import { useCallback, useState } from 'react';

export interface PluginSettings {
  apiKey: string;
  backendUrl: string;
}

interface ImportArgs {
  code?: string;
  githubUrl?: string;
  mode: 'AUTO' | 'MOBILE' | 'DESKTOP' | 'TABLET';
  settings?: PluginSettings;
}

interface ScreenSummary {
  name: string;
  width: number;
  height: number;
  componentType: string;
}

interface ImportState {
  status: 'idle' | 'loading' | 'success' | 'error';
  progress: number;
  statusText: string;
  error: string | null;
  successCount: number;
  screens: ScreenSummary[];
  warnings: string[];
}

const DEFAULT_BACKEND_URL = 'https://mintay.onrender.com';
const SETTINGS_STORAGE_KEY = 'mintay_plugin_settings';
const DEFAULT_PARSE_TIMEOUT_MS = 1800000;

const defaultSettings: PluginSettings = {
  apiKey: '',
  backendUrl: DEFAULT_BACKEND_URL,
};

const initialState: ImportState = {
  status: 'idle',
  progress: 0,
  statusText: 'Ready to import.',
  error: null,
  successCount: 0,
  screens: [],
  warnings: [],
};

function pluginMessageFromEvent(event: MessageEvent) {
  return event.data?.pluginMessage;
}

function readLocalSettings(): PluginSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaultSettings;
    }

    const parsed = JSON.parse(raw) as Partial<PluginSettings>;
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      backendUrl:
        typeof parsed.backendUrl === 'string' && parsed.backendUrl.trim()
          ? parsed.backendUrl
          : DEFAULT_BACKEND_URL,
    };
  } catch {
    return defaultSettings;
  }
}

function writeLocalSettings(settings: PluginSettings): PluginSettings {
  const normalized = {
    apiKey: settings.apiKey || '',
    backendUrl: settings.backendUrl?.trim() || DEFAULT_BACKEND_URL,
  };

  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    return normalized;
  }

  return normalized;
}

function mergeSettings(primary: PluginSettings, fallback: PluginSettings): PluginSettings {
  return {
    apiKey: primary.apiKey || fallback.apiKey || '',
    backendUrl: primary.backendUrl?.trim() || fallback.backendUrl || DEFAULT_BACKEND_URL,
  };
}

function requestPluginData<T>(type: string, data?: unknown, expectedType?: string): Promise<T> {
  const requestId = `${type}_${crypto.randomUUID()}`;

  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Timed out waiting for plugin response.'));
    }, 5000);

    const onMessage = (event: MessageEvent) => {
      const message = pluginMessageFromEvent(event);
      if (!message || message.requestId !== requestId) {
        return;
      }

      if (expectedType && message.type !== expectedType) {
        return;
      }

      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(message.data as T);
    };

    window.addEventListener('message', onMessage);
    parent.postMessage({ pluginMessage: { type, data, requestId } }, '*');
  });
}

export function useImport() {
  const [state, setState] = useState<ImportState>(initialState);

  const loadSettings = useCallback(async (): Promise<PluginSettings> => {
    const localSettings = readLocalSettings();

    try {
      const pluginSettings = await requestPluginData<PluginSettings>(
        'GET_SETTINGS',
        undefined,
        'SETTINGS_VALUE',
      );
      return writeLocalSettings(
        mergeSettings(
          {
            apiKey: pluginSettings.apiKey || '',
            backendUrl: pluginSettings.backendUrl?.trim() || DEFAULT_BACKEND_URL,
          },
          localSettings,
        ),
      );
    } catch {
      return localSettings;
    }
  }, []);

  const saveSettings = useCallback(async (settings: PluginSettings): Promise<PluginSettings> => {
    const normalized = writeLocalSettings(settings);

    try {
      const pluginSettings = await requestPluginData<PluginSettings>(
        'SAVE_SETTINGS',
        normalized,
        'SETTINGS_SAVED',
      );
      return writeLocalSettings(
        mergeSettings(
          {
            apiKey: pluginSettings.apiKey || '',
            backendUrl: pluginSettings.backendUrl?.trim() || DEFAULT_BACKEND_URL,
          },
          normalized,
        ),
      );
    } catch {
      return normalized;
    }
  }, []);

  const resetState = useCallback(() => {
    setState(initialState);
  }, []);

  const handleBuildSuccess = useCallback(
    (message: { count: number; warnings?: string[]; screens?: ScreenSummary[] }) => {
      setState({
        status: 'success',
        progress: 100,
        statusText: 'Import complete.',
        error: null,
        successCount: message.count,
        warnings: message.warnings || [],
        screens: message.screens || [],
      });
    },
    [],
  );

  const handleBuildError = useCallback((message: { message?: string }) => {
    setState((current) => ({
      ...current,
      status: 'error',
      progress: 0,
      error: message.message || 'Mintay hit an unexpected error.',
      statusText: 'Import failed.',
    }));
  }, []);

  const startImport = useCallback(
    async ({ code, githubUrl, mode, settings: currentSettings }: ImportArgs) => {
      const trimmedCode = code?.trim() || '';
      const trimmedUrl = githubUrl?.trim() || '';

      if (!trimmedCode && !trimmedUrl) {
        setState({
          ...initialState,
          status: 'error',
          error: 'Paste code or provide a GitHub URL before importing.',
          statusText: 'Missing input.',
        });
        return;
      }

      setState({
        ...initialState,
        status: 'loading',
        progress: 12,
        statusText: 'Loading local plugin settings...',
      });

      const settings = currentSettings
        ? mergeSettings(writeLocalSettings(currentSettings), await loadSettings())
        : await loadSettings();

      const backendUrl = settings.backendUrl?.trim() || DEFAULT_BACKEND_URL;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), DEFAULT_PARSE_TIMEOUT_MS);

      try {
        setState((current) => ({
          ...current,
          progress: 42,
          statusText: 'Sending code to the Mintay parser. Larger files can take a bit longer...',
        }));

        const response = await fetch(`${backendUrl.replace(/\/$/, '')}/parse`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: trimmedCode || undefined,
            githubUrl: trimmedUrl || undefined,
            mode,
            apiKey: settings.apiKey || undefined,
          }),
          signal: controller.signal,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Mintay could not parse the provided input.');
        }

        if (!result.success) {
          throw new Error(result.error || 'Mintay could not parse the provided input.');
        }

        setState((current) => ({
          ...current,
          progress: 78,
          statusText: 'Drawing editable frames in Figma...',
        }));

        parent.postMessage({ pluginMessage: { type: 'BUILD_SCREENS', data: result } }, '*');
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Mintay waited too long for the parser. Try a candidate file or section if this keeps happening.'
            : error instanceof TypeError
              ? 'Connection failed. Check your Backend URL in settings.'
              : error instanceof Error
                ? error.message
                : 'Mintay hit an unexpected error.';

        setState({
          ...initialState,
          status: 'error',
          error: message,
          statusText: 'Import failed.',
        });
      } finally {
        window.clearTimeout(timeout);
      }
    },
    [loadSettings],
  );

  return {
    state,
    startImport,
    loadSettings,
    saveSettings,
    resetState,
    handleBuildSuccess,
    handleBuildError,
  };
}
