export type Tool = 'pen' | 'highlight' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'eraser';

export interface BaseOp {
  id: number;
  tool: Tool;
  color: string;
  thickness: number;
}

export interface StrokeOp extends BaseOp {
  tool: 'pen' | 'highlight' | 'eraser';
  points: Array<{ x: number; y: number }>;
}

export interface ShapeOp extends BaseOp {
  tool: 'arrow' | 'line' | 'rect' | 'ellipse';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type DrawOp = StrokeOp | ShapeOp;

export function isStroke(op: DrawOp): op is StrokeOp {
  return op.tool === 'pen' || op.tool === 'highlight' || op.tool === 'eraser';
}

export function drawOpOnto(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (op.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
    ctx.lineWidth = Math.max(8, op.thickness * 3);
    if (isStroke(op) && op.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(op.points[0]!.x, op.points[0]!.y);
      for (let i = 1; i < op.points.length; i++) ctx.lineTo(op.points[i]!.x, op.points[i]!.y);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.thickness;

  if (op.tool === 'highlight') {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(op.thickness * 2.5, 8);
    if (isStroke(op) && op.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(op.points[0]!.x, op.points[0]!.y);
      for (let i = 1; i < op.points.length; i++) ctx.lineTo(op.points[i]!.x, op.points[i]!.y);
      ctx.stroke();
    }
  } else if (op.tool === 'pen') {
    if (isStroke(op) && op.points.length > 0) {
      ctx.beginPath();
      ctx.moveTo(op.points[0]!.x, op.points[0]!.y);
      for (let i = 1; i < op.points.length; i++) ctx.lineTo(op.points[i]!.x, op.points[i]!.y);
      ctx.stroke();
    }
  } else if (op.tool === 'line') {
    const s = op as ShapeOp;
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
  } else if (op.tool === 'rect') {
    const s = op as ShapeOp;
    const x = Math.min(s.x0, s.x1);
    const y = Math.min(s.y0, s.y1);
    ctx.strokeRect(x, y, Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
  } else if (op.tool === 'ellipse') {
    const s = op as ShapeOp;
    const cx = (s.x0 + s.x1) / 2;
    const cy = (s.y0 + s.y1) / 2;
    const rx = Math.abs(s.x1 - s.x0) / 2;
    const ry = Math.abs(s.y1 - s.y0) / 2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (op.tool === 'arrow') {
    const s = op as ShapeOp;
    const dx = s.x1 - s.x0;
    const dy = s.y1 - s.y0;
    const headLen = Math.max(14, op.thickness * 3.5);
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(
      s.x1 - headLen * Math.cos(angle - Math.PI / 6),
      s.y1 - headLen * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      s.x1 - headLen * Math.cos(angle + Math.PI / 6),
      s.y1 - headLen * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function repaint(
  canvas: HTMLCanvasElement,
  ops: DrawOp[],
  current: DrawOp | null
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const op of ops) drawOpOnto(ctx, op);
  if (current) drawOpOnto(ctx, current);
}
