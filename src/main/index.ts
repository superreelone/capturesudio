import { app, BrowserWindow, shell } from 'electron';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
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

// Apply Chromium feature flags BEFORE app.whenReady fires. These flags fix
// common screen-capture freezes on Windows:
//
//   CalculateNativeWinOcclusion: when our main window gets fully covered by
//     the transparent drawing overlay, Chromium otherwise "optimises away"
//     occluded surfaces and the desktop-duplication pipeline stalls, leaving
//     the recording with only the first frame.
//
//   AllowWgc* / WebRtcAllowWgc*: the Windows.Graphics.Capture backend on
//     Windows 10/11 occasionally hangs with HRESULT 0x887A0026
//     ("keyed mutex abandoned"). Disabling it forces the older DXGI Desktop
//     Duplication path which is more reliable across driver versions.
//
// captureCompatibilityMode (default ON for new installs) controls whether the
// WGC disables are applied. Settings are read directly from settings.json
// because electron-store can't be loaded before app.whenReady.
function readCaptureCompatibilityModeSync(): boolean {
  try {
    const appData =
      process.platform === 'win32'
        ? process.env['APPDATA']
        : process.platform === 'darwin'
          ? join(process.env['HOME'] ?? '', 'Library', 'Application Support')
          : join(process.env['HOME'] ?? '', '.config');
    if (!appData) return false;
    const path = join(appData, 'Ingestra-CaptureStudio', 'settings.json');
    const json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    if (typeof json['captureCompatibilityMode'] === 'boolean') {
      return json['captureCompatibilityMode'];
    }
  } catch {
    // file missing or invalid — first launch; use default.
  }
  // Default OFF: WGC is the modern Windows screen-capture backend and works
  // on most setups. v0.1.1 shipped this defaulted ON (forcing DXGI fallback)
  // which regressed laptops where WGC was the only working backend. Users
  // hitting DXGI "keyed mutex abandoned" errors can opt in via
  // Settings → Capture → Capture compatibility mode.
  return false;
}

// Universally helpful: never throttle the renderer (capture stops emitting
// frames when the renderer is backgrounded by the OS) and never optimise
// occluded windows away (the transparent always-on-top drawing overlay would
// otherwise let Chromium mark the capture source as "hidden" and pause it).
app.commandLine.appendSwitch(
  'disable-features',
  [
    'CalculateNativeWinOcclusion',
    ...(process.platform === 'win32' && readCaptureCompatibilityModeSync()
      ? [
          // Different Chromium versions name the WGC backend differently; we
          // disable every spelling we've seen across Chromium 100-130 so the
          // capturer falls back to the older but more stable DXGI path.
          'AllowWgcCapturer',
          'AllowWgcDesktopCapturer',
          'AllowWgcScreenCapturer',
          'WebRtcAllowWgcCapturer',
          'WebRtcAllowWgcDesktopCapturer',
          'WebRtcAllowWgcScreenCapturer',
          'Win10WgcCapturer'
        ]
      : [])
  ].join(',')
);
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

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
      webSecurity: true,
      // CRITICAL for recording: when the user clicks into the app they're
      // recording, our window goes "background" and Chromium would otherwise
      // throttle/pause requestAnimationFrame + timers. The composite canvas
      // would freeze on its last frame and the MediaRecorder would emit a
      // frozen video. Setting this to false keeps the renderer running at
      // full speed no matter where focus is.
      backgroundThrottling: false
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
