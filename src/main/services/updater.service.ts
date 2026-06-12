import { app, type BrowserWindow } from 'electron';
import pkg from 'electron-updater';
import { IpcEvent } from '@shared/ipc-channels';
import type { UpdateState } from '@shared/updater.types';
import { createLogger } from '@main/util/logger';

// electron-updater is CJS — pull autoUpdater off the default export.
const { autoUpdater } = pkg;

const log = createLogger('updater');

let currentState: UpdateState = { value: 'idle' };
let mainWindowAccessor: () => BrowserWindow | null = () => null;
let wired = false;

export function setUpdaterMainWindowAccessor(fn: () => BrowserWindow | null): void {
  mainWindowAccessor = fn;
}

export function getUpdaterState(): UpdateState {
  return currentState;
}

function broadcast(state: UpdateState): void {
  currentState = state;
  const win = mainWindowAccessor();
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcEvent.UpdaterStateChanged, state);
  }
}

/** Wire up electron-updater events and (in packaged builds) kick off a check. */
export function setupAutoUpdater(): void {
  if (wired) return;
  wired = true;

  if (!app.isPackaged) {
    log.info('updater disabled in dev mode');
    broadcast({ value: 'idle' });
    return;
  }

  autoUpdater.autoDownload = false; // Let the user decide when to download.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: (m) => log.info(String(m)),
    warn: (m) => log.warn(String(m)),
    error: (m) => log.error(String(m)),
    debug: () => undefined
  };

  autoUpdater.on('checking-for-update', () => broadcast({ value: 'checking' }));

  autoUpdater.on('update-available', (info) => {
    broadcast({
      value: 'available',
      version: info.version,
      notes:
        typeof info.releaseNotes === 'string'
          ? info.releaseNotes
          : Array.isArray(info.releaseNotes)
            ? info.releaseNotes.map((n) => n.note ?? '').join('\n\n')
            : undefined
    });
  });

  autoUpdater.on('update-not-available', () => broadcast({ value: 'not-available' }));

  autoUpdater.on('download-progress', (progress) => {
    broadcast({
      value: 'downloading',
      percent: Math.round(progress.percent ?? 0),
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    broadcast({ value: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    log.error('updater error', { err: String(err) });
    broadcast({ value: 'error', message: String(err) });
  });

  // Check after a delay so the app finishes loading first.
  setTimeout(() => {
    autoUpdater
      .checkForUpdates()
      .catch((err) => log.warn('initial check failed', { err: String(err) }));
  }, 8000);
}

export async function checkForUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) return currentState;
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    log.warn('manual check failed', { err: String(err) });
    broadcast({ value: 'error', message: String(err) });
  }
  return currentState;
}

export async function downloadUpdate(): Promise<UpdateState> {
  if (!app.isPackaged) return currentState;
  if (currentState.value !== 'available') return currentState;
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    log.warn('download failed', { err: String(err) });
    broadcast({ value: 'error', message: String(err) });
  }
  return currentState;
}

export function installUpdate(): void {
  if (!app.isPackaged) return;
  if (currentState.value !== 'downloaded') return;
  log.info('quitAndInstall');
  // isSilent: false so user sees the installer UI; isForceRunAfter: true to relaunch.
  autoUpdater.quitAndInstall(false, true);
}
