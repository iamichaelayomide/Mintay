interface UrlInputProps {
  value: string;
  onChange: (value: string) => void;
  onFetchClick: () => void;
  isLoading: boolean;
}

export default function UrlInput({ value, onChange, onFetchClick, isLoading }: UrlInputProps) {
  return (
    <div className="input-panel">
      <span className="field-label">GitHub repo or file URL</span>
      <div className="url-row">
        <input
          className="text-input"
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://github.com/owner/repo or https://github.com/owner/repo/blob/main/app/page.tsx"
          type="url"
          value={value}
        />
        <button className="secondary-button compact" disabled={isLoading} onClick={onFetchClick} type="button">
          Fetch
        </button>
      </div>
      <p className="helper-text">Paste a GitHub repo, folder, blob, or raw file URL. Repo URLs run through Mintay&apos;s live runtime pipeline for closer layout fidelity.</p>
    </div>
  );
}
