import { useCallback, useEffect, useRef, useState } from 'react';
import type { DrawingState } from '@shared/drawing.types';
import {
  drawOpOnto,
  repaint,
  type DrawOp,
  type ShapeOp,
  type StrokeOp,
  type Tool
} from './drawingState';

const COLORS = ['#ff4d4f', '#5b8def', '#f1c40f', '#3a9b6a', '#ffffff', '#1b2026'];
const THICKNESSES = [2, 4, 7, 12];
const TOOLS: Tool[] = ['pen', 'highlight', 'arrow', 'line', 'rect', 'ellipse', 'eraser'];
const TOOL_LABELS: Record<Tool, string> = {
  pen: '✏️ Pen',
  highlight: '🖍 Highlight',
  arrow: '➤ Arrow',
  line: '╱ Line',
  rect: '▭ Rect',
  ellipse: '◯ Ellipse',
  eraser: '◌ Erase'
};

const TOOL_KEYS: Record<Tool, string> = {
  pen: 'P',
  highlight: 'H',
  arrow: 'A',
  line: 'L',
  rect: 'R',
  ellipse: 'O',
  eraser: 'E'
};

export function DrawingOverlay(): JSX.Element {
  const overlay = window.drawingOverlay;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mode, setMode] = useState<'draw' | 'pass'>('draw');
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<string>('#ff4d4f');
  const [thickness, setThickness] = useState<number>(4);
  const [ops, setOps] = useState<DrawOp[]>([]);
  const [redoStack, setRedoStack] = useState<DrawOp[]>([]);
  const [currentOp, setCurrentOp] = useState<DrawOp | null>(null);
  /** True when the recorder is actually capturing. Hides hint strip + cursor. */
  const [recording, setRecording] = useState<boolean>(false);
  /** Hide the interactive toolbar (separate setting). Implies cursor hidden too. */
  const [hideToolbar, setHideToolbar] = useState<boolean>(false);
  const [dock, setDock] = useState<'top' | 'left' | 'right'>('top');
  const idRef = useRef<number>(0);

  const cycleDock = useCallback(() => {
    setDock((d) => (d === 'top' ? 'left' : d === 'left' ? 'right' : 'top'));
  }, []);

  // Subscribe to main-broadcast state + clear/undo events.
  useEffect(() => {
    const offState = overlay?.onState((s: DrawingState) => {
      setMode(s.mode);
    });
    const offClear = overlay?.onClear(() => {
      setOps([]);
      setRedoStack([]);
      setCurrentOp(null);
    });
    const offUndo = overlay?.onUndo(() => {
      setOps((prev) => {
        if (prev.length === 0) return prev;
        const last = prev[prev.length - 1]!;
        setRedoStack((r) => [...r, last]);
        return prev.slice(0, -1);
      });
    });
    const offSetTool = overlay?.onSetTool((t) => {
      if (TOOLS.includes(t as Tool)) setTool(t as Tool);
    });
    const offSetRecording = overlay?.onSetRecording((payload) => {
      setRecording(Boolean(payload?.recording));
      setHideToolbar(Boolean(payload?.hideToolbar));
    });
    return () => {
      offState?.();
      offClear?.();
      offUndo?.();
      offSetTool?.();
      offSetRecording?.();
    };
  }, [overlay]);

  // Resize canvas to fill the window in physical pixels for crisp lines.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function resize(): void {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      repaint(canvas, ops, currentOp);
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint whenever the ops/current change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    repaint(canvas, ops, currentOp);
  }, [ops, currentOp]);

  const startStroke = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (mode !== 'draw') return;
      if (e.button !== 0) return;
      idRef.current += 1;
      const id = idRef.current;
      const x = e.clientX;
      const y = e.clientY;
      const base = { id, color, thickness };
      if (tool === 'pen' || tool === 'highlight' || tool === 'eraser') {
        const op: StrokeOp = { ...base, tool, points: [{ x, y }] };
        setCurrentOp(op);
      } else {
        const op: ShapeOp = { ...base, tool, x0: x, y0: y, x1: x, y1: y };
        setCurrentOp(op);
      }
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    },
    [color, mode, thickness, tool]
  );

  const continueStroke = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!currentOp || mode !== 'draw') return;
      const x = e.clientX;
      const y = e.clientY;
      setCurrentOp((op) => {
        if (!op) return op;
        if (op.tool === 'pen' || op.tool === 'highlight' || op.tool === 'eraser') {
          return { ...op, points: [...op.points, { x, y }] };
        }
        return { ...op, x1: x, y1: y };
      });
    },
    [currentOp, mode]
  );

  const endStroke = useCallback(() => {
    if (!currentOp) return;
    setOps((prev) => [...prev, currentOp]);
    setCurrentOp(null);
    setRedoStack([]);
  }, [currentOp]);

  const undo = useCallback(() => {
    if (ops.length === 0) return;
    setRedoStack((r) => [...r, ops[ops.length - 1]!]);
    setOps((prev) => prev.slice(0, -1));
  }, [ops]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    setOps((prev) => [...prev, redoStack[redoStack.length - 1]!]);
    setRedoStack((r) => r.slice(0, -1));
  }, [redoStack]);

  const clearAll = useCallback(() => {
    setOps([]);
    setRedoStack([]);
    setCurrentOp(null);
  }, []);

  // Keyboard shortcuts inside overlay (only when in DRAW mode; otherwise keys go through).
  useEffect(() => {
    if (mode !== 'draw') return;
    function onKey(e: KeyboardEvent): void {
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (ctrl && !e.shiftKey && key === 'z') {
        e.preventDefault();
        undo();
      } else if (ctrl && e.shiftKey && key === 'z') {
        e.preventDefault();
        redo();
      } else if (ctrl && key === 'y') {
        e.preventDefault();
        redo();
      } else if (ctrl && e.shiftKey && key === 'c') {
        e.preventDefault();
        clearAll();
      } else if (ctrl && e.shiftKey && key === 'm') {
        // Cycle the toolbar dock position (top → left → right). Drawing
        // surface stays on the same display so it keeps appearing in the
        // recording — only the toolbar repositions.
        e.preventDefault();
        cycleDock();
      } else if (e.key === 'Escape') {
        // Toggle to PASS mode so user can interact with what's underneath.
        e.preventDefault();
        void overlay?.toggleMode();
      } else if (!ctrl && !e.altKey) {
        // Single-letter tool keys.
        const map: Record<string, Tool> = {
          p: 'pen',
          h: 'highlight',
          a: 'arrow',
          l: 'line',
          r: 'rect',
          o: 'ellipse',
          e: 'eraser'
        };
        const t = map[key];
        if (t) {
          e.preventDefault();
          setTool(t);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, undo, redo, clearAll, overlay, cycleDock]);

  // suppress unused warning for drawOpOnto on hot reload; reference here.
  void drawOpOnto;

  return (
    <div className={`do__root${recording ? ' do__root--recording' : ''}`}>
      <canvas
        ref={canvasRef}
        className={`do__canvas${mode === 'pass' ? ' do__canvas--pass' : ''}`}
        onPointerDown={startStroke}
        onPointerMove={continueStroke}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      {!hideToolbar && (
      <div
        className={`do__toolbar do__toolbar--dock-${dock}${mode === 'pass' ? ' do__toolbar--pass' : ''}`}
      >
        <span className={`do__mode do__mode--${mode}`}>{mode === 'draw' ? 'DRAW' : 'PASS'}</span>

        <div className="do__group">
          {TOOLS.map((t) => (
            <button
              key={t}
              className={`do__btn${tool === t ? ' do__btn--on' : ''}`}
              onClick={() => setTool(t)}
              title={`${TOOL_LABELS[t]} (${TOOL_KEYS[t]})`}
            >
              {TOOL_LABELS[t].split(' ')[0]}
              <span className="do__btn-key">{TOOL_KEYS[t]}</span>
            </button>
          ))}
        </div>

        <div className="do__group">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`do__swatch${color === c ? ' do__swatch--on' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`color ${c}`}
            />
          ))}
        </div>

        <div className="do__group">
          {THICKNESSES.map((t) => (
            <button
              key={t}
              className={`do__btn${thickness === t ? ' do__btn--on' : ''}`}
              onClick={() => setThickness(t)}
              title={`Thickness ${t}`}
            >
              <span
                className="do__thickness-dot"
                style={{
                  display: 'inline-block',
                  width: Math.min(14, t + 2),
                  height: Math.min(14, t + 2)
                }}
              />
            </button>
          ))}
        </div>

        <div className="do__group">
          <button className="do__btn" onClick={undo} disabled={ops.length === 0}>
            ↶ Undo
          </button>
          <button className="do__btn" onClick={redo} disabled={redoStack.length === 0}>
            ↷ Redo
          </button>
          <button className="do__btn" onClick={clearAll} disabled={ops.length === 0}>
            🗑 Clear
          </button>
        </div>

        <div className="do__group">
          <button
            className="do__btn"
            onClick={cycleDock}
            title={`Dock toolbar (currently ${dock}). Cycles top → left → right.`}
          >
            ⇄ Dock
          </button>
          <button className="do__btn" onClick={() => void overlay?.toggleMode()}>
            {mode === 'draw' ? '👆 Pass' : '✏️ Draw'}
          </button>
          <button className="do__btn" onClick={() => void overlay?.hide()} title="Close">
            ✕
          </button>
        </div>
      </div>
      )}

      {!recording && (
      <div className="do__hint">
        <kbd>P</kbd>/<kbd>H</kbd>/<kbd>A</kbd>/<kbd>R</kbd>/<kbd>O</kbd>/<kbd>E</kbd> tools ·{' '}
        <kbd>Ctrl+Z</kbd> undo · <kbd>Ctrl+Shift+C</kbd> clear ·{' '}
        <kbd>Ctrl+Shift+D</kbd> toggle mode · <kbd>Ctrl+Shift+M</kbd> dock toolbar ·{' '}
        <kbd>Esc</kbd> pass mode
      </div>
      )}
    </div>
  );
}
