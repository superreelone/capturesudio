import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ExportDoneEvent,
  ExportErrorEvent,
  ExportProgress,
  StartExportRequest
} from '@shared/export.types';

export type ExportPhase = 'idle' | 'starting' | 'running' | 'done' | 'error' | 'cancelled';

interface ExportState {
  phase: ExportPhase;
  jobId: string | null;
  progress: ExportProgress | null;
  result: ExportDoneEvent | null;
  error: ExportErrorEvent | null;
}

const INITIAL: ExportState = {
  phase: 'idle',
  jobId: null,
  progress: null,
  result: null,
  error: null
};

export function useExportJob() {
  const [state, setState] = useState<ExportState>(INITIAL);
  const jobIdRef = useRef<string | null>(null);

  useEffect(() => {
    const offProgress = window.api.events.onExportProgress((ev) => {
      if (ev.jobId !== jobIdRef.current) return;
      setState((s) => ({ ...s, phase: 'running', progress: ev }));
    });
    const offDone = window.api.events.onExportDone((ev) => {
      if (ev.jobId !== jobIdRef.current) return;
      setState((s) => ({ ...s, phase: 'done', result: ev }));
    });
    const offErr = window.api.events.onExportError((ev) => {
      if (ev.jobId !== jobIdRef.current) return;
      setState((s) => ({
        ...s,
        phase: ev.message === 'cancelled' ? 'cancelled' : 'error',
        error: ev
      }));
    });
    return () => {
      offProgress();
      offDone();
      offErr();
    };
  }, []);

  const start = useCallback(async (req: StartExportRequest): Promise<void> => {
    setState({ ...INITIAL, phase: 'starting' });
    try {
      const { jobId } = await window.api.export.start(req);
      jobIdRef.current = jobId;
      setState((s) => ({ ...s, jobId, phase: 'running' }));
    } catch (err) {
      setState({
        ...INITIAL,
        phase: 'error',
        error: {
          jobId: '',
          message: err instanceof Error ? err.message : String(err),
          stderrTail: ''
        }
      });
    }
  }, []);

  const cancel = useCallback(async (): Promise<void> => {
    if (!jobIdRef.current) return;
    await window.api.export.cancel({ jobId: jobIdRef.current });
  }, []);

  const reset = useCallback((): void => {
    jobIdRef.current = null;
    setState({ ...INITIAL });
  }, []);

  return { state, start, cancel, reset };
}
