/** Whisper model identifiers we support. `.en` variants are English-only
 *  and noticeably more accurate for English; the non-suffixed ones are
 *  multilingual. */
export type CaptionsModel =
  | 'tiny.en'
  | 'base.en'
  | 'small.en'
  | 'tiny'
  | 'base'
  | 'small';

export interface CaptionsTranscribeRequest {
  /** Absolute path to the source video (typically a .webm or .mp4). */
  videoPath: string;
  /** Whisper model to use; falls back to settings.captionsModel when omitted. */
  model?: CaptionsModel;
  /** Two-letter language code, or 'auto' for auto-detect. */
  language?: string;
  /** Also emit a second .mp4 with captions burned into the picture. */
  burnIn?: boolean;
}

export interface CaptionsTranscribeResponse {
  /** Job id; events for this transcription reference it. */
  jobId: string;
}

export type CaptionsPhase =
  | 'downloading-model'
  | 'extracting-audio'
  | 'transcribing'
  | 'writing-srt'
  | 'burning-in'
  | 'done'
  | 'cancelled'
  | 'error';

export interface CaptionsProgressEvent {
  jobId: string;
  videoPath: string;
  phase: CaptionsPhase;
  /** 0..1 within the current phase; -1 when we can't measure progress. */
  percent: number;
  /** Free-form one-line status the renderer can display verbatim. */
  message: string;
}

export interface CaptionsDoneEvent {
  jobId: string;
  videoPath: string;
  srtPath: string;
  /** Burned-in MP4 path when burnIn was requested AND it succeeded. */
  captionedVideoPath: string | null;
  durationMs: number;
}

export interface CaptionsErrorEvent {
  jobId: string;
  videoPath: string;
  message: string;
}

export interface CaptionsStatusResponse {
  /** Whether the whisper runtime (binary + at least one model) is ready. */
  runtimeReady: boolean;
  /** Models that have already been downloaded to disk. */
  installedModels: CaptionsModel[];
  /** Active transcription jobs. */
  activeJobs: Array<{
    jobId: string;
    videoPath: string;
    phase: CaptionsPhase;
    percent: number;
  }>;
}
