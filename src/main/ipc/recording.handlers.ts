import { ipcMain, shell } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import type {
  AppendChunkRequest,
  CancelRecordingRequest,
  FinalizeRecordingRequest,
  StartRecordingRequest
} from '@shared/recording.types';
import {
  appendChunk,
  cancelSession,
  finalizeSession,
  startSession
} from '@main/services/recording-session.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('recording-ipc');

function asUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  throw new Error('appendChunk: expected ArrayBuffer or typed array');
}

export function registerRecordingHandlers(): void {
  ipcMain.handle(IpcChannel.RecordingStart, (_e, req: StartRecordingRequest) => startSession(req));

  ipcMain.handle(IpcChannel.RecordingAppendChunk, (_e, req: AppendChunkRequest) => {
    return appendChunk(req.sessionId, asUint8Array(req.data));
  });

  ipcMain.handle(IpcChannel.RecordingFinalize, (_e, req: FinalizeRecordingRequest) =>
    finalizeSession(req)
  );

  ipcMain.handle(IpcChannel.RecordingCancel, (_e, req: CancelRecordingRequest) =>
    cancelSession(req.sessionId)
  );

  ipcMain.handle(IpcChannel.RecordingReveal, (_e, { path }: { path: string }) => {
    shell.showItemInFolder(path);
  });

  log.info('recording handlers registered');
}
