import { useEffect, useRef, useState } from 'react';
import type { CompositorHandle } from '../webcam/composite';
import { WEBCAM_SIZE_PX, type Settings, type WebcamSize } from '@shared/settings.schema';

interface Props {
  compositor: CompositorHandle;
  settings: Settings;
  /** Called every drag tick with new [customX, customY] in 0..1 canvas space. */
  onDrag: (customX: number, customY: number) => void;
}

/**
 * Small always-visible preview of the composite output that the MediaRecorder
 * is actually consuming. Renders the compositor's canvas.captureStream() in a
 * plain <video> and overlays a translucent draggable rectangle at the current
 * webcam PiP position — dragging it repositions the PiP live during recording.
 *
 * All rectangle math is done in composite-canvas pixel space; the outer
 * container's CSS aspect ratio matches the composite's aspect so the mapping
 * is a straight linear scale.
 */
export function LiveCompositePreview({ compositor, settings, onDrag }: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = compositor.stream;
    void v.play().catch(() => undefined);
    return () => {
      v.srcObject = null;
    };
  }, [compositor]);

  // Compute the current PiP rectangle in composite-canvas pixel space, then
  // scale it to the preview element's actual on-screen size. Recomputes each
  // render so mid-recording setting changes (size preset, margin, mirror,
  // etc.) reflect immediately.
  const rect = computePipRect(settings, compositor.outputWidth, compositor.outputHeight);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const cRect = container.getBoundingClientRect();
    // Convert click into composite pixel space.
    const scaleX = compositor.outputWidth / cRect.width;
    const scaleY = compositor.outputHeight / cRect.height;
    const clickX = (e.clientX - cRect.left) * scaleX;
    const clickY = (e.clientY - cRect.top) * scaleY;

    // Grab offset from the PiP top-left to the click point so the box doesn't
    // jump under the cursor on drag start. If the click landed outside the
    // PiP we still start a drag but centre the PiP on the pointer — feels
    // more like a "move to here" than a bug.
    let offsetX: number;
    let offsetY: number;
    if (
      clickX >= rect.x &&
      clickX <= rect.x + rect.w &&
      clickY >= rect.y &&
      clickY <= rect.y + rect.h
    ) {
      offsetX = clickX - rect.x;
      offsetY = clickY - rect.y;
    } else {
      offsetX = rect.w / 2;
      offsetY = rect.h / 2;
      // Emit an immediate reposition so the box teleports under the cursor.
      const nx = clamp((clickX - offsetX) / compositor.outputWidth, 0, 1 - rect.w / compositor.outputWidth);
      const ny = clamp((clickY - offsetY) / compositor.outputHeight, 0, 1 - rect.h / compositor.outputHeight);
      onDrag(nx, ny);
    }

    container.setPointerCapture(e.pointerId);
    setDragging(true);

    const onMove = (ev: PointerEvent): void => {
      const cx = (ev.clientX - cRect.left) * scaleX;
      const cy = (ev.clientY - cRect.top) * scaleY;
      const nx = clamp(
        (cx - offsetX) / compositor.outputWidth,
        0,
        Math.max(0, 1 - rect.w / compositor.outputWidth)
      );
      const ny = clamp(
        (cy - offsetY) / compositor.outputHeight,
        0,
        Math.max(0, 1 - rect.h / compositor.outputHeight)
      );
      onDrag(nx, ny);
    };
    const onUp = (): void => {
      container.removeEventListener('pointermove', onMove);
      container.removeEventListener('pointerup', onUp);
      container.removeEventListener('pointercancel', onUp);
      setDragging(false);
    };
    container.addEventListener('pointermove', onMove);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onUp);
  };

  // The preview container aspect ratio matches the composite. Cap at a
  // reasonable width so it doesn't take over the whole panel.
  const aspect = compositor.outputWidth / compositor.outputHeight;
  const previewWidth = 480;
  const previewHeight = previewWidth / aspect;

  return (
    <div className="live-preview">
      <div className="live-preview__label">
        Recording preview · <em>drag the box to reposition webcam</em>
      </div>
      <div
        ref={containerRef}
        className="live-preview__container"
        style={{ width: previewWidth, height: previewHeight }}
        onPointerDown={startDrag}
      >
        <video ref={videoRef} muted playsInline autoPlay className="live-preview__video" />
        <div
          className={`live-preview__pip${dragging ? ' live-preview__pip--dragging' : ''}`}
          style={{
            left: `${(rect.x / compositor.outputWidth) * 100}%`,
            top: `${(rect.y / compositor.outputHeight) * 100}%`,
            width: `${(rect.w / compositor.outputWidth) * 100}%`,
            height: `${(rect.h / compositor.outputHeight) * 100}%`,
            borderRadius: settings.webcamShape === 'circle' ? '50%' : '4px'
          }}
        />
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Mirrors composeWebcamRect from composite.ts. Keep the two in sync when
 *  position/size math changes. */
function computePipRect(
  settings: Settings,
  canvasW: number,
  canvasH: number
): { x: number; y: number; w: number; h: number } {
  const size = settings.webcamSize as WebcamSize;
  const targetH = WEBCAM_SIZE_PX[size];
  // We don't know the source webcam aspect from here without a peek at the
  // media stream; assume 16:9 which is what all built-in laptop cams report.
  const aspect = 16 / 9;
  const h = Math.min(targetH, canvasH * 0.8);
  const w = Math.round(h * aspect);
  const m = settings.webcamMargin;

  let x: number;
  let y: number;
  switch (settings.webcamPosition) {
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
      x = Math.round(settings.webcamCustomX * canvasW);
      y = Math.round(settings.webcamCustomY * canvasH);
      break;
  }
  x = Math.max(0, Math.min(canvasW - w, x));
  y = Math.max(0, Math.min(canvasH - h, y));
  return { x, y, w: Math.round(w), h: Math.round(h) };
}
