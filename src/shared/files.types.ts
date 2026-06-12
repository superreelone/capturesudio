export type FileKind = 'recording' | 'screenshot';

export interface RecentFile {
  path: string;
  filename: string;
  ext: string;
  sizeBytes: number;
  mtimeMs: number;
  kind: FileKind;
}

export interface ListRecentsRequest {
  /** Max number of files to return per folder. */
  limit?: number;
}

export interface ListRecentsResponse {
  files: RecentFile[];
  recordingFolder: string;
  screenshotFolder: string;
}

export interface DeleteFileRequest {
  path: string;
}

export interface DeleteFileResponse {
  trashed: boolean;
}

export interface SaveAsRequest {
  /** Suggested filename (with extension). */
  defaultName: string;
  /** Extension without a dot, e.g. 'pdf' or 'docx'. */
  ext: string;
  /** Human-readable name for the file-type filter, e.g. 'PDF Document'. */
  filterLabel: string;
  /** Base64-encoded bytes of the file to write. */
  contentBase64: string;
}

export interface SaveAsResponse {
  cancelled: boolean;
  path?: string;
  sizeBytes?: number;
}
