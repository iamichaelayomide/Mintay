interface ScreenPreviewItem {
  name: string;
  width: number;
  height: number;
  componentType: string;
}

interface ScreenPreviewProps {
  screens: ScreenPreviewItem[];
  warnings: string[];
  selectedScreenIds?: number[];
  onToggleScreen?: (screenId: number) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
}

export default function ScreenPreview({
  screens,
  warnings,
  selectedScreenIds,
  onToggleScreen,
  onSelectAll,
  onClearSelection,
}: ScreenPreviewProps) {
  const selectable = Array.isArray(selectedScreenIds) && typeof onToggleScreen === 'function';

  return (
    <div className="preview-stack">
      {selectable ? (
        <div className="section-picker">
          <div className="section-picker-header">
            <span className="field-label">Detected screens</span>
            <div className="code-actions">
              <button className="ghost-chip" onClick={onSelectAll} type="button">
                Select all
              </button>
              <button className="ghost-chip" onClick={onClearSelection} type="button">
                Clear
              </button>
            </div>
          </div>
          <p className="helper-text">
            Pick the screens you want Mintay to place on the Figma canvas from this repo import.
          </p>
        </div>
      ) : null}

      <div className="preview-grid">
        {screens.map((screen, index) => {
          const isSelected = selectable ? selectedScreenIds.includes(index) : false;

          return (
            <article
              className={
                selectable && isSelected
                  ? 'preview-card selectable active'
                  : selectable
                    ? 'preview-card selectable'
                    : 'preview-card'
              }
              key={`${screen.name}-${screen.width}-${screen.height}-${index}`}
              onClick={() => onToggleScreen?.(index)}
            >
              <div className="preview-name">{screen.name}</div>
              <div className="preview-meta">
                {screen.componentType} | {screen.width}x{screen.height}
              </div>
              {selectable ? (
                <div className="preview-select-state">
                  {isSelected ? 'Selected' : 'Not selected'}
                </div>
              ) : null}
            </article>
          );
        })}
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
