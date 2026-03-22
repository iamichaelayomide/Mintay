import axios from 'axios';

function normalizeGithubUrl(url: string): string {
  if (url.includes('raw.githubusercontent.com')) {
    return url;
  }

  if (url.includes('github.com')) {
    return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
  }

  return url;
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
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch GitHub URL: ${message}`);
    }
  },
};
