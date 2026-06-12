import { useState } from 'react';
import type { LicenseStatus } from '@shared/license.types';

interface Props {
  status: LicenseStatus | null;
  onActivate: (keyString: string) => Promise<{ ok: boolean; error?: string }>;
  onDeactivate: () => Promise<void>;
}

function formatExpiry(ms: number | undefined): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function statusLabel(s: LicenseStatus): string {
  switch (s.status) {
    case 'active':
      return 'Active';
    case 'expired':
      return 'Expired';
    case 'tampered':
      return 'Re-activation required';
    case 'clock-warning':
      return 'Clock warning';
    case 'unconfigured':
      return 'Dev mode (unconfigured)';
    case 'none':
      return 'Not activated';
  }
}

function statusClass(s: LicenseStatus): string {
  switch (s.status) {
    case 'active':
      return 'lic-status lic-status--active';
    case 'clock-warning':
      return 'lic-status lic-status--warn';
    case 'unconfigured':
      return 'lic-status lic-status--info';
    case 'expired':
    case 'tampered':
      return 'lic-status lic-status--error';
    case 'none':
      return 'lic-status lic-status--info';
  }
}

export function LicenseSection({ status, onActivate, onDeactivate }: Props): JSX.Element {
  const [keyText, setKeyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  if (!status) return <p className="muted">Loading license…</p>;

  const showInputs =
    status.status === 'none' || status.status === 'expired' || status.status === 'tampered';
  const showDeactivate =
    status.status === 'active' ||
    status.status === 'expired' ||
    status.status === 'tampered' ||
    status.status === 'clock-warning';

  async function handleActivate(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const res = await onActivate(keyText);
      if (!res.ok) setError(res.error ?? 'Activation failed.');
      else setKeyText('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeactivate(): Promise<void> {
    await onDeactivate();
    setConfirming(false);
  }

  return (
    <div className="settings__col license">
      <div className={statusClass(status)}>
        <span>{statusLabel(status)}</span>
        {status.tier && <span className="lic-status__tier">{status.tier}</span>}
        {typeof status.daysRemaining === 'number' && status.status === 'active' && (
          <span className="lic-status__days">{status.daysRemaining} days remaining</span>
        )}
      </div>

      {status.message && <p className="muted small">{status.message}</p>}

      {(status.status === 'active' ||
        status.status === 'expired' ||
        status.status === 'clock-warning') && (
        <dl className="kv">
          <dt>Key id</dt>
          <dd>
            <code>{status.keyId ?? '—'}</code>
          </dd>
          <dt>Tier</dt>
          <dd>{status.tier ?? '—'}</dd>
          <dt>Activated for device</dt>
          <dd>
            <code>{status.deviceFingerprintShort ?? '—'}</code>
            {status.currentDeviceFingerprintShort &&
              status.deviceFingerprintShort !== status.currentDeviceFingerprintShort && (
                <span className="error small">
                  {' '}
                  · current device: <code>{status.currentDeviceFingerprintShort}</code>
                </span>
              )}
          </dd>
          <dt>Expires</dt>
          <dd>{formatExpiry(status.expiresAtMs)}</dd>
          <dt>Issued</dt>
          <dd>{formatExpiry(status.issuedAtMs)}</dd>
          {status.features && status.features.length > 0 && (
            <>
              <dt>Features</dt>
              <dd>
                <code>{status.features.join(', ')}</code>
              </dd>
            </>
          )}
        </dl>
      )}

      {showInputs && (
        <div className="field">
          <label>License key</label>
          <textarea
            className="text"
            rows={3}
            spellCheck={false}
            placeholder="INGE-…"
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            disabled={submitting}
          />
          {error && <p className="error small">{error}</p>}
          <div className="row">
            <button
              className="primary"
              onClick={() => void handleActivate()}
              disabled={submitting || keyText.trim().length === 0}
            >
              {submitting ? 'Activating…' : 'Activate'}
            </button>
          </div>
        </div>
      )}

      {showDeactivate && (
        <div className="row">
          {!confirming ? (
            <button className="ghost" onClick={() => setConfirming(true)}>
              Deactivate this device
            </button>
          ) : (
            <>
              <span className="muted small">
                This frees the key so you can use it on another device. Sure?
              </span>
              <button className="primary" onClick={() => void handleDeactivate()}>
                Yes, deactivate
              </button>
              <button className="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {status.status === 'unconfigured' && (
        <p className="muted small">
          The vendor public key isn&rsquo;t embedded yet. Run{' '}
          <code>npm run keygen:genkey</code> in the project root, then{' '}
          <code>npm run keygen:issue -- --tier pro --days 365</code> to issue your first key. While
          unconfigured, all features are unlocked for development.
        </p>
      )}
    </div>
  );
}
