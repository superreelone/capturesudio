import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type { DrawingShowRequest } from '@shared/drawing.types';
import {
  clearStrokes,
  cycleDisplay,
  getState,
  hideOverlay,
  listDisplays,
  moveToDisplay,
  setRecording,
  setTool,
  showOverlay,
  toggleMode,
  undoStroke
} from '@main/services/drawing.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('drawing-ipc');

export function registerDrawingHandlers(): void {
  ipcMain.handle(IpcChannel.DrawingShow, (_e, req: DrawingShowRequest) =>
    showOverlay(req?.displayId, req?.mode)
  );
  ipcMain.handle(IpcChannel.DrawingHide, () => {
    hideOverlay();
  });
  ipcMain.handle(IpcChannel.DrawingToggleMode, () => toggleMode());
  ipcMain.handle(IpcChannel.DrawingClear, () => {
    clearStrokes();
  });
  ipcMain.handle(IpcChannel.DrawingUndo, () => {
    undoStroke();
  });
  ipcMain.handle(IpcChannel.DrawingSetTool, (_e, req: { tool: string }) => {
    setTool(req?.tool ?? 'pen');
  });
  ipcMain.handle(
    IpcChannel.DrawingSetRecording,
    (_e, req: { recording: boolean; hideToolbar?: boolean }) => {
      setRecording(Boolean(req?.recording), Boolean(req?.hideToolbar));
    }
  );
  ipcMain.handle(IpcChannel.DrawingCycleDisplay, () => cycleDisplay());
  ipcMain.handle(IpcChannel.DrawingMoveToDisplay, (_e, req: { displayId: number }) =>
    moveToDisplay(req.displayId)
  );
  ipcMain.handle(IpcChannel.DrawingListDisplays, () => listDisplays());
  ipcMain.handle(IpcChannel.DrawingState, () => getState());
  log.info('drawing handlers registered');
}
