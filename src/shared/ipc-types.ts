import type { HotkeyAction, Settings, PartialSettings } from './settings.schema';
import type { IpcChannel } from './ipc-channels';
import type {
  AppendChunkRequest,
  CancelRecordingRequest,
  CaptureSource,
  CaptureSourceKind,
  DisplayInfo,
  FinalizeRecordingRequest,
  FinalizeRecordingResponse,
  RegionRect,
  StartRecordingRequest,
  StartRecordingResponse
} from './recording.types';
import type {
  CancelExportRequest,
  StartExportRequest,
  StartExportResponse
} from './export.types';
import type {
  CaptureScreenshotRequest,
  CaptureScreenshotResponse,
  ClipboardScreenshotRequest,
  SaveScreenshotRequest,
  SaveScreenshotResponse
} from './screenshot.types';
import type {
  DeleteFileRequest,
  DeleteFileResponse,
  ListRecentsRequest,
  ListRecentsResponse,
  SaveAsRequest,
  SaveAsResponse
} from './files.types';
import type { DrawingShowRequest, DrawingState } from './drawing.types';
import type { DiscoveredBluetoothDevice } from './bluetooth.types';
import type { UpdateState } from './updater.types';
import type {
  ActivateLicenseRequest,
  ActivateLicenseResponse,
  DeactivateLicenseResponse,
  LicenseStatus
} from './license.types';

export interface AppVersionInfo {
  version: string;
  platform: NodeJS.Platform;
  electron: string;
  chrome: string;
  node: string;
}

export interface ChooseDirectoryRequest {
  title?: string;
  defaultPath?: string;
}

export interface ChooseDirectoryResponse {
  cancelled: boolean;
  path?: string;
}

export interface ListSourcesRequest {
  kinds: CaptureSourceKind[];
  thumbnailSize?: { width: number; height: number };
}

export interface OpenRegionOverlayRequest {
  displayId?: number;
  initialRect?: RegionRect;
}

export interface RunCountdownRequest {
  displayId: number;
  seconds: number;
}

export interface HotkeyRegisterResponse {
  conflicts: HotkeyAction[];
}

export interface IpcContract {
  [IpcChannel.AppGetVersion]: { request: void; response: AppVersionInfo };
  [IpcChannel.AppOpenPath]: { request: { path: string }; response: void };
  [IpcChannel.AppChooseDirectory]: {
    request: ChooseDirectoryRequest;
    response: ChooseDirectoryResponse;
  };

  [IpcChannel.SettingsGet]: { request: void; response: Settings };
  [IpcChannel.SettingsUpdate]: { request: PartialSettings; response: Settings };
  [IpcChannel.SettingsReset]: { request: void; response: Settings };

  [IpcChannel.CaptureListDisplays]: { request: void; response: DisplayInfo[] };
  [IpcChannel.CaptureListSources]: { request: ListSourcesRequest; response: CaptureSource[] };
  [IpcChannel.CaptureOpenRegionOverlay]: {
    request: OpenRegionOverlayRequest;
    response: RegionRect | null;
  };
  [IpcChannel.CaptureRunCountdown]: { request: RunCountdownRequest; response: void };

  [IpcChannel.RecordingStart]: { request: StartRecordingRequest; response: StartRecordingResponse };
  [IpcChannel.RecordingAppendChunk]: { request: AppendChunkRequest; response: void };
  [IpcChannel.RecordingFinalize]: {
    request: FinalizeRecordingRequest;
    response: FinalizeRecordingResponse;
  };
  [IpcChannel.RecordingCancel]: { request: CancelRecordingRequest; response: void };
  [IpcChannel.RecordingReveal]: { request: { path: string }; response: void };

  [IpcChannel.HotkeysRegister]: { request: void; response: HotkeyRegisterResponse };
  [IpcChannel.HotkeysUnregister]: { request: void; response: void };

  [IpcChannel.ExportStart]: { request: StartExportRequest; response: StartExportResponse };
  [IpcChannel.ExportCancel]: { request: CancelExportRequest; response: void };

  [IpcChannel.ScreenshotCapture]: {
    request: CaptureScreenshotRequest;
    response: CaptureScreenshotResponse;
  };
  [IpcChannel.ScreenshotSave]: {
    request: SaveScreenshotRequest;
    response: SaveScreenshotResponse;
  };
  [IpcChannel.ScreenshotClipboard]: { request: ClipboardScreenshotRequest; response: void };

  [IpcChannel.FilesListRecents]: { request: ListRecentsRequest; response: ListRecentsResponse };
  [IpcChannel.FilesDelete]: { request: DeleteFileRequest; response: DeleteFileResponse };
  [IpcChannel.FilesSaveAs]: { request: SaveAsRequest; response: SaveAsResponse };

  [IpcChannel.DrawingShow]: { request: DrawingShowRequest; response: DrawingState };
  [IpcChannel.DrawingHide]: { request: void; response: void };
  [IpcChannel.DrawingToggleMode]: { request: void; response: DrawingState };
  [IpcChannel.DrawingClear]: { request: void; response: void };
  [IpcChannel.DrawingState]: { request: void; response: DrawingState };
  [IpcChannel.DrawingSetTool]: {
    request: { tool: 'pen' | 'arrow' | 'line' | 'rect' | 'highlight' | 'ellipse' | 'eraser' };
    response: void;
  };
  [IpcChannel.DrawingSetRecording]: {
    request: { recording: boolean; hideToolbar: boolean };
    response: void;
  };
  [IpcChannel.DrawingCycleDisplay]: { request: void; response: DrawingState };
  [IpcChannel.DrawingMoveToDisplay]: {
    request: { displayId: number };
    response: DrawingState;
  };
  [IpcChannel.DrawingListDisplays]: {
    request: void;
    response: Array<{
      id: number;
      label: string;
      isPrimary: boolean;
      bounds: { x: number; y: number; width: number; height: number };
    }>;
  };
  [IpcChannel.DrawingSetIgnoreMouseEvents]: {
    request: { ignore: boolean };
    response: void;
  };

  [IpcChannel.LicenseStatus]: { request: void; response: LicenseStatus };
  [IpcChannel.LicenseActivate]: {
    request: ActivateLicenseRequest;
    response: ActivateLicenseResponse;
  };
  [IpcChannel.LicenseDeactivate]: { request: void; response: DeactivateLicenseResponse };

  [IpcChannel.DrawingUndo]: { request: void; response: void };

  [IpcChannel.BluetoothPickDevice]: { request: { deviceId: string }; response: void };
  [IpcChannel.BluetoothCancelPick]: { request: void; response: void };

  [IpcChannel.UpdaterCheck]: { request: void; response: UpdateState };
  [IpcChannel.UpdaterDownload]: { request: void; response: UpdateState };
  [IpcChannel.UpdaterInstall]: { request: void; response: void };
  [IpcChannel.UpdaterState]: { request: void; response: UpdateState };
}

export type { DiscoveredBluetoothDevice };

export type IpcRequest<C extends keyof IpcContract> = IpcContract[C]['request'];
export type IpcResponse<C extends keyof IpcContract> = IpcContract[C]['response'];
