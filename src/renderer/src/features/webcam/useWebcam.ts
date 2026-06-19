import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createBackgroundProcessor,
  type ProcessorHandle,
  type WebcamBackgroundMode
} from './backgroundProcessor';
import { createFaceTracker, type FaceCenter, type FaceTrackerHandle } from './faceTracker';

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

export interface UseWebcamReturn extends WebcamState {
  /** Live face centre in un-mirrored video coords (0..1), null when off or unseen. */
  getFaceCenter: () => FaceCenter | null;
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
  /** Turn on MediaPipe face detection so the crop-zoom centres on the face. */
  faceTracking: boolean;
}

export function useWebcam({
  enabled,
  deviceId,
  backgroundMode,
  backgroundBlurPx,
  backgroundImagePath,
  faceTracking
}: Options) {
  const [state, setState] = useState<WebcamState>(INITIAL);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ProcessorHandle | null>(null);
  const faceTrackerRef = useRef<FaceTrackerHandle | null>(null);
  const [rawVersion, setRawVersion] = useState(0);

  /** Stable callback exposed to compositor + preview. Returns null when
   *  face-tracking is off or the tracker hasn't seen a face yet, in which
   *  case the caller falls back to a centred crop. */
  const getFaceCenterRef = useRef<() => FaceCenter | null>(() => null);
  useEffect(() => {
    getFaceCenterRef.current = (): FaceCenter | null =>
      faceTrackerRef.current ? faceTrackerRef.current.getFaceCenter() : null;
  }, []);

  const teardownProcessor = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.dispose();
      processorRef.current = null;
    }
  }, []);

  const teardownFaceTracker = useCallback(() => {
    if (faceTrackerRef.current) {
      faceTrackerRef.current.dispose();
      faceTrackerRef.current = null;
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
      teardownFaceTracker();
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

  // 2.5) Face-tracker lifecycle. Mirrors the bg processor lifecycle but is
  //      independent of it — they share the same raw stream but each pulls
  //      from it through their own hidden video element. We attach to the
  //      *raw* stream, not the processor's output stream, because the bg
  //      processor's output is masked + bg-replaced and the face detector
  //      gets confused by the synthetic backgrounds.
  useEffect(() => {
    const raw = rawStreamRef.current;
    if (!raw) return;
    if (!faceTracking) {
      teardownFaceTracker();
      return;
    }
    if (faceTrackerRef.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const tracker = await createFaceTracker(raw);
        if (cancelled) {
          tracker.dispose();
          return;
        }
        faceTrackerRef.current = tracker;
      } catch (err) {
        // Non-fatal — preview/compositor just fall back to centred crop.
        console.warn('face tracker failed to start, falling back to centred crop', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [faceTracking, rawVersion, teardownFaceTracker]);

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
      teardownFaceTracker();
      stopRaw();
    };
  }, [teardownProcessor, teardownFaceTracker, stopRaw]);

  return { ...state, getFaceCenter: getFaceCenterRef.current };
}
