import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fsp, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { IpcEvent } from '@shared/ipc-channels';
import type {
  ExportDoneEvent,
  ExportErrorEvent,
  ExportProgress,
  StartExportRequest,
  StartExportResponse
} from '@shared/export.types';
import { renderFilenameTemplate } from '@shared/filename-template';
import { getSettings } from '@main/services/settings.store';
import { nextCounter } from '@main/services/counter.store';
import { ensureDir } from '@main/util/paths';
import { createLogger } from '@main/util/logger';
import { resolveFfmpegPath } from './ffmpeg-path';
import { buildFfmpegArgs, containerExt } from './ffmpeg-args';

const log = createLogger('ffmpeg');
const STDERR_TAIL_LINES = 60;

interface Job {
  id: string;
  proc: ChildProcessWithoutNullStreams;
  outputPath: string;
  durationMs: number;
  startedAt: number;
  cancelled: boolean;
  stderrTail: string[];
  stdoutBuffer: string;
}

const jobs = new Map<string, Job>();
let mainWindowAccessor: () => BrowserWindow | null = () => null;

export function setExportWindowAccessor(fn: () => BrowserWindow | null): void {
  mainWindowAccessor = fn;
}

function send<T>(channel: string, payload: T): void {
  const win = mainWindowAccessor();
  if (!win || win.isDestroyed()) return;
  win.webContents.send(channel, payload);
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

async function computeOutputPath(req: StartExportRequest): Promise<string> {
  const settings = getSettings();
  ensureDir(settings.outputFolder);
  const counter = nextCounter('recording');
  const filename = renderFilenameTemplate(settings.filenameTemplate, {
    app: 'Ingestra-CaptureStudio',
    type: 'recording',
    source: req.sourceLabel,
    ext: containerExt(req.options.container),
    counter,
    date: new Date()
  });
  return ensureUniquePath(join(settings.outputFolder, filename));
}

function parseProgressLines(buffer: string): {
  consumed: number;
  fields: Record<string, string>;
  flush: boolean;
} {
  const fields: Record<string, string> = {};
  let consumed = 0;
  let flush = false;
  const lines = buffer.split('\n');
  // Keep the last incomplete line in the buffer.
  const completeCount = buffer.endsWith('\n') ? lines.length : lines.length - 1;
  for (let i = 0; i < completeCount; i++) {
    const line = lines[i]!;
    consumed += line.length + 1;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    fields[key] = value;
    if (key === 'progress') flush = true;
  }
  return { consumed, fields, flush };
}

function bytesToInt(s: string | undefined): number {
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function speedToNumber(s: string | undefined): number {
  if (!s) return 0;
  const m = /^([\d.]+)x?$/.exec(s.trim());
  return m ? Number(m[1]) : 0;
}

function bitrateToKbps(s: string | undefined): number {
  if (!s) return 0;
  const m = /^([\d.]+)kbits\/s$/.exec(s.trim());
  return m ? Number(m[1]) : 0;
}

export async function startExportJob(req: StartExportRequest): Promise<StartExportResponse> {
  const ffmpegPath = resolveFfmpegPath();
  const outputPath = await computeOutputPath(req);
  ensureDir(dirname(outputPath));

  const { args, copyMode } = buildFfmpegArgs(req.inputPath, outputPath, req.options);
  log.info('export starting', {
    inputPath: req.inputPath,
    outputPath,
    copyMode,
    durationMs: req.inputDurationMs
  });

  const proc = spawn(ffmpegPath, args, { windowsHide: true });
  const id = randomUUID();
  const job: Job = {
    id,
    proc,
    outputPath,
    durationMs: req.inputDurationMs,
    startedAt: Date.now(),
    cancelled: false,
    stderrTail: [],
    stdoutBuffer: ''
  };
  jobs.set(id, job);

  let lastEmittedPercent = -1;
  let lastFields: Record<string, string> = {};

  proc.stdout.setEncoding('utf-8');
  proc.stdout.on('data', (chunk: string) => {
    job.stdoutBuffer += chunk;
    const { consumed, fields, flush } = parseProgressLines(job.stdoutBuffer);
    if (consumed > 0) job.stdoutBuffer = job.stdoutBuffer.slice(consumed);
    if (Object.keys(fields).length > 0) lastFields = { ...lastFields, ...fields };

    if (!flush) return;

    const outTimeUs = bytesToInt(lastFields['out_time_us'] ?? lastFields['out_time_ms']);
    const currentMs = Math.max(0, Math.round(outTimeUs / 1000));
    const totalMs = job.durationMs > 0 ? job.durationMs : 0;
    const percent =
      totalMs > 0 ? Math.max(0, Math.min(1, currentMs / totalMs)) : 0;

    if (Math.abs(percent - lastEmittedPercent) >= 0.005 || percent === 1) {
      lastEmittedPercent = percent;
      const ev: ExportProgress = {
        jobId: id,
        percent,
        currentMs,
        fps: Number(lastFields['fps'] ?? 0) || 0,
        speed: speedToNumber(lastFields['speed']),
        bitrate: bitrateToKbps(lastFields['bitrate'])
      };
      send(IpcEvent.ExportProgress, ev);
    }
  });

  proc.stderr.setEncoding('utf-8');
  proc.stderr.on('data', (chunk: string) => {
    for (const line of chunk.split('\n')) {
      if (!line) continue;
      job.stderrTail.push(line);
      if (job.stderrTail.length > STDERR_TAIL_LINES) job.stderrTail.shift();
    }
  });

  proc.on('error', (err) => {
    jobs.delete(id);
    log.error('ffmpeg spawn error', { id, err: String(err) });
    const ev: ExportErrorEvent = {
      jobId: id,
      message: String(err),
      stderrTail: job.stderrTail.join('\n')
    };
    send(IpcEvent.ExportError, ev);
  });

  proc.on('close', (code, signal) => {
    jobs.delete(id);
    if (job.cancelled) {
      log.info('export cancelled', { id });
      void fsp.unlink(outputPath).catch(() => undefined);
      const ev: ExportErrorEvent = {
        jobId: id,
        message: 'cancelled',
        stderrTail: job.stderrTail.join('\n')
      };
      send(IpcEvent.ExportError, ev);
      return;
    }
    if (code === 0) {
      let sizeBytes = 0;
      try {
        sizeBytes = statSync(outputPath).size;
      } catch {
        // ignore
      }
      log.info('export done', { id, outputPath, sizeBytes });
      const ev: ExportDoneEvent = {
        jobId: id,
        outputPath,
        sizeBytes,
        durationMs: Date.now() - job.startedAt
      };
      // emit final 100% progress for UI smoothing
      send(IpcEvent.ExportProgress, {
        jobId: id,
        percent: 1,
        currentMs: job.durationMs,
        fps: 0,
        speed: 0,
        bitrate: 0
      } satisfies ExportProgress);
      send(IpcEvent.ExportDone, ev);
    } else {
      log.error('ffmpeg exited non-zero', {
        id,
        code,
        signal,
        tail: job.stderrTail.slice(-10).join(' | ')
      });
      const ev: ExportErrorEvent = {
        jobId: id,
        message: `ffmpeg exited with code ${code}${signal ? ` (signal ${signal})` : ''}`,
        stderrTail: job.stderrTail.join('\n')
      };
      send(IpcEvent.ExportError, ev);
    }
  });

  return { jobId: id, outputPath };
}

export function cancelExportJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.cancelled = true;
  try {
    // Try a graceful 'q' first, then kill if it lingers.
    job.proc.stdin.write('q\n', () => undefined);
  } catch {
    // ignore
  }
  setTimeout(() => {
    if (!job.proc.killed) {
      try {
        job.proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }, 500);
}

export function cancelAllJobs(): void {
  for (const id of jobs.keys()) cancelExportJob(id);
}
