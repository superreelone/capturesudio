/**
 * Generic Bluetooth pen integration.
 *
 * Pens that pair as HID (Bluetooth-mouse) need no special handling — their
 * pointer and clicks already flow through the OS pointer. This module is for
 * pens that expose a custom GATT service whose notifications represent button
 * presses (Adonit Note+, Logitech Spotlight, custom devices, etc.).
 */

export interface DiscoveredBluetoothDevice {
  deviceId: string;
  deviceName: string;
}

export type BluetoothPenAction =
  /** Toggle the drawing overlay between DRAW and PASS modes. */
  | 'toggleDrawing'
  /** Pop the most recent stroke. */
  | 'undoStroke'
  /** Wipe all strokes. */
  | 'clearStrokes';

export interface BluetoothPenStatus {
  connected: boolean;
  deviceName: string | null;
  /** 0–100 if the device exposes the standard Battery Service; null otherwise. */
  batteryPct: number | null;
  /** Last error message, if any. */
  error: string | null;
}
