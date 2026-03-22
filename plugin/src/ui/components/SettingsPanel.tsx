import { useState } from 'react';
import type { PluginSettings } from '../hooks/useImport';

interface SettingsPanelProps {
  settings: PluginSettings;
  onUpdate: (settings: PluginSettings) => void;
  onSave: () => void;
  onClose: () => void;
  isSaving: boolean;
}

export default function SettingsPanel({
  settings,
  onUpdate,
  onSave,
  onClose,
  isSaving,
}: SettingsPanelProps) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-panel">
        <div className="settings-header">
          <div>
            <h2>Settings</h2>
            <p>Your API key is stored locally in Figma. It never leaves your device.</p>
          </div>
          <button className="icon-button" onClick={onClose} type="button">
            ✕
          </button>
        </div>

        <label className="input-panel">
          <span className="field-label">Gemini API key</span>
          <div className="inline-field">
            <input
              className="text-input"
              onChange={(event) => onUpdate({ ...settings, apiKey: event.target.value })}
              type={showKey ? 'text' : 'password'}
              value={settings.apiKey}
            />
            <button
              className="secondary-button compact"
              onClick={() => setShowKey((value) => !value)}
              type="button"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label className="input-panel">
          <span className="field-label">Backend URL</span>
          <input
            className="text-input"
            onChange={(event) => onUpdate({ ...settings, backendUrl: event.target.value })}
            type="url"
            value={settings.backendUrl}
          />
        </label>

        <button
          className="primary-button"
          disabled={isSaving}
          onClick={onSave}
          type="button"
        >
          Save
        </button>
      </section>
    </div>
  );
}
