import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import {
  checkForUpdate,
  downloadUpdate,
  getUpdaterState,
  installUpdate
} from '@main/services/updater.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('updater-ipc');

export function registerUpdaterHandlers(): void {
  ipcMain.handle(IpcChannel.UpdaterCheck, () => checkForUpdate());
  ipcMain.handle(IpcChannel.UpdaterDownload, () => downloadUpdate());
  ipcMain.handle(IpcChannel.UpdaterInstall, () => {
    installUpdate();
  });
  ipcMain.handle(IpcChannel.UpdaterState, () => getUpdaterState());
  log.info('updater handlers registered');
}
