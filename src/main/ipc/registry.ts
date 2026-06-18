import { registerAppHandlers } from './app.handlers';
import { registerSettingsHandlers } from './settings.handlers';
import { registerCaptureHandlers } from './capture.handlers';
import { registerRecordingHandlers } from './recording.handlers';
import { registerHotkeyHandlers } from './hotkey.handlers';
import { registerExportHandlers } from './export.handlers';
import { registerScreenshotHandlers } from './screenshot.handlers';
import { registerFilesHandlers } from './files.handlers';
import { registerDrawingHandlers } from './drawing.handlers';
import { registerLicenseHandlers } from './license.handlers';
import { registerBluetoothHandlers } from './bluetooth.handlers';
import { registerUpdaterHandlers } from './updater.handlers';
import { registerCaptionsHandlers } from './captions.handlers';
import { createLogger } from '@main/util/logger';

const log = createLogger('ipc');

export function registerAllIpcHandlers(): void {
  registerAppHandlers();
  registerSettingsHandlers();
  registerCaptureHandlers();
  registerRecordingHandlers();
  registerHotkeyHandlers();
  registerExportHandlers();
  registerScreenshotHandlers();
  registerFilesHandlers();
  registerDrawingHandlers();
  registerLicenseHandlers();
  registerBluetoothHandlers();
  registerUpdaterHandlers();
  registerCaptionsHandlers();
  log.info('all IPC handlers registered');
}
