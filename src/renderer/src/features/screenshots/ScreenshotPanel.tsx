import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CaptureSource,
  DisplayInfo
} from '@shared/recording.types';
import type {
  CaptureScreenshotRequest,
  ScreenshotFormat
} from '@shared/screenshot.types';
import type { HotkeyAction, Settings } from '@shared/settings.schema';
import { SourcePicker, type SourceMode } from '../capture/SourcePicker';
import { Annotator } from './Annotator';
import { useScreenshotPipeline } from './useScreenshotPipeline';
import { useLicense } from '../license/useLicense';

interface Props {
  settings: Settings;
  onUpdateSettings: (patch: Partial<Settings>) => Promise<void>;
  pendingAction: { action: HotkeyAction; seq: number } | null;
  onPendingActionHandled: () => void;
}

const FORMATS: ScreenshotFormat[] = ['png', 'jpg', 'webp', 'bmp', 'tiff'];
const HAS_QUALITY: Record<ScreenshotFormat, boolean> = {
  png: false,
  jpg: true,
  webp: true,
  bmp: false,
  tiff: false
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ScreenshotPanel({
  settings,
  onUpdateSettings,
  pendingAction,
  onPendingActionHandled
}: Props): JSX.Element {
  const [mode, setMode] = useState<SourceMode>('screen');
  const [displays, setDisplays] = useState<DisplayInfo[]>([]);
  const [selectedSource, setSelectedSource] = useState<CaptureSource | null>(null);
  const [selectedDisplayId, setSelectedDisplayId] = useState<number | null>(null);
  const [format, setFormat] = useState<ScreenshotFormat>(settings.defaultScreenshotFormat);
  const [quality, setQuality] = useState<number>(0.92);
  const [delayMs, setDelayMs] = useState<number>(0);
  const [openAnnotator, setOpenAnnotator] = useState<boolean>(true);
  const [copyToClipboard, setCopyToClipboard] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const pipeline = useScreenshotPipeline();
  const pipelineRef = useRef(pipeline);
  pipelineRef.current = pipeline;

  useEffect(() => {
    window.api.capture.listDisplays().then((list) => {
      setDisplays(list);
      const primary = list.find((d) => d.isPrimary) ?? list[0];
      if (primary) setSelectedDisplayId(primary.id);
    });
  }, []);

  useEffect(() => {
    setSelectedSource(null);
  }, [mode]);

  const handleQuickCapture = useCallback(
    async (override?: { mode?: SourceMode; displayId?: number }) => {
      setError(null);
      try {
        const captureMode: SourceMode = override?.mode ?? mode;
        let req: CaptureScreenshotRequest;

        if (captureMode === 'screen') {
          const source = selectedSource;
          const displayId =
            override?.displayId ??
            source?.displayId ??
            (displays.find((d) => d.isPrimary) ?? displays[0])?.id;
          if (displayId === undefined) {
            setError('No display available.');
            return;
          }
          req = { source: 'fullscreen', displayId, delayMs };
        } else if (captureMode === 'window') {
          if (!selectedSource) {
            setError('Pick a window first.');
            return;
          }
          req = { source: 'window', sourceId: selectedSource.id, delayMs };
        } else {
          // Region overlay spans the virtual desktop; user picks anywhere.
          const region = await window.api.capture.openRegionOverlay({});
          if (!region) {
            // No error — user cancelled. Silent.
            return;
          }
          req = { source: 'region', region, delayMs };
        }

        await pipelineRef.current.capture(req);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [delayMs, displays, mode, selectedDisplayId, selectedSource]
  );

  // Consume queued hotkey actions from App.tsx — works from any tab.
  useEffect(() => {
    if (!pendingAction) return;
    void (async () => {
      const action = pendingAction.action;
      if (action === 'screenshotFullscreen') {
        const primary = displays.find((d) => d.isPrimary) ?? displays[0];
        if (!primary) return;
        await pipelineRef.current.capture({
          source: 'fullscreen',
          displayId: primary.id,
          delayMs: 0
        });
      } else if (action === 'screenshotRegion') {
        const region = await window.api.capture.openRegionOverlay({});
        if (!region) return;
        await pipelineRef.current.capture({ source: 'region', region, delayMs: 0 });
      } else if (action === 'screenshotWindow') {
        const sources = await window.api.capture.listSources({
          kinds: ['window'],
          thumbnailSize: { width: 1, height: 1 }
        });
        const target = sources[0];
        if (!target) return;
        await pipelineRef.current.capture({
          source: 'window',
          sourceId: target.id,
          delayMs: 0
        });
      }
      onPendingActionHandled();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction]);

  const captured = pipeline.state.captured;
  const annotatorOpen = captured !== null && openAnnotator;

  const handleAnnotatorSave = useCallback(
    async (canvas: HTMLCanvasElement) => {
      if (!captured) return;
      const sourceLabel = captured.sourceLabel;
      await pipelineRef.current.saveFromCanvas(
        canvas,
        format,
        quality,
        sourceLabel,
        copyToClipboard
      );
    },
    [captured, format, quality, copyToClipboard]
  );

  const handleSkipAnnotator = useCallback(async () => {
    if (!captured) return;
    // Synthesize a canvas from the captured PNG and reuse encodeCanvas pipeline.
    const img = await loadImageFromBase64(captured.pngBase64);
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    await pipelineRef.current.saveFromCanvas(
      canvas,
      format,
      quality,
      captured.sourceLabel,
      copyToClipboard
    );
  }, [captured, format, quality, copyToClipboard]);

  // Auto-save every capture immediately — regardless of whether the editor
  // will open. If the editor is also enabled, its Save creates a SECOND
  // (edited) file via the same template + counter.
  const autoSavedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!captured) return;
    if (autoSavedRef.current === captured.pngBase64.slice(0, 32)) return;
    autoSavedRef.current = captured.pngBase64.slice(0, 32);
    void handleSkipAnnotator();
  }, [captured, handleSkipAnnotator]);

  const lastResult = pipeline.state.saved;
  const saving = pipeline.state.status === 'saving';

  const license = useLicense();
  const licenseBlocks = !license.canUseGatedFeatures;

  const canCapture =
    !licenseBlocks &&
    pipeline.state.status !== 'capturing' &&
    pipeline.state.status !== 'saving' &&
    (mode === 'screen' ||
      (mode === 'window' && selectedSource !== null) ||
      mode === 'region');

  return (
    <section className="record">
      <div className="record__modes">
        {(['screen', 'window', 'region'] as SourceMode[]).map((m) => (
          <button
            key={m}
            className={`mode${m === mode ? ' mode--active' : ''}`}
            onClick={() => setMode(m)}
          >
            {m === 'screen' ? 'Full screen' : m === 'window' ? 'Window' : 'Region'}
          </button>
        ))}
      </div>

      <SourcePicker
        mode={mode}
        displays={displays}
        selectedSourceId={selectedSource?.id ?? null}
        selectedDisplayId={selectedDisplayId}
        onSelectSource={setSelectedSource}
        onSelectDisplay={setSelectedDisplayId}
      />

      <div className="presets">
        <div className="preset-group">
          <label>Format</label>
          <div className="seg">
            {FORMATS.map((f) => (
              <button
                key={f}
                className={`seg__btn${format === f ? ' seg__btn--on' : ''}`}
                onClick={() => {
                  setFormat(f);
                  void onUpdateSettings({ defaultScreenshotFormat: f });
                }}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
        {HAS_QUALITY[format] && (
          <div className="preset-group">
            <label>Quality</label>
            <div className="gain">
              <input
                type="range"
                min={0.4}
                max={1}
                step={0.02}
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
              <span className="gain__value">{Math.round(quality * 100)}%</span>
            </div>
          </div>
        )}
        <div className="preset-group">
          <label>Delay</label>
          <div className="seg">
            {[0, 3, 5, 10].map((d) => (
              <button
                key={d}
                className={`seg__btn${delayMs === d * 1000 ? ' seg__btn--on' : ''}`}
                onClick={() => setDelayMs(d * 1000)}
              >
                {d === 0 ? 'now' : `${d}s`}
              </button>
            ))}
          </div>
        </div>
        <div className="preset-group toggle">
          <label>
            <input
              type="checkbox"
              checked={openAnnotator}
              onChange={(e) => setOpenAnnotator(e.target.checked)}
            />
            <span>Open editor after capture</span>
          </label>
        </div>
        <div className="preset-group toggle">
          <label>
            <input
              type="checkbox"
              checked={copyToClipboard}
              onChange={(e) => setCopyToClipboard(e.target.checked)}
            />
            <span>Also copy to clipboard</span>
          </label>
        </div>
      </div>

      <div className="record__bar">
        <div className="record__status">
          <span className={`dot dot--${pipeline.state.status}`} />
          <span>{statusLabel(pipeline.state.status)}</span>
        </div>
        <div className="record__controls">
          <button
            className="primary"
            onClick={() => void handleQuickCapture()}
            disabled={!canCapture}
            title={mode === 'region' ? 'Click then drag a region on any display' : ''}
          >
            {delayMs > 0
              ? `Capture in ${delayMs / 1000}s`
              : mode === 'region'
                ? 'Drag region…'
                : 'Capture'}
          </button>
        </div>
      </div>

      {licenseBlocks && (
        <p className="error">
          {license.status?.status === 'expired'
            ? 'License expired. Renew it from Settings → License to capture new screenshots. Existing files remain in the Library.'
            : license.status?.status === 'tampered'
              ? 'License needs re-activation. Open Settings → License.'
              : 'Activate a license from Settings → License to capture screenshots.'}
        </p>
      )}

      {(error || pipeline.state.error) && (
        <p className="error">{error ?? pipeline.state.error}</p>
      )}

      <p className="muted small">
        Region: <kbd>{settings.hotkeys.screenshotRegion}</kbd> · Fullscreen:{' '}
        <kbd>{settings.hotkeys.screenshotFullscreen}</kbd>
      </p>

      {lastResult && (
        <div className="card result">
          <h3>Last screenshot</h3>
          <dl className="kv">
            <dt>File</dt>
            <dd className="path">{lastResult.filename}</dd>
            <dt>Saved to</dt>
            <dd className="path">{lastResult.path}</dd>
            <dt>Size</dt>
            <dd>{formatBytes(lastResult.sizeBytes)}</dd>
          </dl>
          <div className="row">
            <button onClick={() => window.api.recording.reveal(lastResult.path)}>Reveal</button>
            <button onClick={() => window.api.app.openPath(lastResult.path)}>Open</button>
            <button onClick={() => void pipeline.copyOriginalToClipboard()}>
              Copy original to clipboard
            </button>
          </div>
        </div>
      )}

      {annotatorOpen && captured && (
        <Annotator
          captured={captured}
          onCancel={() => pipeline.reset()}
          onSave={handleAnnotatorSave}
          saving={saving}
        />
      )}
    </section>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'idle':
      return 'Ready';
    case 'capturing':
      return 'Capturing…';
    case 'ready':
      return 'Captured';
    case 'saving':
      return 'Saving…';
    case 'done':
      return 'Saved';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

function loadImageFromBase64(pngBase64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = `data:image/png;base64,${pngBase64}`;
  });
}

export { loadImageFromBase64 };
