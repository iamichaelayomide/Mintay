import axios from 'axios';

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

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_FETCHED_FILES = 24;
const MAX_FILE_BYTES = 200_000;
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
  const url = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${encodedPath}${encodedPath ? '' : ''}?ref=${encodeURIComponent(branch)}`;
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

function combineFiles(files: Array<{ path: string; content: string }>): string {
  return files
    .map((file) => `// File: ${file.path}\n${file.content.trim()}\n`)
    .join('\n\n');
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
        const files = await collectFilesFromDirectory(
          target.owner,
          target.repo,
          branch,
          dirPath,
        );

        if (files.length === 0) {
          throw new Error('No supported frontend files were found in that GitHub location.');
        }

        const resolvedFiles = await Promise.all(
          files.map(async (file) => ({
            path: file.path,
            content: await fetchText(file.download_url || ''),
          })),
        );

        return combineFiles(resolvedFiles);
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
