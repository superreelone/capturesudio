import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export function getDefaultMediaPaths(): { videos: string; pictures: string } {
  const videos = join(app.getPath('videos'), 'Ingestra-CaptureStudio');
  const pictures = join(app.getPath('pictures'), 'Ingestra-CaptureStudio');
  return { videos, pictures };
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function getTempRecordingDir(): string {
  const dir = join(app.getPath('userData'), 'temp-recordings');
  ensureDir(dir);
  return dir;
}
