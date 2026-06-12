import { promises as fsp, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { BrowserWindow, dialog, shell } from 'electron';
import type {
  DeleteFileResponse,
  ListRecentsRequest,
  ListRecentsResponse,
  RecentFile,
  SaveAsRequest,
  SaveAsResponse
} from '@shared/files.types';
import { getSettings } from './settings.store';
import { createLogger } from '@main/util/logger';

const log = createLogger('files');

const VIDEO_EXTS = new Set(['webm', 'mp4', 'mkv', 'mov', 'gif']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif']);

async function listFolder(folder: string, kindFor: (ext: string) => 'recording' | 'screenshot' | null): Promise<RecentFile[]> {
  try {
    const entries = await fsp.readdir(folder, { withFileTypes: true });
    const out: RecentFile[] = [];
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) return;
        const ext = extname(entry.name).toLowerCase().replace(/^\./, '');
        const kind = kindFor(ext);
        if (!kind) return;
        const fullPath = join(folder, entry.name);
        try {
          const stat = await fsp.stat(fullPath);
          out.push({
            path: fullPath,
            filename: entry.name,
            ext,
            sizeBytes: stat.size,
            mtimeMs: stat.mtimeMs,
            kind
          });
        } catch {
          // skip stat errors
        }
      })
    );
    return out;
  } catch (err) {
    log.warn('listFolder failed', { folder, err: String(err) });
    return [];
  }
}

export async function listRecents(req: ListRecentsRequest): Promise<ListRecentsResponse> {
  const settings = getSettings();
  const [recordings, screenshots] = await Promise.all([
    listFolder(settings.outputFolder, (ext) =>
      VIDEO_EXTS.has(ext) ? 'recording' : null
    ),
    listFolder(settings.screenshotFolder, (ext) =>
      IMAGE_EXTS.has(ext) ? 'screenshot' : null
    )
  ]);
  const all = [...recordings, ...screenshots].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const limit = req.limit ?? 200;
  return {
    files: all.slice(0, limit),
    recordingFolder: settings.outputFolder,
    screenshotFolder: settings.screenshotFolder
  };
}

export async function saveAs(
  parentWindow: BrowserWindow | null,
  req: SaveAsRequest
): Promise<SaveAsResponse> {
  const settings = getSettings();
  const result = await dialog.showSaveDialog(parentWindow ?? undefined!, {
    title: 'Save document',
    defaultPath: join(settings.outputFolder, req.defaultName),
    filters: [
      { name: req.filterLabel, extensions: [req.ext] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePath) return { cancelled: true };
  const bytes = Buffer.from(req.contentBase64, 'base64');
  await fsp.writeFile(result.filePath, bytes);
  const sizeBytes = statSync(result.filePath).size;
  log.info('document saved', { path: result.filePath, sizeBytes });
  return { cancelled: false, path: result.filePath, sizeBytes };
}

export async function deleteFile(path: string): Promise<DeleteFileResponse> {
  const settings = getSettings();
  // Only allow deletion within configured output folders.
  const ok =
    path.startsWith(settings.outputFolder) || path.startsWith(settings.screenshotFolder);
  if (!ok) {
    log.warn('delete denied (outside allowed roots)', { path });
    return { trashed: false };
  }
  try {
    await shell.trashItem(path);
    log.info('file trashed', { path });
    return { trashed: true };
  } catch (err) {
    log.error('trashItem failed', { path, err: String(err) });
    // Fallback to hard unlink
    try {
      await fsp.unlink(path);
      return { trashed: false };
    } catch {
      return { trashed: false };
    }
  }
}
