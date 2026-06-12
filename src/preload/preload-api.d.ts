import type { IngestraApi } from './index';
import type { DrawingState } from '@shared/drawing.types';

interface VirtualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface OverlayDisplay {
  id: number;
  label: string;
  isPrimary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

interface RegionOverlayApi {
  requestId: string;
  virtualX: number;
  virtualY: number;
  virtualWidth: number;
  virtualHeight: number;
  displays: OverlayDisplay[];
  submit(rect: VirtualRect | null): void;
}

interface CountdownApi {
  requestId: string;
  seconds: number;
  done(): void;
}

interface DrawingOverlayApi {
  displayId: number;
  hide(): Promise<void>;
  toggleMode(): Promise<DrawingState>;
  cycleDisplay(): Promise<DrawingState>;
  onState(cb: (s: DrawingState) => void): () => void;
  onClear(cb: () => void): () => void;
  onUndo(cb: () => void): () => void;
  onSetTool(cb: (tool: string) => void): () => void;
  onSetRecording(
    cb: (payload: { recording: boolean; hideToolbar: boolean }) => void
  ): () => void;
}

declare global {
  interface Window {
    api: IngestraApi;
    regionOverlay?: RegionOverlayApi;
    countdown?: CountdownApi;
    drawingOverlay?: DrawingOverlayApi;
  }
}

export {};
