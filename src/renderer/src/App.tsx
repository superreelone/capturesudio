import { useCallback, useEffect, useState } from 'react';
import type { AppVersionInfo } from '@shared/ipc-types';
import type { HotkeyAction, Settings } from '@shared/settings.schema';
import { RecordPanel } from './features/capture/RecordPanel';
import { ScreenshotPanel } from './features/screenshots/ScreenshotPanel';
import { Library } from './features/library/Library';
import { SettingsPanel } from './features/settings/SettingsPanel';
import { ActivationScreen } from './features/license/ActivationScreen';
import { useLicense } from './features/license/useLicense';
import { ShortcutsModal } from './features/shortcuts/ShortcutsModal';
import { UpdateBanner } from './features/updater/UpdateBanner';
import logoUrl from './assets/logo.png';

type Tab = 'record' | 'screenshot' | 'library' | 'settings';

const TAB_ORDER: Tab[] = ['record', 'screenshot', 'library', 'settings'];

const RECORDING_ACTIONS: HotkeyAction[] = ['startStopRecording', 'pauseResumeRecording'];
const SCREENSHOT_ACTIONS: HotkeyAction[] = [
  'screenshotFullscreen',
  'screenshotRegion',
  'screenshotWindow'
];

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>('record');
  const [version, setVersion] = useState<AppVersionInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  // Captions transcription status (banner under the UpdateBanner). null when
  // no job is running. We accept up to one job at a time in the UI; the main
  // process can run several but only the most recent shows here.
  const [captionsStatus, setCaptionsStatus] = useState<{
    phase: string;
    percent: number;
    message: string;
    isDone: boolean;
    isError: boolean;
  } | null>(null);

  // Pending hotkey actions for the per-tab panels to consume.
  // We store a counter alongside so the same action can re-fire (e.g.
  // pressing Ctrl+Shift+F twice in a row should take two screenshots).
  const [pendingRecording, setPendingRecording] = useState<{
    action: HotkeyAction;
    seq: number;
  } | null>(null);
  const [pendingScreenshot, setPendingScreenshot] = useState<{
    action: HotkeyAction;
    seq: number;
  } | null>(null);

  const license = useLicense();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [v, s] = await Promise.all([window.api.app.getVersion(), window.api.settings.get()]);
        if (cancelled) return;
        setVersion(v);
        setSettings(s);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = await window.api.settings.update(patch);
    setSettings(next);
  }, []);

  // Apply the selected theme to the document. When `system`, track the OS
  // preference live (so toggling Windows light/dark mode flips the UI without
  // a restart).
  useEffect(() => {
    const theme = settings?.theme ?? 'system';
    const root = document.documentElement;
    if (theme !== 'system') {
      root.dataset.theme = theme;
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = (): void => {
      root.dataset.theme = media.matches ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings?.theme]);

  const resetSettings = useCallback(async () => {
    const next = await window.api.settings.reset();
    setSettings(next);
  }, []);

  // In-app keyboard shortcuts (only fire when the main app window is focused).
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const target = e.target as HTMLElement | null;
      const inTextField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (inTextField) {
        if (e.key === 'Escape' && showShortcuts) {
          e.preventDefault();
          setShowShortcuts(false);
        }
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && !e.altKey && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        setTab(TAB_ORDER[Number(e.key) - 1]!);
      } else if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
      } else if (e.key === 'Escape' && showShortcuts) {
        e.preventDefault();
        setShowShortcuts(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showShortcuts]);

  // Captions event subscriptions — render a small banner with progress.
  useEffect(() => {
    const offProgress = window.api.events.onCaptionsProgress((ev) => {
      setCaptionsStatus({
        phase: ev.phase,
        percent: ev.percent,
        message: ev.message,
        isDone: false,
        isError: false
      });
    });
    const offDone = window.api.events.onCaptionsDone((ev) => {
      setCaptionsStatus({
        phase: 'done',
        percent: 1,
        message: ev.captionedVideoPath
          ? `Captions ready · SRT + burned-in MP4 saved next to ${ev.videoPath.split(/[/\\]/).pop()}`
          : `Captions ready · SRT saved next to ${ev.videoPath.split(/[/\\]/).pop()}`,
        isDone: true,
        isError: false
      });
      // Auto-dismiss the success message after 10 seconds.
      setTimeout(() => setCaptionsStatus((s) => (s?.isDone ? null : s)), 10_000);
    });
    const offError = window.api.events.onCaptionsError((ev) => {
      setCaptionsStatus({
        phase: 'error',
        percent: 0,
        message: `Captions failed: ${ev.message}`,
        isDone: false,
        isError: true
      });
    });
    return () => {
      offProgress();
      offDone();
      offError();
    };
  }, []);

  // Central handler for every global hotkey. Panels receive a queued action
  // instead of subscribing directly — so a hotkey works from any tab.
  useEffect(() => {
    let recSeq = 0;
    let shotSeq = 0;
    const off = window.api.events.onHotkeyTriggered(async (action) => {
      if (RECORDING_ACTIONS.includes(action)) {
        setTab('record');
        recSeq += 1;
        setPendingRecording({ action, seq: recSeq });
      } else if (SCREENSHOT_ACTIONS.includes(action)) {
        setTab('screenshot');
        shotSeq += 1;
        setPendingScreenshot({ action, seq: shotSeq });
      } else if (action === 'toggleDrawing') {
        // Open if closed; close entirely if already open. (Mode toggle is
        // available separately inside the overlay via Ctrl+Shift+D or Esc.)
        const state = await window.api.drawing.state();
        if (state.open) await window.api.drawing.hide();
        else await window.api.drawing.show({});
      } else if (
        action === 'drawPen' ||
        action === 'drawArrow' ||
        action === 'drawLine' ||
        action === 'drawRect'
      ) {
        // Make sure overlay is open in DRAW mode, then select the requested tool.
        const state = await window.api.drawing.state();
        if (!state.open) {
          await window.api.drawing.show({ mode: 'draw' });
        } else if (state.mode === 'pass') {
          await window.api.drawing.toggleMode();
        }
        const tool =
          action === 'drawPen'
            ? 'pen'
            : action === 'drawArrow'
              ? 'arrow'
              : action === 'drawLine'
                ? 'line'
                : 'rect';
        await window.api.drawing.setTool(tool);
      } else if (action === 'drawClear') {
        const state = await window.api.drawing.state();
        if (state.open) await window.api.drawing.clear();
      } else if (action === 'cycleTab') {
        setTab((prev) => {
          const i = TAB_ORDER.indexOf(prev);
          return TAB_ORDER[(i + 1) % TAB_ORDER.length]!;
        });
      }
    });
    return off;
  }, []);

  // Gating decision
  const licenseStatusValue = license.status?.status ?? 'none';
  const showActivationGate =
    !license.loading &&
    license.status !== null &&
    (licenseStatusValue === 'none' ||
      licenseStatusValue === 'expired' ||
      licenseStatusValue === 'tampered');

  const showActivationFull = showActivationGate && tab !== 'library' && tab !== 'settings';

  const licenseBadge =
    licenseStatusValue === 'active' && typeof license.status?.daysRemaining === 'number'
      ? license.status.daysRemaining <= 14
        ? `${license.status.daysRemaining}d left`
        : null
      : licenseStatusValue === 'expired'
        ? 'Expired'
        : licenseStatusValue === 'tampered'
          ? 'Re-activate'
          : licenseStatusValue === 'unconfigured'
            ? 'Dev'
            : licenseStatusValue === 'none'
              ? 'Activate'
              : null;

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title">
          <div className="brand">
            <img src={logoUrl} alt="Ingestra" className="brand__logo" />
            <div className="brand__words">
              <span className="brand__name">Ingestra</span>
              <span className="brand__sub">CaptureStudio</span>
            </div>
          </div>
          {licenseBadge && (
            <span
              className={`license-badge license-badge--${licenseStatusValue}`}
              onClick={() => setTab('settings')}
              title="Open license settings"
            >
              {licenseBadge}
            </span>
          )}
        </div>
        <nav className="tabs">
          <button
            className={`tab-btn${tab === 'record' ? ' tab-btn--on' : ''}`}
            onClick={() => setTab('record')}
            title="Ctrl+1"
          >
            Record
          </button>
          <button
            className={`tab-btn${tab === 'screenshot' ? ' tab-btn--on' : ''}`}
            onClick={() => setTab('screenshot')}
            title="Ctrl+2"
          >
            Screenshot
          </button>
          <button
            className={`tab-btn${tab === 'library' ? ' tab-btn--on' : ''}`}
            onClick={() => setTab('library')}
            title="Ctrl+3"
          >
            Library
          </button>
          <button
            className={`tab-btn${tab === 'settings' ? ' tab-btn--on' : ''}`}
            onClick={() => setTab('settings')}
            title="Ctrl+4"
          >
            Settings
          </button>
          <button
            className="tab-btn tab-btn--icon"
            onClick={() => setShowShortcuts(true)}
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            ⌨
          </button>
        </nav>
      </header>

      <main className="app__main app__main--stack">
        <UpdateBanner />
        {captionsStatus && (
          <div
            className={`captions-banner${captionsStatus.isError ? ' captions-banner--error' : captionsStatus.isDone ? ' captions-banner--done' : ''}`}
          >
            <div className="captions-banner__row">
              <span className="captions-banner__icon">
                {captionsStatus.isError ? '⚠' : captionsStatus.isDone ? '✓' : '⟳'}
              </span>
              <span className="captions-banner__msg">{captionsStatus.message}</span>
              <button
                className="captions-banner__close"
                onClick={() => setCaptionsStatus(null)}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
            {!captionsStatus.isDone && !captionsStatus.isError && captionsStatus.percent > 0 && (
              <div className="captions-banner__bar">
                <div
                  className="captions-banner__bar-fill"
                  style={{ width: `${Math.round(captionsStatus.percent * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}

        {showActivationFull && license.status && (
          <ActivationScreen
            status={license.status}
            onActivate={license.activate}
            onSwitchToLibrary={() => setTab('library')}
          />
        )}

        {!showActivationFull && settings && version && tab === 'record' && (
          <RecordPanel
            settings={settings}
            platform={version.platform}
            onUpdateSettings={updateSettings}
            pendingAction={pendingRecording}
            onPendingActionHandled={() => setPendingRecording(null)}
          />
        )}
        {!showActivationFull && settings && tab === 'screenshot' && (
          <ScreenshotPanel
            settings={settings}
            onUpdateSettings={updateSettings}
            pendingAction={pendingScreenshot}
            onPendingActionHandled={() => setPendingScreenshot(null)}
          />
        )}
        {tab === 'library' && <Library />}
        {settings && tab === 'settings' && (
          <SettingsPanel
            settings={settings}
            onUpdate={updateSettings}
            onReset={resetSettings}
            license={license.status}
            onActivateLicense={license.activate}
            onDeactivateLicense={license.deactivate}
          />
        )}
      </main>

      <footer className="app__footer">
        <span>
          contextIsolation · sandbox · no nodeIntegration
          {version && (
            <>
              {' · '}v{version.version}
            </>
          )}
        </span>
        <span className="app__footer-hint">
          Press <kbd>?</kbd> for shortcuts
        </span>
      </footer>

      {showShortcuts && settings && (
        <ShortcutsModal settings={settings} onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}
