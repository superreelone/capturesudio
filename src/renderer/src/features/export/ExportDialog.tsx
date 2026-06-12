import { useEffect, useMemo, useState } from 'react';
import type {
  ExportCodec,
  ExportContainer,
  ExportOptions,
  ExportQuality
} from '@shared/export.types';
import { CODEC_CONTAINER_MATRIX, isValidCodecContainer } from '@shared/export.types';
import { TrimSlider } from './TrimSlider';
import { useExportJob } from './useExportJob';
import { useLicense } from '../license/useLicense';

interface Props {
  inputPath: string;
  inputFilename: string;
  inputDurationMs: number;
  sourceLabel: string;
  onClose: () => void;
}

const CONTAINERS: ExportContainer[] = ['mp4', 'mkv', 'mov', 'webm', 'gif'];
const CODECS: ExportCodec[] = ['h264', 'h265', 'vp9'];
const QUALITIES: ExportQuality[] = ['high', 'balanced', 'small'];
const HEIGHT_OPTIONS: Array<number | null> = [null, 1440, 1080, 720, 480];

function defaultCodecFor(container: ExportContainer): ExportCodec | null {
  const allowed = CODEC_CONTAINER_MATRIX[container];
  if (allowed === 'gif') return null;
  if (allowed.includes('h264')) return 'h264';
  return allowed[0] ?? null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function ExportDialog({
  inputPath,
  inputFilename,
  inputDurationMs,
  sourceLabel,
  onClose
}: Props): JSX.Element {
  const [container, setContainer] = useState<ExportContainer>('mp4');
  const [codec, setCodec] = useState<ExportCodec | null>('h264');
  const [quality, setQuality] = useState<ExportQuality>('balanced');
  const [scaleHeight, setScaleHeight] = useState<number | null>(null);
  const [gifFps, setGifFps] = useState<number>(15);
  const [includeAudio, setIncludeAudio] = useState<boolean>(true);
  const [copyIfPossible, setCopyIfPossible] = useState<boolean>(true);
  const [trim, setTrim] = useState<{ startMs: number; endMs: number }>({
    startMs: 0,
    endMs: inputDurationMs
  });

  const job = useExportJob();
  const phase = job.state.phase;
  const license = useLicense();
  const licenseBlocks = !license.canUseGatedFeatures;

  // Reset codec when container changes if combo is invalid
  useEffect(() => {
    if (container === 'gif') {
      setCodec(null);
      return;
    }
    if (!codec || !isValidCodecContainer(codec, container)) {
      setCodec(defaultCodecFor(container));
    }
  }, [container, codec]);

  const trimmed = useMemo(
    () => trim.startMs > 0 || trim.endMs < inputDurationMs,
    [trim, inputDurationMs]
  );

  const fastPathEligible =
    copyIfPossible &&
    container === 'webm' &&
    codec === 'vp9' &&
    !trimmed &&
    scaleHeight === null &&
    inputPath.toLowerCase().endsWith('.webm');

  async function handleStart(): Promise<void> {
    if (licenseBlocks) return;
    const opts: ExportOptions = {
      container,
      codec: container === 'gif' ? null : codec,
      quality,
      scale: { height: scaleHeight },
      ...(container === 'gif' ? { gifFps } : {}),
      ...(trimmed ? { trim } : {}),
      copyIfPossible,
      includeAudio: container === 'gif' ? false : includeAudio
    };
    await job.start({
      inputPath,
      inputDurationMs,
      sourceLabel,
      options: opts
    });
  }

  const inProgress = phase === 'starting' || phase === 'running';
  const finished = phase === 'done';
  const errored = phase === 'error' || phase === 'cancelled';

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={inProgress ? undefined : onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__head">
          <h2>Export</h2>
          <button className="ghost" onClick={onClose} disabled={inProgress}>
            ✕
          </button>
        </header>

        <div className="modal__body">
          <p className="muted small">
            From <code>{inputFilename}</code> · {fmtTime(inputDurationMs)}
          </p>

          <div className="preset-group">
            <label>Container</label>
            <div className="seg">
              {CONTAINERS.map((c) => (
                <button
                  key={c}
                  className={`seg__btn${container === c ? ' seg__btn--on' : ''}`}
                  onClick={() => setContainer(c)}
                  disabled={inProgress}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {container !== 'gif' && (
            <div className="preset-group">
              <label>Video codec</label>
              <div className="seg">
                {CODECS.map((c) => {
                  const valid = isValidCodecContainer(c, container);
                  return (
                    <button
                      key={c}
                      className={`seg__btn${codec === c ? ' seg__btn--on' : ''}`}
                      onClick={() => setCodec(c)}
                      disabled={!valid || inProgress}
                      title={valid ? '' : `${c} is not supported in ${container}`}
                    >
                      {c.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="preset-group">
            <label>Quality</label>
            <div className="seg">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  className={`seg__btn${quality === q ? ' seg__btn--on' : ''}`}
                  onClick={() => setQuality(q)}
                  disabled={inProgress}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          <div className="preset-group">
            <label>Resolution</label>
            <div className="seg">
              {HEIGHT_OPTIONS.map((h) => (
                <button
                  key={String(h)}
                  className={`seg__btn${scaleHeight === h ? ' seg__btn--on' : ''}`}
                  onClick={() => setScaleHeight(h)}
                  disabled={inProgress}
                >
                  {h === null ? 'original' : `${h}p`}
                </button>
              ))}
            </div>
          </div>

          {container === 'gif' && (
            <div className="preset-group">
              <label>GIF frame rate</label>
              <div className="seg">
                {[10, 15, 24, 30].map((f) => (
                  <button
                    key={f}
                    className={`seg__btn${gifFps === f ? ' seg__btn--on' : ''}`}
                    onClick={() => setGifFps(f)}
                    disabled={inProgress}
                  >
                    {f} fps
                  </button>
                ))}
              </div>
            </div>
          )}

          {container !== 'gif' && (
            <div className="settings__row">
              <div className="audio-mute">
                <label>
                  <input
                    type="checkbox"
                    checked={includeAudio}
                    onChange={(e) => setIncludeAudio(e.target.checked)}
                    disabled={inProgress}
                  />
                  <span>Include audio track</span>
                </label>
              </div>
              <div className="audio-mute">
                <label>
                  <input
                    type="checkbox"
                    checked={copyIfPossible}
                    onChange={(e) => setCopyIfPossible(e.target.checked)}
                    disabled={inProgress}
                  />
                  <span>Skip re-encode when possible (fast path)</span>
                </label>
              </div>
            </div>
          )}

          <div className="preset-group">
            <label>Trim</label>
            <TrimSlider
              durationMs={inputDurationMs}
              startMs={trim.startMs}
              endMs={trim.endMs}
              onChange={inProgress ? () => undefined : setTrim}
            />
          </div>

          {fastPathEligible && (
            <p className="muted small">
              ⚡ Fast path active: streams will be copied without re-encode.
            </p>
          )}

          {(inProgress || finished || errored) && (
            <div className="export-progress">
              <div className="export-progress__bar">
                <div
                  className="export-progress__fill"
                  style={{
                    width: `${Math.round((job.state.progress?.percent ?? (finished ? 1 : 0)) * 100)}%`
                  }}
                />
              </div>
              <div className="export-progress__meta">
                {phase === 'starting' && <span>Starting…</span>}
                {phase === 'running' && job.state.progress && (
                  <>
                    <span>{Math.round((job.state.progress.percent ?? 0) * 100)}%</span>
                    {job.state.progress.speed > 0 && (
                      <span className="muted">
                        {job.state.progress.speed.toFixed(2)}x · {job.state.progress.fps.toFixed(0)} fps
                      </span>
                    )}
                    {job.state.progress.currentMs > 0 && (
                      <span className="muted">
                        {fmtTime(job.state.progress.currentMs)} / {fmtTime(inputDurationMs)}
                      </span>
                    )}
                  </>
                )}
                {phase === 'done' && job.state.result && (
                  <span className="muted">
                    Done · {formatBytes(job.state.result.sizeBytes)} ·{' '}
                    {fmtTime(job.state.result.durationMs)} elapsed
                  </span>
                )}
                {phase === 'cancelled' && <span>Cancelled.</span>}
                {phase === 'error' && job.state.error && (
                  <span className="error">Error: {job.state.error.message}</span>
                )}
              </div>
              {phase === 'error' && job.state.error?.stderrTail && (
                <details className="export-progress__stderr">
                  <summary>Show ffmpeg log tail</summary>
                  <pre>{job.state.error.stderrTail}</pre>
                </details>
              )}
            </div>
          )}
        </div>

        <footer className="modal__foot">
          {phase === 'idle' && (
            <>
              <button className="ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => void handleStart()}
                disabled={licenseBlocks}
                title={licenseBlocks ? 'Activate a license to export new files' : ''}
              >
                {licenseBlocks ? 'License required' : 'Export'}
              </button>
            </>
          )}
          {(phase === 'starting' || phase === 'running') && (
            <button className="primary" onClick={() => void job.cancel()}>
              Cancel export
            </button>
          )}
          {phase === 'done' && job.state.result && (
            <>
              <button className="ghost" onClick={onClose}>
                Close
              </button>
              <button
                onClick={() =>
                  job.state.result &&
                  window.api.recording.reveal(job.state.result.outputPath)
                }
              >
                Reveal
              </button>
              <button
                className="primary"
                onClick={() =>
                  job.state.result && window.api.app.openPath(job.state.result.outputPath)
                }
              >
                Open file
              </button>
            </>
          )}
          {(phase === 'error' || phase === 'cancelled') && (
            <>
              <button className="ghost" onClick={onClose}>
                Close
              </button>
              <button className="primary" onClick={() => job.reset()}>
                Try again
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
