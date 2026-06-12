import { useUpdater } from './useUpdater';

function fmtBytes(n?: number): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UpdateBanner(): JSX.Element | null {
  const { state, download, install, dismissCurrent, visible } = useUpdater();

  if (!visible) return null;

  if (state.value === 'available') {
    return (
      <div className="updater-banner updater-banner--available">
        <span className="updater-banner__icon">⬆</span>
        <span className="updater-banner__text">
          <strong>Update available</strong> — v{state.version}
          {state.notes && (
            <details className="updater-banner__notes">
              <summary>Release notes</summary>
              <pre>{state.notes}</pre>
            </details>
          )}
        </span>
        <div className="updater-banner__actions">
          <button className="ghost" onClick={dismissCurrent}>
            Later
          </button>
          <button className="primary" onClick={() => void download()}>
            Download
          </button>
        </div>
      </div>
    );
  }

  if (state.value === 'downloading') {
    const pct = state.percent ?? 0;
    return (
      <div className="updater-banner updater-banner--downloading">
        <span className="updater-banner__icon">⬇</span>
        <span className="updater-banner__text">
          <strong>Downloading update… {pct}%</strong>
          {state.bytesPerSecond !== undefined && (
            <span className="muted small">
              {' '}
              · {fmtBytes(state.bytesPerSecond)}/s
              {state.transferred !== undefined && state.total !== undefined && (
                <>
                  {' '}
                  · {fmtBytes(state.transferred)} / {fmtBytes(state.total)}
                </>
              )}
            </span>
          )}
        </span>
        <div className="updater-banner__bar">
          <div className="updater-banner__bar-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  if (state.value === 'downloaded') {
    return (
      <div className="updater-banner updater-banner--ready">
        <span className="updater-banner__icon">✓</span>
        <span className="updater-banner__text">
          <strong>Update ready</strong> — v{state.version} will install when you restart.
        </span>
        <div className="updater-banner__actions">
          <button className="ghost" onClick={dismissCurrent}>
            Later
          </button>
          <button className="primary" onClick={() => void install()}>
            Restart &amp; install
          </button>
        </div>
      </div>
    );
  }

  if (state.value === 'error') {
    return (
      <div className="updater-banner updater-banner--error">
        <span className="updater-banner__icon">!</span>
        <span className="updater-banner__text">
          <strong>Update check failed</strong>
          {state.message && <span className="muted small"> · {state.message}</span>}
        </span>
        <div className="updater-banner__actions">
          <button className="ghost" onClick={dismissCurrent}>
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  return null;
}
