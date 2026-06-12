import { useEffect, useMemo, useState } from 'react';
import type { CaptureSource, CaptureSourceKind, DisplayInfo } from '@shared/recording.types';

export type SourceMode = 'screen' | 'window' | 'region';

interface Props {
  mode: SourceMode;
  displays: DisplayInfo[];
  selectedSourceId: string | null;
  selectedDisplayId: number | null;
  onSelectSource: (source: CaptureSource) => void;
  onSelectDisplay: (id: number) => void;
}

export function SourcePicker(props: Props): JSX.Element {
  const { mode, displays, selectedSourceId, selectedDisplayId, onSelectSource, onSelectDisplay } =
    props;

  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const kinds: CaptureSourceKind[] = useMemo(() => {
    if (mode === 'screen' || mode === 'region') return ['screen'];
    return ['window'];
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    window.api.capture
      .listSources({ kinds, thumbnailSize: { width: 320, height: 180 } })
      .then((list) => {
        if (cancelled) return;
        setSources(list);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kinds, refreshTick]);

  if (mode === 'region') {
    return (
      <div className="picker">
        <p className="muted small">
          Click the button below (or press the hotkey) and drag a rectangle on{' '}
          <strong>any</strong> display. The overlay covers every display
          simultaneously.{' '}
          {displays.length > 1 && `${displays.length} displays detected.`}
        </p>
        <p className="muted small">
          <kbd>Esc</kbd> cancel · <kbd>Enter</kbd> confirm · hold{' '}
          <kbd>Shift</kbd> for a square.
        </p>
      </div>
    );
  }
  void selectedDisplayId;
  void onSelectDisplay;

  return (
    <div className="picker">
      <div className="picker__head">
        <label>{mode === 'screen' ? 'Screen / monitor' : 'Window'}</label>
        <button className="ghost" onClick={() => setRefreshTick((n) => n + 1)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="thumbs">
        {sources.map((s) => (
          <button
            key={s.id}
            className={`thumb${s.id === selectedSourceId ? ' thumb--active' : ''}`}
            onClick={() => onSelectSource(s)}
            title={s.name}
          >
            <img src={s.thumbnail} alt="" draggable={false} />
            <div className="thumb__meta">
              {s.appIcon && <img className="thumb__icon" src={s.appIcon} alt="" />}
              <span className="thumb__name">{s.name}</span>
            </div>
          </button>
        ))}
        {!loading && sources.length === 0 && (
          <p className="muted">No {mode === 'screen' ? 'displays' : 'windows'} found.</p>
        )}
      </div>
    </div>
  );
}
