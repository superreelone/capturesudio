import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CaptureSource,
  DisplayInfo,
  FinalizeRecordingResponse,
  StartRecordingRequest
} from '@shared/recording.types';
import type {
  BitratePreset,
  Fps,
  HotkeyAction,
  ResolutionPreset,
  Settings
} from '@shared/settings.schema';
import { BITRATE_BPS } from '@shared/settings.schema';
import { SourcePicker, type SourceMode } from './SourcePicker';
import { getDesktopStream, getVideoSpec } from './getDesktopStream';
import { pickSupportedMimeType, useRecorder } from './useRecorder';
import { useAudioPipeline } from '../audio/useAudioPipeline';
import { AudioPanel } from '../audio/AudioPanel';
import { useWebcam } from '../webcam/useWebcam';
import { WebcamPanel } from '../webcam/WebcamPanel';
import { createCompositor, type CompositorHandle } from '../webcam/composite';
import { ExportDialog } from '../export/ExportDialog';
import type { DrawingState } from '@shared/drawing.types';
import { useLicense } from '../license/useLicense';

interface Props {
  settings: Settings;
  platform: NodeJS.Platform;
  onUpdateSettings: (patch: Partial<Settings>) => Promise<void>;
  pendingAction: { action: HotkeyAction; seq: number } | null;
  onPendingActionHandled: () => void;
}

const RESOLUTION_OPTIONS: ResolutionPreset[] = ['720p', '1080p', '1440p', 'native'];
const FPS_OPTIONS: Fps[] = [30, 60];
const BITRATE_OPTIONS: BitratePreset[] = ['small', 'balanced', 'high', 'max'];

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function bitrateLabel(preset: BitratePreset): string {
  const mbps = BITRATE_BPS[preset] / 1_000_000;
  return `${preset[0]!.toUpperCase()}${preset.slice(1)} · ${mbps} Mbps`;
}

export function RecordPanel({
  settings,
  platform,
  onUpdateSettings,
  pendingAction,
  onPendingActionHandled
}: Props): JSX.Element {
  const [mode, setMode] = useState<SourceMode>('screen');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedSource, setSelectedSource] = useState<CaptureSource | null>(null);
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const recorder = useRecorder();
  const recorderRef = useRef(recorder);
  recorderRef.current = recorder;

  const audio = useAudioPipeline(settings);
  const audioRef = useRef(audio);
  audioRef.current = audio;

  const webcam = useWebcam({
    enabled: settings.webcamEnabled,
    deviceId: settings.webcamDeviceId,
    backgroundMode: settings.webcamBackgroundMode,
    backgroundBlurPx: settings.webcamBackgroundBlurPx,
    backgroundImagePath: settings.webcamBackgroundImagePath
  });
  const webcamRef = useRef(webcam);
  webcamRef.current = webcam;

  const sourceVideoStreamRef = useRef<MediaStream | null>(null);
  const sourceAudioStreamRef = useRef<MediaStream | null>(null);
  const compositorRef = useRef<CompositorHandle | null>(null);

  const [drawing, setDrawing] = useState<DrawingState>({
    open: false,
    mode: 'draw',
    displayId: null
  });
  const drawingDisplayRef = useRef<number | null>(null);

  useEffect(() => {
    void window.api.drawing.state().then(setDrawing);
    const off = window.api.events.onDrawingStateChanged(setDrawing);
    return off;
  }, []);

  useEffect(() => {
    window.api.capture.listDisplays().then((list) => {
      setDisplays(list);
      const primary = list.find((d) => d.isPrimary) ?? list[0];
      if (primary) setSelectedDisplayId(primary.id);
    });
  }, []);

  useEffect(() => {
    setSelectedSource(null);
    setStartError(null);
  }, [mode]);

  const spec = useMemo(
    () => getVideoSpec(settings.resolutionPreset, settings.fps),
    [settings.resolutionPreset, settings.fps]
  );

  const videoBitsPerSecond = BITRATE_BPS[settings.bitratePreset];

  const wantsSystemAudio =
    settings.audioMode === 'system' || settings.audioMode === 'both';

  const license = useLicense();
  const licenseBlocks = !license.canUseGatedFeatures;
  const canStart =
    !licenseBlocks &&
    recorder.state.status === 'idle' &&
    ((mode === 'screen' && selectedSource !== null) ||
      (mode === 'window' && selectedSource !== null) ||
      mode === 'region');

  const cleanupCapture = useCallback(() => {
    if (compositorRef.current) {
      compositorRef.current.dispose();
      compositorRef.current = null;
    }
    if (sourceVideoStreamRef.current) {
      for (const t of sourceVideoStreamRef.current.getTracks()) t.stop();
      sourceVideoStreamRef.current = null;
    }
    if (sourceAudioStreamRef.current) {
      for (const t of sourceAudioStreamRef.current.getTracks()) t.stop();
      sourceAudioStreamRef.current = null;
    }
    audioRef.current.attachSystemStream(null);
  }, []);

  useEffect(() => {
    if (recorder.state.status === 'idle' || recorder.state.status === 'error') {
      cleanupCapture();
    }
  }, [recorder.state.status, cleanupCapture]);

  const handleStart = useCallback(async (): Promise<void> => {
    setStartError(null);
    try {
      const hasAudioWanted = audioRef.current.wantsAudio && !settings.audioMuted;
      const webcamStream = webcamRef.current.stream;

      let displayForCountdown: number | undefined;
      let region: import('@shared/recording.types').RegionRect | null = null;
      let sourceLabel = 'capture';
      let req: StartRecordingRequest;

      if (mode === 'screen' || mode === 'window') {
        const source = selectedSource;
        if (!source) return;
        sourceLabel = source.name;
        displayForCountdown =
          source.displayId ?? (displays.find((d) => d.isPrimary) ?? displays[0])?.id;
        req = {
          kind: mode,
          sourceId: source.id,
          displayId: source.displayId,
          mimeType: 'video/webm',
          ext: 'webm'
        };
      } else {
        // region — overlay spans virtual desktop and resolves display by overlap
        region = await window.api.capture.openRegionOverlay({});
        if (!region) {
          setStartError('Region selection cancelled.');
          return;
        }
        displayForCountdown = region.displayId;
        sourceLabel = `region-${region.width}x${region.height}`;
        req = {
          kind: 'region',
          displayId: region.displayId,
          region,
          mimeType: 'video/webm',
          ext: 'webm'
        };
      }

      if (settings.countdownSeconds > 0 && displayForCountdown !== undefined) {
        await window.api.capture.runCountdown({
          displayId: displayForCountdown,
          seconds: settings.countdownSeconds
        });
      }

      // Acquire the desktop source (full-screen / window / underlying-display-for-region).
      let captureSourceId: string;
      let displayInfo: DisplayInfo | undefined;
      if (mode === 'region') {
        const regionDisplayId = region!.displayId;
        const screenSource = (
          await window.api.capture.listSources({ kinds: ['screen'] })
        ).find((s) => s.displayId === regionDisplayId);
        if (!screenSource) {
          setStartError(`Could not find a screen source for display ${regionDisplayId}.`);
          return;
        }
        captureSourceId = screenSource.id;
        displayInfo = displays.find((d) => d.id === regionDisplayId);
        req.sourceId = captureSourceId;
      } else {
        captureSourceId = selectedSource!.id;
        displayInfo = displays.find((d) => d.id === selectedSource!.displayId);
      }

      const desktop = await getDesktopStream(captureSourceId, spec, {
        withSystemAudio: wantsSystemAudio
      });
      sourceVideoStreamRef.current = desktop.stream;
      if (desktop.hasAudio) {
        const sysAudio = new MediaStream(desktop.stream.getAudioTracks());
        sourceAudioStreamRef.current = sysAudio;
        audioRef.current.attachSystemStream(sysAudio);
      }

      // Output canvas dimensions:
      // - region: the region's logical size
      // - screen/window: the spec target (1080p/etc.) — match what user picked
      let outputWidth = spec.width;
      let outputHeight = spec.height;
      if (region) {
        outputWidth = region.width;
        outputHeight = region.height;
      }
      const scaleFactor = displayInfo?.scaleFactor ?? 1;
      drawingDisplayRef.current = displayInfo?.id ?? null;

      const compositor = createCompositor({
        baseStream: desktop.stream,
        region,
        scaleFactor,
        outputWidth,
        outputHeight,
        fps: settings.fps,
        webcamStream,
        webcamConfig: {
          position: settings.webcamPosition,
          customX: settings.webcamCustomX,
          customY: settings.webcamCustomY,
          size: settings.webcamSize,
          shape: settings.webcamShape,
          mirror: settings.webcamMirror,
          margin: settings.webcamMargin
        }
      });
      compositorRef.current = compositor;

      const videoTrack = compositor.stream.getVideoTracks()[0];
      if (!videoTrack) {
        setStartError('Compositor produced no video track.');
        cleanupCapture();
        return;
      }

      const audioTracks = audioRef.current.getMixedAudioTracks();
      const finalStream = new MediaStream([videoTrack, ...audioTracks]);
      const withAudio = finalStream.getAudioTracks().length > 0 && hasAudioWanted;
      req.mimeType = pickSupportedMimeType(withAudio);

      await recorderRef.current.start({
        stream: finalStream,
        request: req,
        sourceLabel,
        videoBitsPerSecond
      });
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
      cleanupCapture();
    }
  }, [
    cleanupCapture,
    displays,
    mode,
    selectedDisplayId,
    selectedSource,
    settings.audioMuted,
    settings.countdownSeconds,
    settings.fps,
    settings.webcamCustomX,
    settings.webcamCustomY,
    settings.webcamMargin,
    settings.webcamMirror,
    settings.webcamPosition,
    settings.webcamShape,
    settings.webcamSize,
    spec,
    videoBitsPerSecond,
    wantsSystemAudio
  ]);

  // Consume queued hotkey actions from App.tsx.
  useEffect(() => {
    if (!pendingAction) return;
    const r = recorderRef.current;
    const { action } = pendingAction;
    if (action === 'startStopRecording') {
      if (r.state.status === 'idle') {
        void handleStart();
      } else if (r.state.status === 'recording' || r.state.status === 'paused') {
        void r.stop();
      }
    } else if (action === 'pauseResumeRecording') {
      if (r.state.status === 'recording') r.pause();
      else if (r.state.status === 'paused') r.resume();
    }
    onPendingActionHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction]);

  // Track which display the active recording is on so toggleDrawing knows where to land.
  useEffect(() => {
    if (recorder.state.status === 'idle' || recorder.state.status === 'error') {
      // keep last known displayId for hotkey opens, but clear on cancel/reset.
    }
  }, [recorder.state.status]);

  // Auto-close drawing overlay when recording fully ends.
  useEffect(() => {
    if (recorder.state.status === 'idle' || recorder.state.status === 'error') {
      if (drawing.open) void window.api.drawing.hide();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder.state.status]);

  async function openDrawingOverlay(): Promise<void> {
    // Pick the display the current recording is on; fall back to selected source's display, then primary.
    const recordingDisplayId =
      drawingDisplayRef.current ??
      selectedSource?.displayId ??
      displays.find((d) => d.isPrimary)?.id ??
      displays[0]?.id;
    // Open in PASS mode so the toolbar appears but clicks still pass through
    // to whatever's being recorded. The user enters DRAW mode by clicking a
    // tool button on the toolbar (or pressing P/H/A/L/R/O/E).
    await window.api.drawing.show({ displayId: recordingDisplayId, mode: 'pass' });
  }

  async function closeDrawingOverlay(): Promise<void> {
    await window.api.drawing.hide();
  }

  const status = recorder.state.status;
  const recording = status === 'recording' || status === 'paused' || status === 'finalizing';

  // Tell the drawing overlay (if open) what to render during recording.
  // `recording` always reflects the actual recorder state so the overlay can
  // hide its bottom hint strip + crosshair (neither belongs in the captured
  // video). `hideToolbar` is the opt-in switch that also hides the interactive
  // tool palette for clean takes — defaults to false so users keep their tools
  // on camera while recording tutorials.
  useEffect(() => {
    if (!drawing.open) return;
    const hideToolbar = recording && settings.hideDrawingToolbarWhileRecording;
    void window.api.drawing.setRecording(recording, hideToolbar);
  }, [recording, drawing.open, settings.hideDrawingToolbarWhileRecording]);

  const audioDescription = useMemo(() => {
    if (settings.audioMode === 'none') return 'no audio';
    if (settings.audioMuted) return 'audio muted';
    return settings.audioMode === 'mic'
      ? 'mic'
      : settings.audioMode === 'system'
        ? 'system'
        : 'mic + system';
  }, [settings.audioMode, settings.audioMuted]);

  return (
    <section className="record">
      <div className="record__modes">
        {(['screen', 'window', 'region'] as SourceMode[]).map((m) => (
          <button
            key={m}
            className={`mode${m === mode ? ' mode--active' : ''}`}
            disabled={recording}
            onClick={() => setMode(m)}
          >
            {m === 'screen' ? 'Full screen' : m === 'window' ? 'Window' : 'Region'}
          </button>
        ))}
      </div>

      {!recording && (
        <SourcePicker
          mode={mode}
          displays={displays}
          selectedSourceId={selectedSource?.id ?? null}
          selectedDisplayId={selectedDisplayId}
          onSelectSource={setSelectedSource}
          onSelectDisplay={setSelectedDisplayId}
        />
      )}

      <AudioPanel
        settings={settings}
        pipeline={audio}
        platform={platform}
        onUpdate={onUpdateSettings}
        disabled={recording}
      />

      <WebcamPanel
        settings={settings}
        webcam={webcam}
        onUpdate={onUpdateSettings}
        disabled={recording}
      />

      {!recording && (
        <div className="presets">
          <div className="preset-group">
            <label>Resolution</label>
            <div className="seg">
              {RESOLUTION_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  className={`seg__btn${settings.resolutionPreset === opt ? ' seg__btn--on' : ''}`}
                  onClick={() => void onUpdateSettings({ resolutionPreset: opt })}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="preset-group">
            <label>Frame rate</label>
            <div className="seg">
              {FPS_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  className={`seg__btn${settings.fps === opt ? ' seg__btn--on' : ''}`}
                  onClick={() => void onUpdateSettings({ fps: opt })}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="preset-group">
            <label>Bitrate</label>
            <div className="seg">
              {BITRATE_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  className={`seg__btn${settings.bitratePreset === opt ? ' seg__btn--on' : ''}`}
                  onClick={() => void onUpdateSettings({ bitratePreset: opt })}
                  title={bitrateLabel(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
          <div className="preset-group">
            <label>Countdown</label>
            <div className="seg">
              {[0, 3, 5, 10].map((opt) => (
                <button
                  key={opt}
                  className={`seg__btn${settings.countdownSeconds === opt ? ' seg__btn--on' : ''}`}
                  onClick={() => void onUpdateSettings({ countdownSeconds: opt })}
                >
                  {opt === 0 ? 'off' : `${opt}s`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="record__bar">
        <div className="record__status">
          <span className={`dot dot--${status}`} />
          <span>{labelFor(status)}</span>
          {(status === 'recording' || status === 'paused') && (
            <span className="timer">{formatDuration(recorder.state.durationMs)}</span>
          )}
        </div>
        <div className="record__controls">
          {status === 'idle' && (
            <button className="primary" onClick={handleStart} disabled={!canStart}>
              Start recording
            </button>
          )}
          {status === 'starting' && <button disabled>Starting…</button>}
          {status === 'recording' && (
            <>
              <button onClick={recorder.pause}>Pause</button>
              <button className="primary" onClick={() => void recorder.stop()}>
                Stop
              </button>
              <button
                onClick={() => void (drawing.open ? closeDrawingOverlay() : openDrawingOverlay())}
                title="Toggle drawing tools (Ctrl+Shift+D)"
              >
                {drawing.open ? '✏️ Hide drawing' : '✏️ Draw'}
              </button>
              <button className="ghost" onClick={() => void recorder.cancel()}>
                Cancel
              </button>
            </>
          )}
          {status === 'paused' && (
            <>
              <button onClick={recorder.resume}>Resume</button>
              <button className="primary" onClick={() => void recorder.stop()}>
                Stop
              </button>
              <button
                onClick={() => void (drawing.open ? closeDrawingOverlay() : openDrawingOverlay())}
              >
                {drawing.open ? '✏️ Hide drawing' : '✏️ Draw'}
              </button>
              <button className="ghost" onClick={() => void recorder.cancel()}>
                Cancel
              </button>
            </>
          )}
          {status === 'finalizing' && <button disabled>Finalizing…</button>}
          {status === 'error' && (
            <button className="primary" onClick={() => void recorder.cancel()}>
              Reset
            </button>
          )}
        </div>
      </div>

      {licenseBlocks && (
        <p className="error">
          {license.status?.status === 'expired'
            ? 'Your license is expired. Renew it from Settings → License to start recording.'
            : license.status?.status === 'tampered'
              ? 'License needs re-activation. Open Settings → License.'
              : 'Activate a license from Settings → License to start recording.'}
        </p>
      )}

      {(startError || recorder.state.error) && (
        <p className="error">{startError ?? recorder.state.error}</p>
      )}
      {recorder.state.warning && !recorder.state.error && (
        <p className="warning">⚠ {recorder.state.warning}</p>
      )}

      <p className="muted small">
        {spec.width}×{spec.height} · {settings.fps} fps ·{' '}
        {(videoBitsPerSecond / 1_000_000).toFixed(1)} Mbps · {audioDescription}
        {settings.webcamEnabled && webcam.stream ? ' · webcam PiP' : ''}
        {drawing.open ? ` · drawing (${drawing.mode})` : ''}
        {settings.countdownSeconds > 0 && ` · ${settings.countdownSeconds}s countdown`}
        {' · '}Hotkey: <kbd>{settings.hotkeys.startStopRecording}</kbd>
      </p>

      {recorder.state.lastResult && <LastResult result={recorder.state.lastResult} />}
    </section>
  );
}

function LastResult({ result }: { result: FinalizeRecordingResponse }): JSX.Element {
  const [exporting, setExporting] = useState(false);
  return (
    <div className="card result">
      <h3>Last recording</h3>
      <dl className="kv">
        <dt>File</dt>
        <dd className="path">{result.filename}</dd>
        <dt>Saved to</dt>
        <dd className="path">{result.finalPath}</dd>
        <dt>Size</dt>
        <dd>{formatBytes(result.sizeBytes)}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(result.durationMs)}</dd>
      </dl>
      <div className="row">
        <button className="primary" onClick={() => setExporting(true)}>
          Export…
        </button>
        <button onClick={() => window.api.recording.reveal(result.finalPath)}>Reveal</button>
        <button onClick={() => window.api.app.openPath(result.finalPath)}>Open file</button>
      </div>
      {exporting && (
        <ExportDialog
          inputPath={result.finalPath}
          inputFilename={result.filename}
          inputDurationMs={result.durationMs}
          sourceLabel={result.filename.replace(/\.[^.]+$/, '')}
          onClose={() => setExporting(false)}
        />
      )}
    </div>
  );
}

function labelFor(status: string): string {
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'starting':
      return 'Starting…';
    case 'recording':
      return 'Recording';
    case 'paused':
      return 'Paused';
    case 'finalizing':
      return 'Saving…';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}
