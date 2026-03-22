interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export default function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="error-card">
      <div className="status-title">Import failed</div>
      <p>{message}</p>
      <button className="secondary-button" onClick={onRetry} type="button">
        Retry
      </button>
    </div>
  );
}
