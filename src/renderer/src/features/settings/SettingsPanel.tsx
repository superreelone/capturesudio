import { useState } from 'react';
import type {
  BitratePreset,
  Fps,
  HotkeyAction,
  ResolutionPreset,
  ScreenshotFormat,
  Settings,
  Theme,
  VideoFormat
} from '@shared/settings.schema';
import { BITRATE_BPS } from '@shared/settings.schema';
import type { LicenseStatus } from '@shared/license.types';
import { HotkeyInput } from './HotkeyInput';
import { LicenseSection } from '../license/LicenseSection';
import { BluetoothPenPanel } from '../bluetooth/BluetoothPenPanel';

interface Props {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => Promise<void>;
  onReset: () => Promise<void>;
  license: LicenseStatus | null;
  onActivateLicense: (keyString: string) => Promise<{ ok: boolean; error?: string }>;
  onDeactivateLicense: () => Promise<void>;
}

const RESOLUTIONS: ResolutionPreset[] = ['720p', '1080p', '1440p', 'native'];
const FPS: Fps[] = [30, 60];
const BITRATES: BitratePreset[] = ['small', 'balanced', 'high', 'max'];
const VIDEO_FORMATS: VideoFormat[] = ['mp4', 'mkv', 'mov', 'webm', 'gif'];
const SCREENSHOT_FORMATS: ScreenshotFormat[] = ['png', 'jpg', 'webp', 'bmp', 'tiff'];
const THEMES: Theme[] = ['light', 'dark', 'system'];

const HOTKEY_LABELS: Record<HotkeyAction, string> = {
  startStopRecording: 'Start / stop recording',
  pauseResumeRecording: 'Pause / resume recording',
  screenshotRegion: 'Region screenshot',
  screenshotFullscreen: 'Fullscreen screenshot',
  screenshotWindow: 'Focused-window screenshot',
  toggleDrawing: 'Toggle drawing overlay',
  cycleTab: 'Cycle app tabs',
  drawPen: 'Draw — Pen tool',
  drawArrow: 'Draw — Arrow tool',
  drawLine: 'Draw — Line tool',
  drawRect: 'Draw — Rectangle tool',
  drawClear: 'Draw — Clear all strokes'
};

export function SettingsPanel({
  settings,
  onUpdate,
  onReset,
  license,
  onActivateLicense,
  onDeactivateLicense
}: Props): JSX.Element {
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  async function applyHotkey(action: HotkeyAction, accel: string): Promise<void> {
    await onUpdate({ hotkeys: { ...settings.hotkeys, [action]: accel } });
    const result = await window.api.hotkeys.register();
    if (result.conflicts.length > 0) {
      setConflictMsg(
        `Could not register: ${result.conflicts.map((a) => HOTKEY_LABELS[a]).join(', ')} (already used by another app or invalid).`
      );
    } else {
      setConflictMsg(null);
    }
  }

  async function chooseOutputFolder(): Promise<void> {
    const result = await window.api.app.chooseDirectory({
      title: 'Choose recordings folder',
      defaultPath: settings.outputFolder
    });
    if (!result.cancelled && result.path) {
      await onUpdate({ outputFolder: result.path });
    }
  }

  async function chooseScreenshotFolder(): Promise<void> {
    const result = await window.api.app.chooseDirectory({
      title: 'Choose screenshots folder',
      defaultPath: settings.screenshotFolder
    });
    if (!result.cancelled && result.path) {
      await onUpdate({ screenshotFolder: result.path });
    }
  }

  return (
    <section className="settings">
      <h2>Capture</h2>
      <div className="settings__row">
        <SegGroup
          label="Resolution"
          options={RESOLUTIONS}
          value={settings.resolutionPreset}
          onChange={(v) => void onUpdate({ resolutionPreset: v })}
        />
        <SegGroup
          label="Frame rate"
          options={FPS}
          value={settings.fps}
          onChange={(v) => void onUpdate({ fps: v })}
          format={(v) => `${v}`}
        />
        <SegGroup
          label="Bitrate"
          options={BITRATES}
          value={settings.bitratePreset}
          onChange={(v) => void onUpdate({ bitratePreset: v })}
          format={(v) => `${v} · ${BITRATE_BPS[v] / 1_000_000} Mbps`}
        />
      </div>
      <div className="settings__row">
        <SegGroup
          label="Countdown"
          options={[0, 3, 5, 10] as const}
          value={settings.countdownSeconds}
          onChange={(v) => void onUpdate({ countdownSeconds: v })}
          format={(v) => (v === 0 ? 'off' : `${v}s`)}
        />
        <Toggle
          label="Show cursor in recording"
          value={settings.showCursor}
          onChange={(v) => void onUpdate({ showCursor: v })}
          hint="OS-dependent; not all platforms honor this with the desktop-capture API."
        />
        <Toggle
          label="Click highlight effect"
          value={settings.clickHighlight}
          onChange={(v) => void onUpdate({ clickHighlight: v })}
          hint="Persisted now; visual overlay ships in a later phase."
        />
        <Toggle
          label="Hide drawing toolbar in recording"
          value={settings.hideDrawingToolbarWhileRecording}
          onChange={(v) => void onUpdate({ hideDrawingToolbarWhileRecording: v })}
          hint="Off (default) keeps the floating drawing toolbar + cursor visible in the captured video, which is usually what you want for tutorials. Turn this on for clean takes where strokes appear without UI chrome."
        />
        <Toggle
          label="Capture compatibility mode (Windows)"
          value={settings.captureCompatibilityMode}
          onChange={(v) => void onUpdate({ captureCompatibilityMode: v })}
          hint="Off (default) — uses the modern Windows.Graphics.Capture (WGC) backend, which works on most setups. Turn this On only if your recordings are freezing on the first frame, or if you see HRESULT 0x887A0026 'keyed mutex abandoned' errors. It forces the older DXGI Desktop Duplication backend, which is slower but more reliable on some hardware. Requires app restart to take effect."
        />
      </div>

      <h2>Output</h2>
      <div className="settings__col">
        <FolderRow
          label="Recordings folder"
          path={settings.outputFolder}
          onChange={chooseOutputFolder}
          onReveal={() => void window.api.app.openPath(settings.outputFolder)}
        />
        <FolderRow
          label="Screenshots folder"
          path={settings.screenshotFolder}
          onChange={chooseScreenshotFolder}
          onReveal={() => void window.api.app.openPath(settings.screenshotFolder)}
        />
        <div className="field">
          <label>Filename template</label>
          <input
            type="text"
            className="text"
            value={settings.filenameTemplate}
            onChange={(e) => void onUpdate({ filenameTemplate: e.target.value })}
          />
          <p className="muted small">
            Tokens: <code>{'{app}'}</code> <code>{'{type}'}</code> <code>{'{source}'}</code>{' '}
            <code>{'{date}'}</code> <code>{'{time}'}</code> <code>{'{counter}'}</code>{' '}
            <code>{'{year}'}</code> <code>{'{month}'}</code> <code>{'{day}'}</code>
          </p>
        </div>
        <div className="settings__row">
          <SegGroup
            label="Default video format"
            options={VIDEO_FORMATS}
            value={settings.defaultVideoFormat}
            onChange={(v) => void onUpdate({ defaultVideoFormat: v })}
          />
          <SegGroup
            label="Default screenshot format"
            options={SCREENSHOT_FORMATS}
            value={settings.defaultScreenshotFormat}
            onChange={(v) => void onUpdate({ defaultScreenshotFormat: v })}
          />
        </div>
      </div>

      <h2>Hotkeys</h2>
      {conflictMsg && <p className="error">{conflictMsg}</p>}
      <div className="settings__col hotkeys">
        {(Object.keys(HOTKEY_LABELS) as HotkeyAction[]).map((action) => (
          <HotkeyInput
            key={action}
            label={HOTKEY_LABELS[action]}
            value={settings.hotkeys[action]}
            onChange={(accel) => void applyHotkey(action, accel)}
          />
        ))}
      </div>
      <p className="muted small">
        Hotkeys are temporarily paused while you bind a new one, then re-registered automatically.
        Avoid raw <kbd>F1</kbd>–<kbd>F12</kbd> on laptops — many OEMs (Dell, HP, Lenovo, ASUS,
        MSI) map those to brightness, night-mode, mic-mute and similar functions that the OS
        intercepts before the app can see the key. Combinations like{' '}
        <kbd>Ctrl+Shift+1</kbd> or <kbd>Alt+P</kbd> are usually safe.
      </p>

      <h2>Appearance</h2>
      <div className="settings__row">
        <SegGroup
          label="Theme"
          options={THEMES}
          value={settings.theme}
          onChange={(v) => void onUpdate({ theme: v })}
        />
      </div>

      <h2>Bluetooth pen</h2>
      <BluetoothPenPanel settings={settings} onUpdate={onUpdate} />

      <h2>Diagnostics</h2>
      <div className="settings__row">
        <Toggle
          label="Local crash reporter"
          value={settings.crashReporterEnabled}
          onChange={(v) => void onUpdate({ crashReporterEnabled: v })}
          hint="Writes native crash dumps to userData/Crashpad/ and JS errors to userData/crash.log. No data leaves this device. Restart required to take effect."
        />
      </div>

      <h2>License</h2>
      <LicenseSection
        status={license}
        onActivate={onActivateLicense}
        onDeactivate={onDeactivateLicense}
      />

      <div className="settings__footer">
        <button className="ghost" onClick={() => void onReset()}>
          Reset all settings to defaults
        </button>
      </div>
    </section>
  );
}

interface SegGroupProps<T extends string | number> {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}

function SegGroup<T extends string | number>({
  label,
  options,
  value,
  onChange,
  format
}: SegGroupProps<T>): JSX.Element {
  return (
    <div className="preset-group">
      <label>{label}</label>
      <div className="seg">
        {options.map((opt) => (
          <button
            key={String(opt)}
            className={`seg__btn${opt === value ? ' seg__btn--on' : ''}`}
            onClick={() => onChange(opt)}
          >
            {format ? format(opt) : String(opt)}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ToggleProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}

function Toggle({ label, value, onChange, hint }: ToggleProps): JSX.Element {
  return (
    <div className="preset-group toggle">
      <label>
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {hint && <p className="muted small">{hint}</p>}
    </div>
  );
}

interface FolderRowProps {
  label: string;
  path: string;
  onChange: () => void | Promise<void>;
  onReveal: () => void;
}

function FolderRow({ label, path, onChange, onReveal }: FolderRowProps): JSX.Element {
  return (
    <div className="field folder">
      <label>{label}</label>
      <div className="folder__row">
        <code className="path">{path}</code>
        <button onClick={() => void onChange()}>Change…</button>
        <button className="ghost" onClick={onReveal}>
          Open
        </button>
      </div>
    </div>
  );
}
