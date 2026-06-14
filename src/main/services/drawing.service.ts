import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import { IpcEvent } from '@shared/ipc-channels';
import type { DrawingMode, DrawingState } from '@shared/drawing.types';
import { createLogger } from '@main/util/logger';

const log = createLogger('drawing');

let overlay: BrowserWindow | null = null;
let currentMode: DrawingMode = 'draw';
let currentDisplayId: number | null = null;
let mainWindowAccessor: () => BrowserWindow | null = () => null;

export function setDrawingMainWindowAccessor(fn: () => BrowserWindow | null): void {
  mainWindowAccessor = fn;
}

function broadcastState(): void {
  const state = getState();
  const main = mainWindowAccessor();
  if (main && !main.isDestroyed()) main.webContents.send(IpcEvent.DrawingStateChanged, state);
  if (overlay && !overlay.isDestroyed()) {
    overlay.webContents.send('drawing-overlay:state', state);
  }
}

/**
 * Whether we hid the main window because the overlay opened. We only restore
 * on close if we were the one who hid it (don't pop up a window the user
 * manually closed).
 */
let didHideMainForOverlay = false;

function hideMainForOverlay(): void {
  const main = mainWindowAccessor();
  if (!main || main.isDestroyed()) return;
  if (!main.isVisible()) return;
  main.hide();
  didHideMainForOverlay = true;
}

function restoreMainAfterOverlay(): void {
  if (!didHideMainForOverlay) return;
  const main = mainWindowAccessor();
  didHideMainForOverlay = false;
  if (!main || main.isDestroyed()) return;
  if (!main.isVisible()) main.show();
}

export function getState(): DrawingState {
  return {
    open: overlay !== null && !overlay.isDestroyed(),
    mode: currentMode,
    displayId: currentDisplayId
  };
}

function applyMouseEvents(win: BrowserWindow, mode: DrawingMode): void {
  if (mode === 'draw') {
    win.setIgnoreMouseEvents(false);
  } else {
    // Pass-through but still forward mousemove so the renderer can show hover hints.
    win.setIgnoreMouseEvents(true, { forward: true });
  }
}

export function showOverlay(displayId?: number, initialMode: DrawingMode = 'draw'): DrawingState {
  if (overlay && !overlay.isDestroyed()) {
    // Already open — move to requested display if different and re-show.
    if (displayId !== undefined && displayId !== currentDisplayId) {
      const display =
        screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay();
      overlay.setBounds(display.bounds);
      currentDisplayId = display.id;
    }
    currentMode = initialMode;
    applyMouseEvents(overlay, currentMode);
    overlay.showInactive();
    broadcastState();
    return getState();
  }

  const display =
    (displayId !== undefined
      ? screen.getAllDisplays().find((d) => d.id === displayId)
      : undefined) ?? screen.getPrimaryDisplay();
  currentDisplayId = display.id;
  currentMode = initialMode;
  const { x, y, width, height } = display.bounds;

  overlay = new BrowserWindow({
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
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--drawing-overlay-display=${display.id}`]
    }
  });

  // 'floating' sits above normal app windows but BELOW the Windows taskbar
  // and Start menu. We previously used 'screen-saver' which covered the
  // taskbar too, so the user couldn't get back to the minimised main window.
  overlay.setAlwaysOnTop(true, 'floating');
  applyMouseEvents(overlay, currentMode);

  // Hide the main window entirely while drawing is active. On a single-display
  // laptop the fullscreen transparent overlay would otherwise visually cover
  // it. The overlay's close ('closed' event below) brings it back.
  hideMainForOverlay();

  overlay.on('closed', () => {
    overlay = null;
    currentDisplayId = null;
    broadcastState();
    restoreMainAfterOverlay();
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const url = devUrl
    ? `${devUrl}/drawing-overlay.html`
    : `file://${join(__dirname, '../renderer/drawing-overlay.html')}`;

  overlay
    .loadURL(url)
    .then(() => {
      if (!overlay || overlay.isDestroyed()) return;
      overlay.showInactive();
      broadcastState();
    })
    .catch((err) => {
      log.error('drawing overlay load failed', { err: String(err), url });
      if (overlay && !overlay.isDestroyed()) overlay.close();
    });

  log.info('drawing overlay opened', { displayId: display.id, mode: currentMode });
  return getState();
}

export function hideOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.close();
  // 'closed' handler clears refs and broadcasts.
}

export function toggleMode(): DrawingState {
  if (!overlay || overlay.isDestroyed()) {
    // Nothing to toggle. Caller (e.g. hotkey) can decide to show instead.
    return getState();
  }
  currentMode = currentMode === 'draw' ? 'pass' : 'draw';
  applyMouseEvents(overlay, currentMode);
  broadcastState();
  log.info('drawing mode toggled', { mode: currentMode });
  return getState();
}

export function clearStrokes(): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send('drawing-overlay:clear');
}

export function undoStroke(): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send('drawing-overlay:undo');
}

export function setTool(tool: string): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send('drawing-overlay:setTool', tool);
}

/**
 * Tell the overlay what to render during a recording. `recording` is the
 * actual recorder state — when true we hide the bottom hint strip and the
 * crosshair cursor because neither is useful inside captured video.
 * `hideToolbar` is a separate user opt-in: when both `recording` and
 * `hideToolbar` are true we additionally hide the floating tool palette for
 * clean takes. Annotation strokes always remain visible.
 */
export function setRecording(recording: boolean, hideToolbar: boolean): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.webContents.send('drawing-overlay:setRecording', { recording, hideToolbar });
}

/**
 * Move the drawing overlay to the next connected display in round-robin
 * order. No-op if only one display is connected or the overlay isn't open.
 * Annotation strokes are CLEARED on move because pixel coordinates don't
 * translate between displays of different resolutions.
 */
export function cycleDisplay(): DrawingState {
  if (!overlay || overlay.isDestroyed()) return getState();
  const all = screen.getAllDisplays();
  if (all.length < 2) return getState();
  const idx = all.findIndex((d) => d.id === currentDisplayId);
  const next = all[(idx + 1) % all.length] ?? all[0]!;
  overlay.setBounds(next.bounds);
  currentDisplayId = next.id;
  // Tell the renderer to drop existing strokes — they were drawn in the old
  // display's coordinate space and would look wrong on the new size.
  overlay.webContents.send('drawing-overlay:clear');
  overlay.showInactive();
  broadcastState();
  log.info('drawing overlay moved to display', { displayId: next.id });
  return getState();
}

/** Move to a specific display by id. Same coordinate-clear semantics. */
export function moveToDisplay(displayId: number): DrawingState {
  if (!overlay || overlay.isDestroyed()) return getState();
  const all = screen.getAllDisplays();
  const target = all.find((d) => d.id === displayId);
  if (!target || target.id === currentDisplayId) return getState();
  overlay.setBounds(target.bounds);
  currentDisplayId = target.id;
  overlay.webContents.send('drawing-overlay:clear');
  overlay.showInactive();
  broadcastState();
  log.info('drawing overlay moved to display', { displayId: target.id });
  return getState();
}

/** List displays so the renderer can render a picker without enumerating itself. */
export function listDisplays(): Array<{
  id: number;
  label: string;
  isPrimary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}> {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `Display ${i + 1}${d.id === primary.id ? ' (primary)' : ''}`,
    isPrimary: d.id === primary.id,
    bounds: d.bounds
  }));
}

export function destroyOverlayOnQuit(): void {
  if (overlay && !overlay.isDestroyed()) {
    try {
      overlay.close();
    } catch {
      // ignore
    }
  }
  overlay = null;
}
