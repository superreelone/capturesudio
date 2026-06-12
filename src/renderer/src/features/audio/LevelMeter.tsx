import { useEffect, useRef } from 'react';
import { analyserToLevel } from './audioPipeline';

interface Props {
  analyser: AnalyserNode | null;
  active: boolean;
  width?: number;
  height?: number;
}

export function LevelMeter({ analyser, active, width = 160, height = 10 }: Props): JSX.Element {
  const fillRef = useRef<HTMLDivElement | null>(null);
  const peakRef = useRef<number>(0);
  const peakDecayRef = useRef<number>(0);
  const peakBarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!analyser || !active) {
      if (fillRef.current) fillRef.current.style.width = '0%';
      if (peakBarRef.current) peakBarRef.current.style.left = '0%';
      return;
    }
    const buffer = new Uint8Array(analyser.fftSize);
    let raf = 0;
    let lastT = performance.now();
    const tick = (): void => {
      const level = analyserToLevel(analyser, buffer);
      // Visual: light compression for friendlier movement
      const display = Math.min(1, Math.pow(level, 0.65) * 1.6);
      if (fillRef.current) fillRef.current.style.width = `${(display * 100).toFixed(1)}%`;

      // Peak hold with decay
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      lastT = now;
      if (display > peakRef.current) {
        peakRef.current = display;
        peakDecayRef.current = 0;
      } else {
        peakDecayRef.current += dt;
        if (peakDecayRef.current > 0.6) {
          peakRef.current = Math.max(0, peakRef.current - dt * 0.5);
        }
      }
      if (peakBarRef.current) {
        peakBarRef.current.style.left = `${(peakRef.current * 100).toFixed(1)}%`;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [analyser, active]);

  return (
    <div className="meter" style={{ width, height }}>
      <div className="meter__fill" ref={fillRef} />
      <div className="meter__peak" ref={peakBarRef} />
    </div>
  );
}
