interface UrlInputProps {
  value: string;
  onChange: (value: string) => void;
  onFetchClick: () => void;
  isLoading: boolean;
}

export default function UrlInput({ value, onChange, onFetchClick, isLoading }: UrlInputProps) {
  return (
    <div className="input-panel">
      <span className="field-label">GitHub file URL</span>
      <div className="url-row">
        <input
          className="text-input"
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://github.com/owner/repo/blob/main/app/page.tsx"
          type="url"
          value={value}
        />
        <button className="secondary-button compact" disabled={isLoading} onClick={onFetchClick} type="button">
          Fetch
        </button>
      </div>
      <p className="helper-text">Paste a GitHub blob or raw file URL. Mintay fetches the file and reconstructs the screen layout.</p>
    </div>
  );
}
