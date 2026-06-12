import { useCallback, useEffect, useState } from 'react';
import type { UpdateState } from '@shared/updater.types';

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ value: 'idle' });
  const [dismissed, setDismissed] = useState<string | null>(null);

  useEffect(() => {
    void window.api.updater.state().then(setState);
    const off = window.api.events.onUpdaterStateChanged(setState);
    return off;
  }, []);

  const check = useCallback(async () => {
    const s = await window.api.updater.check();
    setState(s);
  }, []);

  const download = useCallback(async () => {
    const s = await window.api.updater.download();
    setState(s);
  }, []);

  const install = useCallback(async () => {
    await window.api.updater.install();
  }, []);

  const dismissCurrent = useCallback(() => {
    if (state.version) setDismissed(state.version);
  }, [state.version]);

  const visible =
    (state.value === 'available' && dismissed !== state.version) ||
    state.value === 'downloading' ||
    state.value === 'downloaded' ||
    state.value === 'error';

  return { state, check, download, install, dismissCurrent, visible };
}
