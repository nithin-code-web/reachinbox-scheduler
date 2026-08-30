export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="empty-state"><div className="empty-icon empty-icon-error">!</div><h3>Something went wrong</h3><p>{message}</p>{onRetry && <button className="button button-secondary error-retry" onClick={onRetry} type="button">Try again</button>}</div>;
}
