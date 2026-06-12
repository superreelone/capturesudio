/**
 * Pure license-key verifier — extracted from license.service so it can be
 * unit-tested with a throwaway keypair, without touching electron, safeStorage,
 * or any singletons.
 *
 *   key format:  INGE-<base64url(payloadJSON)>.<base64url(Ed25519Signature)>
 *   verification: Ed25519 verify(payloadBytes, sig, publicKey)
 *
 * No side effects, no I/O, no Electron imports. Safe to import in tests and
 * in the renderer (though the renderer never calls it — verification is a
 * main-process responsibility).
 */
import { createPublicKey, verify } from 'node:crypto';
import type { LicensePayload, LicenseTier } from '@shared/license.types';

export type VerifyResult =
  | { ok: true; payload: LicensePayload }
  | { ok: false; error: string };

const VALID_TIERS: LicenseTier[] = ['pro', 'team', 'enterprise', 'trial'];

function b64urlToBuf(s: string): Buffer {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64');
}

/**
 * Verify a license key against the given public key (base64 DER SPKI).
 *
 *   - Strips the `INGE-` prefix and any whitespace.
 *   - Splits into payload + signature.
 *   - Verifies the Ed25519 signature.
 *   - Parses the payload and sanity-checks v / id / tier / exp / iat.
 *
 * Does NOT check expiry — that's a time-based concern handled by the caller so
 * it can be mocked in tests cleanly.
 */
export function verifyLicenseKey(
  keyString: string,
  publicKeyBase64: string
): VerifyResult {
  if (!publicKeyBase64 || publicKeyBase64.trim().length === 0) {
    return { ok: false, error: 'license system not configured' };
  }

  let s = (keyString || '').trim();
  if (s.startsWith('INGE-')) s = s.slice(5);
  s = s.replace(/\s+/g, '');
  if (!s) return { ok: false, error: 'empty key' };

  const parts = s.split('.');
  if (parts.length !== 2) {
    return { ok: false, error: 'malformed key (expected body.signature)' };
  }

  let bodyBytes: Buffer;
  let sigBytes: Buffer;
  try {
    bodyBytes = b64urlToBuf(parts[0]!);
    sigBytes = b64urlToBuf(parts[1]!);
  } catch (err) {
    return { ok: false, error: `base64 decode failed: ${String(err)}` };
  }

  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki'
    });
  } catch (err) {
    return { ok: false, error: `public key load failed: ${String(err)}` };
  }

  // Ed25519 detached: hash arg is null per Node docs.
  const sigValid = verify(null, bodyBytes, publicKey, sigBytes);
  if (!sigValid) return { ok: false, error: 'signature does not verify' };

  let payload: LicensePayload;
  try {
    payload = JSON.parse(bodyBytes.toString('utf-8'));
  } catch (err) {
    return { ok: false, error: `payload JSON parse failed: ${String(err)}` };
  }

  if (payload.v !== 1) {
    return { ok: false, error: `unsupported payload version: ${payload.v}` };
  }
  if (typeof payload.exp !== 'number' || typeof payload.iat !== 'number') {
    return { ok: false, error: 'payload missing exp/iat' };
  }
  if (typeof payload.id !== 'string' || !payload.id) {
    return { ok: false, error: 'payload missing id' };
  }
  if (!VALID_TIERS.includes(payload.tier)) {
    return { ok: false, error: `payload has unknown tier: ${payload.tier}` };
  }

  return { ok: true, payload };
}

/** True if the key payload's `exp` is in the past, given the current time. */
export function isExpired(payload: LicensePayload, nowMs: number = Date.now()): boolean {
  return nowMs > payload.exp;
}
