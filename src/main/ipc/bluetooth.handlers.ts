import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import { cancelPick, pickDevice } from '@main/services/bluetooth.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('bluetooth-ipc');

export function registerBluetoothHandlers(): void {
  ipcMain.handle(
    IpcChannel.BluetoothPickDevice,
    (_e, req: { deviceId: string }) => {
      pickDevice(req?.deviceId ?? '');
    }
  );
  ipcMain.handle(IpcChannel.BluetoothCancelPick, () => {
    cancelPick();
  });
  log.info('bluetooth handlers registered');
}
