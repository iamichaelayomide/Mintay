import { useEffect, useState } from 'react';
import CodeInput from './components/CodeInput';
import ErrorState from './components/ErrorState';
import ProgressBar from './components/ProgressBar';
import ScreenPreview from './components/ScreenPreview';
import SettingsPanel from './components/SettingsPanel';
import UrlInput from './components/UrlInput';
import { useImport } from './hooks/useImport';
import { usePluginMessage } from './hooks/usePluginMessage';

type InputTab = 'code' | 'url';
type ScreenMode = 'AUTO' | 'MOBILE' | 'DESKTOP' | 'TABLET';

const DEFAULT_SETTINGS = {
  apiKey: '',
  backendUrl: 'http://localhost:3001',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<InputTab>('code');
  const [screenMode, setScreenMode] = useState<ScreenMode>('AUTO');
  const [code, setCode] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState(DEFAULT_SETTINGS);

  const {
    state,
    startImport,
    loadSettings,
    saveSettings,
    resetState,
    handleBuildSuccess,
    handleBuildError,
  } = useImport();

  usePluginMessage({
    onSuccess: handleBuildSuccess,
    onError: handleBuildError,
  });

  useEffect(() => {
    loadSettings()
      .then(setSettingsDraft)
      .catch(() => {
        setSettingsDraft(DEFAULT_SETTINGS);
      });
  }, [loadSettings]);

  const handleImport = async () => {
    await startImport({
      code: activeTab === 'code' ? code : '',
      githubUrl: activeTab === 'url' ? githubUrl : '',
      mode: screenMode,
    });
  };

  const handleSaveSettings = async () => {
    const saved = await saveSettings(settingsDraft);
    setSettingsDraft(saved);
    setSettingsOpen(false);
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <div className="brand-name">Mintay</div>
            <div className="brand-tagline">Your codebase, in Figma. Instantly.</div>
          </div>
        </div>

        <button
          aria-label="Open settings"
          className="icon-button"
          onClick={() => setSettingsOpen(true)}
          type="button"
        >
          ⚙
        </button>
      </header>

      <section className="tabs">
        <button
          className={activeTab === 'code' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('code')}
          type="button"
        >
          Paste Code
        </button>
        <button
          className={activeTab === 'url' ? 'tab active' : 'tab'}
          onClick={() => setActiveTab('url')}
          type="button"
        >
          GitHub URL
        </button>
      </section>

      <section className="panel">
        {activeTab === 'code' ? (
          <CodeInput value={code} onChange={setCode} />
        ) : (
          <UrlInput
            isLoading={state.status === 'loading'}
            onChange={setGithubUrl}
            onFetchClick={handleImport}
            value={githubUrl}
          />
        )}
      </section>

      <section className="options-row">
        <label className="field-label" htmlFor="screen-mode">
          Screen type
        </label>
        <select
          className="select"
          id="screen-mode"
          onChange={(event) => setScreenMode(event.target.value as ScreenMode)}
          value={screenMode}
        >
          <option value="AUTO">Auto</option>
          <option value="MOBILE">Mobile</option>
          <option value="DESKTOP">Desktop</option>
          <option value="TABLET">Tablet</option>
        </select>
      </section>

      <button
        className="primary-button"
        disabled={state.status === 'loading'}
        onClick={handleImport}
        type="button"
      >
        {state.status === 'loading' ? (
          <span className="button-content">
            <span className="spinner" />
            Importing…
          </span>
        ) : (
          'Import to Figma'
        )}
      </button>

      <section className="status-area">
        {state.status === 'loading' && (
          <ProgressBar label={state.statusText} progress={state.progress} />
        )}

        {state.status === 'error' && (
          <ErrorState
            message={state.error || 'Mintay hit an unexpected error.'}
            onRetry={handleImport}
          />
        )}

        {state.status === 'success' && (
          <div className="success-card">
            <div className="success-header">
              <div>
                <h2>{state.successCount} screen(s) built</h2>
                <p>Mintay placed the generated frames on your current Figma page.</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => parent.postMessage({ pluginMessage: { type: 'CLOSE' } }, '*')}
                type="button"
              >
                View in Figma
              </button>
            </div>

            <ScreenPreview screens={state.screens} warnings={state.warnings} />
          </div>
        )}

        {state.status === 'idle' && (
          <div className="hint-card">
            <p>Paste a page, component, or GitHub file URL and Mintay will rebuild the layout as editable Figma frames.</p>
          </div>
        )}
      </section>

      {settingsOpen && (
        <SettingsPanel
          isSaving={state.status === 'loading'}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
          onUpdate={setSettingsDraft}
          settings={settingsDraft}
        />
      )}

      {state.status !== 'loading' && (state.status === 'success' || state.status === 'error') ? (
        <button className="ghost-button" onClick={resetState} type="button">
          Reset status
        </button>
      ) : null}
    </main>
  );
}
