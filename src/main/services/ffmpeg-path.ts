import ffmpegStatic from 'ffmpeg-static';
import { app } from 'electron';
import { existsSync } from 'node:fs';

/**
 * Resolve the ffmpeg binary path. In packaged builds the binary is unpacked from
 * the asar archive into `app.asar.unpacked` via electron-builder config; we
 * rewrite the path to match.
 */
export function resolveFfmpegPath(): string {
  const raw = ffmpegStatic;
  if (!raw) throw new Error('ffmpeg-static did not provide a binary path');
  if (app.isPackaged) {
    const unpacked = raw.replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`);
    if (existsSync(unpacked)) return unpacked;
  }
  return raw;
}
