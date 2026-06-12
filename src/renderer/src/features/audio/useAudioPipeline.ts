import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioMode, Settings } from '@shared/settings.schema';
import { AudioPipeline } from './audioPipeline';

export interface AudioPipelineState {
  pipeline: AudioPipeline | null;
  micStream: MediaStream | null;
  micError: string | null;
  micDevices: MediaDeviceInfo[];
  permissionDenied: boolean;
}

export interface UseAudioPipelineApi extends AudioPipelineState {
  /** Audio is wanted (mic or system) by the current mode. */
  wantsAudio: boolean;
  /** Refresh the device list (call after permission grant). */
  refreshDevices: () => Promise<void>;
  /** Attach a captured system-audio stream to the pipeline (Windows loopback). */
  attachSystemStream: (stream: MediaStream | null) => void;
  /** Get the live mixed audio tracks for the recorder. */
  getMixedAudioTracks: () => MediaStreamTrack[];
}

const MIC_DEVICE_KEYWORDS_SYSTEM_AUDIO = [
  'blackhole',
  'soundflower',
  'loopback audio',
  'voicemeeter',
  'stereo mix',
  'vb-audio',
  'vb-cable'
];

export function isVirtualLoopbackName(label: string): boolean {
  const lower = label.toLowerCase();
  return MIC_DEVICE_KEYWORDS_SYSTEM_AUDIO.some((kw) => lower.includes(kw));
}

export function useAudioPipeline(settings: Settings): UseAudioPipelineApi {
  const pipelineRef = useRef<AudioPipeline | null>(null);
  const [state, setState] = useState<AudioPipelineState>({
    pipeline: null,
    micStream: null,
    micError: null,
    micDevices: [],
    permissionDenied: false
  });

  const wantsMic = settings.audioMode === 'mic' || settings.audioMode === 'both';
  const wantsSystem = settings.audioMode === 'system' || settings.audioMode === 'both';
  const wantsAudio = wantsMic || wantsSystem;

  // Lazily create the pipeline on first need.
  useEffect(() => {
    if (!wantsAudio) return;
    if (!pipelineRef.current) {
      pipelineRef.current = new AudioPipeline();
      pipelineRef.current.setMicGain(settings.micGain);
      pipelineRef.current.setSystemGain(settings.systemGain);
      pipelineRef.current.setMuted(settings.audioMuted);
      setState((s) => ({ ...s, pipeline: pipelineRef.current }));
    }
    void pipelineRef.current.resume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsAudio]);

  // Apply gain/mute changes live.
  useEffect(() => {
    pipelineRef.current?.setMicGain(settings.micGain);
  }, [settings.micGain]);

  useEffect(() => {
    pipelineRef.current?.setSystemGain(settings.systemGain);
  }, [settings.systemGain]);

  useEffect(() => {
    pipelineRef.current?.setMuted(settings.audioMuted);
  }, [settings.audioMuted]);

  // Acquire / release the mic stream when mode or device changes.
  useEffect(() => {
    let cancelled = false;

    async function acquireMic(): Promise<void> {
      const pipeline = pipelineRef.current;
      if (!pipeline) return;

      // Release current mic stream if any.
      const stop = (s: MediaStream | null): void => {
        if (s) for (const t of s.getTracks()) t.stop();
      };

      if (!wantsMic) {
        setState((prev) => {
          stop(prev.micStream);
          return { ...prev, micStream: null, micError: null };
        });
        pipeline.setMicStream(null);
        return;
      }

      try {
        const audioConstraints: MediaTrackConstraints = {
          // Chromium-backed mic preprocessing. Honors user toggles in Settings.
          noiseSuppression: settings.micNoiseSuppression,
          echoCancellation: settings.micEchoCancellation,
          autoGainControl: settings.micAutoGainControl
        };
        if (settings.micDeviceId) {
          audioConstraints.deviceId = { exact: settings.micDeviceId };
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: false
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        pipeline.setMicStream(stream);
        setState((prev) => {
          stop(prev.micStream);
          return { ...prev, micStream: stream, micError: null, permissionDenied: false };
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        const isPermission = /denied|not allowed|permission/i.test(message);
        pipeline.setMicStream(null);
        setState((prev) => {
          stop(prev.micStream);
          return {
            ...prev,
            micStream: null,
            micError: message,
            permissionDenied: isPermission
          };
        });
      }
    }

    void acquireMic();
    return () => {
      cancelled = true;
    };
  }, [
    wantsMic,
    settings.micDeviceId,
    settings.micNoiseSuppression,
    settings.micEchoCancellation,
    settings.micAutoGainControl
  ]);

  // Refresh device list on mount + when devices change.
  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        setState((s) => ({ ...s, micDevices: inputs }));
      } catch {
        // ignore
      }
    }
    void refresh();
    const handler = (): void => void refresh();
    navigator.mediaDevices.addEventListener('devicechange', handler);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener('devicechange', handler);
    };
  }, []);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      const p = pipelineRef.current;
      pipelineRef.current = null;
      if (p) void p.destroy();
    };
  }, []);

  return useMemo<UseAudioPipelineApi>(
    () => ({
      ...state,
      wantsAudio,
      refreshDevices: async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((d) => d.kind === 'audioinput');
        setState((s) => ({ ...s, micDevices: inputs }));
      },
      attachSystemStream: (stream) => {
        pipelineRef.current?.setSystemStream(stream);
      },
      getMixedAudioTracks: () => {
        const p = pipelineRef.current;
        if (!p) return [];
        if (!p.hasAnyAudio()) return [];
        return p.getMixedStream().getAudioTracks();
      }
    }),
    [state, wantsAudio]
  );
}

export type { AudioMode };
