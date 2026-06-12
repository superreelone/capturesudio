import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  durationMs: number;
  startMs: number;
  endMs: number;
  onChange: (range: { startMs: number; endMs: number }) => void;
}

type Handle = 'start' | 'end' | null;

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const cs = Math.floor((ms % 1000) / 10);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return h > 0
    ? `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`
    : `${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export function TrimSlider({ durationMs, startMs, endMs, onChange }: Props): JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState<Handle>(null);

  const pctStart = durationMs > 0 ? (startMs / durationMs) * 100 : 0;
  const pctEnd = durationMs > 0 ? (endMs / durationMs) * 100 : 100;

  const onMove = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const ms = Math.round(t * durationMs);
      if (dragging === 'start') {
        const next = Math.min(ms, endMs - 100);
        onChange({ startMs: Math.max(0, next), endMs });
      } else if (dragging === 'end') {
        const next = Math.max(ms, startMs + 100);
        onChange({ startMs, endMs: Math.min(durationMs, next) });
      }
    },
    [dragging, durationMs, endMs, onChange, startMs]
  );

  useEffect(() => {
    if (!dragging) return;
    const onMouseMove = (e: MouseEvent): void => onMove(e.clientX);
    const onMouseUp = (): void => setDragging(null);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragging, onMove]);

  const selectedMs = endMs - startMs;

  return (
    <div className="trim">
      <div className="trim__times">
        <span className="trim__time">{fmt(startMs)}</span>
        <span className="trim__time muted">selected: {fmt(selectedMs)}</span>
        <span className="trim__time">{fmt(endMs)}</span>
      </div>
      <div className="trim__track" ref={trackRef}>
        <div
          className="trim__selection"
          style={{ left: `${pctStart}%`, right: `${100 - pctEnd}%` }}
        />
        <button
          className="trim__handle trim__handle--start"
          style={{ left: `${pctStart}%` }}
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging('start');
          }}
          aria-label="Trim start"
        />
        <button
          className="trim__handle trim__handle--end"
          style={{ left: `${pctEnd}%` }}
          onMouseDown={(e) => {
            e.preventDefault();
            setDragging('end');
          }}
          aria-label="Trim end"
        />
      </div>
      <div className="trim__row">
        <button
          className="ghost small-btn"
          onClick={() => onChange({ startMs: 0, endMs: durationMs })}
        >
          Reset
        </button>
        <span className="muted small">Drag handles to set in/out points.</span>
      </div>
    </div>
  );
}
