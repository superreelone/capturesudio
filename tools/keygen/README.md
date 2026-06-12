# Ingestra-CaptureStudio — Vendor Keygen

Offline Ed25519 license-key generation. Run on the vendor machine only. The
private key never leaves this directory.

## One-time setup (per project)

```bash
npm run keygen:genkey
```

This writes:

| File | Status | Contents |
|---|---|---|
| `tools/keygen/keys/private.pem` | **KEEP SECRET** (gitignored) | Ed25519 PKCS#8 PEM. Used to sign licenses. |
| `tools/keygen/keys/public.pem` | Backup (gitignored) | Human-readable public key. |
| `src/main/services/license-public-key.ts` | Committed | The same public key embedded in the app for offline verification. |

Back up `private.pem` somewhere secure (password manager, hardware token, etc.).
If you lose it, every license you've issued is still valid until expiry, but you
can never sign new keys with that public key embedded — you'd have to ship a new
public key in an app update and re-issue everyone.

To rotate keys (NOT something to do casually):

```bash
npm run keygen:genkey -- --force
```

…then re-issue keys to all customers.

## Issuing a license

```bash
npm run keygen:issue -- --tier pro --days 365
```

Output:

```
✓ License key issued
  id:       7b2f9c08aa1d04e2
  tier:     pro
  issued:   2026-06-08T03:00:00.000Z
  expires:  2027-06-08T03:00:00.000Z
  days:     365
  max:      1

Key (paste into the app):
INGE-eyJ2IjoxLC...lots...of...characters...
```

Send that `INGE-…` string to the customer. They paste it into the activation
screen on first run. The app:

1. Verifies the Ed25519 signature offline with the embedded public key.
2. Computes a hardware fingerprint and binds the activation to this device.
3. Stores everything encrypted via Electron `safeStorage` (OS keychain on macOS,
   DPAPI on Windows, libsecret on Linux).
4. Periodically updates a last-seen timestamp to detect clock rollback.

## Flags

| Flag | Default | Description |
|---|---|---|
| `--tier <name>` | `pro` | One of `pro`, `team`, `enterprise`, `trial`. The app surfaces this in the license panel; doesn't gate features automatically. |
| `--days <N>` | `365` | Days from now until expiry. |
| `--id <hex>` | random 16 hex chars | Vendor-assigned key id. Useful for tracking. |
| `--max <N>` | `1` | Stored in payload; app currently honors 1 activation per device. |
| `--features <a,b>` | empty | Comma-separated flag list embedded in the payload. |

## Key format

```
INGE-<base64url(payloadJSON)>.<base64url(Ed25519Signature)>
```

The payload is a small JSON object:

```json
{
  "v": 1,
  "id": "7b2f9c08aa1d04e2",
  "tier": "pro",
  "exp": 1780028400000,
  "iat": 1748492400000,
  "max": 1
}
```

Signature is Ed25519 over the raw payload bytes (the bytes before base64
encoding). The app's verification path mirrors this exactly.
