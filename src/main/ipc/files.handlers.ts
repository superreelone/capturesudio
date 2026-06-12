import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  DeleteFileRequest,
  ListRecentsRequest,
  SaveAsRequest
} from '@shared/files.types';
import { deleteFile, listRecents, saveAs } from '@main/services/files.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('files-ipc');

export function registerFilesHandlers(): void {
  ipcMain.handle(IpcChannel.FilesListRecents, (_e, req: ListRecentsRequest) => listRecents(req));
  ipcMain.handle(IpcChannel.FilesDelete, (_e, req: DeleteFileRequest) => deleteFile(req.path));
  ipcMain.handle(IpcChannel.FilesSaveAs, (event, req: SaveAsRequest) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return saveAs(win, req);
  });
  log.info('files handlers registered');
}
