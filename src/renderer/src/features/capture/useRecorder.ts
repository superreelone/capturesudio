import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  FinalizeRecordingResponse,
  StartRecordingRequest
} from '@shared/recording.types';

export type RecorderStatus = 'idle' | 'starting' | 'recording' | 'paused' | 'finalizing' | 'error';

interface StartArgs {
  stream: MediaStream;
  request: StartRecordingRequest;
  sourceLabel: string;
  videoBitsPerSecond: number;
}

const WITH_AUDIO_MIME_TYPES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm'
];

const VIDEO_ONLY_MIME_TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm'
];

export function pickSupportedMimeType(withAudio = true): string {
  const candidates = withAudio ? WITH_AUDIO_MIME_TYPES : VIDEO_ONLY_MIME_TYPES;
  for (const mt of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return 'video/webm';
}

interface RecorderState {
  status: RecorderStatus;
  error: string | null;
  /** Non-fatal warning shown alongside the recording UI (e.g. frozen capture). */
  warning: string | null;
  startedAt: number | null;
  pausedElapsedMs: number;
  durationMs: number;
  lastResult: FinalizeRecordingResponse | null;
}

const INITIAL: RecorderState = {
  status: 'idle',
  error: null,
  warning: null,
  startedAt: null,
  pausedElapsedMs: 0,
  durationMs: 0,
  lastResult: null
};

/**
 * If the underlying screen-capture pipeline stops producing frames (DXGI
 * "Duplication failed", keyed-mutex abandoned, etc. on Windows), we want to
 * surface it instead of silently writing a frozen video. We flag a freeze
 * after this many ms without any MediaRecorder data chunk.
 */
const FREEZE_THRESHOLD_MS = 6000;

export function useRecorder() {
  const [state, setState] = useState<RecorderState>(INITIAL);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pauseStartedRef = useRef<number | null>(null);
  const sourceLabelRef = useRef<string>('capture');
  const sourceKindRef = useRef<'screen' | 'window' | 'region'>('screen');
  const tickRef = useRef<number | null>(null);
  const lastChunkAtRef = useRef<number>(0);
  const freezeWatchdogRef = useRef<number | null>(null);
  /**
   * Outstanding appendChunk IPC calls. MediaRecorder fires a final
   * `dataavailable` event right before `stop`, but our handler is async, so
   * without explicit tracking we may call `finalize` (which destroys the
   * session in main) before the last chunk has been uploaded — causing an
   * "unknown recording session" error in main. Drain this list before
   * finalizing.
   */
  const pendingChunksRef = useRef<Promise<void>[]>([]);

  const stopTimer = useCallback(() => {
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const stopFreezeWatchdog = useCallback(() => {
    if (freezeWatchdogRef.current) {
      window.clearInterval(freezeWatchdogRef.current);
      freezeWatchdogRef.current = null;
    }
  }, []);

  const startFreezeWatchdog = useCallback(() => {
    stopFreezeWatchdog();
    lastChunkAtRef.current = Date.now();
    freezeWatchdogRef.current = window.setInterval(() => {
      setState((s) => {
        if (s.status !== 'recording') return s;
        const gap = Date.now() - lastChunkAtRef.current;
        if (gap > FREEZE_THRESHOLD_MS && !s.warning) {
          return {
            ...s,
            warning:
              'Screen capture has stopped producing frames. The recording is likely frozen — ' +
              'this is usually a Windows desktop-duplication failure (UAC, secure desktop, ' +
              'GPU driver hiccup, or a window with display-capture protection). Stop and ' +
              'restart the recording to recover.'
          };
        }
        if (gap <= FREEZE_THRESHOLD_MS && s.warning) {
          return { ...s, warning: null };
        }
        return s;
      });
    }, 1000);
  }, [stopFreezeWatchdog]);

  const startTimer = useCallback(() => {
    stopTimer();
    tickRef.current = window.setInterval(() => {
      setState((s) => {
        if (s.status !== 'recording' || s.startedAt === null) return s;
        const now = Date.now();
        const duration = now - s.startedAt - s.pausedElapsedMs;
        return { ...s, durationMs: duration };
      });
    }, 250);
  }, [stopTimer]);

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      // Only stop tracks the recorder owns (video). Audio tracks belong to the
      // upstream audio pipeline / source streams — caller manages those lifetimes.
      for (const track of streamRef.current.getVideoTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  const start = useCallback(
    async ({ stream, request, sourceLabel, videoBitsPerSecond }: StartArgs): Promise<void> => {
      try {
        setState({ ...INITIAL, status: 'starting' });
        const session = await window.api.recording.start(request);
        sessionIdRef.current = session.sessionId;
        sourceLabelRef.current = sourceLabel;
        sourceKindRef.current = request.kind;
        streamRef.current = stream;

        const recorder = new MediaRecorder(stream, {
          mimeType: request.mimeType,
          videoBitsPerSecond
        });
        recorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (!event.data || event.data.size === 0) return;
          // Track liveness for the freeze watchdog.
          lastChunkAtRef.current = Date.now();
          const sessionId = sessionIdRef.current;
          if (!sessionId) return;
          // Register an in-flight upload so `stop()` can wait for it before
          // calling finalize. Snapshot the Blob synchronously here so we don't
          // depend on `event.data` being valid after the handler returns.
          const blob = event.data;
          const job = (async () => {
            try {
              const buf = await blob.arrayBuffer();
              await window.api.recording.appendChunk({
                sessionId,
                data: new Uint8Array(buf)
              });
            } catch (err) {
              console.error('appendChunk failed', err);
            }
          })();
          pendingChunksRef.current.push(job);
          // Self-clean once settled so the array doesn't grow unbounded over
          // a long recording.
          void job.finally(() => {
            const idx = pendingChunksRef.current.indexOf(job);
            if (idx !== -1) pendingChunksRef.current.splice(idx, 1);
          });
        };

        recorder.onerror = (event: Event) => {
          const message =
            (event as unknown as { error?: { message?: string } }).error?.message ??
            'MediaRecorder error';
          setState((s) => ({ ...s, status: 'error', error: message }));
        };

        for (const track of stream.getVideoTracks()) {
          track.addEventListener('ended', () => {
            setState((s) => ({
              ...s,
              warning:
                'Screen capture stream ended unexpectedly — saving what was captured so far.'
            }));
            if (recorder.state !== 'inactive') recorder.stop();
          });
          // Track-level mute fires when Chromium's capturer stops emitting
          // frames (e.g. DXGI duplication failed). Surface it as a warning.
          track.addEventListener('mute', () => {
            setState((s) => ({
              ...s,
              warning:
                'Screen capture muted by the OS (likely a UAC prompt or protected window). ' +
                'Frames may be missing until it resumes.'
            }));
          });
          track.addEventListener('unmute', () => {
            setState((s) => (s.warning ? { ...s, warning: null } : s));
            lastChunkAtRef.current = Date.now();
          });
        }

        recorder.start(1000);
        setState({
          status: 'recording',
          error: null,
          warning: null,
          startedAt: Date.now(),
          pausedElapsedMs: 0,
          durationMs: 0,
          lastResult: null
        });
        startTimer();
        startFreezeWatchdog();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState({ ...INITIAL, status: 'error', error: message });
        cleanupStream();
      }
    },
    [cleanupStream, startTimer, startFreezeWatchdog]
  );

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    pauseStartedRef.current = Date.now();
    stopTimer();
    stopFreezeWatchdog();
    setState((s) => ({ ...s, status: 'paused' }));
  }, [stopTimer, stopFreezeWatchdog]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== 'paused') return;
    if (pauseStartedRef.current) {
      const pausedFor = Date.now() - pauseStartedRef.current;
      pauseStartedRef.current = null;
      setState((s) => ({
        ...s,
        status: 'recording',
        pausedElapsedMs: s.pausedElapsedMs + pausedFor
      }));
    } else {
      setState((s) => ({ ...s, status: 'recording' }));
    }
    recorder.resume();
    startTimer();
    startFreezeWatchdog();
  }, [startTimer, startFreezeWatchdog]);

  const stop = useCallback(async (): Promise<FinalizeRecordingResponse | null> => {
    const recorder = recorderRef.current;
    const sessionId = sessionIdRef.current;
    if (!recorder || !sessionId) return null;

    stopTimer();
    stopFreezeWatchdog();
    setState((s) => ({ ...s, status: 'finalizing' }));

    await new Promise<void>((resolve) => {
      const onStop = () => {
        recorder.removeEventListener('stop', onStop);
        resolve();
      };
      recorder.addEventListener('stop', onStop);
      if (recorder.state !== 'inactive') recorder.stop();
      else resolve();
    });

    // Wait for any in-flight appendChunk IPCs to land before we finalize —
    // otherwise main may destroy the session before the final chunk arrives.
    // settleAllSettled keeps us going even if individual chunks failed.
    if (pendingChunksRef.current.length > 0) {
      await Promise.allSettled(pendingChunksRef.current);
      pendingChunksRef.current = [];
    }

    cleanupStream();

    const durationMs = state.durationMs;
    try {
      const result = await window.api.recording.finalize({
        sessionId,
        durationMs,
        sourceLabel: sourceLabelRef.current,
        sourceKind: sourceKindRef.current
      });
      sessionIdRef.current = null;
      recorderRef.current = null;
      setState({
        status: 'idle',
        error: null,
        warning: null,
        startedAt: null,
        pausedElapsedMs: 0,
        durationMs: 0,
        lastResult: result
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, status: 'error', error: message }));
      return null;
    }
  }, [cleanupStream, state.durationMs, stopTimer, stopFreezeWatchdog]);

  const cancel = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    const sessionId = sessionIdRef.current;
    stopTimer();
    stopFreezeWatchdog();
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // ignore
      }
    }
    cleanupStream();
    if (sessionId) {
      try {
        await window.api.recording.cancel({ sessionId });
      } catch {
        // ignore
      }
    }
    sessionIdRef.current = null;
    recorderRef.current = null;
    setState({ ...INITIAL });
  }, [cleanupStream, stopTimer, stopFreezeWatchdog]);

  useEffect(() => {
    return () => {
      stopTimer();
      stopFreezeWatchdog();
      cleanupStream();
    };
  }, [cleanupStream, stopTimer, stopFreezeWatchdog]);

  return {
    state,
    start,
    pause,
    resume,
    stop,
    cancel
  };
}
