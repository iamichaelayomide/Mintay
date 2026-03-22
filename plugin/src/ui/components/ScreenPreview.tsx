interface ScreenPreviewItem {
  name: string;
  width: number;
  height: number;
  componentType: string;
}

interface ScreenPreviewProps {
  screens: ScreenPreviewItem[];
  warnings: string[];
}

export default function ScreenPreview({ screens, warnings }: ScreenPreviewProps) {
  return (
    <div className="preview-stack">
      <div className="preview-grid">
        {screens.map((screen) => (
          <article className="preview-card" key={`${screen.name}-${screen.width}-${screen.height}`}>
            <div className="preview-name">{screen.name}</div>
            <div className="preview-meta">
              {screen.componentType} • {screen.width}×{screen.height}
            </div>
          </article>
        ))}
      </div>

      {warnings.length > 0 && (
        <div className="warning-card">
          <div className="status-title">Warnings</div>
          <ul className="warning-list">
            {warnings.slice(0, 5).map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
