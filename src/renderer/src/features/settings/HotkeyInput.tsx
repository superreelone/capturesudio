import { useCallback, useEffect, useRef, useState } from 'react';
import { acceleratorFromEvent } from './acceleratorFromEvent';

interface Props {
  label: string;
  value: string;
  onChange: (accelerator: string) => void;
}

export function HotkeyInput({ label, value, onChange }: Props): JSX.Element {
  const [capturing, setCapturing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const stopCapture = useCallback(
    (accept: boolean) => {
      setCapturing(false);
      if (accept && draft) onChange(draft);
      setDraft(null);
      void window.api.hotkeys.register();
    },
    [draft, onChange]
  );

  useEffect(() => {
    if (!capturing) return;

    void window.api.hotkeys.unregister();

    function onKey(e: KeyboardEvent): void {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        stopCapture(false);
        return;
      }
      const accel = acceleratorFromEvent(e);
      if (accel) setDraft(accel);
    }
    function onKeyUp(e: KeyboardEvent): void {
      e.preventDefault();
      const accel = acceleratorFromEvent(e);
      if (accel) {
        setDraft(accel);
        setTimeout(() => stopCapture(true), 50);
      }
    }
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKeyUp, true);

    function onClickOutside(e: MouseEvent): void {
      if (!containerRef.current?.contains(e.target as Node)) stopCapture(false);
    }
    window.addEventListener('mousedown', onClickOutside, true);

    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('mousedown', onClickOutside, true);
    };
  }, [capturing, stopCapture]);

  return (
    <div className="hotkey" ref={containerRef}>
      <label className="hotkey__label">{label}</label>
      <button
        className={`hotkey__btn${capturing ? ' hotkey__btn--capturing' : ''}`}
        onClick={() => {
          setDraft(null);
          setCapturing(true);
        }}
      >
        {capturing ? draft ?? 'Press keys…' : <kbd>{value}</kbd>}
      </button>
      <button className="ghost small-btn" onClick={() => onChange('')} title="Clear">
        clear
      </button>
    </div>
  );
}
