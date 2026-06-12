import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createBackgroundProcessor,
  type ProcessorHandle,
  type WebcamBackgroundMode
} from './backgroundProcessor';

export interface WebcamState {
  enabled: boolean;
  /** What WebcamPreview + the compositor should consume — raw or processed. */
  stream: MediaStream | null;
  devices: MediaDeviceInfo[];
  error: string | null;
  permissionDenied: boolean;
  /** True while MediaPipe is downloading / initializing the segmenter. */
  backgroundLoading: boolean;
}

const INITIAL: WebcamState = {
  enabled: false,
  stream: null,
  devices: [],
  error: null,
  permissionDenied: false,
  backgroundLoading: false
};

interface Options {
  enabled: boolean;
  deviceId: string;
  backgroundMode: WebcamBackgroundMode;
  backgroundBlurPx: number;
  /** Data URL or empty. The picker writes a data URL into settings. */
  backgroundImagePath: string;
}

export function useWebcam({
  enabled,
  deviceId,
  backgroundMode,
  backgroundBlurPx,
  backgroundImagePath
}: Options) {
  const [state, setState] = useState<WebcamState>(INITIAL);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ProcessorHandle | null>(null);
  const [rawVersion, setRawVersion] = useState(0);

  const teardownProcessor = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.dispose();
      processorRef.current = null;
    }
  }, []);

  const stopRaw = useCallback(() => {
    if (rawStreamRef.current) {
      for (const t of rawStreamRef.current.getTracks()) t.stop();
      rawStreamRef.current = null;
    }
  }, []);

  // 1) Acquire the raw camera stream whenever enabled or device changes.
  useEffect(() => {
    let cancelled = false;

    async function acquire(): Promise<void> {
      teardownProcessor();
      stopRaw();
      if (!enabled) {
        setState((s) => ({ ...s, stream: null, error: null, enabled: false }));
        return;
      }
      try {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, frameRate: { ideal: 30 } }
            : { frameRate: { ideal: 30 } }
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        rawStreamRef.current = stream;
        setRawVersion((v) => v + 1);
        setState((s) => ({
          ...s,
          enabled: true,
          stream,
          error: null,
          permissionDenied: false
        }));
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        const denied = /denied|not allowed|permission/i.test(msg);
        setState((s) => ({
          ...s,
          enabled: false,
          stream: null,
          error: msg,
          permissionDenied: denied
        }));
      }
    }

    void acquire();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, deviceId]);

  // 2) Apply / update / tear down the background processor.
  useEffect(() => {
    const raw = rawStreamRef.current;
    if (!raw) return;

    if (backgroundMode === 'none') {
      teardownProcessor();
      setState((s) => ({ ...s, stream: raw, backgroundLoading: false }));
      return;
    }

    const processorOpts = {
      mode: backgroundMode,
      blurPx: backgroundBlurPx,
      imageUrl: backgroundMode === 'image' ? backgroundImagePath || null : null,
      targetFps: 30
    };

    if (processorRef.current) {
      processorRef.current.setOptions(processorOpts);
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, backgroundLoading: true }));
    void (async () => {
      try {
        const proc = await createBackgroundProcessor(raw, processorOpts);
        if (cancelled) {
          proc.dispose();
          return;
        }
        processorRef.current = proc;
        setState((s) => ({
          ...s,
          stream: proc.stream,
          backgroundLoading: false,
          error: null
        }));
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setState((s) => ({
            ...s,
            error: `Background processor failed: ${msg}`,
            backgroundLoading: false
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backgroundMode, backgroundBlurPx, backgroundImagePath, rawVersion, teardownProcessor]);

  // 3) Device-list refresh.
  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        const cams = all.filter((d) => d.kind === 'videoinput');
        setState((s) => ({ ...s, devices: cams }));
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

  // 4) Unmount cleanup.
  useEffect(() => {
    return () => {
      teardownProcessor();
      stopRaw();
    };
  }, [teardownProcessor, stopRaw]);

  return state;
}
