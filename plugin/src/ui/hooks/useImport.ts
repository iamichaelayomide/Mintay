import { useCallback, useState } from 'react';
import type { MintayParseResult, MintayScreen } from '@shared/types/mintaySchema';

export interface PluginSettings {
  apiKey: string;
  backendUrl: string;
  runtimeEnv: string;
}

interface ImportArgs {
  code?: string;
  githubUrl?: string;
  mode: 'AUTO' | 'MOBILE' | 'DESKTOP' | 'TABLET';
  settings?: PluginSettings;
}

export interface ScreenSummary {
  name: string;
  width: number;
  height: number;
  componentType: string;
}

export interface RouteOption {
  label: string;
  path: string;
  sourceFile?: string;
}

interface ImportState {
  status: 'idle' | 'loading' | 'route_review' | 'review' | 'success' | 'error';
  progress: number;
  statusText: string;
  error: string | null;
  successCount: number;
  screens: ScreenSummary[];
  routeOptions: RouteOption[];
  selectedRoutePath: string | null;
  warnings: string[];
  selectedScreenIds: number[];
}

interface RuntimeIssue {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: string;
}

interface RepoPreflightResult {
  success?: boolean;
  repoId?: string;
  readiness?: 'ready' | 'limited' | 'needs_input' | 'blocked';
  supported?: boolean;
  supportReason?: string;
  routeOptions?: RouteOption[];
  envVarNames?: string[];
  issues?: RuntimeIssue[];
  warnings?: string[];
  error?: string;
}

const DEFAULT_BACKEND_URL = 'https://mintay.onrender.com';
const SETTINGS_STORAGE_KEY = 'mintay_plugin_settings';
const DEFAULT_PARSE_TIMEOUT_MS = 1800000;

const defaultSettings: PluginSettings = {
  apiKey: '',
  backendUrl: DEFAULT_BACKEND_URL,
  runtimeEnv: '',
};

const initialState: ImportState = {
  status: 'idle',
  progress: 0,
  statusText: 'Ready to import.',
  error: null,
  successCount: 0,
  screens: [],
  routeOptions: [],
  selectedRoutePath: null,
  warnings: [],
  selectedScreenIds: [],
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
      runtimeEnv: typeof parsed.runtimeEnv === 'string' ? parsed.runtimeEnv : '',
    };
  } catch {
    return defaultSettings;
  }
}

function writeLocalSettings(settings: PluginSettings): PluginSettings {
  const normalized = {
    apiKey: settings.apiKey || '',
    backendUrl: settings.backendUrl?.trim() || DEFAULT_BACKEND_URL,
    runtimeEnv: settings.runtimeEnv || '',
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
    runtimeEnv: primary.runtimeEnv || fallback.runtimeEnv || '',
  };
}

function parseRuntimeEnvInput(input: string): Record<string, string> {
  const envOverrides: Record<string, string> = {};

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      continue;
    }

    envOverrides[key] = value.replace(/^['"]|['"]$/g, '');
  }

  return envOverrides;
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

function summarizeScreens(screens: MintayScreen[]): ScreenSummary[] {
  return screens.map((screen) => ({
    name: screen.name,
    width: screen.width,
    height: screen.height,
    componentType: screen.componentType || 'DESKTOP',
  }));
}

function isGithubRepoRuntimeCandidate(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
      return false;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 2) {
      return false;
    }

    return segments[2] !== 'blob' && segments[2] !== 'raw';
  } catch {
    return false;
  }
}

function formatRuntimeIssues(issues: RuntimeIssue[] | undefined, warnings: string[] | undefined) {
  const parts: string[] = [];

  for (const issue of issues || []) {
    const detail = issue.details ? ` ${issue.details}` : '';
    parts.push(`${issue.message}${detail}`);
  }

  for (const warning of warnings || []) {
    parts.push(warning);
  }

  return parts.join(' ');
}

export function useImport() {
  const [state, setState] = useState<ImportState>(initialState);
  const [pendingResult, setPendingResult] = useState<MintayParseResult | null>(null);
  const [pendingRuntime, setPendingRuntime] = useState<{
    repoId: string;
    backendUrl: string;
    mode: ImportArgs['mode'];
  } | null>(null);

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
            runtimeEnv: pluginSettings.runtimeEnv || '',
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
            runtimeEnv: pluginSettings.runtimeEnv || '',
          },
          normalized,
        ),
      );
    } catch {
      return normalized;
    }
  }, []);

  const resetState = useCallback(() => {
    setPendingResult(null);
    setPendingRuntime(null);
    setState(initialState);
  }, []);

  const handleBuildSuccess = useCallback(
    (message: { count: number; warnings?: string[]; screens?: ScreenSummary[] }) => {
      setPendingResult(null);
      setState({
        status: 'success',
        progress: 100,
        statusText: 'Import complete.',
        error: null,
        successCount: message.count,
        warnings: message.warnings || [],
        screens: message.screens || [],
        routeOptions: [],
        selectedRoutePath: null,
        selectedScreenIds: [],
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
        setPendingResult(null);
        setPendingRuntime(null);
        setState({
          ...initialState,
          status: 'error',
          error: 'Paste code or provide a GitHub URL before importing.',
          statusText: 'Missing input.',
        });
        return;
      }

      setPendingResult(null);
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
      const runtimeEnvOverrides = parseRuntimeEnvInput(settings.runtimeEnv || '');
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), DEFAULT_PARSE_TIMEOUT_MS);

      try {
        let result: MintayParseResult;

        if (trimmedUrl && isGithubRepoRuntimeCandidate(trimmedUrl)) {
          setState((current) => ({
            ...current,
            progress: 24,
            statusText: 'Preparing the repository runtime workspace...',
          }));

          const prepareResponse = await fetch(`${backendUrl.replace(/\/$/, '')}/repo-runtime/prepare`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              githubUrl: trimmedUrl,
            }),
            signal: controller.signal,
          });

          const prepared = (await prepareResponse.json()) as {
            success?: boolean;
            repoId?: string;
            error?: string;
          };

          if (!prepareResponse.ok || !prepared.success || !prepared.repoId) {
            throw new Error(prepared.error || 'Mintay could not prepare the repository runtime.');
          }

          setState((current) => ({
            ...current,
            progress: 36,
            statusText: 'Checking launch blockers before installing the repo...',
          }));

          const preflightResponse = await fetch(`${backendUrl.replace(/\/$/, '')}/repo-runtime/preflight`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              repoId: prepared.repoId,
              envOverrides: runtimeEnvOverrides,
            }),
            signal: controller.signal,
          });

          const preflight = (await preflightResponse.json()) as RepoPreflightResult;

          if (!preflightResponse.ok || !preflight.success) {
            throw new Error(preflight.error || 'Mintay could not preflight the repository runtime.');
          }

          if (preflight.supported === false) {
            throw new Error(
              preflight.supportReason ||
                'Mintay v1 runtime import currently supports Next.js and Vite frontend apps only.',
            );
          }

          if (preflight.readiness === 'blocked') {
            throw new Error(
              formatRuntimeIssues(preflight.issues, preflight.warnings) ||
                'This repo is blocked from runtime launch until the preflight issues are fixed.',
            );
          }

          const routeOptions = Array.isArray(preflight.routeOptions) ? preflight.routeOptions : [];
          const selectedRoutePath = routeOptions[0]?.path || '/';

          setPendingRuntime({
            repoId: prepared.repoId,
            backendUrl,
            mode,
          });
          setState({
            status: 'route_review',
            progress: 56,
            statusText: 'Pick the route Mintay should launch and extract.',
            error: null,
            successCount: 0,
            screens: [],
            routeOptions,
            selectedRoutePath,
            warnings: [
              ...(preflight.warnings || []),
              ...(preflight.issues
                ?.filter((issue) => issue.severity !== 'error')
                .map((issue) => `${issue.message}${issue.details ? ` ${issue.details}` : ''}`) || []),
            ],
            selectedScreenIds: [],
          });
          return;
        } else {
          setState((current) => ({
            ...current,
            progress: 42,
            statusText: 'Parsing your repo into candidate screens. Larger imports can take a bit longer...',
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

          result = (await response.json()) as MintayParseResult;

          if (!response.ok) {
            throw new Error(result.error || 'Mintay could not parse the provided input.');
          }
        }

        if (!result.success || !Array.isArray(result.screens) || result.screens.length === 0) {
          throw new Error(result.error || 'Mintay could not find any screens in the provided input.');
        }

        const summaries = summarizeScreens(result.screens);
        const selectedScreenIds = summaries.map((_screen, index) => index);

        setPendingResult(result);
        setState({
          status: 'review',
          progress: 100,
          statusText: 'Review the detected screens and choose what to import.',
          error: null,
          successCount: 0,
          screens: summaries,
          warnings: result.warnings || [],
          selectedScreenIds,
        });
      } catch (error) {
        const message =
          error instanceof DOMException && error.name === 'AbortError'
            ? 'Mintay waited too long for the parser. Try again or narrow the repo only if this keeps happening.'
            : error instanceof TypeError
              ? 'Connection failed. Check your Backend URL in settings.'
              : error instanceof Error
                ? error.message
                : 'Mintay hit an unexpected error.';

        setPendingResult(null);
        setPendingRuntime(null);
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

  const toggleScreenSelection = useCallback((screenId: number) => {
    setState((current) => {
      const exists = current.selectedScreenIds.includes(screenId);
      return {
        ...current,
        selectedScreenIds: exists
          ? current.selectedScreenIds.filter((id) => id !== screenId)
          : [...current.selectedScreenIds, screenId].sort((left, right) => left - right),
      };
    });
  }, []);

  const selectAllScreens = useCallback(() => {
    setState((current) => ({
      ...current,
      selectedScreenIds: current.screens.map((_screen, index) => index),
    }));
  }, []);

  const clearSelectedScreens = useCallback(() => {
    setState((current) => ({
      ...current,
      selectedScreenIds: [],
    }));
  }, []);

  const selectRoute = useCallback((routePath: string) => {
    setState((current) => ({
      ...current,
      selectedRoutePath: routePath,
    }));
  }, []);

  const launchSelectedRoute = useCallback(async () => {
    if (!pendingRuntime) {
      return;
    }

    if (!state.selectedRoutePath) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: 'Select a route before Mintay launches the live preview.',
        statusText: 'No route selected.',
      }));
      return;
    }

    const settings = await loadSettings();
    const runtimeEnvOverrides = parseRuntimeEnvInput(settings.runtimeEnv || '');
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), DEFAULT_PARSE_TIMEOUT_MS);

    try {
      setState((current) => ({
        ...current,
        status: 'loading',
        progress: 68,
        error: null,
        statusText: `Starting ${state.selectedRoutePath} in a live preview...`,
      }));

      const launchResponse = await fetch(`${pendingRuntime.backendUrl.replace(/\/$/, '')}/repo-runtime/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoId: pendingRuntime.repoId,
          envOverrides: runtimeEnvOverrides,
        }),
        signal: controller.signal,
      });

      const launched = (await launchResponse.json()) as {
        success?: boolean;
        repoId?: string;
        error?: string;
      };

      if (!launchResponse.ok || !launched.success || !launched.repoId) {
        throw new Error(launched.error || 'Mintay could not launch the repository preview.');
      }

      setState((current) => ({
        ...current,
        progress: 84,
        statusText: `Extracting rendered layout from ${state.selectedRoutePath}...`,
      }));

      const extractResponse = await fetch(`${pendingRuntime.backendUrl.replace(/\/$/, '')}/repo-runtime/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoId: launched.repoId,
          mode: pendingRuntime.mode,
          routePath: state.selectedRoutePath,
        }),
        signal: controller.signal,
      });

      const result = (await extractResponse.json()) as MintayParseResult;

      void fetch(`${pendingRuntime.backendUrl.replace(/\/$/, '')}/repo-runtime/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repoId: launched.repoId,
        }),
      }).catch(() => undefined);

      if (!extractResponse.ok) {
        throw new Error(result.error || 'Mintay could not extract the rendered repository layout.');
      }

      if (!result.success || !Array.isArray(result.screens) || result.screens.length === 0) {
        throw new Error(result.error || 'Mintay could not find any screens in the selected route.');
      }

      const summaries = summarizeScreens(result.screens);
      const selectedScreenIds = summaries.map((_screen, index) => index);

      setPendingResult(result);
      setPendingRuntime(null);
      setState({
        status: 'review',
        progress: 100,
        statusText: 'Review the detected screens and choose what to import.',
        error: null,
        successCount: 0,
        screens: summaries,
        routeOptions: [],
        selectedRoutePath: null,
        warnings: result.warnings || [],
        selectedScreenIds,
      });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'AbortError'
          ? 'Mintay waited too long for the selected route to start. Try another route or add the missing env vars.'
          : error instanceof TypeError
            ? 'Connection failed. Check your Backend URL in settings.'
            : error instanceof Error
              ? error.message
              : 'Mintay hit an unexpected runtime error.';

      setPendingResult(null);
      setState((current) => ({
        ...current,
        status: 'error',
        error: message,
        statusText: 'Import failed.',
      }));
    } finally {
      window.clearTimeout(timeout);
    }
  }, [loadSettings, pendingRuntime, state.selectedRoutePath]);

  const buildSelectedScreens = useCallback(() => {
    if (!pendingResult) {
      return;
    }

    const selectedScreens = pendingResult.screens.filter((_screen, index) =>
      state.selectedScreenIds.includes(index),
    );

    if (selectedScreens.length === 0) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: 'Select at least one screen before importing to Figma.',
        statusText: 'No screens selected.',
      }));
      return;
    }

    setState((current) => ({
      ...current,
      status: 'loading',
      progress: 78,
      error: null,
      statusText: 'Drawing selected screens in Figma...',
    }));

    parent.postMessage(
      {
        pluginMessage: {
          type: 'BUILD_SCREENS',
          data: {
            ...pendingResult,
            screens: selectedScreens,
          },
        },
      },
      '*',
    );
  }, [pendingResult, state.selectedScreenIds]);

  return {
    state,
    startImport,
    loadSettings,
    saveSettings,
    resetState,
    handleBuildSuccess,
    handleBuildError,
    toggleScreenSelection,
    selectAllScreens,
    clearSelectedScreens,
    selectRoute,
    launchSelectedRoute,
    buildSelectedScreens,
  };
}
