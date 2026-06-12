import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { registerAllIpcHandlers } from './ipc/registry';
import { bootstrapOutputFolders } from './services/settings.store';
import { cleanupTempOnQuit } from './services/recording-session.service';
import {
  reregisterHotkeys,
  setMainWindowAccessor,
  unregisterAllHotkeys
} from './services/hotkey.service';
import {
  cancelAllJobs,
  setExportWindowAccessor
} from './services/ffmpeg.service';
import {
  destroyOverlayOnQuit,
  setDrawingMainWindowAccessor
} from './services/drawing.service';
import { setLicenseWindowAccessor } from './services/license.service';
import {
  attachBluetoothPicker,
  setBluetoothMainWindowAccessor
} from './services/bluetooth.service';
import {
  setUpdaterMainWindowAccessor,
  setupAutoUpdater
} from './services/updater.service';
import { installCrashHandlers } from './services/crash.service';
import { getSettings } from './services/settings.store';
import {
  registerLocalMediaProtocol,
  registerLocalMediaSchemeAsPrivileged
} from './services/protocol.service';
import { createLogger } from './util/logger';

registerLocalMediaSchemeAsPrivileged();

const log = createLogger('main');

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

const ICON_PATH = (): string => {
  // Dev: resources/ is at the project root; packaged: resources/ next to the asar.
  if (app.isPackaged) return join(process.resourcesPath, 'icon.png');
  return join(__dirname, '..', '..', 'resources', 'icon.png');
};

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    title: 'Ingestra-CaptureStudio',
    icon: ICON_PATH(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  attachBluetoothPicker(win);

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devUrl) {
    void win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

setMainWindowAccessor(() => mainWindow);
setExportWindowAccessor(() => mainWindow);
setDrawingMainWindowAccessor(() => mainWindow);
setLicenseWindowAccessor(() => mainWindow);
setBluetoothMainWindowAccessor(() => mainWindow);
setUpdaterMainWindowAccessor(() => mainWindow);

app.whenReady().then(() => {
  log.info('app ready', { platform: process.platform, version: app.getVersion() });
  bootstrapOutputFolders();
  // Settings are bootstrapped above; crash handlers respect the toggle.
  installCrashHandlers({ enableNativeReporter: getSettings().crashReporterEnabled });
  registerLocalMediaProtocol();
  registerAllIpcHandlers();
  mainWindow = createMainWindow();
  reregisterHotkeys();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  unregisterAllHotkeys();
});

app.on('before-quit', () => {
  cancelAllJobs();
  destroyOverlayOnQuit();
  void cleanupTempOnQuit();
});

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl && url.startsWith(devUrl)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
});
