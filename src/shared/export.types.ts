export type ExportContainer = 'mp4' | 'mkv' | 'mov' | 'webm' | 'gif';
export type ExportCodec = 'h264' | 'h265' | 'vp9';
export type ExportQuality = 'high' | 'balanced' | 'small';

export interface ResolutionDownscale {
  /** Target height in pixels (width auto). Set to null to keep original. */
  height: number | null;
}

export interface TrimRange {
  /** Start in milliseconds. */
  startMs: number;
  /** End in milliseconds (exclusive). */
  endMs: number;
}

export interface ExportOptions {
  container: ExportContainer;
  /** null for GIF (no separate codec choice). */
  codec: ExportCodec | null;
  quality: ExportQuality;
  scale: ResolutionDownscale;
  /** Frame rate for GIF (ignored otherwise). */
  gifFps?: number;
  trim?: TrimRange;
  /** Copy streams without re-encode when possible. */
  copyIfPossible: boolean;
  /** Include audio in output. */
  includeAudio: boolean;
}

export interface StartExportRequest {
  inputPath: string;
  inputDurationMs: number;
  /** Used to derive the output filename via the user's template. */
  sourceLabel: string;
  options: ExportOptions;
}

export interface StartExportResponse {
  jobId: string;
  /** The output path we'll write to. */
  outputPath: string;
}

export interface ExportProgress {
  jobId: string;
  /** 0..1 */
  percent: number;
  currentMs: number;
  fps: number;
  speed: number;
  bitrate: number;
}

export interface ExportDoneEvent {
  jobId: string;
  outputPath: string;
  sizeBytes: number;
  durationMs: number;
}

export interface ExportErrorEvent {
  jobId: string;
  message: string;
  stderrTail: string;
}

export interface CancelExportRequest {
  jobId: string;
}

/** Codec × container validity. */
export const CODEC_CONTAINER_MATRIX: Record<ExportContainer, ExportCodec[] | 'gif'> = {
  mp4: ['h264', 'h265'],
  mkv: ['h264', 'h265', 'vp9'],
  mov: ['h264', 'h265'],
  webm: ['vp9'],
  gif: 'gif'
};

export function isValidCodecContainer(codec: ExportCodec, container: ExportContainer): boolean {
  const allowed = CODEC_CONTAINER_MATRIX[container];
  if (allowed === 'gif') return false;
  return allowed.includes(codec);
}
