import { app, safeStorage } from 'electron';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import Store from 'electron-store';
import { IpcEvent } from '@shared/ipc-channels';
import type {
  ActivateLicenseResponse,
  DeactivateLicenseResponse,
  LicensePayload,
  LicenseStatus,
  LicenseStatusValue,
  LicenseTier
} from '@shared/license.types';
import { LICENSE_PUBLIC_KEY_BASE64 } from './license-public-key';
import { verifyLicenseKey } from './license-verify';
import { getDeviceFingerprint, shortFingerprint } from './fingerprint.service';
import { createLogger } from '@main/util/logger';
import type { BrowserWindow } from 'electron';

const log = createLogger('license');

const STORED_FILE = (): string => join(app.getPath('userData'), 'license.bin');
const CLOCK_STORE_NAME = 'clock-marker';

interface StoredLicense {
  key: string;
  payload: LicensePayload;
  fingerprint: string;
  activatedAtMs: number;
}

interface ClockStoreSchema {
  lastSeenMs: number;
}

let clockStore: Store<ClockStoreSchema> | null = null;
function getClockStore(): Store<ClockStoreSchema> {
  if (!clockStore) {
    clockStore = new Store<ClockStoreSchema>({
      name: CLOCK_STORE_NAME,
      defaults: { lastSeenMs: 0 }
    });
  }
  return clockStore;
}

let mainWindowAccessor: () => BrowserWindow | null = () => null;
export function setLicenseWindowAccessor(fn: () => BrowserWindow | null): void {
  mainWindowAccessor = fn;
}

function broadcast(status: LicenseStatus): void {
  const win = mainWindowAccessor();
  if (win && !win.isDestroyed()) win.webContents.send(IpcEvent.LicenseStatusChanged, status);
}

/* ---------- key parsing & verification ---------- */

function isConfigured(): boolean {
  return LICENSE_PUBLIC_KEY_BASE64.trim().length > 0;
}

function verifyKey(keyString: string): ReturnType<typeof verifyLicenseKey> {
  return verifyLicenseKey(keyString, LICENSE_PUBLIC_KEY_BASE64);
}

/* ---------- storage (safeStorage-encrypted file) ---------- */

async function writeStored(stored: StoredLicense): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage unavailable on this system');
  }
  const json = JSON.stringify(stored);
  const encrypted = safeStorage.encryptString(json);
  await fsp.writeFile(STORED_FILE(), encrypted);
}

async function readStored(): Promise<StoredLicense | null> {
  try {
    const buf = await fsp.readFile(STORED_FILE());
    if (!safeStorage.isEncryptionAvailable()) {
      log.warn('safeStorage unavailable; cannot decrypt stored license');
      return null;
    }
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json) as StoredLicense;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') log.warn('readStored failed', { err: String(err) });
    return null;
  }
}

async function clearStored(): Promise<void> {
  try {
    await fsp.unlink(STORED_FILE());
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') log.warn('clearStored failed', { err: String(err) });
  }
}

/* ---------- clock-rollback detection ---------- */

function getLastSeen(): number {
  return getClockStore().get('lastSeenMs') ?? 0;
}

function markLastSeen(): void {
  const now = Date.now();
  const previous = getLastSeen();
  if (now > previous) getClockStore().set('lastSeenMs', now);
}

function clockSeemsRolledBack(): boolean {
  const last = getLastSeen();
  if (last === 0) return false;
  // 60s fudge for time sync corrections.
  return Date.now() < last - 60_000;
}

/* ---------- status assembly ---------- */

function buildStatus(stored: StoredLicense | null, currentFingerprint: string): LicenseStatus {
  if (!isConfigured()) {
    return {
      status: 'unconfigured',
      message:
        'License system not configured. Run `npm run keygen:genkey`. All features unlocked in dev mode.',
      currentDeviceFingerprintShort: shortFingerprint(currentFingerprint)
    };
  }
  if (!stored) {
    return {
      status: 'none',
      currentDeviceFingerprintShort: shortFingerprint(currentFingerprint)
    };
  }
  const { payload, fingerprint } = stored;
  const fingerprintMatches = fingerprint === currentFingerprint;

  // Re-verify signature on every read (defense in depth — file may have been tampered).
  const verifyResult = verifyKey(stored.key);
  if (!verifyResult.ok) {
    return {
      status: 'tampered',
      tier: payload.tier as LicenseTier,
      keyId: payload.id,
      expiresAtMs: payload.exp,
      message: verifyResult.error,
      deviceFingerprintShort: shortFingerprint(fingerprint),
      currentDeviceFingerprintShort: shortFingerprint(currentFingerprint)
    };
  }
  if (!fingerprintMatches) {
    return {
      status: 'tampered',
      tier: payload.tier as LicenseTier,
      keyId: payload.id,
      expiresAtMs: payload.exp,
      message:
        'License is bound to a different device. Deactivate it on the original device first, then re-activate here.',
      deviceFingerprintShort: shortFingerprint(fingerprint),
      currentDeviceFingerprintShort: shortFingerprint(currentFingerprint)
    };
  }

  const now = Date.now();
  const expired = now > payload.exp;
  const daysRemaining = Math.max(0, Math.ceil((payload.exp - now) / (24 * 60 * 60 * 1000)));

  const base: LicenseStatus = {
    tier: payload.tier as LicenseTier,
    keyId: payload.id,
    expiresAtMs: payload.exp,
    issuedAtMs: payload.iat,
    daysRemaining,
    deviceFingerprintShort: shortFingerprint(fingerprint),
    currentDeviceFingerprintShort: shortFingerprint(currentFingerprint),
    features: payload.features,
    status: 'active' as LicenseStatusValue
  };

  if (expired) {
    return { ...base, status: 'expired', message: `Expired ${new Date(payload.exp).toLocaleDateString()}.` };
  }
  if (clockSeemsRolledBack()) {
    return {
      ...base,
      status: 'clock-warning',
      message: 'System clock appears to have moved backwards. License will continue to work but is being monitored.'
    };
  }
  return { ...base, status: 'active' };
}

/* ---------- public API ---------- */

export async function getStatus(): Promise<LicenseStatus> {
  markLastSeen();
  const fp = getDeviceFingerprint();
  const stored = await readStored();
  return buildStatus(stored, fp);
}

export async function activate(keyString: string): Promise<ActivateLicenseResponse> {
  if (!isConfigured()) {
    return {
      ok: true,
      status: await getStatus()
    };
  }
  const result = verifyKey(keyString);
  if (!result.ok) {
    return { ok: false, status: await getStatus(), error: result.error };
  }
  const now = Date.now();
  if (result.payload.exp <= now) {
    return {
      ok: false,
      status: await getStatus(),
      error: `License key is already expired (${new Date(result.payload.exp).toLocaleDateString()}).`
    };
  }
  const fp = getDeviceFingerprint();
  const stored: StoredLicense = {
    key: keyString.trim(),
    payload: result.payload,
    fingerprint: fp,
    activatedAtMs: now
  };
  try {
    await writeStored(stored);
  } catch (err) {
    return {
      ok: false,
      status: await getStatus(),
      error: `Could not write license to secure storage: ${String(err)}`
    };
  }
  markLastSeen();
  const status = buildStatus(stored, fp);
  log.info('license activated', {
    keyId: result.payload.id,
    tier: result.payload.tier,
    daysRemaining: status.daysRemaining
  });
  broadcast(status);
  return { ok: true, status };
}

export async function deactivate(): Promise<DeactivateLicenseResponse> {
  await clearStored();
  const status = await getStatus();
  log.info('license deactivated');
  broadcast(status);
  return { ok: true, status };
}
