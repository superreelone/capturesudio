import { useCallback, useEffect, useState } from 'react';
import type { ListRecentsResponse, RecentFile } from '@shared/files.types';

export interface RecentsState {
  files: RecentFile[];
  recordingFolder: string;
  screenshotFolder: string;
  loading: boolean;
  error: string | null;
}

const INITIAL: RecentsState = {
  files: [],
  recordingFolder: '',
  screenshotFolder: '',
  loading: false,
  error: null
};

export function useRecents() {
  const [state, setState] = useState<RecentsState>(INITIAL);

  const refresh = useCallback(async (): Promise<void> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res: ListRecentsResponse = await window.api.files.listRecents({ limit: 300 });
      setState({
        files: res.files,
        recordingFolder: res.recordingFolder,
        screenshotFolder: res.screenshotFolder,
        loading: false,
        error: null
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : String(err)
      }));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const remove = useCallback(async (path: string): Promise<void> => {
    await window.api.files.delete(path);
    setState((s) => ({ ...s, files: s.files.filter((f) => f.path !== path) }));
  }, []);

  return { state, refresh, remove };
}
