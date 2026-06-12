import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  CaptureScreenshotRequest,
  ClipboardScreenshotRequest,
  SaveScreenshotRequest
} from '@shared/screenshot.types';
import {
  captureScreenshot,
  clipboardWriteScreenshot,
  saveScreenshot
} from '@main/services/screenshot.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('screenshot-ipc');

export function registerScreenshotHandlers(): void {
  ipcMain.handle(IpcChannel.ScreenshotCapture, (_e, req: CaptureScreenshotRequest) =>
    captureScreenshot(req)
  );
  ipcMain.handle(IpcChannel.ScreenshotSave, (_e, req: SaveScreenshotRequest) =>
    saveScreenshot(req)
  );
  ipcMain.handle(IpcChannel.ScreenshotClipboard, (_e, req: ClipboardScreenshotRequest) => {
    clipboardWriteScreenshot(req.pngBase64);
  });
  log.info('screenshot handlers registered');
}
