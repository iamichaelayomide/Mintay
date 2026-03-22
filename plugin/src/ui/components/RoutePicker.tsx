import type { RouteOption } from '../hooks/useImport';

interface RoutePickerProps {
  routeOptions: RouteOption[];
  selectedRoutePath: string | null;
  onSelectRoute: (routePath: string) => void;
  warnings: string[];
}

export default function RoutePicker({
  routeOptions,
  selectedRoutePath,
  onSelectRoute,
  warnings,
}: RoutePickerProps) {
  return (
    <div className="preview-stack">
      <div className="section-picker">
        <div className="section-picker-header">
          <span className="field-label">Detected routes</span>
        </div>
        <p className="helper-text">
          Pick one route for Mintay to launch and extract. This is the supported v1 flow for repo imports.
        </p>
      </div>

      <div className="preview-grid">
        {routeOptions.map((route) => {
          const isSelected = selectedRoutePath === route.path;

          return (
            <article
              className={isSelected ? 'preview-card selectable active' : 'preview-card selectable'}
              key={`${route.path}-${route.sourceFile || ''}`}
              onClick={() => onSelectRoute(route.path)}
            >
              <div className="preview-name">{route.label}</div>
              <div className="preview-meta">{route.sourceFile || 'Derived route'}</div>
              <div className="preview-select-state">{isSelected ? 'Selected' : 'Click to select'}</div>
            </article>
          );
        })}
      </div>

      {warnings.length > 0 && (
        <div className="warning-card">
          <div className="status-title">Notes</div>
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
