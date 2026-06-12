import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import {
  reregisterHotkeys,
  unregisterAllHotkeys
} from '@main/services/hotkey.service';

export function registerHotkeyHandlers(): void {
  ipcMain.handle(IpcChannel.HotkeysRegister, () => reregisterHotkeys());
  ipcMain.handle(IpcChannel.HotkeysUnregister, () => {
    unregisterAllHotkeys();
  });
}
