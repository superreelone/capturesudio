import { useState } from 'react';
import type { LicenseStatus } from '@shared/license.types';
import logoUrl from '../../assets/logo.png';

interface Props {
  status: LicenseStatus;
  onActivate: (keyString: string) => Promise<{ ok: boolean; error?: string }>;
  onSwitchToLibrary?: () => void;
}

export function ActivationScreen({ status, onActivate, onSwitchToLibrary }: Props): JSX.Element {
  const [keyText, setKeyText] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const headline =
    status.status === 'expired'
      ? 'License expired'
      : status.status === 'tampered'
        ? 'License needs re-activation'
        : 'Activate Ingestra-CaptureStudio';

  const subline =
    status.status === 'expired'
      ? 'Your license key has expired. Enter a renewal key to keep recording and exporting.'
      : status.status === 'tampered'
        ? status.message ?? 'The stored activation is no longer valid on this device.'
        : 'Paste your license key below. No login, no account — just the key.';

  async function handleSubmit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const res = await onActivate(keyText);
      if (!res.ok) setError(res.error ?? 'Activation failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="activation">
      <div className="activation__card">
        <div className="activation__brand">
          <div className="activation__logo">
            <img src={logoUrl} alt="Ingestra" />
          </div>
          <div className="activation__brand-text">
            <h1>
              Ingestra <span className="activation__brand-sub">CaptureStudio</span>
            </h1>
            <span className="app__badge">Activation</span>
          </div>
        </div>

        <h2>{headline}</h2>
        <p className="muted">{subline}</p>

        <label className="activation__label">License key</label>
        <textarea
          className="activation__input"
          placeholder="INGE-…"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={keyText}
          onChange={(e) => setKeyText(e.target.value)}
          disabled={submitting}
          rows={4}
        />

        {error && <p className="error">{error}</p>}

        <div className="activation__row">
          <button
            className="primary"
            onClick={() => void handleSubmit()}
            disabled={submitting || keyText.trim().length === 0}
          >
            {submitting ? 'Activating…' : 'Activate'}
          </button>
          {onSwitchToLibrary && (
            <button className="ghost" onClick={onSwitchToLibrary}>
              Open Library
            </button>
          )}
        </div>

        <details className="activation__details">
          <summary>What gets stored on this device</summary>
          <ul className="muted small">
            <li>The license key itself (encrypted via OS keychain).</li>
            <li>
              A SHA-256 fingerprint of the machine, so the key only works on this device. Move to a
              new laptop with the Deactivate action in Settings.
            </li>
            <li>The decoded expiry date and tier (for the status panel).</li>
            <li>
              A periodic last-seen timestamp, used to detect if the system clock is rolled back.
            </li>
          </ul>
          <p className="muted small">
            Verification is fully offline — no network call is made on activation or on any
            subsequent app launch.
          </p>
        </details>

        <p className="muted small">
          Device fingerprint:{' '}
          <code>{status.currentDeviceFingerprintShort ?? '—'}</code>
        </p>
      </div>
    </section>
  );
}
