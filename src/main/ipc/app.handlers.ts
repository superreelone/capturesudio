import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type { AppVersionInfo, ChooseDirectoryRequest } from '@shared/ipc-types';

export function registerAppHandlers(): void {
  ipcMain.handle(IpcChannel.AppGetVersion, (): AppVersionInfo => {
    return {
      version: app.getVersion(),
      platform: process.platform,
      electron: process.versions.electron ?? 'unknown',
      chrome: process.versions.chrome ?? 'unknown',
      node: process.versions.node
    };
  });

  ipcMain.handle(IpcChannel.AppOpenPath, async (_e, { path }: { path: string }) => {
    await shell.openPath(path);
  });

  ipcMain.handle(
    IpcChannel.AppChooseDirectory,
    async (event, req: ChooseDirectoryRequest) => {
      const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const result = await dialog.showOpenDialog(parent!, {
        title: req.title ?? 'Choose folder',
        defaultPath: req.defaultPath,
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { cancelled: true };
      }
      return { cancelled: false, path: result.filePaths[0] };
    }
  );
}
