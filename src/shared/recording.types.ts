export interface DisplayInfo {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  rotation: number;
}

export type CaptureSourceKind = 'screen' | 'window';

export interface CaptureSource {
  id: string;
  name: string;
  kind: CaptureSourceKind;
  displayId?: number;
  appIcon?: string;
  thumbnail: string;
}

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId: number;
}

export interface StartRecordingRequest {
  kind: 'screen' | 'window' | 'region';
  sourceId?: string;
  displayId?: number;
  region?: RegionRect;
  mimeType: string;
  ext: 'webm';
}

export interface StartRecordingResponse {
  sessionId: string;
  tempPath: string;
}

export interface AppendChunkRequest {
  sessionId: string;
  data: Uint8Array;
}

export interface FinalizeRecordingRequest {
  sessionId: string;
  durationMs: number;
  sourceLabel: string;
  sourceKind: 'screen' | 'window' | 'region';
}

export interface FinalizeRecordingResponse {
  finalPath: string;
  filename: string;
  sizeBytes: number;
  durationMs: number;
}

export interface CancelRecordingRequest {
  sessionId: string;
}
