import axios from 'axios';

function normalizeGithubUrl(url: string): string {
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
    return parsed.toString();
  }

  if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
    throw new Error('Only GitHub file URLs are supported.');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);

  if (segments.length < 5 || segments[2] !== 'blob') {
    throw new Error('Use a GitHub file URL in /blob/... format, not a repo or folder URL.');
  }

  const [, owner, , branch, ...filePath] = segments;

  if (!owner || !branch || filePath.length === 0) {
    throw new Error('GitHub file URL is incomplete.');
  }

  return `https://raw.githubusercontent.com/${owner}/${segments[1]}/${branch}/${filePath.join('/')}`;
}

export const githubService = {
  async fetchFromUrl(url: string): Promise<string> {
    const rawUrl = normalizeGithubUrl(url);

    try {
      const response = await axios.get(rawUrl, {
        timeout: 10000,
        responseType: 'text',
      });

      return typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          throw new Error('GitHub file not found. Check that the URL points to an existing public file.');
        }

        const message = error.message || 'Unknown network error';
        throw new Error(`Failed to fetch GitHub URL: ${message}`);
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch GitHub URL: ${message}`);
    }
  },
};
