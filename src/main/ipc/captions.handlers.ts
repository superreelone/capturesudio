import { ipcMain } from 'electron';
import { IpcChannel } from '@shared/ipc-channels';
import {
  cancelTranscribeJob,
  getCaptionsStatus,
  startTranscribeJob
} from '@main/services/captions.service';
import { isWhisperBinaryAvailable } from '@main/services/whisper.service';
import { createLogger } from '@main/util/logger';

const log = createLogger('captions-ipc');

export function registerCaptionsHandlers(): void {
  ipcMain.handle(IpcChannel.CaptionsTranscribe, (_e, req) => {
    const jobId = startTranscribeJob(req);
    return { jobId };
  });
  ipcMain.handle(IpcChannel.CaptionsCancel, (_e, req: { jobId: string }) => {
    cancelTranscribeJob(req.jobId);
  });
  ipcMain.handle(IpcChannel.CaptionsStatus, () => getCaptionsStatus());
  ipcMain.handle(IpcChannel.CaptionsEnsureRuntime, () => {
    const ready = isWhisperBinaryAvailable();
    return {
      ready,
      message: ready
        ? 'Captions runtime is bundled with this build.'
        : 'Captions runtime (whisper-cli) is not bundled with this build. Reinstall a newer version of the app.'
    };
  });
  log.info('captions handlers registered');
}
