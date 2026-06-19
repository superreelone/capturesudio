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
    let lastT = performance.now();
    // setInterval, not requestAnimationFrame: rAF gets paused or throttled
    // when the renderer is contested (e.g. CPU-delegate MediaPipe running the
    // webcam background segmenter), which makes the meter look frozen at a
    // static level even when the underlying mic signal is fine. setInterval
    // is driven off Chromium's timer queue and (with backgroundThrottling
    // disabled at the BrowserWindow level) keeps firing regardless of paint
    // pressure. 30ms = ~33Hz, fast enough to feel responsive without burning
    // CPU.
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
    };
    const timer = window.setInterval(tick, 30);
    tick(); // also paint immediately so the meter doesn't sit empty for 30ms
    return () => window.clearInterval(timer);
  }, [analyser, active]);

  return (
    <div className="meter" style={{ width, height }}>
      <div className="meter__fill" ref={fillRef} />
      <div className="meter__peak" ref={peakBarRef} />
    </div>
  );
}
