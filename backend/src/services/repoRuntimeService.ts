import axios from 'axios';
import { spawn, type ChildProcess } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const JSZip = require('jszip') as {
  loadAsync(data: Buffer): Promise<{
    files: Record<
      string,
      {
        dir: boolean;
        name: string;
        async(type: 'text' | 'nodebuffer'): Promise<string | Buffer>;
      }
    >;
  }>;
};

interface RepoPrepareResult {
  success: boolean;
  repoId: string;
  projectRoot: string;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  framework: string;
  installCommand: string;
  devCommand: string | null;
  routeCandidates: string[];
  warnings: string[];
}

interface RuntimeIssue {
  code:
    | 'missing_script'
    | 'missing_env'
    | 'unknown_framework'
    | 'monorepo'
    | 'missing_lockfile'
    | 'large_repo'
    | 'install_failed'
    | 'preview_start_failed'
    | 'preview_timeout';
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: string;
}

type RuntimeIssueCode = RuntimeIssue['code'];

interface RepoPreflightResult {
  success: boolean;
  repoId: string;
  readiness: 'ready' | 'limited' | 'needs_input' | 'blocked';
  framework: string;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  projectRoot: string;
  installCommand: string;
  devCommand: string | null;
  routeCandidates: string[];
  envVarNames: string[];
  issues: RuntimeIssue[];
  warnings: string[];
}

interface RepoLaunchResult {
  success: boolean;
  repoId: string;
  status: 'running' | 'failed';
  previewUrl: string | null;
  port: number | null;
  framework: string;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  routeCandidates: string[];
  warnings: string[];
  logs: string[];
}

interface RuntimeSession {
  repoId: string;
  workspacePath: string;
  projectRoot: string;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  framework: string;
  installCommand: string;
  devCommand: string | null;
  routeCandidates: string[];
  warnings: string[];
  status: 'prepared' | 'installing' | 'starting' | 'running' | 'failed' | 'stopped';
  process: ChildProcess | null;
  port: number | null;
  previewUrl: string | null;
  logs: string[];
  lastError: string | null;
  lastFailureCode: RuntimeIssueCode | null;
  preflight: RepoPreflightResult | null;
  envOverrides: Record<string, string>;
}

type GithubRepoTarget = {
  owner: string;
  repo: string;
  branch?: string;
  subdir: string;
};

type PackageJsonShape = {
  private?: boolean;
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

type LaunchStrategy = {
  label: string;
  command: string;
  setupCommand?: string;
  env?: Record<string, string>;
};

const CODELOAD_TIMEOUT_MS = 45_000;
const MAX_ROUTE_CANDIDATES = 20;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const START_TIMEOUT_MS = 2 * 60 * 1000;
const PREVIEW_READY_STATUS_CODES = new Set([200, 204, 301, 302, 307, 308, 401, 403, 404]);
const MAX_ENV_VAR_CANDIDATES = 20;
const MAX_PREFLIGHT_SCAN_FILES = 120;
const runtimeSessions = new Map<string, RuntimeSession>();
let nextPreviewPort = 3200;

function parseGithubRepoTarget(url: string): GithubRepoTarget {
  let parsed: URL;

  try {
    parsed = new URL(url.trim());
  } catch {
    throw new Error('Repository URL is invalid.');
  }

  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    throw new Error('Only GitHub repository URLs are supported for runtime prep.');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new Error('GitHub URL must include an owner and repository.');
  }

  const [owner, repo, mode, branch, ...rest] = segments;

  if (mode === 'tree') {
    return {
      owner,
      repo,
      branch,
      subdir: rest.join('/'),
    };
  }

  return {
    owner,
    repo,
    subdir: '',
  };
}

async function fetchRepoArchive(
  owner: string,
  repo: string,
  preferredBranch?: string,
): Promise<{ branch: string; data: Buffer }> {
  const candidates = Array.from(
    new Set([preferredBranch, 'main', 'master', 'develop', 'dev'].filter(Boolean) as string[]),
  );

  let lastError: unknown = null;

  for (const branch of candidates) {
    try {
      const response = await axios.get<ArrayBuffer>(
        `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`,
        {
          timeout: CODELOAD_TIMEOUT_MS,
          responseType: 'arraybuffer',
          maxContentLength: 100_000_000,
          maxBodyLength: 100_000_000,
          headers: {
            'User-Agent': 'mintay-backend',
          },
          validateStatus: (status) => status >= 200 && status < 300,
        },
      );

      return {
        branch,
        data: Buffer.from(response.data),
      };
    } catch (error) {
      lastError = error;
      const status = axios.isAxiosError(error) ? error.response?.status : undefined;
      if (status && status !== 404) {
        continue;
      }
    }
  }

  if (axios.isAxiosError(lastError) && lastError.response?.status === 403) {
    throw new Error('GitHub blocked the repo archive request with status 403. Try again shortly or use a direct file/folder input.');
  }

  throw new Error('Could not download a repo archive from GitHub. The default branch may not be one of main/master/develop/dev, or the repository may be unavailable.');
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function removeDir(dirPath: string) {
  await fs.rm(dirPath, { recursive: true, force: true });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function detectPackageManager(projectRoot: string): 'npm' | 'pnpm' | 'yarn' {
  if (require('fs').existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (require('fs').existsSync(path.join(projectRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  return 'npm';
}

function resolveInstallCommand(packageManager: 'npm' | 'pnpm' | 'yarn') {
  if (packageManager === 'pnpm') {
    return 'pnpm install';
  }
  if (packageManager === 'yarn') {
    return 'yarn install';
  }
  return 'npm install';
}

function detectFramework(pkg: PackageJsonShape): string {
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  if (deps.next) {
    return 'next';
  }
  if (deps['react-scripts']) {
    return 'cra';
  }
  if (deps.vite) {
    return 'vite';
  }
  if (deps['@angular/core']) {
    return 'angular';
  }
  if (deps.vue || deps.nuxt) {
    return 'vue';
  }
  return 'unknown';
}

function hasFrontendSignals(projectRoot: string, pkg: PackageJsonShape): number {
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };

  let score = 0;
  const framework = detectFramework(pkg);
  const scripts = pkg.scripts || {};
  const normalizedRoot = projectRoot.replace(/\\/g, '/').toLowerCase();
  const name = (pkg.name || '').toLowerCase();

  if (framework !== 'unknown') {
    score += 50;
  }

  if (deps.react || deps['react-dom'] || deps.next || deps.vite || deps.vue || deps.nuxt || deps.svelte) {
    score += 30;
  }

  if (scripts.dev) {
    score += 15;
  }

  if (scripts.preview) {
    score += 10;
  }

  if (
    require('fs').existsSync(path.join(projectRoot, 'app')) ||
    require('fs').existsSync(path.join(projectRoot, 'pages')) ||
    require('fs').existsSync(path.join(projectRoot, 'src', 'app')) ||
    require('fs').existsSync(path.join(projectRoot, 'src', 'pages')) ||
    require('fs').existsSync(path.join(projectRoot, 'components')) ||
    require('fs').existsSync(path.join(projectRoot, 'src', 'components'))
  ) {
    score += 20;
  }

  if (normalizedRoot.includes('/frontend') || normalizedRoot.includes('/web') || normalizedRoot.includes('/app')) {
    score += 12;
  }

  if (normalizedRoot.includes('/backend') || normalizedRoot.includes('/server') || normalizedRoot.includes('/api')) {
    score -= 35;
  }

  if (name.includes('backend') || name.includes('server') || name.includes('api')) {
    score -= 30;
  }

  if (deps.express && !deps.react && !deps.next && !deps.vite && !deps.vue) {
    score -= 20;
  }

  return score;
}

function detectDevCommand(pkg: PackageJsonShape, packageManager: 'npm' | 'pnpm' | 'yarn'): string | null {
  const scripts = pkg.scripts || {};

  if (scripts.dev) {
    return packageManager === 'yarn' ? 'yarn dev' : `${packageManager} run dev`;
  }
  if (scripts.start) {
    return packageManager === 'yarn' ? 'yarn start' : `${packageManager} run start`;
  }
  return null;
}

function getScriptRunner(
  packageManager: 'npm' | 'pnpm' | 'yarn',
  scriptName: string,
  args: string[] = [],
): string {
  if (packageManager === 'yarn') {
    return ['yarn', scriptName, ...args].join(' ');
  }

  if (args.length > 0) {
    return [packageManager, 'run', scriptName, '--', ...args].join(' ');
  }

  return [packageManager, 'run', scriptName].join(' ');
}

function detectPreferredScriptName(pkg: PackageJsonShape): 'dev' | 'start' | null {
  const scripts = pkg.scripts || {};

  if (scripts.dev) {
    return 'dev';
  }

  if (scripts.start) {
    return 'start';
  }

  return null;
}

function resolveLaunchStrategies(
  pkg: PackageJsonShape,
  packageManager: 'npm' | 'pnpm' | 'yarn',
  framework: string,
  port: number,
): LaunchStrategy[] {
  const strategies: LaunchStrategy[] = [];
  const scripts = pkg.scripts || {};
  const preferredScript = detectPreferredScriptName(pkg);

  if (preferredScript) {
    if (framework === 'next') {
      strategies.push({
        label: 'Next.js dev with explicit host/port flags',
        command: getScriptRunner(packageManager, preferredScript, [
          '--hostname',
          '127.0.0.1',
          '--port',
          String(port),
        ]),
        env: {
          HOSTNAME: '127.0.0.1',
        },
      });
    } else if (framework === 'vite' || framework === 'vue') {
      strategies.push({
        label: 'Vite-compatible dev with explicit host/port flags',
        command: getScriptRunner(packageManager, preferredScript, [
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
        ]),
      });
    } else if (framework === 'angular') {
      strategies.push({
        label: 'Angular dev with explicit host/port flags',
        command: getScriptRunner(packageManager, preferredScript, [
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
        ]),
      });
    }

    strategies.push({
      label: 'Script with env-based host/port injection',
      command: getScriptRunner(packageManager, preferredScript),
      env: {
        HOST: '127.0.0.1',
        HOSTNAME: '127.0.0.1',
      },
    });
  }

  if (scripts.build && scripts.preview) {
    strategies.push({
      label: 'Build and preview fallback',
      setupCommand: getScriptRunner(packageManager, 'build'),
      command: getScriptRunner(packageManager, 'preview', ['--host', '127.0.0.1', '--port', String(port)]),
    });
  }

  return strategies.filter(
    (strategy, index, all) =>
      all.findIndex(
        (other) =>
          other.command === strategy.command &&
          (other.setupCommand || '') === (strategy.setupCommand || ''),
      ) === index,
  );
}

function hasLockfile(projectRoot: string) {
  return (
    require('fs').existsSync(path.join(projectRoot, 'package-lock.json')) ||
    require('fs').existsSync(path.join(projectRoot, 'pnpm-lock.yaml')) ||
    require('fs').existsSync(path.join(projectRoot, 'yarn.lock'))
  );
}

function hasWorkspaceConfig(pkg: PackageJsonShape) {
  if (!pkg.workspaces) {
    return false;
  }

  if (Array.isArray(pkg.workspaces)) {
    return pkg.workspaces.length > 0;
  }

  return Array.isArray(pkg.workspaces.packages) && pkg.workspaces.packages.length > 0;
}

async function findProjectRoot(extractRoot: string, subdir: string): Promise<string> {
  const desiredRoot = subdir ? path.join(extractRoot, subdir) : extractRoot;
  const candidates: { root: string; score: number }[] = [];
  if (await fileExists(path.join(desiredRoot, 'package.json'))) {
    try {
      const rootPkg = JSON.parse(await fs.readFile(path.join(desiredRoot, 'package.json'), 'utf8')) as PackageJsonShape;
      candidates.push({
        root: desiredRoot,
        score: hasFrontendSignals(desiredRoot, rootPkg),
      });
    } catch {
      candidates.push({
        root: desiredRoot,
        score: 0,
      });
    }
  }

  const queue = [desiredRoot];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await fs.readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) {
        continue;
      }

      const nextPath = path.join(current, entry.name);
      if (await fileExists(path.join(nextPath, 'package.json'))) {
        try {
          const pkg = JSON.parse(await fs.readFile(path.join(nextPath, 'package.json'), 'utf8')) as PackageJsonShape;
          candidates.push({
            root: nextPath,
            score: hasFrontendSignals(nextPath, pkg),
          });
        } catch {
          candidates.push({
            root: nextPath,
            score: 0,
          });
        }
      }

      queue.push(nextPath);
    }
  }

  if (candidates.length > 0) {
    candidates.sort((left, right) => right.score - left.score);
    return candidates[0].root;
  }

  throw new Error('Could not find a runnable package.json in the extracted repository.');
}

async function listRouteCandidates(projectRoot: string, framework: string): Promise<string[]> {
  const candidates: string[] = [];
  const roots =
    framework === 'next'
      ? ['app', 'pages', path.join('src', 'app'), path.join('src', 'pages')]
      : ['src', 'pages', 'app'];

  for (const relativeRoot of roots) {
    const absoluteRoot = path.join(projectRoot, relativeRoot);
    if (!(await fileExists(absoluteRoot))) {
      continue;
    }

    const stack = [absoluteRoot];
    while (stack.length > 0 && candidates.length < MAX_ROUTE_CANDIDATES) {
      const current = stack.pop()!;
      const entries = await fs.readdir(current, { withFileTypes: true });

      for (const entry of entries) {
        const nextPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(nextPath);
          continue;
        }

        if (!/\.(tsx|ts|jsx|js|html)$/i.test(entry.name)) {
          continue;
        }

        const relativePath = path.relative(projectRoot, nextPath).replace(/\\/g, '/');
        candidates.push(relativePath);
        if (candidates.length >= MAX_ROUTE_CANDIDATES) {
          break;
        }
      }
    }
  }

  return Array.from(new Set(candidates));
}

async function collectPrefightScanFiles(projectRoot: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [
    path.join(projectRoot, 'src'),
    path.join(projectRoot, 'app'),
    path.join(projectRoot, 'pages'),
    path.join(projectRoot, 'components'),
    projectRoot,
  ].filter((value, index, all) => all.indexOf(value) === index);

  while (queue.length > 0 && files.length < MAX_PREFLIGHT_SCAN_FILES) {
    const current = queue.shift()!;
    if (!(await fileExists(current))) {
      continue;
    }

    const stat = await fs.stat(current);
    if (!stat.isDirectory()) {
      continue;
    }

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo'].includes(entry.name)) {
          continue;
        }
        queue.push(nextPath);
        continue;
      }

      if (!/\.(tsx|ts|jsx|js|mjs|cjs|json|html|css|scss|sass|mdx|md)$/i.test(entry.name)) {
        continue;
      }

      files.push(nextPath);
      if (files.length >= MAX_PREFLIGHT_SCAN_FILES) {
        break;
      }
    }
  }

  return files;
}

async function detectEnvVarNames(projectRoot: string, pkg: PackageJsonShape): Promise<string[]> {
  const names = new Set<string>();
  const envTemplateFiles = [
    '.env.example',
    '.env.sample',
    '.env.template',
    '.env.local.example',
    '.env.development.example',
  ].map((fileName) => path.join(projectRoot, fileName));

  for (const templatePath of envTemplateFiles) {
    if (!(await fileExists(templatePath))) {
      continue;
    }

    const content = await fs.readFile(templatePath, 'utf8');
    for (const match of content.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*=/gm)) {
      names.add(match[1]);
    }
  }

  const scripts = Object.values(pkg.scripts || {}).join('\n');
  for (const match of scripts.matchAll(/\b([A-Z][A-Z0-9_]{2,})\b/g)) {
    if (!['NODE', 'PORT', 'HOST', 'PATH', 'CI'].includes(match[1])) {
      names.add(match[1]);
    }
  }

  const scanFiles = await collectPrefightScanFiles(projectRoot);
  for (const filePath of scanFiles) {
    const content = await fs.readFile(filePath, 'utf8');

    for (const match of content.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) {
      names.add(match[1]);
    }

    for (const match of content.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]+)/g)) {
      names.add(match[1]);
    }
  }

  return Array.from(names)
    .filter((name) => !['NODE_ENV', 'PORT', 'HOST', 'CI', 'BROWSER'].includes(name))
    .sort()
    .slice(0, MAX_ENV_VAR_CANDIDATES);
}

async function buildPreflightReport(session: RuntimeSession, pkg: PackageJsonShape): Promise<RepoPreflightResult> {
  const issues: RuntimeIssue[] = [];
  const warnings = [...session.warnings];
  const envVarNames = await detectEnvVarNames(session.projectRoot, pkg);

  if (!session.devCommand) {
    issues.push({
      code: 'missing_script',
      severity: 'error',
      message: 'No runnable dev/start script was detected in package.json.',
      details: 'Add a dev or start script, or teach Mintay which script should launch the preview.',
    });
  }

  if (envVarNames.length > 0) {
    issues.push({
      code: 'missing_env',
      severity: 'warning',
      message: `This repo appears to depend on ${envVarNames.length} environment variable(s).`,
      details: envVarNames.join(', '),
    });
  }

  if (session.framework === 'unknown') {
    issues.push({
      code: 'unknown_framework',
      severity: 'warning',
      message: 'Framework detection is unknown, so Mintay may need a fallback launch strategy.',
    });
  }

  if (hasWorkspaceConfig(pkg)) {
    issues.push({
      code: 'monorepo',
      severity: 'warning',
      message: 'This looks like a monorepo/workspace package, and Mintay may need a more specific app root.',
      details: 'If launch fails, pick the actual frontend package instead of the workspace root.',
    });
  }

  if (!hasLockfile(session.projectRoot)) {
    issues.push({
      code: 'missing_lockfile',
      severity: 'info',
      message: 'No lockfile was found in the detected project root.',
      details: 'Install may still work, but dependency resolution could be slower or less deterministic.',
    });
  }

  const routeCount = session.routeCandidates.length;
  if (routeCount >= Math.min(MAX_ROUTE_CANDIDATES, 10)) {
    issues.push({
      code: 'large_repo',
      severity: 'info',
      message: 'Mintay found many candidate route files in this project.',
      details: 'That is fine, but route selection before extraction will usually produce better screen results.',
    });
  }

  let readiness: RepoPreflightResult['readiness'] = 'ready';
  if (issues.some((issue) => issue.severity === 'error')) {
    readiness = 'blocked';
  } else if (issues.some((issue) => issue.code === 'missing_env')) {
    readiness = 'needs_input';
  } else if (issues.some((issue) => issue.severity === 'warning')) {
    readiness = 'limited';
  }

  return {
    success: true,
    repoId: session.repoId,
    readiness,
    framework: session.framework,
    packageManager: session.packageManager,
    projectRoot: session.projectRoot,
    installCommand: session.installCommand,
    devCommand: session.devCommand,
    routeCandidates: session.routeCandidates,
    envVarNames,
    issues,
    warnings,
  };
}

function appendLog(session: RuntimeSession, message: string) {
  session.logs.push(message);
  if (session.logs.length > 200) {
    session.logs.splice(0, session.logs.length - 200);
  }
}

function reservePort() {
  const port = nextPreviewPort;
  nextPreviewPort += 1;
  if (nextPreviewPort > 3999) {
    nextPreviewPort = 3200;
  }
  return port;
}

function sanitizeEnvOverrides(input: Record<string, string> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(input || {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      continue;
    }

    normalized[key] = String(value ?? '');
  }

  return normalized;
}

function getShellInvocation(command: string) {
  if (process.platform === 'win32') {
    return {
      shell: 'cmd.exe',
      args: ['/c', command],
    };
  }

  return {
    shell: 'sh',
    args: ['-lc', command],
  };
}

function runCommand(command: string, cwd: string, session: RuntimeSession, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const invocation = getShellInvocation(command);
    const child = spawn(invocation.shell, invocation.args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command timed out: ${command}`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => appendLog(session, String(chunk).trim()));
    child.stderr?.on('data', (chunk) => appendLog(session, String(chunk).trim()));

    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed (${code ?? 'unknown'}): ${command}`));
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function killProcessTree(child: ChildProcess | null) {
  if (!child || child.killed) {
    return;
  }

  child.kill('SIGTERM');
}

async function waitForPreview(url: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await axios.get(url, {
        timeout: 5000,
        validateStatus: () => true,
      });
      if (PREVIEW_READY_STATUS_CODES.has(response.status)) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new Error('Timed out waiting for the preview server to start.');
}

function sanitizePrepareResult(session: RuntimeSession): RepoPrepareResult {
  return {
    success: true,
    repoId: session.repoId,
    projectRoot: session.projectRoot,
    packageManager: session.packageManager,
    framework: session.framework,
    installCommand: session.installCommand,
    devCommand: session.devCommand,
    routeCandidates: session.routeCandidates,
    warnings: session.warnings,
  };
}

function sanitizeLaunchResult(session: RuntimeSession): RepoLaunchResult {
  return {
    success: session.status === 'running',
    repoId: session.repoId,
    status: session.status === 'running' ? 'running' : 'failed',
    previewUrl: session.previewUrl,
    port: session.port,
    framework: session.framework,
    packageManager: session.packageManager,
    routeCandidates: session.routeCandidates,
    warnings: session.warnings,
    logs: session.logs.slice(-40),
  };
}

function classifyLaunchFailure(
  session: RuntimeSession,
  phase: 'install' | 'start',
  error: unknown,
): RuntimeIssue {
  const message = error instanceof Error ? error.message : 'Runtime launch failed.';
  const combinedLogs = session.logs.join('\n');

  if (phase === 'install') {
    return {
      code: 'install_failed',
      severity: 'error',
      message: 'Dependency installation failed before the preview server could start.',
      details: /ERR_PNPM|pnpm/i.test(combinedLogs)
        ? 'pnpm install failed. This repo may need a workspace-aware root or a specific package filter.'
        : /ECONNRESET|ENOTFOUND|network/i.test(combinedLogs)
          ? 'Package installation failed due to a network or registry issue.'
          : message,
    };
  }

  if (/Timed out waiting for the preview server to start/i.test(message)) {
    return {
      code: 'preview_timeout',
      severity: 'error',
      message: 'The preview server never became reachable on the expected port.',
      details: 'This usually means the repo binds to a different host/port, needs extra env vars, or crashed during startup.',
    };
  }

  return {
    code: 'preview_start_failed',
    severity: 'error',
    message: 'The preview process exited before Mintay could extract the rendered app.',
    details: /Missing script|missing script/i.test(combinedLogs)
      ? 'The detected launch command is not valid for this repo.'
      : message,
  };
}

async function attemptLaunchStrategy(
  session: RuntimeSession,
  strategy: LaunchStrategy,
): Promise<RepoLaunchResult> {
  if (!session.port || !session.previewUrl) {
    throw new Error('Preview port was not reserved before launch.');
  }

  appendLog(session, `Trying launch strategy: ${strategy.label}`);

  if (strategy.setupCommand) {
    appendLog(session, `Running setup command: ${strategy.setupCommand}`);
    await runCommand(strategy.setupCommand, session.projectRoot, session, INSTALL_TIMEOUT_MS);
  }

  appendLog(session, `Starting preview server with ${strategy.command} on ${session.previewUrl}`);

  const invocation = getShellInvocation(strategy.command);
  const child = spawn(invocation.shell, invocation.args, {
    cwd: session.projectRoot,
    env: {
      ...process.env,
      ...session.envOverrides,
      ...(strategy.env || {}),
      PORT: String(session.port),
      HOST: '127.0.0.1',
      HOSTNAME: '127.0.0.1',
      BROWSER: 'none',
      CI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  session.process = child;
  child.stdout?.on('data', (chunk) => appendLog(session, String(chunk).trim()));
  child.stderr?.on('data', (chunk) => appendLog(session, String(chunk).trim()));
  child.on('exit', (code) => {
    if (session.status !== 'stopped' && session.status !== 'running') {
      session.status = 'failed';
      session.lastError = `Preview process exited with code ${code ?? 'unknown'}`;
    }
  });

  try {
    await waitForPreview(session.previewUrl, START_TIMEOUT_MS);
    session.status = 'running';
    return sanitizeLaunchResult(session);
  } catch (error) {
    killProcessTree(child);
    session.process = null;
    throw error;
  }
}

export const repoRuntimeService = {
  async prepareFromGithubUrl(url: string): Promise<RepoPrepareResult> {
    const target = parseGithubRepoTarget(url);
    const archive = await fetchRepoArchive(target.owner, target.repo, target.branch);
    const branch = archive.branch;
    const repoId = createHash('sha1').update(`${target.owner}/${target.repo}:${branch}:${target.subdir}`).digest('hex').slice(0, 12);
    const workspacePath = path.join(os.tmpdir(), 'mintay-runtime', `${repoId}-${randomUUID()}`);
    const extractRoot = path.join(workspacePath, 'repo');

    await removeDir(workspacePath);
    await ensureDir(extractRoot);

    try {
      const zip = await JSZip.loadAsync(archive.data);
      for (const entry of Object.values(zip.files)) {
        const segments = entry.name.split('/').filter(Boolean);
        if (segments.length < 2) {
          continue;
        }

        const relativePath = path.join(...segments.slice(1));
        const outputPath = path.join(extractRoot, relativePath);

        if (entry.dir) {
          await ensureDir(outputPath);
          continue;
        }

        await ensureDir(path.dirname(outputPath));
        const content = await entry.async('nodebuffer');
        await fs.writeFile(outputPath, content as Buffer);
      }

      const projectRoot = await findProjectRoot(extractRoot, target.subdir);
      const pkg = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')) as PackageJsonShape;
      const packageManager = detectPackageManager(projectRoot);
      const scripts = pkg.scripts || {};
      const framework = detectFramework(pkg);
      const devCommand = detectDevCommand(pkg, packageManager);
      const routeCandidates = await listRouteCandidates(projectRoot, framework);
      const warnings: string[] = [];

      if (!devCommand) {
        warnings.push('No dev/start script was detected yet. Runtime launch may need manual configuration.');
      }
      if (framework === 'unknown') {
        warnings.push('Framework detection is unknown. Runner support is currently strongest for Next.js, Vite, and CRA-style apps.');
      }
      if (scripts.build && scripts.preview) {
        warnings.push('Build and preview fallback is available if the default dev launch does not bind cleanly.');
      }

      const session: RuntimeSession = {
        repoId,
        workspacePath,
        projectRoot,
        packageManager,
        framework,
        installCommand: resolveInstallCommand(packageManager),
        devCommand,
        routeCandidates,
        warnings,
        status: 'prepared',
        process: null,
        port: null,
        previewUrl: null,
        logs: [],
        lastError: null,
        lastFailureCode: null,
        preflight: null,
        envOverrides: {},
      };

      session.preflight = await buildPreflightReport(session, pkg);

      runtimeSessions.set(repoId, session);
      return sanitizePrepareResult(session);
    } catch (error) {
      await removeDir(workspacePath);
      const message = error instanceof Error ? error.message : 'Could not prepare repository runtime workspace.';
      throw new Error(message);
    }
  },

  async launch(repoId: string, envOverrides?: Record<string, string>): Promise<RepoLaunchResult> {
    const session = runtimeSessions.get(repoId);
    if (!session) {
      throw new Error('Runtime session not found. Prepare the repository first.');
    }

    session.envOverrides = sanitizeEnvOverrides(envOverrides);

    if (!session.devCommand) {
      session.lastFailureCode = 'missing_script';
      throw new Error('No dev/start command detected for this repository.');
    }

    if (session.process && session.status === 'running') {
      return sanitizeLaunchResult(session);
    }

    session.status = 'installing';
    appendLog(session, `Installing dependencies with ${session.installCommand}`);
    try {
      await runCommand(session.installCommand, session.projectRoot, session, INSTALL_TIMEOUT_MS);
    } catch (error) {
      session.status = 'failed';
      session.lastFailureCode = 'install_failed';
      const failure = classifyLaunchFailure(session, 'install', error);
      session.lastError = failure.details || failure.message;
      throw new Error(failure.message + (failure.details ? ` ${failure.details}` : ''));
    }

    session.status = 'starting';
    session.lastFailureCode = null;
    session.port = reservePort();
    session.previewUrl = `http://127.0.0.1:${session.port}`;
    const pkg = JSON.parse(await fs.readFile(path.join(session.projectRoot, 'package.json'), 'utf8')) as PackageJsonShape;
    const strategies = resolveLaunchStrategies(pkg, session.packageManager, session.framework, session.port);

    if (strategies.length === 0) {
      session.lastFailureCode = 'missing_script';
      throw new Error('No supported launch strategy could be constructed for this repository.');
    }

    for (const strategy of strategies) {
      try {
        return await attemptLaunchStrategy(session, strategy);
      } catch (error) {
        appendLog(session, `Launch strategy failed: ${strategy.label}`);
        appendLog(session, error instanceof Error ? error.message : 'Unknown launch failure');
      }
    }

    session.status = 'failed';
    const failure = classifyLaunchFailure(session, 'start', new Error('Timed out waiting for the preview server to start.'));
    session.lastFailureCode = failure.code;
    session.lastError = failure.details || failure.message;
    throw new Error(failure.message + (failure.details ? ` ${failure.details}` : ''));
  },

  async preflight(repoId: string): Promise<RepoPreflightResult> {
    const session = runtimeSessions.get(repoId);
    if (!session) {
      throw new Error('Runtime session not found. Prepare the repository first.');
    }

    if (session.preflight) {
      return session.preflight;
    }

    const pkg = JSON.parse(await fs.readFile(path.join(session.projectRoot, 'package.json'), 'utf8')) as PackageJsonShape;
    session.preflight = await buildPreflightReport(session, pkg);
    return session.preflight;
  },

  getStatus(repoId: string) {
    const session = runtimeSessions.get(repoId);
    if (!session) {
      throw new Error('Runtime session not found.');
    }

    return {
      success: session.status === 'running' || session.status === 'prepared' || session.status === 'starting' || session.status === 'installing',
      repoId: session.repoId,
      status: session.status,
      previewUrl: session.previewUrl,
      port: session.port,
      framework: session.framework,
      packageManager: session.packageManager,
      routeCandidates: session.routeCandidates,
      warnings: session.warnings,
      logs: session.logs.slice(-40),
      error: session.lastError,
      failureCode: session.lastFailureCode,
      preflight: session.preflight,
    };
  },

  async stop(repoId: string) {
    const session = runtimeSessions.get(repoId);
    if (!session) {
      throw new Error('Runtime session not found.');
    }

    session.status = 'stopped';
    session.process?.kill('SIGTERM');
    session.process = null;
    await removeDir(session.workspacePath);
    runtimeSessions.delete(repoId);

    return {
      success: true,
      repoId,
      stopped: true,
    };
  },
};
