export type DrawingMode = 'draw' | 'pass';

export interface DrawingShowRequest {
  /** Display id to show overlay on. If omitted, uses the primary display. */
  displayId?: number;
  /** Initial mode (default 'draw'). */
  mode?: DrawingMode;
}

export interface DrawingState {
  open: boolean;
  mode: DrawingMode;
  displayId: number | null;
}
