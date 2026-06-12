import { useRef } from 'react';
import type {
  Settings,
  WebcamBackgroundMode,
  WebcamPosition,
  WebcamShape,
  WebcamSize
} from '@shared/settings.schema';
import type { WebcamState } from './useWebcam';
import { WebcamPreview } from './WebcamPreview';

interface Props {
  settings: Settings;
  webcam: WebcamState;
  onUpdate: (patch: Partial<Settings>) => Promise<void>;
  disabled?: boolean;
}

const POSITIONS: WebcamPosition[] = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight', 'custom'];
const SIZES: WebcamSize[] = ['small', 'medium', 'large'];
const SHAPES: WebcamShape[] = ['rect', 'circle'];
const BG_MODES: WebcamBackgroundMode[] = ['none', 'blur', 'image'];

const POSITION_LABELS: Record<WebcamPosition, string> = {
  topLeft: 'Top-left',
  topRight: 'Top-right',
  bottomLeft: 'Bottom-left',
  bottomRight: 'Bottom-right',
  custom: 'Custom'
};

const BG_MODE_LABELS: Record<WebcamBackgroundMode, string> = {
  none: 'Off',
  blur: 'Blur',
  image: 'Image'
};

/** Hard ceiling so settings.json doesn't balloon. ~4 MB raw → ~5.4 MB base64. */
const MAX_BG_IMAGE_BYTES = 4 * 1024 * 1024;

export function WebcamPanel({ settings, webcam, onUpdate, disabled }: Props): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function onPickBgImage(): void {
    fileInputRef.current?.click();
  }

  async function onBgImageChange(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking same file
    if (!file) return;
    if (file.size > MAX_BG_IMAGE_BYTES) {
      alert(
        `Image is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). ` +
          `Please choose a file under ${MAX_BG_IMAGE_BYTES / 1024 / 1024} MB.`
      );
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });
    await onUpdate({ webcamBackgroundImagePath: dataUrl });
  }

  return (
    <div className="audio-panel">
      <div className="audio-row">
        <div className="audio-row__head">
          <span className="audio-row__name">📷 Webcam (picture-in-picture)</span>
          <div className="toggle">
            <label>
              <input
                type="checkbox"
                checked={settings.webcamEnabled}
                onChange={(e) => void onUpdate({ webcamEnabled: e.target.checked })}
                disabled={disabled}
              />
              <span>Enabled</span>
            </label>
          </div>
        </div>

        {settings.webcamEnabled && (
          <>
            <div className="audio-row__controls webcam-controls">
              <select
                className="text select"
                value={settings.webcamDeviceId}
                onChange={(e) => void onUpdate({ webcamDeviceId: e.target.value })}
                disabled={disabled}
              >
                <option value="">System default</option>
                {webcam.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Camera ${d.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
              <WebcamPreview
                stream={webcam.stream}
                mirror={settings.webcamMirror}
                shape={settings.webcamShape}
                size={160}
              />
            </div>

            {webcam.error && (
              <p className="error small">
                {webcam.permissionDenied
                  ? 'Camera permission denied — enable it in OS Privacy settings, then toggle Webcam off and back on.'
                  : `Camera error: ${webcam.error}`}
              </p>
            )}

            <div className="presets webcam-presets">
              <div className="preset-group">
                <label>Position</label>
                <div className="seg">
                  {POSITIONS.map((p) => (
                    <button
                      key={p}
                      className={`seg__btn${settings.webcamPosition === p ? ' seg__btn--on' : ''}`}
                      onClick={() => void onUpdate({ webcamPosition: p })}
                      disabled={disabled}
                    >
                      {POSITION_LABELS[p]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="preset-group">
                <label>Size</label>
                <div className="seg">
                  {SIZES.map((s) => (
                    <button
                      key={s}
                      className={`seg__btn${settings.webcamSize === s ? ' seg__btn--on' : ''}`}
                      onClick={() => void onUpdate({ webcamSize: s })}
                      disabled={disabled}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="preset-group">
                <label>Shape</label>
                <div className="seg">
                  {SHAPES.map((s) => (
                    <button
                      key={s}
                      className={`seg__btn${settings.webcamShape === s ? ' seg__btn--on' : ''}`}
                      onClick={() => void onUpdate({ webcamShape: s })}
                      disabled={disabled}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="preset-group toggle">
                <label>
                  <input
                    type="checkbox"
                    checked={settings.webcamMirror}
                    onChange={(e) => void onUpdate({ webcamMirror: e.target.checked })}
                    disabled={disabled}
                  />
                  <span>Mirror (selfie view)</span>
                </label>
              </div>
            </div>

            <div className="presets webcam-presets">
              <div className="preset-group">
                <label>Background</label>
                <div className="seg">
                  {BG_MODES.map((m) => (
                    <button
                      key={m}
                      className={`seg__btn${settings.webcamBackgroundMode === m ? ' seg__btn--on' : ''}`}
                      onClick={() => void onUpdate({ webcamBackgroundMode: m })}
                      disabled={disabled}
                    >
                      {BG_MODE_LABELS[m]}
                    </button>
                  ))}
                </div>
                {webcam.backgroundLoading && (
                  <p className="muted small">Loading segmentation model…</p>
                )}
              </div>

              {settings.webcamBackgroundMode === 'blur' && (
                <div className="preset-group">
                  <label>Blur strength ({settings.webcamBackgroundBlurPx}px)</label>
                  <div className="gain">
                    <input
                      type="range"
                      min={2}
                      max={40}
                      step={1}
                      value={settings.webcamBackgroundBlurPx}
                      onChange={(e) =>
                        void onUpdate({ webcamBackgroundBlurPx: Number(e.target.value) })
                      }
                      disabled={disabled}
                    />
                  </div>
                </div>
              )}

              {settings.webcamBackgroundMode === 'image' && (
                <div className="preset-group">
                  <label>Background image</label>
                  <div className="folder__row">
                    <button onClick={onPickBgImage} disabled={disabled}>
                      Choose image…
                    </button>
                    {settings.webcamBackgroundImagePath && (
                      <button
                        className="ghost"
                        onClick={() => void onUpdate({ webcamBackgroundImagePath: '' })}
                        disabled={disabled}
                      >
                        Clear
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => void onBgImageChange(e)}
                    />
                  </div>
                  {!settings.webcamBackgroundImagePath && (
                    <p className="muted small">
                      No image chosen — falls back to a flat color until you pick one.
                    </p>
                  )}
                </div>
              )}
            </div>

            {settings.webcamPosition === 'custom' && (
              <div className="presets">
                <div className="preset-group">
                  <label>Custom X ({Math.round(settings.webcamCustomX * 100)}%)</label>
                  <div className="gain">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={settings.webcamCustomX}
                      onChange={(e) =>
                        void onUpdate({ webcamCustomX: Number(e.target.value) })
                      }
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className="preset-group">
                  <label>Custom Y ({Math.round(settings.webcamCustomY * 100)}%)</label>
                  <div className="gain">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={settings.webcamCustomY}
                      onChange={(e) =>
                        void onUpdate({ webcamCustomY: Number(e.target.value) })
                      }
                      disabled={disabled}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
