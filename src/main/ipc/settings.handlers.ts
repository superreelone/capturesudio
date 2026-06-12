import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import { PartialSettingsSchema } from '@shared/settings.schema';
import { getSettings, resetSettings, updateSettings } from '@main/services/settings.store';
import { reregisterHotkeys } from '@main/services/hotkey.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('settings-ipc');

export function registerSettingsHandlers(): void {
  ipcMain.handle(IpcChannel.SettingsGet, () => getSettings());

  ipcMain.handle(IpcChannel.SettingsUpdate, (_event, payload: unknown) => {
    const patch = PartialSettingsSchema.parse(payload);
    const next = updateSettings(patch);
    if (patch.hotkeys) {
      const { conflicts } = reregisterHotkeys();
      if (conflicts.length) log.warn('hotkey re-register had conflicts', { conflicts });
    }
    return next;
  });

  ipcMain.handle(IpcChannel.SettingsReset, () => {
    const next = resetSettings();
    reregisterHotkeys();
    return next;
  });
}
