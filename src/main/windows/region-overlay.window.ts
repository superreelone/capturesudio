import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RegionRect } from '@shared/recording.types';
import { createLogger } from '@main/util/logger';

const log = createLogger('region-overlay');

const RESULT_CHANNEL = (id: string): string => `region-overlay:result:${id}`;

interface VirtualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

let activeOverlays: BrowserWindow[] = [];

function resolveDisplayByLargestOverlap(rect: VirtualRect): Electron.Display {
  const displays = screen.getAllDisplays();
  let best: Electron.Display = displays[0] ?? screen.getPrimaryDisplay();
  let bestArea = -1;
  for (const d of displays) {
    const ix = Math.max(rect.x, d.bounds.x);
    const iy = Math.max(rect.y, d.bounds.y);
    const ax = Math.min(rect.x + rect.width, d.bounds.x + d.bounds.width);
    const ay = Math.min(rect.y + rect.height, d.bounds.y + d.bounds.height);
    const area = Math.max(0, ax - ix) * Math.max(0, ay - iy);
    if (area > bestArea) {
      bestArea = area;
      best = d;
    }
  }
  return best;
}

/**
 * Open one transparent overlay window PER display. Each window covers its own
 * display only, so Windows-with-mixed-DPI behaves correctly (the previous
 * span-all-displays approach rendered as 0-alpha on multi-DPI setups).
 *
 * Any window's submission settles the promise and closes all overlays. The
 * cursor's display gets initial keyboard focus so Esc works without a click.
 */
export function openRegionOverlay(_unusedDisplay?: Electron.Display): Promise<RegionRect | null> {
  return new Promise((resolve) => {
    // Block concurrent opens (rapid double-clicks etc.).
    if (activeOverlays.some((w) => !w.isDestroyed())) {
      log.warn('region overlay already open; focusing first existing');
      const alive = activeOverlays.find((w) => !w.isDestroyed());
      if (alive) {
        try {
          alive.show();
          alive.focus();
        } catch {
          // ignore
        }
      }
      return resolve(null);
    }
    activeOverlays = [];

    const displays = screen.getAllDisplays();
    const requestId = randomUUID();
    const cursorPoint = screen.getCursorScreenPoint();
    const cursorDisplay = screen.getDisplayNearestPoint(cursorPoint);

    log.info('opening region overlay (per-display)', {
      cursorPoint,
      cursorDisplay: cursorDisplay.id,
      displays: displays.map((d) => ({ id: d.id, bounds: d.bounds, scale: d.scaleFactor }))
    });

    let settled = false;
    const settle = (rect: RegionRect | null): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(RESULT_CHANNEL(requestId), onResult);
      const toClose = activeOverlays.slice();
      activeOverlays = [];
      for (const w of toClose) {
        if (!w.isDestroyed()) {
          try {
            w.close();
          } catch {
            // ignore
          }
        }
      }
      resolve(rect);
    };

    function onResult(_event: Electron.IpcMainEvent, payload: VirtualRect | null): void {
      if (!payload) return settle(null);
      const display = resolveDisplayByLargestOverlap(payload);
      const localX = Math.max(0, Math.round(payload.x - display.bounds.x));
      const localY = Math.max(0, Math.round(payload.y - display.bounds.y));
      const localW = Math.max(1, Math.round(payload.width));
      const localH = Math.max(1, Math.round(payload.height));
      const clampedW = Math.min(localW, display.bounds.width - localX);
      const clampedH = Math.min(localH, display.bounds.height - localY);
      const converted: RegionRect = {
        x: localX,
        y: localY,
        width: clampedW,
        height: clampedH,
        displayId: display.id
      };
      log.info('region resolved', { virtual: payload, displayId: display.id, local: converted });
      settle(converted);
    }
    ipcMain.on(RESULT_CHANNEL(requestId), onResult);

    const displaysJson = encodeURIComponent(
      JSON.stringify(
        displays.map((d) => ({
          id: d.id,
          label: d.label,
          isPrimary: d.id === screen.getPrimaryDisplay().id,
          bounds: d.bounds
        }))
      )
    );

    for (const display of displays) {
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
        show: false,
        focusable: true,
        // Windows + mixed-DPI: secondary displays would otherwise have the
        // window shrunk to the primary's DIP space. Allow oversize creation
        // and force exact bounds after load.
        enableLargerThanScreen: true,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          additionalArguments: [
            `--region-overlay-request=${requestId}`,
            `--region-overlay-virtual-x=${x}`,
            `--region-overlay-virtual-y=${y}`,
            `--region-overlay-virtual-w=${width}`,
            `--region-overlay-virtual-h=${height}`,
            `--region-overlay-displays=${displaysJson}`
          ]
        }
      });

      win.setAlwaysOnTop(true, 'screen-saver');
      win.setIgnoreMouseEvents(false);
      activeOverlays.push(win);

      win.on('closed', () => {
        // If all overlays are closed without a settle, treat as cancel.
        const aliveCount = activeOverlays.filter((w) => !w.isDestroyed()).length;
        if (aliveCount === 0 && !settled) settle(null);
      });

      win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') {
          event.preventDefault();
          settle(null);
        }
      });

      const devUrl = process.env['ELECTRON_RENDERER_URL'];
      const overlayUrl = devUrl
        ? `${devUrl}/region-overlay.html`
        : `file://${join(__dirname, '../renderer/region-overlay.html')}`;

      const isCursorDisplay = display.id === cursorDisplay.id;

      win
        .loadURL(overlayUrl)
        .then(() => {
          if (win.isDestroyed()) return;
          // Force exact bounds AFTER load. This works around the Electron bug
          // where windows created off the primary display get DPI-scaled
          // from the primary's scale factor on first paint.
          // Belt-and-suspenders: setPosition + setSize + setBounds.
          try {
            win.setPosition(display.bounds.x, display.bounds.y);
            win.setSize(display.bounds.width, display.bounds.height);
            win.setBounds(
              {
                x: display.bounds.x,
                y: display.bounds.y,
                width: display.bounds.width,
                height: display.bounds.height
              },
              false
            );
          } catch (err) {
            log.warn('overlay setBounds failed', { displayId: display.id, err: String(err) });
          }
          if (isCursorDisplay) {
            win.show();
            win.focus();
          } else {
            win.showInactive();
          }
          // Re-assert bounds after show; on some Windows setups the show()
          // call snaps the window back to a different size.
          try {
            win.setBounds(
              {
                x: display.bounds.x,
                y: display.bounds.y,
                width: display.bounds.width,
                height: display.bounds.height
              },
              false
            );
          } catch {
            // ignore
          }
          log.info('overlay shown', {
            displayId: display.id,
            target: display.bounds,
            actual: win.getBounds(),
            content: win.getContentSize()
          });
        })
        .catch((err) => {
          log.error('region overlay load failed', {
            err: String(err),
            overlayUrl,
            displayId: display.id
          });
        });
    }
  });
}
