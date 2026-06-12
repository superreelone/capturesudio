import { BrowserWindow, globalShortcut } from 'electron';
import { IpcEvent } from '@shared/ipc-channels';
import { HotkeyActionSchema, type HotkeyAction } from '@shared/settings.schema';
import { getSettings } from '@main/services/settings.store';
import { createLogger } from '@main/util/logger';

const log = createLogger('hotkeys');

const ACTIONS = HotkeyActionSchema.options as readonly HotkeyAction[];

let registered: string[] = [];
let mainWindowAccessor: () => BrowserWindow | null = () => null;

export function setMainWindowAccessor(fn: () => BrowserWindow | null): void {
  mainWindowAccessor = fn;
}

function broadcastHotkey(action: HotkeyAction): void {
  const win = mainWindowAccessor();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IpcEvent.HotkeyTriggered, action);
}

export function reregisterHotkeys(): { conflicts: HotkeyAction[] } {
  for (const accel of registered) {
    try {
      globalShortcut.unregister(accel);
    } catch {
      // ignore
    }
  }
  registered = [];

  const hotkeys = getSettings().hotkeys;
  const conflicts: HotkeyAction[] = [];

  for (const action of ACTIONS) {
    const accel = hotkeys[action];
    if (!accel || accel.trim().length === 0) continue;
    try {
      const ok = globalShortcut.register(accel, () => broadcastHotkey(action));
      if (ok) {
        registered.push(accel);
      } else {
        conflicts.push(action);
        log.warn('hotkey conflict', { action, accelerator: accel });
      }
    } catch (err) {
      conflicts.push(action);
      log.error('hotkey register error', { action, accelerator: accel, err: String(err) });
    }
  }
  log.info('hotkeys registered', { count: registered.length, conflicts });
  return { conflicts };
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll();
  registered = [];
}
