import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  mirror: boolean;
  shape: 'rect' | 'circle';
  size?: number;
  /** Crop-zoom on the preview to match what the recording compositor does. */
  zoom?: number;
  borderWidth?: number;
  borderColor?: string;
  /** Live face-centre callback. When provided + returns non-null, the preview
   *  shifts to keep the face framed; otherwise reverts to centred crop. */
  getFaceCenter?: () => { x: number; y: number } | null;
}

export function WebcamPreview({
  stream,
  mirror,
  shape,
  size = 120,
  zoom = 1,
  borderWidth = 0,
  borderColor = '#ffffff80',
  getFaceCenter
}: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (stream) {
      v.srcObject = stream;
      void v.play().catch(() => undefined);
    } else {
      v.srcObject = null;
    }
  }, [stream]);

  // Push the transform via setInterval (not rAF — same reason the LevelMeter
  // moved off rAF: it gets throttled when the renderer is under load and the
  // preview would freeze even though tracking is still running). 20Hz is
  // plenty for smooth visual tracking.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const scale = Math.max(1, zoom);
    const mirrorPart = mirror ? 'scaleX(-1) ' : '';

    function applyTransform(): void {
      if (!v) return;
      const face = getFaceCenter ? getFaceCenter() : null;
      // Face coords are in UN-mirrored video space. In a mirrored preview the
      // face appears at (1 - face.x), so the offset sign flips on X.
      const fx = face ? (mirror ? 1 - face.x : face.x) : 0.5;
      const fy = face ? face.y : 0.5;
      // We want the face to land at the centre of the preview after scaling.
      // CSS translate with %s is in element-own space; combined with scale
      // around the default centre origin, this puts (fx,fy) at the centre.
      const tx = (0.5 - fx) * 100;
      const ty = (0.5 - fy) * 100;
      v.style.transform = `${mirrorPart}translate(${tx}%, ${ty}%) scale(${scale})`;
    }
    applyTransform();
    if (!getFaceCenter) return; // static transform — no need to poll
    const timer = window.setInterval(applyTransform, 50);
    return () => window.clearInterval(timer);
  }, [mirror, zoom, getFaceCenter]);

  return (
    <div
      className={`webcam-preview${shape === 'circle' ? ' webcam-preview--circle' : ''}`}
      style={{
        width: size,
        height: size * 0.5625,
        border: borderWidth > 0 ? `${borderWidth}px solid ${borderColor}` : undefined,
        boxSizing: 'border-box'
      }}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{
          transformOrigin: 'center',
          objectFit: 'cover'
        }}
      />
    </div>
  );
}
