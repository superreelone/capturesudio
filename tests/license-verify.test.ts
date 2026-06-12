import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { isExpired, verifyLicenseKey } from '../src/main/services/license-verify';
import type { LicensePayload } from '../src/shared/license.types';

/** Issue a fresh keypair + signed key for each test — fully isolated. */
function makeIssuer() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyBase64 = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).toString(
    'base64'
  );

  function issue(payload: LicensePayload): string {
    const body = Buffer.from(JSON.stringify(payload), 'utf-8');
    const sig = sign(null, body, privateKey);
    const b64url = (b: Buffer) =>
      b.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `INGE-${b64url(body)}.${b64url(sig)}`;
  }

  return { publicKeyBase64, issue, privateKey };
}

function validPayload(over: Partial<LicensePayload> = {}): LicensePayload {
  const now = Date.now();
  return {
    v: 1,
    id: 'test-key-id',
    tier: 'pro',
    exp: now + 30 * 24 * 60 * 60 * 1000,
    iat: now,
    ...over
  };
}

describe('verifyLicenseKey', () => {
  it('happy path: signed key verifies and payload comes through', () => {
    const { publicKeyBase64, issue } = makeIssuer();
    const payload = validPayload();
    const key = issue(payload);
    const result = verifyLicenseKey(key, publicKeyBase64);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.id).toBe('test-key-id');
      expect(result.payload.tier).toBe('pro');
      expect(result.payload.exp).toBe(payload.exp);
    }
  });

  it('rejects when public key is empty (unconfigured)', () => {
    const { issue } = makeIssuer();
    const result = verifyLicenseKey(issue(validPayload()), '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not configured/);
  });

  it('rejects an empty key', () => {
    const { publicKeyBase64 } = makeIssuer();
    const result = verifyLicenseKey('', publicKeyBase64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/empty key/);
  });

  it('rejects a malformed key (no dot)', () => {
    const { publicKeyBase64 } = makeIssuer();
    const result = verifyLicenseKey('INGE-justonepart', publicKeyBase64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/malformed/);
  });

  it('tolerates whitespace and missing INGE- prefix', () => {
    const { publicKeyBase64, issue } = makeIssuer();
    const key = issue(validPayload());
    const stripped = key.slice(5); // drop INGE-
    const messy = '   ' + stripped.replace(/(.{20})/g, '$1  \n') + '   ';
    const result = verifyLicenseKey(messy, publicKeyBase64);
    expect(result.ok).toBe(true);
  });

  it('rejects a key signed by a different private key', () => {
    const issuerA = makeIssuer();
    const issuerB = makeIssuer();
    const key = issuerA.issue(validPayload());
    const result = verifyLicenseKey(key, issuerB.publicKeyBase64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/signature does not verify/);
  });

  it('rejects a key whose payload was tampered with after signing', () => {
    const { publicKeyBase64, issue } = makeIssuer();
    const key = issue(validPayload());
    const stripped = key.slice(5);
    const [body, sig] = stripped.split('.');
    // Re-encode a different payload but keep the original signature.
    const fakeBody = Buffer.from(
      JSON.stringify(validPayload({ tier: 'enterprise', exp: Date.now() + 10 * 365 * 86400_000 })),
      'utf-8'
    )
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const result = verifyLicenseKey(`INGE-${fakeBody}.${sig}`, publicKeyBase64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/signature does not verify/);
    void body; // referenced only to satisfy ESLint about unused destructure
  });

  it('rejects payload missing required fields', () => {
    const { publicKeyBase64, issue } = makeIssuer();
    // Missing tier
    const badPayload = { v: 1, id: 'x', iat: Date.now(), exp: Date.now() + 1000 } as unknown as LicensePayload;
    const key = issue(badPayload);
    const result = verifyLicenseKey(key, publicKeyBase64);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown tier', () => {
    const { publicKeyBase64, issue } = makeIssuer();
    const key = issue(validPayload({ tier: 'platinum' as 'pro' }));
    const result = verifyLicenseKey(key, publicKeyBase64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unknown tier/);
  });

  it('rejects unsupported payload version', () => {
    const { publicKeyBase64, issue } = makeIssuer();
    const key = issue(validPayload({ v: 2 as 1 }));
    const result = verifyLicenseKey(key, publicKeyBase64);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/unsupported payload version/);
  });
});

describe('isExpired', () => {
  it('returns false for a future exp', () => {
    const payload = validPayload({ exp: Date.now() + 60_000 });
    expect(isExpired(payload)).toBe(false);
  });

  it('returns true for a past exp', () => {
    const payload = validPayload({ exp: Date.now() - 60_000 });
    expect(isExpired(payload)).toBe(true);
  });

  it('respects the now parameter for testability', () => {
    const exp = 1_000_000;
    const payload = validPayload({ exp });
    expect(isExpired(payload, exp - 1)).toBe(false);
    expect(isExpired(payload, exp)).toBe(false);
    expect(isExpired(payload, exp + 1)).toBe(true);
  });
});
