import axios from 'axios';

const JSZip = require('jszip') as {
  loadAsync(data: Buffer): Promise<{
    files: Record<
      string,
      {
        dir: boolean;
        name: string;
        async(type: 'text'): Promise<string>;
      }
    >;
  }>;
};

type GithubTarget =
  | {
      kind: 'raw';
      rawUrl: string;
    }
  | {
      kind: 'blob';
      owner: string;
      repo: string;
      branch: string;
      path: string;
    }
  | {
      kind: 'tree';
      owner: string;
      repo: string;
      branch?: string;
      path: string;
    }
  | {
      kind: 'repo';
      owner: string;
      repo: string;
    };

interface GithubContentItem {
  type: 'file' | 'dir';
  name: string;
  path: string;
  download_url: string | null;
}

interface GithubRepoResponse {
  default_branch: string;
}

interface ResolvedGithubFile {
  path: string;
  content: string;
  score: number;
}

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_FETCHED_FILES = 40;
const MAX_FILE_BYTES = 200_000;
const MAX_REPO_CONTEXT_CHARS = 120_000;
const MAX_EMBEDDED_FILES = 18;
const PRIMARY_FILE_CHAR_LIMIT = 12_000;
const SECONDARY_FILE_CHAR_LIMIT = 6_000;
const INCLUDE_EXTENSIONS = new Set([
  '.tsx',
  '.ts',
  '.jsx',
  '.js',
  '.html',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.json',
]);
const PRIORITY_FILE_NAMES = [
  'page.tsx',
  'page.jsx',
  'index.tsx',
  'index.jsx',
  'app.tsx',
  'app.jsx',
  'main.tsx',
  'main.jsx',
  'layout.tsx',
  'layout.jsx',
];

function parseGithubTarget(url: string): GithubTarget {
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    throw new Error('GitHub URL is empty.');
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmedUrl);
  } catch {
    throw new Error('GitHub URL is invalid.');
  }

  if (parsed.hostname === 'raw.githubusercontent.com') {
    return {
      kind: 'raw',
      rawUrl: parsed.toString(),
    };
  }

  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    throw new Error('Only GitHub URLs are supported.');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);

  if (segments.length < 2) {
    throw new Error('GitHub URL must include an owner and repository.');
  }

  const [owner, repo, mode, branch, ...rest] = segments;

  if (!mode) {
    return { kind: 'repo', owner, repo };
  }

  if (mode === 'blob') {
    if (!branch || rest.length === 0) {
      throw new Error('GitHub file URL is incomplete.');
    }

    return {
      kind: 'blob',
      owner,
      repo,
      branch,
      path: rest.join('/'),
    };
  }

  if (mode === 'tree') {
    return {
      kind: 'tree',
      owner,
      repo,
      branch,
      path: rest.join('/'),
    };
  }

  return { kind: 'repo', owner, repo };
}

function extensionOf(path: string): string {
  const dotIndex = path.lastIndexOf('.');
  return dotIndex === -1 ? '' : path.slice(dotIndex).toLowerCase();
}

function shouldIncludeFile(path: string): boolean {
  return INCLUDE_EXTENSIONS.has(extensionOf(path));
}

function scorePath(path: string): number {
  const lower = path.toLowerCase();
  let score = 0;

  for (let index = 0; index < PRIORITY_FILE_NAMES.length; index += 1) {
    if (lower.endsWith(PRIORITY_FILE_NAMES[index])) {
      score += 100 - index;
    }
  }

  if (lower.includes('/app/')) {
    score += 20;
  }
  if (lower.includes('/src/')) {
    score += 15;
  }
  if (lower.includes('/components/')) {
    score += 10;
  }
  if (lower.endsWith('.tsx') || lower.endsWith('.jsx')) {
    score += 12;
  }
  if (lower.endsWith('.css') || lower.endsWith('.scss')) {
    score += 4;
  }

  return score;
}

function normalizeSnippet(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trimSnippet(content: string, limit: number): string {
  if (content.length <= limit) {
    return content;
  }

  return `${content.slice(0, limit)}\n/* truncated */`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await axios.get<T>(url, {
    timeout: 15000,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mintay-backend',
    },
  });

  return response.data;
}

async function fetchText(url: string): Promise<string> {
  const response = await axios.get(url, {
    timeout: 15000,
    responseType: 'text',
    maxContentLength: MAX_FILE_BYTES,
    maxBodyLength: MAX_FILE_BYTES,
    headers: {
      'User-Agent': 'mintay-backend',
    },
  });

  return typeof response.data === 'string'
    ? response.data
    : JSON.stringify(response.data, null, 2);
}

async function fetchDefaultBranch(owner: string, repo: string): Promise<string> {
  const repoData = await fetchJson<GithubRepoResponse>(`${GITHUB_API_BASE}/repos/${owner}/${repo}`);
  return repoData.default_branch;
}

async function listContents(
  owner: string,
  repo: string,
  branch: string,
  dirPath: string,
): Promise<GithubContentItem[]> {
  const encodedPath = dirPath
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const data = await fetchJson<GithubContentItem[] | GithubContentItem>(url);
  return Array.isArray(data) ? data : [data];
}

async function collectFilesFromDirectory(
  owner: string,
  repo: string,
  branch: string,
  dirPath: string,
): Promise<GithubContentItem[]> {
  const queue = [dirPath];
  const collected: GithubContentItem[] = [];

  while (queue.length > 0 && collected.length < MAX_FETCHED_FILES * 2) {
    const currentPath = queue.shift() || '';
    const items = await listContents(owner, repo, branch, currentPath);

    for (const item of items) {
      if (item.type === 'dir') {
        if (
          item.path.includes('node_modules') ||
          item.path.includes('.next') ||
          item.path.includes('dist/') ||
          item.path.startsWith('dist/')
        ) {
          continue;
        }

        queue.push(item.path);
        continue;
      }

      if (item.download_url && shouldIncludeFile(item.path)) {
        collected.push(item);
      }
    }
  }

  return collected
    .sort((left, right) => scorePath(right.path) - scorePath(left.path))
    .slice(0, MAX_FETCHED_FILES);
}

function buildRepoDigest(files: ResolvedGithubFile[]): string {
  const prioritizedFiles = [...files]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_EMBEDDED_FILES);

  const totalFileCount = files.length;
  let remainingBudget = MAX_REPO_CONTEXT_CHARS;
  const sections: string[] = [];

  const manifest = prioritizedFiles
    .map((file, index) => `${index + 1}. ${file.path}`)
    .join('\n');

  const header = [
    '/* Mintay GitHub repo digest */',
    `Included files: ${prioritizedFiles.length} of ${totalFileCount}`,
    'Prioritized file manifest:',
    manifest,
    '',
  ].join('\n');

  sections.push(header);
  remainingBudget -= header.length;

  prioritizedFiles.forEach((file, index) => {
    if (remainingBudget <= 0) {
      return;
    }

    const fileLimit = index < 6 ? PRIMARY_FILE_CHAR_LIMIT : SECONDARY_FILE_CHAR_LIMIT;
    const normalized = normalizeSnippet(file.content);
    const trimmed = trimSnippet(normalized, Math.min(fileLimit, remainingBudget));
    const block = `// File: ${file.path}\n${trimmed}\n`;

    sections.push(block);
    remainingBudget -= block.length + 2;
  });

  const omittedCount = Math.max(0, totalFileCount - prioritizedFiles.length);
  if (omittedCount > 0 && remainingBudget > 40) {
    sections.push(`/* ${omittedCount} additional supported files omitted after prioritization */`);
  }

  return sections.join('\n\n');
}

async function loadRepoArchive(
  owner: string,
  repo: string,
  branch: string,
  dirPath: string,
): Promise<ResolvedGithubFile[]> {
  const response = await axios.get<ArrayBuffer>(
    `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`,
    {
      timeout: 30000,
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'mintay-backend',
      },
      maxContentLength: 50_000_000,
      maxBodyLength: 50_000_000,
    },
  );

  const zip = await JSZip.loadAsync(Buffer.from(response.data));
  const normalizedDirPath = dirPath.replace(/^\/+|\/+$/g, '').toLowerCase();
  const resolvedFiles: ResolvedGithubFile[] = [];

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  for (const entry of entries) {
    const parts = entry.name.split('/').filter(Boolean);
    if (parts.length < 2) {
      continue;
    }

    const repoRelativePath = parts.slice(1).join('/');
    const lowerPath = repoRelativePath.toLowerCase();

    if (
      lowerPath.includes('/node_modules/') ||
      lowerPath.startsWith('node_modules/') ||
      lowerPath.includes('/.next/') ||
      lowerPath.startsWith('.next/') ||
      lowerPath.includes('/dist/') ||
      lowerPath.startsWith('dist/')
    ) {
      continue;
    }

    if (normalizedDirPath && lowerPath !== normalizedDirPath && !lowerPath.startsWith(`${normalizedDirPath}/`)) {
      continue;
    }

    if (!shouldIncludeFile(repoRelativePath)) {
      continue;
    }

    const content = await entry.async('text');
    if (!content.trim()) {
      continue;
    }

    resolvedFiles.push({
      path: repoRelativePath,
      content,
      score: scorePath(repoRelativePath),
    });

    if (resolvedFiles.length >= MAX_FETCHED_FILES) {
      break;
    }
  }

  return resolvedFiles
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_FETCHED_FILES);
}

export const githubService = {
  async fetchFromUrl(url: string): Promise<string> {
    const target = parseGithubTarget(url);

    try {
      if (target.kind === 'raw') {
        return await fetchText(target.rawUrl);
      }

      if (target.kind === 'blob') {
        return await fetchText(
          `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${target.branch}/${target.path}`,
        );
      }

      if (target.kind === 'repo' || target.kind === 'tree') {
        const branch =
          target.kind === 'tree' && target.branch
            ? target.branch
            : await fetchDefaultBranch(target.owner, target.repo);
        const dirPath = target.kind === 'tree' ? target.path : '';

        let resolvedFiles: ResolvedGithubFile[];

        try {
          const files = await collectFilesFromDirectory(
            target.owner,
            target.repo,
            branch,
            dirPath,
          );

          if (files.length === 0) {
            throw new Error('No supported frontend files were found in that GitHub location.');
          }

          resolvedFiles = await Promise.all(
            files.map(async (file) => ({
              path: file.path,
              score: scorePath(file.path),
              content: await fetchText(file.download_url || ''),
            })),
          );
        } catch (error) {
          if (!axios.isAxiosError(error) || error.response?.status !== 403) {
            throw error;
          }

          resolvedFiles = await loadRepoArchive(target.owner, target.repo, branch, dirPath);
        }

        if (resolvedFiles.length === 0) {
          throw new Error('No supported frontend files were found in that GitHub location.');
        }

        return buildRepoDigest(resolvedFiles);
      }

      throw new Error('Unsupported GitHub URL.');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error('GitHub file or repository not found. Check that the URL is public and exists.');
        }

        if (error.response?.status === 403) {
          throw new Error('GitHub request was blocked or rate-limited. Try again shortly.');
        }

        const message = error.message || 'Unknown network error';
        throw new Error(`Failed to fetch GitHub URL: ${message}`);
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(message);
    }
  },
};
