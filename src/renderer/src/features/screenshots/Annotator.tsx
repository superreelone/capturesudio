import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CaptureScreenshotResponse } from '@shared/screenshot.types';
import { loadImageFromBase64 } from './ScreenshotPanel';

type Tool =
  | 'pen'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'highlight'
  | 'text'
  | 'step'
  | 'stamp'
  | 'callout'
  | 'blur'
  | 'crop';

type BlurMode = 'blur' | 'pixelate';
type StampShape = 'check' | 'x' | 'star' | 'exclamation' | 'question' | 'heart';

interface BaseOp {
  id: number;
  tool: Tool;
  color: string;
  thickness: number;
}

interface PenOp extends BaseOp {
  tool: 'pen';
  points: Array<{ x: number; y: number }>;
}

interface ShapeOp extends BaseOp {
  tool: 'arrow' | 'rect' | 'ellipse' | 'highlight' | 'line';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  filled?: boolean;
}

interface TextOp extends BaseOp {
  tool: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

interface BlurOp extends BaseOp {
  tool: 'blur';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  mode: BlurMode;
}

interface StepOp extends BaseOp {
  tool: 'step';
  x: number;
  y: number;
  number: number;
}

interface StampOp extends BaseOp {
  tool: 'stamp';
  x: number;
  y: number;
  shape: StampShape;
  size: number;
}

interface CalloutOp extends BaseOp {
  tool: 'callout';
  x: number;
  y: number;
  width: number;
  height: number;
  tipX: number;
  tipY: number;
  text: string;
  fontSize: number;
  filled?: boolean;
}

type Op = PenOp | ShapeOp | TextOp | BlurOp | StepOp | StampOp | CalloutOp;

const COLORS = ['#ff4d4f', '#5b8def', '#f1c40f', '#3a9b6a', '#ffffff', '#000000'];
const THICKNESSES = [2, 4, 6, 10, 16];

const STAMP_SHAPES: StampShape[] = ['check', 'x', 'star', 'exclamation', 'question', 'heart'];
const STAMP_CHARS: Record<StampShape, string> = {
  check: '✓',
  x: '✕',
  star: '★',
  exclamation: '!',
  question: '?',
  heart: '♥'
};

const TOOL_LABELS: Record<Tool, string> = {
  pen: '✏️',
  line: '╱',
  arrow: '➤',
  rect: '▭',
  ellipse: '◯',
  highlight: '🖍',
  text: 'T',
  step: '①',
  stamp: '★',
  callout: '💬',
  blur: '◌',
  crop: '✂'
};

const TOOL_NAMES: Record<Tool, string> = {
  pen: 'Pen',
  line: 'Line',
  arrow: 'Arrow',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  highlight: 'Highlight',
  text: 'Text',
  step: 'Step counter',
  stamp: 'Stamp',
  callout: 'Callout',
  blur: 'Blur / Pixelate',
  crop: 'Crop'
};

interface Props {
  captured: CaptureScreenshotResponse;
  onSave: (canvas: HTMLCanvasElement) => void | Promise<void>;
  onCancel: () => void;
  saving: boolean;
}

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function Annotator({ captured, onSave, onCancel, saving }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseImgRef = useRef<HTMLImageElement | HTMLCanvasElement | null>(null);
  const blurredImgRef = useRef<HTMLCanvasElement | null>(null);
  const pixelatedImgRef = useRef<HTMLCanvasElement | null>(null);

  const [ready, setReady] = useState(false);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState<string>('#ff4d4f');
  const [thickness, setThickness] = useState<number>(4);
  const [filled, setFilled] = useState<boolean>(false);
  const [blurMode, setBlurMode] = useState<BlurMode>('blur');
  const [stampShape, setStampShape] = useState<StampShape>('check');
  const [ops, setOps] = useState<Op[]>([]);
  const [redoStack, setRedoStack] = useState<Op[]>([]);
  const [currentOp, setCurrentOp] = useState<Op | null>(null);
  const [pendingText, setPendingText] = useState<{
    x: number;
    y: number;
    cssX: number;
    cssY: number;
    forOp: 'text' | 'callout';
    calloutOpId?: number;
  } | null>(null);
  const [textDraft, setTextDraft] = useState<string>('');
  const [pendingCrop, setPendingCrop] = useState<CropRect | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({
    w: captured.width,
    h: captured.height
  });
  const idCounter = useRef<number>(0);
  const stepCounterRef = useRef<number>(1);
  const [stepCounter, setStepCounter] = useState<number>(1);

  // Build blur + pixelate caches from a given source (base image or post-crop canvas).
  const rebuildCaches = useCallback((src: HTMLImageElement | HTMLCanvasElement) => {
    const w = src.width;
    const h = src.height;

    const blurred = document.createElement('canvas');
    blurred.width = w;
    blurred.height = h;
    const bctx = blurred.getContext('2d');
    if (bctx) {
      bctx.filter = 'blur(14px)';
      bctx.drawImage(src, 0, 0);
    }
    blurredImgRef.current = blurred;

    const pixelated = document.createElement('canvas');
    pixelated.width = w;
    pixelated.height = h;
    const pctx = pixelated.getContext('2d');
    if (pctx) {
      const sm = document.createElement('canvas');
      const scale = 16;
      sm.width = Math.max(1, Math.round(w / scale));
      sm.height = Math.max(1, Math.round(h / scale));
      const smctx = sm.getContext('2d');
      if (smctx) {
        smctx.imageSmoothingEnabled = false;
        smctx.drawImage(src, 0, 0, sm.width, sm.height);
      }
      pctx.imageSmoothingEnabled = false;
      pctx.drawImage(sm, 0, 0, w, h);
    }
    pixelatedImgRef.current = pixelated;
  }, []);

  // Load base image and prepare blur/pixelate caches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const img = await loadImageFromBase64(captured.pngBase64);
      if (cancelled) return;
      baseImgRef.current = img;
      rebuildCaches(img);
      setReady(true);
    })().catch((err) => console.error('annotator load failed', err));
    return () => {
      cancelled = true;
    };
  }, [captured.pngBase64, rebuildCaches]);

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    const img = baseImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const allOps = currentOp ? [...ops, currentOp] : ops;
    for (const op of allOps) drawOp(ctx, op, blurredImgRef.current, pixelatedImgRef.current);

    if (pendingCrop) drawCropOverlay(ctx, pendingCrop, canvas.width, canvas.height);
  }, [ops, currentOp, pendingCrop]);

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvasSize.w;
    canvas.height = canvasSize.h;
    repaint();
  }, [ready, canvasSize.w, canvasSize.h, repaint]);

  useEffect(() => {
    if (!ready) return;
    repaint();
  }, [ops, currentOp, pendingCrop, ready, repaint]);

  const screenToCanvas = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
      };
    },
    []
  );

  const startDraw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      if (pendingText) return;
      const { x, y } = screenToCanvas(e.clientX, e.clientY);

      if (tool === 'text') {
        setPendingText({ x, y, cssX: e.clientX, cssY: e.clientY, forOp: 'text' });
        setTextDraft('');
        return;
      }

      if (tool === 'step') {
        idCounter.current += 1;
        const op: StepOp = {
          id: idCounter.current,
          tool: 'step',
          color,
          thickness,
          x,
          y,
          number: stepCounterRef.current
        };
        setOps((prev) => [...prev, op]);
        stepCounterRef.current += 1;
        setStepCounter(stepCounterRef.current);
        setRedoStack([]);
        return;
      }

      if (tool === 'stamp') {
        idCounter.current += 1;
        const op: StampOp = {
          id: idCounter.current,
          tool: 'stamp',
          color,
          thickness,
          x,
          y,
          shape: stampShape,
          size: Math.max(32, thickness * 12)
        };
        setOps((prev) => [...prev, op]);
        setRedoStack([]);
        return;
      }

      idCounter.current += 1;
      const id = idCounter.current;

      if (tool === 'pen') {
        setCurrentOp({ id, tool: 'pen', color, thickness, points: [{ x, y }] });
        return;
      }

      if (tool === 'blur') {
        setCurrentOp({
          id,
          tool: 'blur',
          color,
          thickness,
          x0: x,
          y0: y,
          x1: x,
          y1: y,
          mode: blurMode
        });
        return;
      }

      if (tool === 'crop') {
        setPendingCrop({ x, y, w: 0, h: 0 });
        return;
      }

      if (tool === 'callout') {
        // First click sets the tip; drag defines the box (start point becomes tip).
        setCurrentOp({
          id,
          tool: 'callout',
          color,
          thickness,
          x,
          y,
          width: 0,
          height: 0,
          tipX: x,
          tipY: y,
          text: '',
          fontSize: Math.max(16, thickness * 5)
        });
        return;
      }

      // Shape tools
      setCurrentOp({
        id,
        tool: tool as 'arrow' | 'rect' | 'ellipse' | 'highlight' | 'line',
        color,
        thickness,
        x0: x,
        y0: y,
        x1: x,
        y1: y,
        filled: (tool === 'rect' || tool === 'ellipse') ? filled : false
      });
    },
    [blurMode, color, filled, pendingText, screenToCanvas, stampShape, thickness, tool]
  );

  const moveDraw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      if (pendingCrop && tool === 'crop') {
        // Update crop box during drag
        setPendingCrop((c) => (c ? { ...c, w: x - c.x, h: y - c.y } : c));
        return;
      }
      if (!currentOp) return;
      setCurrentOp((op) => {
        if (!op) return op;
        if (op.tool === 'pen') return { ...op, points: [...op.points, { x, y }] };
        if (op.tool === 'callout') {
          // Box's top-left is the cursor; tip stays at op.tipX/op.tipY.
          const dx = x - op.tipX;
          const dy = y - op.tipY;
          const w = Math.max(120, Math.abs(dx));
          const h = Math.max(48, Math.abs(dy));
          const bx = dx >= 0 ? op.tipX + 40 : op.tipX - w - 40;
          const by = dy >= 0 ? op.tipY + 40 : op.tipY - h - 40;
          return { ...op, x: bx, y: by, width: w, height: h };
        }
        if ('x0' in op) return { ...op, x1: x, y1: y };
        return op;
      });
    },
    [currentOp, pendingCrop, screenToCanvas, tool]
  );

  const endDraw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (pendingCrop && tool === 'crop') {
        // Normalize negative width/height to positive
        const cr = pendingCrop;
        const nx = cr.w < 0 ? cr.x + cr.w : cr.x;
        const ny = cr.h < 0 ? cr.y + cr.h : cr.y;
        const nw = Math.abs(cr.w);
        const nh = Math.abs(cr.h);
        if (nw < 8 || nh < 8) {
          setPendingCrop(null);
          return;
        }
        setPendingCrop({ x: nx, y: ny, w: nw, h: nh });
        return;
      }
      if (!currentOp) return;
      if (currentOp.tool === 'callout') {
        // Push the op and open a text input at the box center for typing.
        const op = currentOp as CalloutOp;
        setOps((prev) => [...prev, op]);
        // Convert canvas coords back to CSS coords for the input position
        const canvas = canvasRef.current;
        if (canvas) {
          const r = canvas.getBoundingClientRect();
          const scaleX = r.width / canvas.width;
          const scaleY = r.height / canvas.height;
          setPendingText({
            x: op.x + op.width / 2,
            y: op.y + op.height / 2,
            cssX: r.left + (op.x + op.width / 2) * scaleX,
            cssY: r.top + (op.y + op.height / 2) * scaleY,
            forOp: 'callout',
            calloutOpId: op.id
          });
          setTextDraft('');
        }
        setCurrentOp(null);
        setRedoStack([]);
        return;
      }
      setOps((prev) => [...prev, currentOp]);
      setCurrentOp(null);
      setRedoStack([]);
      void e;
    },
    [currentOp, pendingCrop, tool]
  );

  const commitText = useCallback(() => {
    if (!pendingText) return;
    if (pendingText.forOp === 'callout' && pendingText.calloutOpId !== undefined) {
      // Update the callout op's text.
      const calloutId = pendingText.calloutOpId;
      const text = textDraft.trim();
      setOps((prev) =>
        prev.map((o) => (o.id === calloutId && o.tool === 'callout' ? { ...o, text } : o))
      );
      setPendingText(null);
      setTextDraft('');
      return;
    }
    // Plain text op
    if (!textDraft.trim()) {
      setPendingText(null);
      setTextDraft('');
      return;
    }
    idCounter.current += 1;
    const op: TextOp = {
      id: idCounter.current,
      tool: 'text',
      color,
      thickness,
      x: pendingText.x,
      y: pendingText.y,
      text: textDraft,
      fontSize: Math.max(14, thickness * 6)
    };
    setOps((prev) => [...prev, op]);
    setPendingText(null);
    setTextDraft('');
    setRedoStack([]);
  }, [color, pendingText, textDraft, thickness]);

  const cancelPendingText = useCallback(() => {
    if (pendingText?.forOp === 'callout' && pendingText.calloutOpId !== undefined) {
      // Remove the callout op if user cancels (avoids dangling empty bubble).
      const calloutId = pendingText.calloutOpId;
      setOps((prev) => prev.filter((o) => o.id !== calloutId));
    }
    setPendingText(null);
    setTextDraft('');
  }, [pendingText]);

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

  const resetStepCounter = useCallback(() => {
    stepCounterRef.current = 1;
    setStepCounter(1);
  }, []);

  const applyCrop = useCallback(() => {
    if (!pendingCrop) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y, w, h } = pendingCrop;

    // Flatten current canvas state into a new image at the crop bounds.
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);

    // Replace base image with the cropped result; clear ops (they were flattened in).
    baseImgRef.current = tmp;
    rebuildCaches(tmp);
    setOps([]);
    setRedoStack([]);
    setCurrentOp(null);
    setPendingCrop(null);
    setCanvasSize({ w, h });
    setTool('arrow');
  }, [pendingCrop, rebuildCaches]);

  const cancelCrop = useCallback(() => setPendingCrop(null), []);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (pendingText) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      } else if (
        (ctrl && e.shiftKey && e.key.toLowerCase() === 'z') ||
        (ctrl && e.key.toLowerCase() === 'y')
      ) {
        e.preventDefault();
        redo();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (pendingCrop) setPendingCrop(null);
        else onCancel();
      } else if (e.key === 'Enter' && pendingCrop) {
        e.preventDefault();
        applyCrop();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [applyCrop, onCancel, pendingCrop, pendingText, redo, undo]);

  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    await onSave(canvas);
  }, [onSave]);

  const displayMaxStyle = useMemo<React.CSSProperties>(
    () => ({ maxWidth: '85vw', maxHeight: '60vh' }),
    []
  );

  const isShapeToolWithFill = tool === 'rect' || tool === 'ellipse';

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={saving ? undefined : onCancel} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__head">
          <h2>Annotate</h2>
          <span className="muted small">
            {canvasSize.w} × {canvasSize.h}
          </span>
          <button className="ghost" onClick={onCancel} disabled={saving}>
            ✕
          </button>
        </header>

        <div className="annotator__toolbar">
          <div className="annotator__tools">
            {(
              [
                'pen',
                'line',
                'arrow',
                'rect',
                'ellipse',
                'highlight',
                'text',
                'step',
                'stamp',
                'callout',
                'blur',
                'crop'
              ] as Tool[]
            ).map((t) => (
              <button
                key={t}
                className={`tool${tool === t ? ' tool--on' : ''}`}
                onClick={() => setTool(t)}
                title={TOOL_NAMES[t]}
              >
                {TOOL_LABELS[t]}
              </button>
            ))}
          </div>

          {tool === 'blur' && (
            <div className="seg seg--small">
              {(['blur', 'pixelate'] as BlurMode[]).map((m) => (
                <button
                  key={m}
                  className={`seg__btn${blurMode === m ? ' seg__btn--on' : ''}`}
                  onClick={() => setBlurMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          )}

          {tool === 'stamp' && (
            <div className="seg seg--small">
              {STAMP_SHAPES.map((s) => (
                <button
                  key={s}
                  className={`seg__btn${stampShape === s ? ' seg__btn--on' : ''}`}
                  onClick={() => setStampShape(s)}
                  title={s}
                >
                  {STAMP_CHARS[s]}
                </button>
              ))}
            </div>
          )}

          {tool === 'step' && (
            <div className="step-counter">
              <span className="muted small">Next: {stepCounter}</span>
              <button className="ghost small-btn" onClick={resetStepCounter}>
                Reset
              </button>
            </div>
          )}

          {isShapeToolWithFill && (
            <div className="toggle annotator__fill">
              <label>
                <input
                  type="checkbox"
                  checked={filled}
                  onChange={(e) => setFilled(e.target.checked)}
                />
                <span>Filled</span>
              </label>
            </div>
          )}

          <div className="annotator__colors">
            {COLORS.map((c) => (
              <button
                key={c}
                className={`swatch${color === c ? ' swatch--on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`color ${c}`}
              />
            ))}
            <input
              type="color"
              className="swatch swatch--picker"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title="Custom color"
            />
          </div>

          <div className="seg seg--small">
            {THICKNESSES.map((t) => (
              <button
                key={t}
                className={`seg__btn${thickness === t ? ' seg__btn--on' : ''}`}
                onClick={() => setThickness(t)}
                title={`Thickness ${t}`}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="annotator__history">
            <button onClick={undo} disabled={ops.length === 0} title="Ctrl+Z">
              Undo
            </button>
            <button onClick={redo} disabled={redoStack.length === 0} title="Ctrl+Shift+Z">
              Redo
            </button>
          </div>
        </div>

        <div className="annotator__stage" ref={containerRef}>
          {!ready && <p className="muted">Loading image…</p>}
          <canvas
            ref={canvasRef}
            className="annotator__canvas"
            style={displayMaxStyle}
            onMouseDown={startDraw}
            onMouseMove={moveDraw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
          />
          {pendingText && (
            <TextEntry
              x={pendingText.cssX}
              y={pendingText.cssY}
              centered={pendingText.forOp === 'callout'}
              value={textDraft}
              placeholder={pendingText.forOp === 'callout' ? 'Type callout text…' : 'Type text…'}
              onChange={setTextDraft}
              onCommit={commitText}
              onCancel={cancelPendingText}
            />
          )}
          {pendingCrop && (
            <div className="annotator__crop-bar">
              <span className="muted small">
                Crop to {Math.abs(Math.round(pendingCrop.w))} ×{' '}
                {Math.abs(Math.round(pendingCrop.h))}
              </span>
              <button className="ghost" onClick={cancelCrop}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={applyCrop}
                disabled={Math.abs(pendingCrop.w) < 8 || Math.abs(pendingCrop.h) < 8}
              >
                Apply crop
              </button>
            </div>
          )}
        </div>

        <footer className="modal__foot">
          <button className="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button className="primary" onClick={() => void handleSave()} disabled={saving || !ready}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TextEntry({
  x,
  y,
  centered,
  value,
  placeholder,
  onChange,
  onCommit,
  onCancel
}: {
  x: number;
  y: number;
  centered: boolean;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}): JSX.Element {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    // requestAnimationFrame to ensure the element is laid out before focus.
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <input
      ref={ref}
      className={`annotator__text-input${centered ? ' annotator__text-input--centered' : ''}`}
      style={{ left: x, top: y }}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCommit}
    />
  );
}

function drawCropOverlay(
  ctx: CanvasRenderingContext2D,
  crop: CropRect,
  canvasW: number,
  canvasH: number
): void {
  const nx = crop.w < 0 ? crop.x + crop.w : crop.x;
  const ny = crop.h < 0 ? crop.y + crop.h : crop.y;
  const nw = Math.abs(crop.w);
  const nh = Math.abs(crop.h);
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
  ctx.fillRect(0, 0, canvasW, ny);
  ctx.fillRect(0, ny + nh, canvasW, canvasH - (ny + nh));
  ctx.fillRect(0, ny, nx, nh);
  ctx.fillRect(nx + nw, ny, canvasW - (nx + nw), nh);
  ctx.strokeStyle = '#5b8def';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(nx, ny, nw, nh);
  ctx.restore();
}

function drawOp(
  ctx: CanvasRenderingContext2D,
  op: Op,
  blurredImg: HTMLCanvasElement | null,
  pixelatedImg: HTMLCanvasElement | null
): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.thickness;

  switch (op.tool) {
    case 'pen': {
      if (op.points.length === 0) break;
      ctx.beginPath();
      ctx.moveTo(op.points[0]!.x, op.points[0]!.y);
      for (let i = 1; i < op.points.length; i++) ctx.lineTo(op.points[i]!.x, op.points[i]!.y);
      ctx.stroke();
      break;
    }
    case 'line': {
      ctx.beginPath();
      ctx.moveTo(op.x0, op.y0);
      ctx.lineTo(op.x1, op.y1);
      ctx.stroke();
      break;
    }
    case 'rect': {
      const x = Math.min(op.x0, op.x1);
      const y = Math.min(op.y0, op.y1);
      const w = Math.abs(op.x1 - op.x0);
      const h = Math.abs(op.y1 - op.y0);
      if (op.filled) ctx.fillRect(x, y, w, h);
      else ctx.strokeRect(x, y, w, h);
      break;
    }
    case 'ellipse': {
      const cx = (op.x0 + op.x1) / 2;
      const cy = (op.y0 + op.y1) / 2;
      const rx = Math.abs(op.x1 - op.x0) / 2;
      const ry = Math.abs(op.y1 - op.y0) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      if (op.filled) ctx.fill();
      else ctx.stroke();
      break;
    }
    case 'arrow': {
      const dx = op.x1 - op.x0;
      const dy = op.y1 - op.y0;
      const headLen = Math.max(12, op.thickness * 3);
      const angle = Math.atan2(dy, dx);
      ctx.beginPath();
      ctx.moveTo(op.x0, op.y0);
      ctx.lineTo(op.x1, op.y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(
        op.x1 - headLen * Math.cos(angle - Math.PI / 6),
        op.y1 - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        op.x1 - headLen * Math.cos(angle + Math.PI / 6),
        op.y1 - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'highlight': {
      ctx.save();
      ctx.fillStyle = op.color;
      ctx.globalAlpha = 0.32;
      const x = Math.min(op.x0, op.x1);
      const y = Math.min(op.y0, op.y1);
      const w = Math.abs(op.x1 - op.x0);
      const h = Math.abs(op.y1 - op.y0);
      ctx.fillRect(x, y, w, h);
      ctx.restore();
      break;
    }
    case 'text': {
      ctx.font = `600 ${op.fontSize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 4;
      ctx.fillText(op.text, op.x, op.y);
      break;
    }
    case 'step': {
      const r = Math.max(16, op.thickness * 5);
      ctx.beginPath();
      ctx.arc(op.x, op.y, r, 0, Math.PI * 2);
      ctx.fillStyle = op.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(r * 1.1)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(op.number), op.x, op.y + 1);
      break;
    }
    case 'stamp': {
      const ch = STAMP_CHARS[op.shape];
      ctx.fillStyle = op.color;
      ctx.font = `bold ${op.size}px -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.shadowBlur = 4;
      ctx.fillText(ch, op.x, op.y);
      break;
    }
    case 'callout': {
      const { x, y, width, height, tipX, tipY, text, fontSize, color, thickness } = op;
      // Box background (semi-opaque white) + colored border
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      ctx.strokeStyle = color;
      ctx.lineWidth = thickness;
      drawRoundedRect(ctx, x, y, width, height, 8);
      ctx.fill();
      ctx.stroke();
      // Tail: from tip to nearest point on rect edge
      const tail = closestPointOnRectEdge(x, y, width, height, tipX, tipY);
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tail.x, tail.y);
      ctx.stroke();
      // Tip "dot"
      ctx.beginPath();
      ctx.arc(tipX, tipY, Math.max(3, thickness), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      // Text inside box
      if (text) {
        ctx.fillStyle = '#0b0d10';
        ctx.font = `500 ${fontSize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        wrapText(ctx, text, x + width / 2, y + height / 2, width - 16, fontSize * 1.25);
      }
      break;
    }
    case 'blur': {
      const x = Math.min(op.x0, op.x1);
      const y = Math.min(op.y0, op.y1);
      const w = Math.abs(op.x1 - op.x0);
      const h = Math.abs(op.y1 - op.y0);
      const src = op.mode === 'pixelate' ? pixelatedImg : blurredImg;
      if (src && w > 0 && h > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, w, h);
        ctx.clip();
        ctx.drawImage(src, 0, 0);
        ctx.restore();
      }
      break;
    }
  }
  ctx.restore();
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function closestPointOnRectEdge(
  x: number,
  y: number,
  w: number,
  h: number,
  px: number,
  py: number
): { x: number; y: number } {
  const cx = Math.max(x, Math.min(px, x + w));
  const cy = Math.max(y, Math.min(py, y + h));
  // If px,py is inside, push out to the nearest edge.
  const dl = cx - x;
  const dr = x + w - cx;
  const dt = cy - y;
  const db = y + h - cy;
  const minD = Math.min(dl, dr, dt, db);
  if (minD === dl) return { x: x, y: cy };
  if (minD === dr) return { x: x + w, y: cy };
  if (minD === dt) return { x: cx, y: y };
  return { x: cx, y: y + h };
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  lineHeight: number
): void {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, i) => ctx.fillText(line, cx, startY + i * lineHeight));
}
