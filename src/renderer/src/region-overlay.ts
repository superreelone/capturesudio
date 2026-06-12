interface VirtualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const overlay = window.regionOverlay;
if (!overlay) {
  console.error('regionOverlay api missing — overlay loaded in wrong context');
}

const virtualX = overlay?.virtualX ?? 0;
const virtualY = overlay?.virtualY ?? 0;
const displays = overlay?.displays ?? [];

const dimTop = document.getElementById('dim-top') as HTMLDivElement;
const dimBottom = document.getElementById('dim-bottom') as HTMLDivElement;
const dimLeft = document.getElementById('dim-left') as HTMLDivElement;
const dimRight = document.getElementById('dim-right') as HTMLDivElement;
const selection = document.getElementById('selection') as HTMLDivElement;
const readout = document.getElementById('readout') as HTMLDivElement;
const overlayToolbar = document.getElementById('toolbar') as HTMLDivElement;
const confirmBtn = document.getElementById('confirm') as HTMLButtonElement;
const cancelBtn = document.getElementById('cancel') as HTMLButtonElement;
const hud = document.getElementById('hud') as HTMLDivElement;

let startX = 0;
let startY = 0;
let endX = 0;
let endY = 0;
let dragging = false;
let hasSelection = false;

interface ClientRectXYWH {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectCoords(): ClientRectXYWH {
  return {
    x: Math.round(Math.min(startX, endX)),
    y: Math.round(Math.min(startY, endY)),
    w: Math.round(Math.abs(endX - startX)),
    h: Math.round(Math.abs(endY - startY))
  };
}

function findDisplayForVirtualPoint(
  vx: number,
  vy: number
): { label: string; isPrimary: boolean } | null {
  const hit = displays.find(
    (d) =>
      vx >= d.bounds.x &&
      vx < d.bounds.x + d.bounds.width &&
      vy >= d.bounds.y &&
      vy < d.bounds.y + d.bounds.height
  );
  return hit ? { label: hit.label, isPrimary: hit.isPrimary } : null;
}

function findBestDisplayForRect(rect: VirtualRect): {
  label: string;
  isPrimary: boolean;
  spansMultiple: boolean;
} | null {
  if (displays.length === 0) return null;
  let best = displays[0]!;
  let bestArea = -1;
  let touchedCount = 0;
  for (const d of displays) {
    const ix = Math.max(rect.x, d.bounds.x);
    const iy = Math.max(rect.y, d.bounds.y);
    const ax = Math.min(rect.x + rect.width, d.bounds.x + d.bounds.width);
    const ay = Math.min(rect.y + rect.height, d.bounds.y + d.bounds.height);
    const area = Math.max(0, ax - ix) * Math.max(0, ay - iy);
    if (area > 0) touchedCount++;
    if (area > bestArea) {
      bestArea = area;
      best = d;
    }
  }
  return { label: best.label, isPrimary: best.isPrimary, spansMultiple: touchedCount > 1 };
}

function paint(): void {
  const { x, y, w, h } = rectCoords();
  // Use the larger of innerWidth and document.documentElement.clientWidth
  // — on some Windows mixed-DPI setups, Electron reports innerWidth too small
  // until the window's bounds are finalized.
  const W = Math.max(
    window.innerWidth,
    document.documentElement.clientWidth,
    document.body.clientWidth
  );
  const H = Math.max(
    window.innerHeight,
    document.documentElement.clientHeight,
    document.body.clientHeight
  );

  selection.style.display = 'block';
  selection.style.left = `${x}px`;
  selection.style.top = `${y}px`;
  selection.style.width = `${w}px`;
  selection.style.height = `${h}px`;

  dimTop.style.cssText = `position:fixed; left:0; top:0; width:${W}px; height:${y}px; background:rgba(0,0,0,0.45); pointer-events:none;`;
  dimBottom.style.cssText = `position:fixed; left:0; top:${y + h}px; width:${W}px; height:${Math.max(0, H - (y + h))}px; background:rgba(0,0,0,0.45); pointer-events:none; display:block;`;
  dimLeft.style.cssText = `position:fixed; left:0; top:${y}px; width:${x}px; height:${h}px; background:rgba(0,0,0,0.45); pointer-events:none; display:block;`;
  dimRight.style.cssText = `position:fixed; left:${x + w}px; top:${y}px; width:${Math.max(0, W - (x + w))}px; height:${h}px; background:rgba(0,0,0,0.45); pointer-events:none; display:block;`;

  // Determine target display from rect's virtual coords.
  const virtRect: VirtualRect = {
    x: x + virtualX,
    y: y + virtualY,
    width: w,
    height: h
  };
  const target = findBestDisplayForRect(virtRect);

  readout.style.display = 'block';
  const sizeText = `${w} × ${h}`;
  const dispText = target ? ` · ${target.label}${target.isPrimary ? ' (primary)' : ''}` : '';
  const warnText = target?.spansMultiple ? ' · will clamp to this display' : '';
  readout.textContent = `${sizeText}${dispText}${warnText}`;
  const readoutLeft = Math.min(W - 320, x + w + 8);
  const readoutTop = Math.min(H - 28, y + h + 8);
  readout.style.left = `${readoutLeft}px`;
  readout.style.top = `${readoutTop}px`;
}

function showToolbar(): void {
  const { x, y, w, h } = rectCoords();
  const W = window.innerWidth;
  const H = window.innerHeight;
  overlayToolbar.style.display = 'flex';
  let left = x + w - 130;
  let top = y + h + 12;
  if (top + 36 > H) top = y - 40;
  if (left < 4) left = 4;
  if (left + 140 > W) left = W - 144;
  overlayToolbar.style.left = `${left}px`;
  overlayToolbar.style.top = `${top}px`;
}

function hideToolbar(): void {
  overlayToolbar.style.display = 'none';
}

function virtualRectFromSelection(): VirtualRect | null {
  const { x, y, w, h } = rectCoords();
  if (w < 4 || h < 4) return null;
  return {
    x: x + virtualX,
    y: y + virtualY,
    width: w,
    height: h
  };
}

function finish(submitNow: boolean): void {
  if (!overlay) return;
  overlay.submit(submitNow ? virtualRectFromSelection() : null);
}

// HUD live-updates as the cursor moves (even without dragging) to show which display
// we're hovering on.
function updateHud(clientX: number, clientY: number): void {
  if (dragging || !hud) return;
  const target = findDisplayForVirtualPoint(clientX + virtualX, clientY + virtualY);
  const dispLabel = target
    ? `${target.label}${target.isPrimary ? ' · primary' : ''}`
    : 'unknown display';
  hud.querySelector('.hud__current')?.replaceChildren(document.createTextNode(`Hovering: ${dispLabel}`));
}

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest('#toolbar')) return;
  hideToolbar();
  dragging = true;
  hasSelection = false;
  startX = e.clientX;
  startY = e.clientY;
  endX = e.clientX;
  endY = e.clientY;
  paint();
});

window.addEventListener('mousemove', (e) => {
  if (dragging) {
    endX = e.clientX;
    endY = e.clientY;
    if (e.shiftKey) {
      const w = endX - startX;
      const h = endY - startY;
      const side = Math.max(Math.abs(w), Math.abs(h));
      endX = startX + Math.sign(w || 1) * side;
      endY = startY + Math.sign(h || 1) * side;
    }
    paint();
  } else {
    updateHud(e.clientX, e.clientY);
  }
});

window.addEventListener('mouseup', (e) => {
  if (!dragging) return;
  dragging = false;
  endX = e.clientX;
  endY = e.clientY;
  paint();
  hasSelection = virtualRectFromSelection() !== null;
  // Auto-submit on release with a valid rect — no confirm step needed.
  if (hasSelection) {
    finish(true);
  }
});

window.addEventListener('dblclick', () => {
  if (hasSelection) finish(true);
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') finish(false);
  if (e.key === 'Enter') finish(hasSelection);
});

confirmBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (hasSelection) finish(true);
});
cancelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  finish(false);
});

// When main re-asserts the window bounds after creation (DPI fix),
// the viewport size changes — re-render dim panels to fit.
window.addEventListener('resize', () => {
  if (dragging || hasSelection) paint();
});

export {};
