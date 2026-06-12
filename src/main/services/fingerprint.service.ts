import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createLogger } from '@main/util/logger';

const log = createLogger('fingerprint');

let cached: string | null = null;

function readPlatformId(): string {
  try {
    if (process.platform === 'win32') {
      // MachineGuid is a stable per-OS-install identifier on Windows.
      const out = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: 'utf-8', windowsHide: true }
      );
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(out);
      if (m && m[1]) return m[1].trim().toLowerCase();
    } else if (process.platform === 'darwin') {
      const out = execSync('ioreg -rd1 -c IOPlatformExpertDevice', {
        encoding: 'utf-8'
      });
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out);
      if (m && m[1]) return m[1].trim().toLowerCase();
    } else if (process.platform === 'linux') {
      try {
        return readFileSync('/etc/machine-id', 'utf-8').trim();
      } catch {
        // ignore
      }
      try {
        return readFileSync('/var/lib/dbus/machine-id', 'utf-8').trim();
      } catch {
        // ignore
      }
    }
  } catch (err) {
    log.warn('platform id read failed', { err: String(err) });
  }
  return 'unknown';
}

/**
 * Returns a SHA-256 hex digest scoped to this app + machine. Stable across app
 * upgrades and reboots; changes if the OS is reinstalled. Not exposed raw — we
 * salt with the app name so the same machine produces different fingerprints
 * for different apps that use the same MachineGuid.
 */
export function getDeviceFingerprint(): string {
  if (cached) return cached;
  const raw = readPlatformId();
  const hash = createHash('sha256').update(`Ingestra-CaptureStudio::${raw}`).digest('hex');
  cached = hash;
  return hash;
}

export function shortFingerprint(fp: string): string {
  return fp.slice(0, 8);
}
