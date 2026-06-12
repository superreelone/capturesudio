import { useCallback, useEffect, useRef, useState } from 'react';
import type { BluetoothPenStatus, DiscoveredBluetoothDevice } from '@shared/bluetooth.types';
import type { BluetoothPenActionT } from '@shared/settings.schema';

/**
 * Web Bluetooth-based pen integration.
 *
 *   - User clicks Connect → navigator.bluetooth.requestDevice()
 *   - Electron fires select-bluetooth-device on the BrowserWindow
 *   - Main sends the discovered device list to the renderer (DevicePicker shows it)
 *   - User picks one → main calls Chromium's callback with the chosen id
 *   - requestDevice() resolves with that device
 *   - We connect to GATT, try to read battery, and subscribe to ALL notify
 *     characteristics. Each notification is treated as one "button event".
 *   - Debounce events (most BLE buttons emit on press AND release).
 *   - Each event dispatches the configured action (toggleDrawing / undoStroke /
 *     clearStrokes).
 */

const BATTERY_SERVICE = 0x180f;
const BATTERY_LEVEL_CHAR = 0x2a19;

export interface UseBluetoothPenApi {
  status: BluetoothPenStatus;
  /** Discovered devices, sent from main during requestDevice. */
  discoveredDevices: DiscoveredBluetoothDevice[];
  /** Whether the device picker should be shown. */
  pickerOpen: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  pickDevice: (deviceId: string) => Promise<void>;
  cancelPick: () => Promise<void>;
}

interface Options {
  action: BluetoothPenActionT;
  debounceMs: number;
}

export function useBluetoothPen({ action, debounceMs }: Options): UseBluetoothPenApi {
  const [status, setStatus] = useState<BluetoothPenStatus>({
    connected: false,
    deviceName: null,
    batteryPct: null,
    error: null
  });
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredBluetoothDevice[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const deviceRef = useRef<BluetoothDevice | null>(null);
  const lastEventRef = useRef<number>(0);
  const actionRef = useRef(action);
  actionRef.current = action;
  const debounceRef = useRef(debounceMs);
  debounceRef.current = debounceMs;

  // Listen for the device list pushed from main while requestDevice is open.
  useEffect(() => {
    const off = window.api.events.onBluetoothDevicesDiscovered((devices) => {
      setDiscoveredDevices(devices);
      setPickerOpen(true);
    });
    return off;
  }, []);

  const dispatchAction = useCallback(async (): Promise<void> => {
    const now = performance.now();
    if (now - lastEventRef.current < debounceRef.current) return;
    lastEventRef.current = now;
    const a = actionRef.current;
    try {
      if (a === 'toggleDrawing') {
        const s = await window.api.drawing.state();
        if (s.open) await window.api.drawing.toggleMode();
        else await window.api.drawing.show({});
      } else if (a === 'undoStroke') {
        await window.api.drawing.undo();
      } else if (a === 'clearStrokes') {
        await window.api.drawing.clear();
      }
    } catch (err) {
      console.error('Bluetooth pen action failed:', err);
    }
  }, []);

  async function tryReadBattery(server: BluetoothRemoteGATTServer): Promise<void> {
    try {
      const svc = await server.getPrimaryService(BATTERY_SERVICE);
      const ch = await svc.getCharacteristic(BATTERY_LEVEL_CHAR);
      const value = await ch.readValue();
      const pct = value.getUint8(0);
      setStatus((s) => ({ ...s, batteryPct: pct }));
      try {
        await ch.startNotifications();
        ch.addEventListener('characteristicvaluechanged', () => {
          const v = ch.value;
          if (v) setStatus((s) => ({ ...s, batteryPct: v.getUint8(0) }));
        });
      } catch {
        // Some devices don't notify battery; one-shot read is fine.
      }
    } catch {
      // Device doesn't expose Battery Service. That's OK.
    }
  }

  async function subscribeButtonNotifications(
    server: BluetoothRemoteGATTServer
  ): Promise<number> {
    let count = 0;
    let services: BluetoothRemoteGATTService[];
    try {
      services = await server.getPrimaryServices();
    } catch (err) {
      throw new Error(`Could not enumerate services: ${String(err)}`);
    }
    for (const svc of services) {
      // Skip battery service for button events.
      try {
        if (typeof svc.uuid === 'string' && svc.uuid.includes('180f')) continue;
      } catch {
        // ignore
      }
      let chars: BluetoothRemoteGATTCharacteristic[];
      try {
        chars = await svc.getCharacteristics();
      } catch {
        continue;
      }
      for (const ch of chars) {
        if (ch.properties.notify || ch.properties.indicate) {
          try {
            await ch.startNotifications();
            ch.addEventListener('characteristicvaluechanged', () => {
              void dispatchAction();
            });
            count++;
          } catch {
            // some characteristics refuse notify even though property says they do
          }
        }
      }
    }
    return count;
  }

  const connect = useCallback(async (): Promise<void> => {
    if (!navigator.bluetooth) {
      setStatus({
        connected: false,
        deviceName: null,
        batteryPct: null,
        error: 'Web Bluetooth is not available in this build.'
      });
      return;
    }
    setStatus((s) => ({ ...s, error: null }));
    try {
      const dev = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [BATTERY_SERVICE]
      });
      setPickerOpen(false);
      setDiscoveredDevices([]);

      deviceRef.current = dev;
      dev.addEventListener('gattserverdisconnected', () => {
        setStatus((s) => ({
          ...s,
          connected: false,
          error: 'Pen disconnected (out of range or powered off).'
        }));
      });
      if (!dev.gatt) throw new Error('Device has no GATT server.');
      const server = await dev.gatt.connect();
      const subCount = await subscribeButtonNotifications(server);
      await tryReadBattery(server);

      setStatus({
        connected: true,
        deviceName: dev.name ?? '(unnamed device)',
        batteryPct: null,
        error:
          subCount === 0
            ? 'Connected, but this device exposes no notify characteristics — buttons may not work.'
            : null
      });
    } catch (err) {
      setPickerOpen(false);
      const msg = err instanceof Error ? err.message : String(err);
      // requestDevice rejects with NotFoundError when user cancels — treat as silent
      if (msg.includes('cancelled') || msg.toLowerCase().includes('user cancel')) {
        setStatus((s) => ({ ...s, error: null }));
        return;
      }
      setStatus({ connected: false, deviceName: null, batteryPct: null, error: msg });
    }
  }, []);

  const disconnect = useCallback(async (): Promise<void> => {
    const dev = deviceRef.current;
    if (dev?.gatt?.connected) {
      try {
        dev.gatt.disconnect();
      } catch {
        // ignore
      }
    }
    deviceRef.current = null;
    setStatus({ connected: false, deviceName: null, batteryPct: null, error: null });
  }, []);

  const pickDevice = useCallback(async (deviceId: string): Promise<void> => {
    setPickerOpen(false);
    await window.api.bluetooth.pickDevice(deviceId);
  }, []);

  const cancelPick = useCallback(async (): Promise<void> => {
    setPickerOpen(false);
    setDiscoveredDevices([]);
    await window.api.bluetooth.cancelPick();
  }, []);

  return {
    status,
    discoveredDevices,
    pickerOpen,
    connect,
    disconnect,
    pickDevice,
    cancelPick
  };
}
