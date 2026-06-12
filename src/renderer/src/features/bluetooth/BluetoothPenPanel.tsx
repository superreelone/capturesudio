import type { Settings } from '@shared/settings.schema';
import type { BluetoothPenActionT } from '@shared/settings.schema';
import { useBluetoothPen } from './useBluetoothPen';
import { BluetoothDevicePicker } from './BluetoothDevicePicker';

interface Props {
  settings: Settings;
  onUpdate: (patch: Partial<Settings>) => Promise<void>;
}

const ACTION_OPTIONS: { value: BluetoothPenActionT; label: string; hint: string }[] = [
  {
    value: 'toggleDrawing',
    label: 'Toggle draw / pass mode',
    hint: 'Open the drawing overlay if closed, otherwise flip DRAW ↔ PASS — most useful for live recording.'
  },
  {
    value: 'undoStroke',
    label: 'Undo last stroke',
    hint: 'Pop the last stroke from the drawing overlay.'
  },
  {
    value: 'clearStrokes',
    label: 'Clear all strokes',
    hint: 'Wipe everything currently on the drawing overlay.'
  }
];

export function BluetoothPenPanel({ settings, onUpdate }: Props): JSX.Element {
  const pen = useBluetoothPen({
    action: settings.bluetoothPenAction,
    debounceMs: settings.bluetoothPenDebounceMs
  });

  return (
    <div className="settings__col ble">
      <div className="ble-status">
        <span className={`ble-status__dot ble-status__dot--${pen.status.connected ? 'on' : 'off'}`} />
        <strong>
          {pen.status.connected
            ? pen.status.deviceName ?? 'Connected'
            : 'Not connected'}
        </strong>
        {pen.status.batteryPct !== null && pen.status.connected && (
          <span className="ble-status__battery muted small">
            🔋 {pen.status.batteryPct}%
          </span>
        )}
      </div>

      {pen.status.error && <p className="error small">{pen.status.error}</p>}

      <div className="row">
        {!pen.status.connected ? (
          <button className="primary" onClick={() => void pen.connect()}>
            Connect Bluetooth pen…
          </button>
        ) : (
          <button onClick={() => void pen.disconnect()}>Disconnect</button>
        )}
      </div>

      <div className="preset-group">
        <label>On button press</label>
        <div className="seg">
          {ACTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`seg__btn${
                settings.bluetoothPenAction === opt.value ? ' seg__btn--on' : ''
              }`}
              onClick={() => void onUpdate({ bluetoothPenAction: opt.value })}
              title={opt.hint}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="preset-group">
        <label>Debounce ({settings.bluetoothPenDebounceMs}ms)</label>
        <input
          type="range"
          min={0}
          max={1000}
          step={50}
          value={settings.bluetoothPenDebounceMs}
          onChange={(e) =>
            void onUpdate({ bluetoothPenDebounceMs: Number(e.target.value) })
          }
        />
        <p className="muted small">
          Most BLE buttons fire on both press and release. A short debounce window collapses
          them into a single action. Raise if your pen double-fires; lower for snappier
          response.
        </p>
      </div>

      <details className="ble-notes">
        <summary>How this works</summary>
        <p className="muted small">
          Pens that pair as a Bluetooth mouse (HID) just work — their pointer and clicks are
          handled by your OS. This panel is for pens that expose <strong>GATT
          notifications</strong> for button presses (Adonit Note+, Logitech presenters,
          custom devices, etc.).
        </p>
        <p className="muted small">
          When connected, every notification received from any service is treated as a button
          event and triggers your chosen action. Pressure-sensitive drawing data is
          vendor-specific and not available through generic Web Bluetooth.
        </p>
      </details>

      {pen.pickerOpen && (
        <BluetoothDevicePicker
          devices={pen.discoveredDevices}
          onPick={(id) => void pen.pickDevice(id)}
          onCancel={() => void pen.cancelPick()}
        />
      )}
    </div>
  );
}
