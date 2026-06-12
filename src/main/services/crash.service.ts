import { app, crashReporter } from 'electron';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@main/util/logger';

const log = createLogger('crash');

let installed = false;

/**
 * Wire up uncaughtException + unhandledRejection handlers and (optionally)
 * Electron's crashReporter for native-process crashes (renderer / GPU / NaCl).
 * No external upload — dumps live in `userData/Crashpad/` and a parallel
 * `userData/crash.log` accumulates JSON-line records for uncaught JS errors.
 */
export function installCrashHandlers(opts: { enableNativeReporter: boolean }): void {
  if (installed) return;
  installed = true;

  if (opts.enableNativeReporter) {
    try {
      crashReporter.start({
        productName: 'Ingestra-CaptureStudio',
        companyName: 'Ingestra',
        // Empty submitURL + uploadToServer=false → dumps stay local in Crashpad/.
        submitURL: '',
        uploadToServer: false,
        ignoreSystemCrashHandler: false
      });
      log.info('native crash reporter started (local dumps only)');
    } catch (err) {
      log.warn('native crash reporter failed to start', { err: String(err) });
    }
  }

  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { message: err.message, stack: err.stack });
    void appendCrashRecord('uncaughtException', err);
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    log.error('unhandled rejection', { message: err.message, stack: err.stack });
    void appendCrashRecord('unhandledRejection', err);
  });
}

async function appendCrashRecord(kind: string, err: Error): Promise<void> {
  try {
    const path = join(app.getPath('userData'), 'crash.log');
    const record =
      JSON.stringify({
        ts: new Date().toISOString(),
        kind,
        version: app.getVersion(),
        platform: process.platform,
        message: err.message,
        stack: err.stack
      }) + '\n';
    await fsp.appendFile(path, record);
  } catch {
    // intentionally swallowed — never throw from a crash handler
  }
}
