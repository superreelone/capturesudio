/**
 * License key format (Option A — offline Ed25519 signed keys):
 *
 *   INGE-<base64url(payloadJSON)>.<base64url(signature)>
 *
 * The payload is a small JSON object, the signature is Ed25519 over the raw
 * payload bytes (before base64-encoding). The app verifies offline with the
 * embedded public key — no network call.
 */

export type LicenseTier = 'pro' | 'team' | 'enterprise' | 'trial';

export interface LicensePayload {
  /** Schema version. */
  v: 1;
  /** Vendor-assigned key id (also useful for revocation lists later). */
  id: string;
  /** Tier name. */
  tier: LicenseTier;
  /** Expiry Unix epoch ms. */
  exp: number;
  /** Issued-at Unix epoch ms. */
  iat: number;
  /** Optional max simultaneous activations (we honor 1 by default). */
  max?: number;
  /** Optional feature flags. */
  features?: string[];
}

export type LicenseStatusValue =
  /** Public key not embedded yet — dev mode; all features unlocked. */
  | 'unconfigured'
  /** No license activated on this device. */
  | 'none'
  /** Active + not expired + fingerprint matches. */
  | 'active'
  /** Signature OK but past expiry. */
  | 'expired'
  /** Signature failed OR fingerprint doesn't match the stored binding. */
  | 'tampered'
  /** Active, but system clock appears to have rolled back. */
  | 'clock-warning';

export interface LicenseStatus {
  status: LicenseStatusValue;
  tier?: LicenseTier;
  keyId?: string;
  expiresAtMs?: number;
  issuedAtMs?: number;
  daysRemaining?: number;
  /** First 8 hex chars of the bound fingerprint (UI hint only). */
  deviceFingerprintShort?: string;
  /** Current device's fingerprint short — useful for showing "bound to: X / current: Y". */
  currentDeviceFingerprintShort?: string;
  /** Human-readable message for error/warning states. */
  message?: string;
  features?: string[];
}

export interface ActivateLicenseRequest {
  keyString: string;
}

export interface ActivateLicenseResponse {
  ok: boolean;
  status: LicenseStatus;
  error?: string;
}

export interface DeactivateLicenseResponse {
  ok: boolean;
  status: LicenseStatus;
}
