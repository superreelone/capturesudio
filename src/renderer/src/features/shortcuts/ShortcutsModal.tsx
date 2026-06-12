import type { Settings } from '@shared/settings.schema';

interface Props {
  settings: Settings;
  onClose: () => void;
}

interface Row {
  label: string;
  combo: string;
  scope: string;
}

function localShortcuts(): Row[] {
  return [
    { label: 'Go to Record tab', combo: 'Ctrl+1', scope: 'In-app' },
    { label: 'Go to Screenshot tab', combo: 'Ctrl+2', scope: 'In-app' },
    { label: 'Go to Library tab', combo: 'Ctrl+3', scope: 'In-app' },
    { label: 'Go to Settings tab', combo: 'Ctrl+4', scope: 'In-app' },
    { label: 'Open this shortcuts card', combo: '?', scope: 'In-app' },
    { label: 'Close shortcuts card', combo: 'Esc', scope: 'In-app' }
  ];
}

function drawingShortcuts(): Row[] {
  return [
    { label: 'Pen', combo: 'P', scope: 'Drawing overlay' },
    { label: 'Highlight', combo: 'H', scope: 'Drawing overlay' },
    { label: 'Arrow', combo: 'A', scope: 'Drawing overlay' },
    { label: 'Rectangle', combo: 'R', scope: 'Drawing overlay' },
    { label: 'Ellipse', combo: 'O', scope: 'Drawing overlay' },
    { label: 'Eraser', combo: 'E', scope: 'Drawing overlay' },
    { label: 'Undo / Redo', combo: 'Ctrl+Z / Ctrl+Shift+Z', scope: 'Drawing overlay' },
    { label: 'Clear all strokes', combo: 'Ctrl+Shift+C', scope: 'Drawing overlay' },
    { label: 'Toggle draw / pass mode', combo: 'Esc', scope: 'Drawing overlay' }
  ];
}

export function ShortcutsModal({ settings, onClose }: Props): JSX.Element {
  const global: Row[] = [
    { label: 'Start / stop recording', combo: settings.hotkeys.startStopRecording, scope: 'Global' },
    { label: 'Pause / resume recording', combo: settings.hotkeys.pauseResumeRecording, scope: 'Global' },
    { label: 'Region screenshot', combo: settings.hotkeys.screenshotRegion, scope: 'Global' },
    { label: 'Fullscreen screenshot', combo: settings.hotkeys.screenshotFullscreen, scope: 'Global' },
    { label: 'Focused-window screenshot', combo: settings.hotkeys.screenshotWindow, scope: 'Global' },
    { label: 'Toggle drawing overlay', combo: settings.hotkeys.toggleDrawing, scope: 'Global' },
    { label: 'Cycle app tabs', combo: settings.hotkeys.cycleTab, scope: 'Global' }
  ];

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__head">
          <h2>Keyboard shortcuts</h2>
          <button className="ghost" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal__body">
          <Section title="Global (work from any app)" rows={global} />
          <Section title="In-app (work when this window is focused)" rows={localShortcuts()} />
          <Section title="Drawing overlay (when overlay is in draw mode)" rows={drawingShortcuts()} />
          <p className="muted small">
            Rebind global shortcuts in Settings → Hotkeys.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: Row[] }): JSX.Element {
  return (
    <div className="shortcuts-section">
      <h3>{title}</h3>
      <div className="shortcuts-table">
        {rows.map((r) => (
          <div className="shortcuts-row" key={`${r.scope}-${r.label}`}>
            <span className="shortcuts-row__label">{r.label}</span>
            <kbd className="shortcuts-row__combo">{r.combo}</kbd>
          </div>
        ))}
      </div>
    </div>
  );
}
