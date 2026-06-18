import { BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { IpcEvent } from '@shared/ipc-channels';
import type {
  CaptionsDoneEvent,
  CaptionsErrorEvent,
  CaptionsModel,
  CaptionsPhase,
  CaptionsProgressEvent,
  CaptionsTranscribeRequest
} from '@shared/captions.types';
import { resolveFfmpegPath } from './ffmpeg-path';
import {
  ensureModel,
  installedModels,
  isWhisperBinaryAvailable,
  runWhisper
} from './whisper.service';
import { getSettings } from './settings.store';
import { createLogger } from '@main/util/logger';

const log = createLogger('captions');

interface Job {
  jobId: string;
  videoPath: string;
  abort: AbortController;
  phase: CaptionsPhase;
  percent: number;
  startedAt: number;
}

const jobs = new Map<string, Job>();
let mainWindowAccessor: () => BrowserWindow | null = () => null;

export function setCaptionsMainWindowAccessor(fn: () => BrowserWindow | null): void {
  mainWindowAccessor = fn;
}

function emitProgress(
  job: Job,
  phase: CaptionsPhase,
  percent: number,
  message: string
): void {
  job.phase = phase;
  job.percent = percent;
  const win = mainWindowAccessor();
  if (!win || win.isDestroyed()) return;
  const ev: CaptionsProgressEvent = {
    jobId: job.jobId,
    videoPath: job.videoPath,
    phase,
    percent,
    message
  };
  win.webContents.send(IpcEvent.CaptionsProgress, ev);
}

function emitDone(job: Job, srtPath: string, captionedVideoPath: string | null): void {
  const win = mainWindowAccessor();
  if (!win || win.isDestroyed()) return;
  const ev: CaptionsDoneEvent = {
    jobId: job.jobId,
    videoPath: job.videoPath,
    srtPath,
    captionedVideoPath,
    durationMs: Date.now() - job.startedAt
  };
  win.webContents.send(IpcEvent.CaptionsDone, ev);
}

function emitError(job: Job, message: string): void {
  const win = mainWindowAccessor();
  if (!win || win.isDestroyed()) return;
  const ev: CaptionsErrorEvent = {
    jobId: job.jobId,
    videoPath: job.videoPath,
    message
  };
  win.webContents.send(IpcEvent.CaptionsError, ev);
}

/**
 * Extract the audio from `videoPath` to a 16-kHz mono WAV file that whisper
 * can consume directly. Whisper-cli also accepts other formats but expects
 * 16kHz mono internally — doing the conversion ourselves removes that hidden
 * cost from the transcription phase and makes progress estimation cleaner.
 */
function extractAudio(videoPath: string, wavPath: string, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = resolveFfmpegPath();
    const args = [
      '-y',
      '-i', videoPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-f', 'wav',
      wavPath
    ];
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `ffmpeg audio-extract exited with code ${code}. Tail: ${stderr.slice(-300)}`
            )
          )
    );
    signal.addEventListener('abort', () => proc.kill('SIGTERM'));
  });
}

/**
 * Burn `srtPath` into `videoPath` as hard-coded picture-side captions and
 * write the result to `outPath`. Uses libx264 + AAC, which Web players and
 * Quicktime both handle fine.
 *
 * The subtitles filter is fussy about Windows paths — colons and backslashes
 * both need escaping, and the whole expression has to be single-quoted at the
 * filter level. We construct the escape carefully.
 */
function burnInSubtitles(
  videoPath: string,
  srtPath: string,
  outPath: string,
  signal: AbortSignal,
  onProgress?: (pct: number) => void,
  totalMs?: number
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = resolveFfmpegPath();
    // Escape for ffmpeg's filter parser.
    const escapedSrt = srtPath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "'\\''");
    const vf = `subtitles='${escapedSrt}':force_style='Fontsize=18,OutlineColour=&H40000000,BorderStyle=3,Outline=1.5,Shadow=0,MarginV=20'`;
    const args = [
      '-y',
      '-i', videoPath,
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '21',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      outPath
    ];
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      // ffmpeg prints "time=HH:MM:SS.ms" repeatedly while encoding.
      const m = /time=(\d+):(\d{2}):(\d{2})\.(\d+)/.exec(s);
      if (m && totalMs && onProgress) {
        const ms =
          Number(m[1]) * 3600_000 +
          Number(m[2]) * 60_000 +
          Number(m[3]) * 1000 +
          Number(m[4]);
        onProgress(Math.min(0.99, ms / totalMs));
      }
    });
    proc.on('error', reject);
    proc.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`ffmpeg burn-in exited with code ${code}. Tail: ${stderr.slice(-300)}`)
          )
    );
    signal.addEventListener('abort', () => proc.kill('SIGTERM'));
  });
}

/** Resolve sidecar paths next to the source video. */
function sidecarPaths(videoPath: string): { wav: string; srtPrefix: string; srt: string; mp4: string } {
  const ext = extname(videoPath);
  const stem = videoPath.slice(0, videoPath.length - ext.length);
  return {
    wav: `${stem}.captions.wav`,
    srtPrefix: stem,
    srt: `${stem}.srt`,
    mp4: `${stem}.captioned.mp4`
  };
}

export interface StartTranscribeOptions extends CaptionsTranscribeRequest {
  /** Estimated video duration in ms; used for progress in the burn-in phase. */
  durationMs?: number;
}

/**
 * Kick off a transcription job. Returns the job id immediately; progress and
 * completion are reported via IPC events.
 */
export function startTranscribeJob(opts: StartTranscribeOptions): string {
  const settings = getSettings();
  const model: CaptionsModel = opts.model ?? settings.captionsModel;
  const language = opts.language ?? settings.captionsLanguage;
  const burnIn = opts.burnIn ?? settings.captionsBurnIn;

  if (!isWhisperBinaryAvailable()) {
    throw new Error(
      'Captions runtime (whisper-cli) is not bundled with this build. ' +
        'Update to a build that includes the whisper runtime.'
    );
  }
  if (!existsSync(opts.videoPath)) {
    throw new Error(`source video not found: ${opts.videoPath}`);
  }

  const job: Job = {
    jobId: randomUUID(),
    videoPath: opts.videoPath,
    abort: new AbortController(),
    phase: 'extracting-audio',
    percent: 0,
    startedAt: Date.now()
  };
  jobs.set(job.jobId, job);

  void (async () => {
    const paths = sidecarPaths(opts.videoPath);
    try {
      // 1. Ensure model is on disk (download if needed).
      emitProgress(job, 'downloading-model', 0, `Checking ${model} model…`);
      const modelPath = await ensureModel(model, {
        signal: job.abort.signal,
        onProgress: (pct) =>
          emitProgress(job, 'downloading-model', pct, `Downloading ${model} model… ${Math.round(pct * 100)}%`)
      });

      if (job.abort.signal.aborted) throw new Error('cancelled');

      // 2. Extract audio (16kHz mono WAV).
      emitProgress(job, 'extracting-audio', 0, 'Extracting audio…');
      await extractAudio(opts.videoPath, paths.wav, job.abort.signal);

      if (job.abort.signal.aborted) throw new Error('cancelled');

      // 3. Run whisper-cli → writes .srt directly.
      emitProgress(job, 'transcribing', 0, 'Transcribing audio…');
      await runWhisper({
        audioPath: paths.wav,
        modelPath,
        language,
        outputPrefix: paths.srtPrefix,
        signal: job.abort.signal,
        onProgress: (pct) =>
          emitProgress(job, 'transcribing', pct, `Transcribing audio… ${Math.round(pct * 100)}%`)
      });

      // Clean up the temporary WAV file.
      try {
        unlinkSync(paths.wav);
      } catch {
        // ignore
      }

      if (!existsSync(paths.srt)) {
        throw new Error('whisper-cli completed but did not produce an SRT file');
      }

      // 4. Optional burn-in to a separate MP4 (we never modify the original).
      let captionedVideoPath: string | null = null;
      if (burnIn) {
        emitProgress(job, 'burning-in', 0, 'Burning captions into MP4…');
        try {
          await burnInSubtitles(
            opts.videoPath,
            paths.srt,
            paths.mp4,
            job.abort.signal,
            (pct) =>
              emitProgress(job, 'burning-in', pct, `Burning captions… ${Math.round(pct * 100)}%`),
            opts.durationMs
          );
          captionedVideoPath = paths.mp4;
        } catch (err) {
          // Burn-in failure is non-fatal: we still have the SRT.
          log.warn('burn-in failed, keeping SRT only', { err: String(err) });
        }
      }

      emitProgress(job, 'done', 1, 'Captions ready');
      emitDone(job, paths.srt, captionedVideoPath);
      log.info('captions job done', {
        jobId: job.jobId,
        srtPath: paths.srt,
        captionedVideoPath,
        durationMs: Date.now() - job.startedAt
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (job.abort.signal.aborted || message === 'cancelled') {
        emitProgress(job, 'cancelled', job.percent, 'Captions cancelled');
      } else {
        emitProgress(job, 'error', job.percent, `Captions failed: ${message}`);
        emitError(job, message);
        log.error('captions job failed', { jobId: job.jobId, err: message });
      }
      // Clean up the temp WAV if we made it that far.
      try {
        if (existsSync(paths.wav)) unlinkSync(paths.wav);
      } catch {
        // ignore
      }
    } finally {
      jobs.delete(job.jobId);
    }
  })();

  return job.jobId;
}

export function cancelTranscribeJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.abort.abort();
}

export function getCaptionsStatus(): {
  runtimeReady: boolean;
  installedModels: CaptionsModel[];
  activeJobs: Array<{ jobId: string; videoPath: string; phase: CaptionsPhase; percent: number }>;
} {
  return {
    runtimeReady: isWhisperBinaryAvailable(),
    installedModels: installedModels(),
    activeJobs: [...jobs.values()].map((j) => ({
      jobId: j.jobId,
      videoPath: j.videoPath,
      phase: j.phase,
      percent: j.percent
    }))
  };
}
