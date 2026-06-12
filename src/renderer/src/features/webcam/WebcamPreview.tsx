import { useEffect, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  mirror: boolean;
  shape: 'rect' | 'circle';
  size?: number;
}

export function WebcamPreview({ stream, mirror, shape, size = 120 }: Props): JSX.Element {
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

  return (
    <div
      className={`webcam-preview${shape === 'circle' ? ' webcam-preview--circle' : ''}`}
      style={{ width: size, height: size * 0.5625 }}
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={{
          transform: mirror ? 'scaleX(-1)' : 'none',
          objectFit: 'cover'
        }}
      />
    </div>
  );
}
