import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type { CancelExportRequest, StartExportRequest } from '@shared/export.types';
import {
  cancelExportJob,
  startExportJob
} from '@main/services/ffmpeg.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('export-ipc');

export function registerExportHandlers(): void {
  ipcMain.handle(IpcChannel.ExportStart, async (_e, req: StartExportRequest) => {
    return startExportJob(req);
  });

  ipcMain.handle(IpcChannel.ExportCancel, (_e, req: CancelExportRequest) => {
    cancelExportJob(req.jobId);
  });

  log.info('export handlers registered');
}
