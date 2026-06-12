import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@main/util/logger';

const log = createLogger('countdown');

const DONE_CHANNEL = (id: string) => `countdown:done:${id}`;

export function runCountdown(displayId: number, seconds: number): Promise<void> {
  const safeSeconds = Math.max(1, Math.min(10, Math.floor(seconds)));
  return new Promise((resolve) => {
    const display =
      screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
    const requestId = randomUUID();
    const { x, y, width, height } = display.bounds;

    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        additionalArguments: [
          `--countdown-request=${requestId}`,
          `--countdown-seconds=${safeSeconds}`
        ]
      }
    });

    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: false });

    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(DONE_CHANNEL(requestId), onDone);
      if (!win.isDestroyed()) win.close();
      resolve();
    };

    function onDone(): void {
      settle();
    }
    ipcMain.on(DONE_CHANNEL(requestId), onDone);

    win.on('closed', () => settle());

    const safetyTimeout = setTimeout(() => settle(), safeSeconds * 1000 + 2000);
    win.on('closed', () => clearTimeout(safetyTimeout));

    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    const overlayUrl = devUrl
      ? `${devUrl}/countdown.html`
      : `file://${join(__dirname, '../renderer/countdown.html')}`;

    win
      .loadURL(overlayUrl)
      .then(() => {
        win.showInactive();
      })
      .catch((err) => {
        log.error('countdown load failed', { err: String(err), overlayUrl });
        settle();
      });
  });
}
