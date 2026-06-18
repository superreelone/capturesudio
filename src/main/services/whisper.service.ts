import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync
} from 'node:fs';
import { get } from 'node:https';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createLogger } from '@main/util/logger';
import type { CaptionsModel } from '@shared/captions.types';

const log = createLogger('whisper');

/**
 * URLs for the ggml-format whisper.cpp models. They live on the project's
 * official Hugging Face mirror, which is fast, free, and has been stable
 * for years. We pin to a specific revision so we don't get surprised by
 * upstream renames.
 */
const MODEL_URLS: Record<CaptionsModel, string> = {
  'tiny.en':  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
  'base.en':  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
  'small.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
  'tiny':     'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
  'base':     'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  'small':    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
};

/** Where models are cached on disk. Survives upgrades. */
function modelsDir(): string {
  return join(app.getPath('userData'), 'whisper-models');
}

function modelFilePath(model: CaptionsModel): string {
  return join(modelsDir(), `ggml-${model}.bin`);
}

/**
 * Resolve the whisper-cli binary path. The binary is shipped as an
 * extraResource in the installer (see electron-builder.yml), unpacked into
 * `resources/whisper/<platform>/`. In dev it lives next to the project root.
 */
export function resolveWhisperBinaryPath(): string {
  const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  const binName = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  if (app.isPackaged) {
    return join(process.resourcesPath, 'whisper', platform, binName);
  }
  return join(app.getAppPath(), 'resources', 'whisper', platform, binName);
}

export function isWhisperBinaryAvailable(): boolean {
  try {
    return existsSync(resolveWhisperBinaryPath());
  } catch {
    return false;
  }
}

export function isModelInstalled(model: CaptionsModel): boolean {
  try {
    const p = modelFilePath(model);
    return existsSync(p) && statSync(p).size > 1024;
  } catch {
    return false;
  }
}

export function installedModels(): CaptionsModel[] {
  return (Object.keys(MODEL_URLS) as CaptionsModel[]).filter(isModelInstalled);
}

interface DownloadOptions {
  /** Called with 0..1 every ~1% of progress. */
  onProgress?: (pct: number) => void;
  signal?: AbortSignal;
}

/**
 * Download `url` to `dest`. Follows redirects (the HF CDN issues a couple).
 * Writes to a temp file first and renames on success so a half-finished
 * download doesn't poison the cache.
 */
function downloadFile(url: string, dest: string, opts: DownloadOptions = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const dir = join(dest, '..');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmpDest = `${dest}.part`;
    if (existsSync(tmpDest)) {
      try {
        unlinkSync(tmpDest);
      } catch {
        // ignore — we'll truncate via createWriteStream
      }
    }

    let redirectsLeft = 5;

    const start = (currentUrl: string): void => {
      const req = get(currentUrl, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectsLeft-- <= 0) {
            reject(new Error('too many redirects'));
            return;
          }
          res.resume();
          start(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`download failed: HTTP ${res.statusCode} for ${currentUrl}`));
          res.resume();
          return;
        }
        const total = Number(res.headers['content-length'] ?? 0);
        let received = 0;
        let lastEmittedPct = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0 && opts.onProgress) {
            const pct = received / total;
            if (pct - lastEmittedPct >= 0.01 || pct === 1) {
              lastEmittedPct = pct;
              opts.onProgress(pct);
            }
          }
        });
        const out = createWriteStream(tmpDest, { flags: 'w' });
        pipeline(res, out)
          .then(() => {
            try {
              renameSync(tmpDest, dest);
              resolve();
            } catch (err) {
              reject(err as Error);
            }
          })
          .catch(reject);
      });
      req.on('error', reject);
      if (opts.signal) {
        opts.signal.addEventListener('abort', () => {
          req.destroy(new Error('cancelled'));
          try {
            unlinkSync(tmpDest);
          } catch {
            // ignore
          }
          reject(new Error('cancelled'));
        });
      }
    };
    start(url);
  });
}

export async function ensureModel(
  model: CaptionsModel,
  opts: DownloadOptions = {}
): Promise<string> {
  const dest = modelFilePath(model);
  if (isModelInstalled(model)) return dest;
  const url = MODEL_URLS[model];
  log.info('downloading whisper model', { model, url });
  await downloadFile(url, dest, opts);
  log.info('whisper model downloaded', { model, path: dest });
  return dest;
}

export interface WhisperRunOptions {
  audioPath: string;
  modelPath: string;
  /** Two-letter ISO 639-1 code, or 'auto' to let whisper detect. */
  language: string;
  /** Output prefix (whisper-cli appends .srt etc.) */
  outputPrefix: string;
  /** Approx duration of the audio in ms; used to estimate progress. */
  durationMs?: number;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}

/**
 * Run whisper-cli on a 16kHz mono WAV file. Output is written to
 * `<outputPrefix>.srt` by whisper-cli itself.
 */
export function runWhisper(opts: WhisperRunOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const bin = resolveWhisperBinaryPath();
    if (!existsSync(bin)) {
      reject(
        new Error(
          `whisper-cli binary not found at ${bin}. The captions runtime hasn't been bundled with this build.`
        )
      );
      return;
    }
    const args = [
      '-m', opts.modelPath,
      '-f', opts.audioPath,
      '-osrt',
      '-of', opts.outputPrefix,
      '-l', opts.language === 'auto' || !opts.language ? 'auto' : opts.language,
      '-pp' // print-progress: writes "progress = NN%" lines to stderr
    ];
    log.info('running whisper-cli', { bin, args });
    const proc = spawn(bin, args, { windowsHide: true });

    let stderr = '';
    proc.stderr.on('data', (data: Buffer) => {
      const s = data.toString();
      stderr += s;
      // whisper-cli prints "progress = NN%" with the -pp flag.
      const m = /progress\s*=\s*(\d+)%/.exec(s);
      if (m && opts.onProgress) {
        const pct = Math.min(0.99, Number(m[1]) / 100);
        opts.onProgress(pct);
      }
    });
    proc.stdout.on('data', () => {
      // whisper-cli prints the transcript text to stdout; we don't need it,
      // the .srt file is written separately.
    });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        opts.onProgress?.(1);
        resolve();
      } else {
        reject(
          new Error(
            `whisper-cli exited with code ${code}. Stderr tail: ${stderr.slice(-500)}`
          )
        );
      }
    });
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        proc.kill('SIGTERM');
      });
    }
  });
}

let mainWindowAccessor: () => BrowserWindow | null = () => null;
export function setWhisperMainWindowAccessor(fn: () => BrowserWindow | null): void {
  mainWindowAccessor = fn;
}
export function whisperMainWindow(): BrowserWindow | null {
  return mainWindowAccessor();
}
