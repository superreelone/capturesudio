import type { DiscoveredBluetoothDevice } from '@shared/bluetooth.types';

interface Props {
  devices: DiscoveredBluetoothDevice[];
  onPick: (deviceId: string) => void;
  onCancel: () => void;
}

export function BluetoothDevicePicker({ devices, onPick, onCancel }: Props): JSX.Element {
  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={onCancel} />
      <div className="modal__panel">
        <header className="modal__head">
          <h2>Pair a Bluetooth pen</h2>
          <button className="ghost" onClick={onCancel}>
            ✕
          </button>
        </header>
        <div className="modal__body">
          {devices.length === 0 ? (
            <p className="muted small">
              Scanning… make sure your pen is powered on and in pairing mode. Devices appear
              here as they're discovered.
            </p>
          ) : (
            <>
              <p className="muted small">
                {devices.length} device{devices.length === 1 ? '' : 's'} found · select one
                to pair.
              </p>
              <div className="ble-list">
                {devices.map((d) => (
                  <button
                    key={d.deviceId}
                    className="ble-list__item"
                    onClick={() => onPick(d.deviceId)}
                    title={d.deviceId}
                  >
                    <span className="ble-list__name">{d.deviceName}</span>
                    <span className="ble-list__id muted small">
                      {d.deviceId.slice(0, 8)}…
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <footer className="modal__foot">
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
