export type UpdateStateValue =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error';

export interface UpdateState {
  value: UpdateStateValue;
  /** Available / Downloaded version. */
  version?: string;
  /** Optional release notes from the feed. */
  notes?: string;
  /** Download progress percent (0–100). */
  percent?: number;
  /** Download speed in bytes/second. */
  bytesPerSecond?: number;
  /** Total bytes of the download. */
  total?: number;
  /** Bytes transferred so far. */
  transferred?: number;
  /** Error message when value === 'error'. */
  message?: string;
}
