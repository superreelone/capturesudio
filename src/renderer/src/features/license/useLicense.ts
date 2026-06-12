import { useCallback, useEffect, useState } from 'react';
import type { LicenseStatus } from '@shared/license.types';

export interface UseLicense {
  status: LicenseStatus | null;
  loading: boolean;
  canUseGatedFeatures: boolean;
  refresh: () => Promise<void>;
  activate: (keyString: string) => Promise<{ ok: boolean; error?: string }>;
  deactivate: () => Promise<void>;
}

export function useLicense(): UseLicense {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    const s = await window.api.license.status();
    setStatus(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.api.events.onLicenseStatusChanged((s) => setStatus(s));
    return off;
  }, [refresh]);

  const activate = useCallback(
    async (keyString: string): Promise<{ ok: boolean; error?: string }> => {
      const res = await window.api.license.activate({ keyString });
      setStatus(res.status);
      return { ok: res.ok, error: res.error };
    },
    []
  );

  const deactivate = useCallback(async (): Promise<void> => {
    const res = await window.api.license.deactivate();
    setStatus(res.status);
  }, []);

  // Gated features: recording, screenshot capture, export.
  // Unlocked in: active, clock-warning (we don't block but warn), unconfigured (dev).
  // Blocked in: none, expired, tampered.
  const canUseGatedFeatures =
    status?.status === 'active' ||
    status?.status === 'clock-warning' ||
    status?.status === 'unconfigured';

  return { status, loading, canUseGatedFeatures, refresh, activate, deactivate };
}
