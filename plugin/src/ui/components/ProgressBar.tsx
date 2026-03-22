interface ProgressBarProps {
  label: string;
  progress: number;
}

export default function ProgressBar({ label, progress }: ProgressBarProps) {
  return (
    <div className="progress-card">
      <div className="progress-copy">
        <div className="status-title">Processing</div>
        <p>{label}</p>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.max(8, Math.min(progress, 100))}%` }} />
      </div>
    </div>
  );
}
