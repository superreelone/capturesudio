import { clipboard, desktopCapturer, nativeImage, screen } from 'electron';
import { promises as fsp, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  CaptureScreenshotRequest,
  CaptureScreenshotResponse,
  ScreenshotFormat,
  SaveScreenshotRequest,
  SaveScreenshotResponse
} from '@shared/screenshot.types';
import { renderFilenameTemplate } from '@shared/filename-template';
import { getSettings } from '@main/services/settings.store';
import { nextCounter } from '@main/services/counter.store';
import { ensureDir } from '@main/util/paths';
import { createLogger } from '@main/util/logger';

const log = createLogger('screenshot');

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function findDisplay(displayId: number | undefined): Electron.Display {
  if (displayId !== undefined) {
    const d = screen.getAllDisplays().find((x) => x.id === displayId);
    if (d) return d;
  }
  return screen.getPrimaryDisplay();
}

async function captureFullDisplay(displayId: number | undefined): Promise<{
  image: Electron.NativeImage;
  label: string;
}> {
  const display = findDisplay(displayId);
  const { width, height } = display.bounds;
  const scale = display.scaleFactor || 1;
  // desktopCapturer thumbnailSize is in physical pixels; pass the full physical size
  // so we don't downsample HiDPI displays.
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(width * scale),
      height: Math.round(height * scale)
    }
  });
  const match = sources.find((s) => {
    if (!s.display_id) return false;
    const num = Number(s.display_id);
    return Number.isFinite(num) && num === display.id;
  }) ?? sources[0];
  if (!match) throw new Error('No screen source available');
  return {
    image: match.thumbnail,
    label: match.name || `Display ${display.id}`
  };
}

async function captureWindow(sourceId: string): Promise<{
  image: Electron.NativeImage;
  label: string;
}> {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 3840, height: 2160 }
  });
  const match = sources.find((s) => s.id === sourceId);
  if (!match) throw new Error(`Window source not found: ${sourceId}`);
  return { image: match.thumbnail, label: match.name };
}

export async function captureScreenshot(
  req: CaptureScreenshotRequest
): Promise<CaptureScreenshotResponse> {
  if (req.delayMs && req.delayMs > 0) await delay(req.delayMs);

  let image: Electron.NativeImage;
  let label: string;

  switch (req.source) {
    case 'fullscreen': {
      const r = await captureFullDisplay(req.displayId);
      image = r.image;
      label = r.label;
      break;
    }
    case 'window': {
      if (!req.sourceId) throw new Error('window screenshot needs sourceId');
      const r = await captureWindow(req.sourceId);
      image = r.image;
      label = r.label;
      break;
    }
    case 'region': {
      if (!req.region) throw new Error('region screenshot needs region');
      const display = findDisplay(req.region.displayId);
      const scale = display.scaleFactor || 1;
      const r = await captureFullDisplay(req.region.displayId);
      image = r.image.crop({
        x: Math.round(req.region.x * scale),
        y: Math.round(req.region.y * scale),
        width: Math.max(1, Math.round(req.region.width * scale)),
        height: Math.max(1, Math.round(req.region.height * scale))
      });
      label = `region-${req.region.width}x${req.region.height}`;
      break;
    }
  }

  const size = image.getSize();
  const pngBuffer = image.toPNG();
  log.info('screenshot captured', {
    source: req.source,
    width: size.width,
    height: size.height,
    bytes: pngBuffer.byteLength
  });

  return {
    pngBase64: pngBuffer.toString('base64'),
    width: size.width,
    height: size.height,
    sourceLabel: label
  };
}

async function ensureUniquePath(path: string): Promise<string> {
  try {
    await fsp.access(path);
  } catch {
    return path;
  }
  const dot = path.lastIndexOf('.');
  const stem = dot >= 0 ? path.slice(0, dot) : path;
  const ext = dot >= 0 ? path.slice(dot) : '';
  for (let i = 1; i < 9999; i++) {
    const candidate = `${stem} (${i})${ext}`;
    try {
      await fsp.access(candidate);
    } catch {
      return candidate;
    }
  }
  return `${stem}-${Date.now()}${ext}`;
}

const FORMAT_EXT: Record<ScreenshotFormat, string> = {
  png: 'png',
  jpg: 'jpg',
  webp: 'webp',
  bmp: 'bmp',
  tiff: 'tiff'
};

export async function saveScreenshot(
  req: SaveScreenshotRequest
): Promise<SaveScreenshotResponse> {
  const settings = getSettings();
  ensureDir(settings.screenshotFolder);
  const counter = nextCounter('screenshot');
  const filename = renderFilenameTemplate(settings.filenameTemplate, {
    app: 'Ingestra-CaptureStudio',
    type: 'screenshot',
    source: req.sourceLabel,
    ext: FORMAT_EXT[req.format],
    counter,
    date: new Date()
  });
  const target = await ensureUniquePath(join(settings.screenshotFolder, filename));
  const bytes = Buffer.from(req.encodedBase64, 'base64');
  await fsp.writeFile(target, bytes);
  const sizeBytes = statSync(target).size;
  log.info('screenshot saved', { target, format: req.format, sizeBytes });
  return { path: target, filename: basename(target), sizeBytes };
}

export function clipboardWriteScreenshot(pngBase64: string): void {
  const img = nativeImage.createFromBuffer(Buffer.from(pngBase64, 'base64'));
  if (img.isEmpty()) throw new Error('clipboard write: empty image');
  clipboard.writeImage(img);
}
