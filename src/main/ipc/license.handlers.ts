import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type { ActivateLicenseRequest } from '@shared/license.types';
import { activate, deactivate, getStatus } from '@main/services/license.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('license-ipc');

export function registerLicenseHandlers(): void {
  ipcMain.handle(IpcChannel.LicenseStatus, () => getStatus());
  ipcMain.handle(IpcChannel.LicenseActivate, (_e, req: ActivateLicenseRequest) =>
    activate(req?.keyString ?? '')
  );
  ipcMain.handle(IpcChannel.LicenseDeactivate, () => deactivate());
  log.info('license handlers registered');
}
