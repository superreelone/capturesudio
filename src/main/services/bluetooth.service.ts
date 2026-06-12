import type { BrowserWindow } from 'electron';
import { IpcEvent } from '@shared/ipc-channels';
import type { DiscoveredBluetoothDevice } from '@shared/bluetooth.types';
import { createLogger } from '@main/util/logger';

const log = createLogger('bluetooth');

/**
 * The renderer initiates `navigator.bluetooth.requestDevice()`, Electron fires
 * 'select-bluetooth-device' with the discovered devices, and we relay them to
 * the renderer so a custom picker UI can display them. When the user picks one
 * (or cancels), the renderer calls back into us via IPC and we invoke the
 * Chromium callback.
 */
type SelectCallback = (deviceId: string) => void;

let pendingCallback: SelectCallback | null = null;
let mainWindowAccessor: () => BrowserWindow | null = () => null;

export function setBluetoothMainWindowAccessor(fn: () => BrowserWindow | null): void {
  mainWindowAccessor = fn;
}

export function attachBluetoothPicker(win: BrowserWindow): void {
  win.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    pendingCallback = callback;
    const devices: DiscoveredBluetoothDevice[] = deviceList.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName || '(no name)'
    }));
    log.info('bluetooth devices discovered', { count: devices.length });
    const w = mainWindowAccessor();
    if (w && !w.isDestroyed()) {
      w.webContents.send(IpcEvent.BluetoothDevicesDiscovered, devices);
    }
  });
}

export function pickDevice(deviceId: string): void {
  if (!pendingCallback) {
    log.warn('pickDevice called with no pending callback');
    return;
  }
  log.info('user picked bluetooth device', { deviceId });
  const cb = pendingCallback;
  pendingCallback = null;
  cb(deviceId);
}

export function cancelPick(): void {
  if (!pendingCallback) return;
  log.info('user cancelled bluetooth pick');
  const cb = pendingCallback;
  pendingCallback = null;
  cb(''); // empty string = cancel
}
