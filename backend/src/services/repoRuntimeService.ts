import axios from 'axios';
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
  workspacePath: string;
  projectRoot: string;
  packageManager: 'npm' | 'pnpm' | 'yarn';
  framework: string;
  installCommand: string;
  devCommand: string | null;
  routeCandidates: string[];
  warnings: string[];
}

type GithubRepoTarget = {
  owner: string;
  repo: string;
  branch?: string;
  subdir: string;
};

type PackageJsonShape = {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const CODELOAD_TIMEOUT_MS = 45_000;
const MAX_ROUTE_CANDIDATES = 20;

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

async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  const response = await axios.get<{ default_branch: string }>(`https://api.github.com/repos/${owner}/${repo}`, {
    timeout: 15_000,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mintay-backend',
    },
  });

  return response.data.default_branch;
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

async function findProjectRoot(extractRoot: string, subdir: string): Promise<string> {
  const desiredRoot = subdir ? path.join(extractRoot, subdir) : extractRoot;
  if (await fileExists(path.join(desiredRoot, 'package.json'))) {
    return desiredRoot;
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
        return nextPath;
      }

      queue.push(nextPath);
    }
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

export const repoRuntimeService = {
  async prepareFromGithubUrl(url: string): Promise<RepoPrepareResult> {
    const target = parseGithubRepoTarget(url);
    const branch = target.branch || (await fetchDefaultBranch(target.owner, target.repo));
    const repoId = createHash('sha1').update(`${target.owner}/${target.repo}:${branch}:${target.subdir}`).digest('hex').slice(0, 12);
    const workspacePath = path.join(os.tmpdir(), 'mintay-runtime', `${repoId}-${randomUUID()}`);
    const extractRoot = path.join(workspacePath, 'repo');

    await removeDir(workspacePath);
    await ensureDir(extractRoot);

    try {
      const response = await axios.get<ArrayBuffer>(
        `https://codeload.github.com/${target.owner}/${target.repo}/zip/refs/heads/${branch}`,
        {
          timeout: CODELOAD_TIMEOUT_MS,
          responseType: 'arraybuffer',
          maxContentLength: 100_000_000,
          maxBodyLength: 100_000_000,
          headers: {
            'User-Agent': 'mintay-backend',
          },
        },
      );

      const zip = await JSZip.loadAsync(Buffer.from(response.data));
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

      return {
        success: true,
        repoId,
        workspacePath,
        projectRoot,
        packageManager,
        framework,
        installCommand: resolveInstallCommand(packageManager),
        devCommand,
        routeCandidates,
        warnings,
      };
    } catch (error) {
      await removeDir(workspacePath);
      const message = error instanceof Error ? error.message : 'Could not prepare repository runtime workspace.';
      throw new Error(message);
    }
  },
};
