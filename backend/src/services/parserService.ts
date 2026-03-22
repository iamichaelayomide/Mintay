const MAX_PREPROCESSED_CHARS = 120000;

export const parserService = {
  preProcess(code: string): string {
    let processed = code;

    processed = processed.replace(/^import\s+.*?from\s+['"][^'"]+['"]\s*;?\s*$/gm, '');
    processed = processed.replace(/^export\s+default\s+/gm, '');
    processed = processed.replace(/^export\s+/gm, '');
    processed = processed.replace(/\/\*[\s\S]*?\*\//g, '');
    processed = processed.replace(/^\s*\/\/.*$/gm, '');
    processed = processed.replace(/:\s*[A-Za-z0-9_<>{}\[\]\s|&?,]+(?=[,)=;])/g, '');
    processed = processed.replace(/\n{3,}/g, '\n\n').trim();

    if (processed.length > MAX_PREPROCESSED_CHARS) {
      processed = `${processed.slice(0, MAX_PREPROCESSED_CHARS)}\n... [truncated]`;
    }

    return processed;
  },
};
