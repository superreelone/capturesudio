import { useMemo } from 'react';
import type { AudioMode, Settings } from '@shared/settings.schema';
import type { UseAudioPipelineApi } from './useAudioPipeline';
import { isVirtualLoopbackName } from './useAudioPipeline';
import { LevelMeter } from './LevelMeter';

interface Props {
  settings: Settings;
  pipeline: UseAudioPipelineApi;
  platform: NodeJS.Platform;
  onUpdate: (patch: Partial<Settings>) => Promise<void>;
  disabled?: boolean;
}

const MODE_LABELS: Record<AudioMode, string> = {
  none: 'No audio',
  mic: 'Mic only',
  system: 'System only',
  both: 'Mic + system'
};

export function AudioPanel({
  settings,
  pipeline,
  platform,
  onUpdate,
  disabled
}: Props): JSX.Element {
  const wantsMic = settings.audioMode === 'mic' || settings.audioMode === 'both';
  const wantsSys = settings.audioMode === 'system' || settings.audioMode === 'both';

  const sysSupport = useMemo(() => evaluateSystemAudioSupport(platform, pipeline.micDevices), [
    platform,
    pipeline.micDevices
  ]);

  return (
    <div className="audio-panel">
      <div className="preset-group">
        <label>Audio</label>
        <div className="seg">
          {(['none', 'mic', 'system', 'both'] as AudioMode[]).map((m) => (
            <button
              key={m}
              className={`seg__btn${settings.audioMode === m ? ' seg__btn--on' : ''}`}
              onClick={() => void onUpdate({ audioMode: m })}
              disabled={disabled}
              title={MODE_LABELS[m]}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {wantsMic && (
        <div className="audio-row">
          <div className="audio-row__head">
            <span className="audio-row__name">🎙️ Microphone</span>
            <LevelMeter
              analyser={pipeline.pipeline?.micAnalyser ?? null}
              active={!!pipeline.micStream && !settings.audioMuted}
            />
          </div>
          <div className="audio-row__controls">
            <select
              className="text select"
              value={settings.micDeviceId}
              onChange={(e) => void onUpdate({ micDeviceId: e.target.value })}
              disabled={disabled}
            >
              <option value="">System default</option>
              {pipeline.micDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Input ${d.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
            <GainSlider
              value={settings.micGain}
              onChange={(v) => void onUpdate({ micGain: v })}
              disabled={disabled}
            />
          </div>
          {pipeline.micError && (
            <p className="error small">
              {pipeline.permissionDenied
                ? 'Microphone permission denied — enable it in OS Privacy settings, then click Retry.'
                : `Mic error: ${pipeline.micError}`}{' '}
              <button className="ghost small-btn" onClick={() => void pipeline.refreshDevices()}>
                Retry
              </button>
            </p>
          )}
          <div className="audio-row__dsp">
            <label className="audio-row__dsp-item">
              <input
                type="checkbox"
                checked={settings.micVoiceBoost}
                onChange={(e) => void onUpdate({ micVoiceBoost: e.target.checked })}
                disabled={disabled}
              />
              <span>Voice boost (compressor + makeup gain)</span>
            </label>
            <label className="audio-row__dsp-item">
              <input
                type="checkbox"
                checked={settings.micNoiseSuppression}
                onChange={(e) => void onUpdate({ micNoiseSuppression: e.target.checked })}
                disabled={disabled}
              />
              <span>Noise suppression</span>
            </label>
            <label className="audio-row__dsp-item">
              <input
                type="checkbox"
                checked={settings.micEchoCancellation}
                onChange={(e) => void onUpdate({ micEchoCancellation: e.target.checked })}
                disabled={disabled}
              />
              <span>Echo cancellation</span>
            </label>
            <label className="audio-row__dsp-item">
              <input
                type="checkbox"
                checked={settings.micAutoGainControl}
                onChange={(e) => void onUpdate({ micAutoGainControl: e.target.checked })}
                disabled={disabled}
              />
              <span>Auto gain</span>
            </label>
          </div>
          <p className="muted small">
            Voice boost is what makes recordings sound as loud as Zoom / Voice Recorder.
            Keep it on for screen recordings. Toggling the others re-acquires the mic; brief
            level-meter blip is normal.
          </p>
        </div>
      )}

      {wantsSys && (
        <div className="audio-row">
          <div className="audio-row__head">
            <span className="audio-row__name">🔊 System audio</span>
            <LevelMeter
              analyser={pipeline.pipeline?.sysAnalyser ?? null}
              active={!settings.audioMuted}
            />
          </div>
          <div className="audio-row__controls">
            <div className="muted small audio-row__status">
              {sysSupport.kind === 'windows-loopback' && 'Windows desktop loopback (captured at recording start).'}
              {sysSupport.kind === 'mac-virtual' && (
                <>
                  Virtual device detected:{' '}
                  <code>{sysSupport.deviceLabel}</code> — select it as the mic to record it, or
                  route system audio through it.
                </>
              )}
              {sysSupport.kind === 'mac-missing' && (
                <>
                  macOS has no native loopback. Install{' '}
                  <a
                    href="https://existential.audio/blackhole/"
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => {
                      e.preventDefault();
                      void window.api.app.openPath('https://existential.audio/blackhole/');
                    }}
                  >
                    BlackHole
                  </a>{' '}
                  (or similar) and route system audio through it to capture.
                </>
              )}
              {sysSupport.kind === 'linux-loopback' &&
                'Attempting desktop loopback (works on most distros via PipeWire/PulseAudio).'}
              {sysSupport.kind === 'unsupported' &&
                'System audio capture is not supported on this platform.'}
            </div>
            <GainSlider
              value={settings.systemGain}
              onChange={(v) => void onUpdate({ systemGain: v })}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      {(wantsMic || wantsSys) && (
        <div className="audio-mute">
          <label>
            <input
              type="checkbox"
              checked={settings.audioMuted}
              onChange={(e) => void onUpdate({ audioMuted: e.target.checked })}
              disabled={disabled}
            />
            <span>Master mute (recording continues, no audio is written)</span>
          </label>
        </div>
      )}
    </div>
  );
}

function GainSlider({
  value,
  onChange,
  disabled
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="gain">
      <input
        type="range"
        min={0}
        max={4}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
      <span className="gain__value">{Math.round(value * 100)}%</span>
    </div>
  );
}

type SysSupport =
  | { kind: 'windows-loopback' }
  | { kind: 'mac-virtual'; deviceLabel: string }
  | { kind: 'mac-missing' }
  | { kind: 'linux-loopback' }
  | { kind: 'unsupported' };

export function evaluateSystemAudioSupport(
  platform: NodeJS.Platform,
  inputs: MediaDeviceInfo[]
): SysSupport {
  if (platform === 'win32') return { kind: 'windows-loopback' };
  if (platform === 'linux') return { kind: 'linux-loopback' };
  if (platform === 'darwin') {
    const virtual = inputs.find((d) => isVirtualLoopbackName(d.label));
    if (virtual) return { kind: 'mac-virtual', deviceLabel: virtual.label };
    return { kind: 'mac-missing' };
  }
  return { kind: 'unsupported' };
}
