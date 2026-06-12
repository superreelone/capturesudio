import type { RegionRect } from './recording.types';

export type ScreenshotSourceKind = 'fullscreen' | 'window' | 'region';

export type ScreenshotFormat = 'png' | 'jpg' | 'webp' | 'bmp' | 'tiff';

export interface CaptureScreenshotRequest {
  source: ScreenshotSourceKind;
  /** Required for fullscreen + region. */
  displayId?: number;
  /** Required for window. */
  sourceId?: string;
  /** Required for region. */
  region?: RegionRect;
  /** Optional pre-capture delay (ms). */
  delayMs?: number;
}

export interface CaptureScreenshotResponse {
  /** Base64-encoded PNG of the captured image. */
  pngBase64: string;
  width: number;
  height: number;
  /** Human-readable label used in the filename template. */
  sourceLabel: string;
}

export interface SaveScreenshotRequest {
  /** Image bytes encoded in the chosen output format. */
  encodedBase64: string;
  format: ScreenshotFormat;
  sourceLabel: string;
}

export interface SaveScreenshotResponse {
  path: string;
  filename: string;
  sizeBytes: number;
}

export interface ClipboardScreenshotRequest {
  /** PNG bytes — clipboard image format is universally PNG/BMP. */
  pngBase64: string;
}
