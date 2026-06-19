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
}

export function WebcamPreview({
  stream,
  mirror,
  shape,
  size = 120,
  zoom = 1,
  borderWidth = 0,
  borderColor = '#ffffff80'
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

  // Compose transforms: mirror flips on X, zoom scales up — both off the
  // centre so the cropped portion of the face stays framed.
  const scale = Math.max(1, zoom);
  const mirrorPart = mirror ? 'scaleX(-1) ' : '';
  const transform = `${mirrorPart}scale(${scale})`;

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
          transform,
          transformOrigin: 'center',
          objectFit: 'cover'
        }}
      />
    </div>
  );
}
