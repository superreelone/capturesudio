import {
  WEBCAM_SIZE_PX,
  type WebcamPosition,
  type WebcamShape,
  type WebcamSize
} from '@shared/settings.schema';
import type { RegionRect } from '@shared/recording.types';

export interface WebcamConfig {
  position: WebcamPosition;
  customX: number; // 0..1 of canvas width (top-left of webcam)
  customY: number;
  size: WebcamSize;
  shape: WebcamShape;
  mirror: boolean;
  margin: number;
}

export interface CompositeOptions {
  baseStream: MediaStream;
  /** If set, crop the base stream to this region (logical coords). */
  region: RegionRect | null;
  /** Display scale factor for region crop (1 if not region). */
  scaleFactor: number;
  /** Output canvas dimensions in pixels. */
  outputWidth: number;
  outputHeight: number;
  fps: number;
  /** Webcam stream (already running). null disables PiP. */
  webcamStream: MediaStream | null;
  webcamConfig: WebcamConfig;
}

export interface CompositorHandle {
  stream: MediaStream;
  dispose: () => void;
}

interface PreparedVideo {
  el: HTMLVideoElement;
  stop: () => void;
}

function prepareVideo(stream: MediaStream): PreparedVideo {
  const v = document.createElement('video');
  v.srcObject = stream;
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  void v.play().catch(() => undefined);
  const handler = (): void => {
    if (v.readyState < 2) void v.play().catch(() => undefined);
  };
  v.addEventListener('loadedmetadata', handler);
  return {
    el: v,
    stop: () => {
      v.removeEventListener('loadedmetadata', handler);
      try {
        v.pause();
      } catch {
        // ignore
      }
      v.srcObject = null;
    }
  };
}

function computeWebcamRect(
  config: WebcamConfig,
  canvasW: number,
  canvasH: number,
  webcamW: number,
  webcamH: number
): { x: number; y: number; w: number; h: number } {
  const targetH = WEBCAM_SIZE_PX[config.size];
  const aspect = webcamW > 0 && webcamH > 0 ? webcamW / webcamH : 16 / 9;
  const h = Math.min(targetH, canvasH * 0.8);
  const w = Math.round(h * aspect);
  const m = config.margin;

  let x: number;
  let y: number;
  switch (config.position) {
    case 'topLeft':
      x = m;
      y = m;
      break;
    case 'topRight':
      x = canvasW - w - m;
      y = m;
      break;
    case 'bottomLeft':
      x = m;
      y = canvasH - h - m;
      break;
    case 'bottomRight':
      x = canvasW - w - m;
      y = canvasH - h - m;
      break;
    case 'custom':
      x = Math.round(config.customX * canvasW);
      y = Math.round(config.customY * canvasH);
      break;
  }
  // Clamp inside canvas
  x = Math.max(0, Math.min(canvasW - w, x));
  y = Math.max(0, Math.min(canvasH - h, y));
  return { x, y, w: Math.round(w), h: Math.round(h) };
}

export function createCompositor(opts: CompositeOptions): CompositorHandle {
  const canvas = document.createElement('canvas');
  canvas.width = opts.outputWidth;
  canvas.height = opts.outputHeight;
  const ctxMaybe = canvas.getContext('2d', { alpha: false });
  if (!ctxMaybe) throw new Error('canvas 2d context unavailable');
  const ctx: CanvasRenderingContext2D = ctxMaybe;

  const base = prepareVideo(opts.baseStream);
  const cam = opts.webcamStream ? prepareVideo(opts.webcamStream) : null;

  let raf = 0;
  let disposed = false;

  // Pre-compute base draw rect (region crop, in physical pixels of source video).
  const region = opts.region;
  const sx = region ? Math.round(region.x * opts.scaleFactor) : 0;
  const sy = region ? Math.round(region.y * opts.scaleFactor) : 0;
  const swForRegion = region ? Math.max(2, Math.round(region.width * opts.scaleFactor)) : 0;
  const shForRegion = region ? Math.max(2, Math.round(region.height * opts.scaleFactor)) : 0;

  function draw(): void {
    if (disposed) return;

    if (base.el.readyState >= 2) {
      if (region) {
        ctx.drawImage(
          base.el,
          sx,
          sy,
          swForRegion,
          shForRegion,
          0,
          0,
          canvas.width,
          canvas.height
        );
      } else {
        ctx.drawImage(base.el, 0, 0, canvas.width, canvas.height);
      }
    } else {
      // First frame not yet ready
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    if (cam && cam.el.readyState >= 2) {
      const rect = computeWebcamRect(
        opts.webcamConfig,
        canvas.width,
        canvas.height,
        cam.el.videoWidth,
        cam.el.videoHeight
      );
      ctx.save();
      if (opts.webcamConfig.shape === 'circle') {
        ctx.beginPath();
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const r = Math.min(rect.w, rect.h) / 2;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
      }
      if (opts.webcamConfig.mirror) {
        ctx.translate(rect.x + rect.w, rect.y);
        ctx.scale(-1, 1);
        ctx.drawImage(cam.el, 0, 0, rect.w, rect.h);
      } else {
        ctx.drawImage(cam.el, rect.x, rect.y, rect.w, rect.h);
      }
      ctx.restore();
      // Subtle frame
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 2;
      if (opts.webcamConfig.shape === 'circle') {
        ctx.beginPath();
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const r = Math.min(rect.w, rect.h) / 2;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      }
      ctx.restore();
    }

    raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);

  const stream = canvas.captureStream(opts.fps);

  // If the base source ends (user clicked "stop sharing"), end the composite.
  for (const t of opts.baseStream.getVideoTracks()) {
    t.addEventListener('ended', () => {
      for (const out of stream.getTracks()) out.stop();
    });
  }

  return {
    stream,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      base.stop();
      cam?.stop();
      for (const t of stream.getTracks()) t.stop();
    }
  };
}
