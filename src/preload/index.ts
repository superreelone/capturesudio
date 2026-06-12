import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, IpcEvent } from '@shared/ipc-channels';
import type {
  AppVersionInfo,
  ChooseDirectoryRequest,
  ChooseDirectoryResponse,
  HotkeyRegisterResponse,
  ListSourcesRequest,
  OpenRegionOverlayRequest,
  RunCountdownRequest
} from '@shared/ipc-types';
import type {
  AppendChunkRequest,
  CancelRecordingRequest,
  CaptureSource,
  DisplayInfo,
  FinalizeRecordingRequest,
  FinalizeRecordingResponse,
  RegionRect,
  StartRecordingRequest,
  StartRecordingResponse
} from '@shared/recording.types';
import type {
  CancelExportRequest,
  ExportDoneEvent,
  ExportErrorEvent,
  ExportProgress,
  StartExportRequest,
  StartExportResponse
} from '@shared/export.types';
import type {
  CaptureScreenshotRequest,
  CaptureScreenshotResponse,
  ClipboardScreenshotRequest,
  SaveScreenshotRequest,
  SaveScreenshotResponse
} from '@shared/screenshot.types';
import type {
  DeleteFileResponse,
  ListRecentsRequest,
  ListRecentsResponse,
  SaveAsRequest,
  SaveAsResponse
} from '@shared/files.types';
import type { DrawingShowRequest, DrawingState } from '@shared/drawing.types';
import type {
  ActivateLicenseRequest,
  ActivateLicenseResponse,
  DeactivateLicenseResponse,
  LicenseStatus
} from '@shared/license.types';
import type { DiscoveredBluetoothDevice } from '@shared/bluetooth.types';
import type { UpdateState } from '@shared/updater.types';
import type { HotkeyAction, PartialSettings, Settings } from '@shared/settings.schema';

const api = {
  app: {
    getVersion: (): Promise<AppVersionInfo> => ipcRenderer.invoke(IpcChannel.AppGetVersion),
    openPath: (path: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.AppOpenPath, { path }),
    chooseDirectory: (req: ChooseDirectoryRequest): Promise<ChooseDirectoryResponse> =>
      ipcRenderer.invoke(IpcChannel.AppChooseDirectory, req)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IpcChannel.SettingsGet),
    update: (patch: PartialSettings): Promise<Settings> =>
      ipcRenderer.invoke(IpcChannel.SettingsUpdate, patch),
    reset: (): Promise<Settings> => ipcRenderer.invoke(IpcChannel.SettingsReset)
  },
  capture: {
    listDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IpcChannel.CaptureListDisplays),
    listSources: (req: ListSourcesRequest): Promise<CaptureSource[]> =>
      ipcRenderer.invoke(IpcChannel.CaptureListSources, req),
    openRegionOverlay: (req: OpenRegionOverlayRequest = {}): Promise<RegionRect | null> =>
      ipcRenderer.invoke(IpcChannel.CaptureOpenRegionOverlay, req),
    runCountdown: (req: RunCountdownRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.CaptureRunCountdown, req)
  },
  recording: {
    start: (req: StartRecordingRequest): Promise<StartRecordingResponse> =>
      ipcRenderer.invoke(IpcChannel.RecordingStart, req),
    appendChunk: (req: AppendChunkRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.RecordingAppendChunk, req),
    finalize: (req: FinalizeRecordingRequest): Promise<FinalizeRecordingResponse> =>
      ipcRenderer.invoke(IpcChannel.RecordingFinalize, req),
    cancel: (req: CancelRecordingRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.RecordingCancel, req),
    reveal: (path: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.RecordingReveal, { path })
  },
  hotkeys: {
    register: (): Promise<HotkeyRegisterResponse> =>
      ipcRenderer.invoke(IpcChannel.HotkeysRegister),
    unregister: (): Promise<void> => ipcRenderer.invoke(IpcChannel.HotkeysUnregister)
  },
  export: {
    start: (req: StartExportRequest): Promise<StartExportResponse> =>
      ipcRenderer.invoke(IpcChannel.ExportStart, req),
    cancel: (req: CancelExportRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.ExportCancel, req)
  },
  screenshot: {
    capture: (req: CaptureScreenshotRequest): Promise<CaptureScreenshotResponse> =>
      ipcRenderer.invoke(IpcChannel.ScreenshotCapture, req),
    save: (req: SaveScreenshotRequest): Promise<SaveScreenshotResponse> =>
      ipcRenderer.invoke(IpcChannel.ScreenshotSave, req),
    clipboard: (req: ClipboardScreenshotRequest): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.ScreenshotClipboard, req)
  },
  files: {
    listRecents: (req: ListRecentsRequest = {}): Promise<ListRecentsResponse> =>
      ipcRenderer.invoke(IpcChannel.FilesListRecents, req),
    delete: (path: string): Promise<DeleteFileResponse> =>
      ipcRenderer.invoke(IpcChannel.FilesDelete, { path }),
    saveAs: (req: SaveAsRequest): Promise<SaveAsResponse> =>
      ipcRenderer.invoke(IpcChannel.FilesSaveAs, req)
  },
  drawing: {
    show: (req: DrawingShowRequest = {}): Promise<DrawingState> =>
      ipcRenderer.invoke(IpcChannel.DrawingShow, req),
    hide: (): Promise<void> => ipcRenderer.invoke(IpcChannel.DrawingHide),
    toggleMode: (): Promise<DrawingState> => ipcRenderer.invoke(IpcChannel.DrawingToggleMode),
    clear: (): Promise<void> => ipcRenderer.invoke(IpcChannel.DrawingClear),
    undo: (): Promise<void> => ipcRenderer.invoke(IpcChannel.DrawingUndo),
    setTool: (tool: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.DrawingSetTool, { tool }),
    setRecording: (recording: boolean, hideToolbar: boolean): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.DrawingSetRecording, { recording, hideToolbar }),
    cycleDisplay: (): Promise<DrawingState> =>
      ipcRenderer.invoke(IpcChannel.DrawingCycleDisplay),
    moveToDisplay: (displayId: number): Promise<DrawingState> =>
      ipcRenderer.invoke(IpcChannel.DrawingMoveToDisplay, { displayId }),
    listDisplays: (): Promise<
      Array<{
        id: number;
        label: string;
        isPrimary: boolean;
        bounds: { x: number; y: number; width: number; height: number };
      }>
    > => ipcRenderer.invoke(IpcChannel.DrawingListDisplays),
    state: (): Promise<DrawingState> => ipcRenderer.invoke(IpcChannel.DrawingState)
  },
  license: {
    status: (): Promise<LicenseStatus> => ipcRenderer.invoke(IpcChannel.LicenseStatus),
    activate: (req: ActivateLicenseRequest): Promise<ActivateLicenseResponse> =>
      ipcRenderer.invoke(IpcChannel.LicenseActivate, req),
    deactivate: (): Promise<DeactivateLicenseResponse> =>
      ipcRenderer.invoke(IpcChannel.LicenseDeactivate)
  },
  bluetooth: {
    pickDevice: (deviceId: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannel.BluetoothPickDevice, { deviceId }),
    cancelPick: (): Promise<void> => ipcRenderer.invoke(IpcChannel.BluetoothCancelPick)
  },
  updater: {
    check: (): Promise<UpdateState> => ipcRenderer.invoke(IpcChannel.UpdaterCheck),
    download: (): Promise<UpdateState> => ipcRenderer.invoke(IpcChannel.UpdaterDownload),
    install: (): Promise<void> => ipcRenderer.invoke(IpcChannel.UpdaterInstall),
    state: (): Promise<UpdateState> => ipcRenderer.invoke(IpcChannel.UpdaterState)
  },
  events: {
    onHotkeyTriggered: (cb: (action: HotkeyAction) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, action: HotkeyAction): void => cb(action);
      ipcRenderer.on(IpcEvent.HotkeyTriggered, listener);
      return () => {
        ipcRenderer.removeListener(IpcEvent.HotkeyTriggered, listener);
      };
    },
    onExportProgress: (cb: (ev: ExportProgress) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, ev: ExportProgress): void => cb(ev);
      ipcRenderer.on(IpcEvent.ExportProgress, listener);
      return () => ipcRenderer.removeListener(IpcEvent.ExportProgress, listener);
    },
    onExportDone: (cb: (ev: ExportDoneEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, ev: ExportDoneEvent): void => cb(ev);
      ipcRenderer.on(IpcEvent.ExportDone, listener);
      return () => ipcRenderer.removeListener(IpcEvent.ExportDone, listener);
    },
    onExportError: (cb: (ev: ExportErrorEvent) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, ev: ExportErrorEvent): void => cb(ev);
      ipcRenderer.on(IpcEvent.ExportError, listener);
      return () => ipcRenderer.removeListener(IpcEvent.ExportError, listener);
    },
    onDrawingStateChanged: (cb: (s: DrawingState) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, s: DrawingState): void => cb(s);
      ipcRenderer.on(IpcEvent.DrawingStateChanged, listener);
      return () => ipcRenderer.removeListener(IpcEvent.DrawingStateChanged, listener);
    },
    onLicenseStatusChanged: (cb: (s: LicenseStatus) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, s: LicenseStatus): void => cb(s);
      ipcRenderer.on(IpcEvent.LicenseStatusChanged, listener);
      return () => ipcRenderer.removeListener(IpcEvent.LicenseStatusChanged, listener);
    },
    onBluetoothDevicesDiscovered: (
      cb: (devices: DiscoveredBluetoothDevice[]) => void
    ): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        devices: DiscoveredBluetoothDevice[]
      ): void => cb(devices);
      ipcRenderer.on(IpcEvent.BluetoothDevicesDiscovered, listener);
      return () =>
        ipcRenderer.removeListener(IpcEvent.BluetoothDevicesDiscovered, listener);
    },
    onUpdaterStateChanged: (cb: (s: UpdateState) => void): (() => void) => {
      const listener = (_e: Electron.IpcRendererEvent, s: UpdateState): void => cb(s);
      ipcRenderer.on(IpcEvent.UpdaterStateChanged, listener);
      return () => ipcRenderer.removeListener(IpcEvent.UpdaterStateChanged, listener);
    }
  }
};

export type IngestraApi = typeof api;

function findArg(prefix: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

const regionRequestId = findArg('--region-overlay-request=');
const regionVirtualX = Number(findArg('--region-overlay-virtual-x=') ?? '0');
const regionVirtualY = Number(findArg('--region-overlay-virtual-y=') ?? '0');
const regionVirtualW = Number(findArg('--region-overlay-virtual-w=') ?? '0');
const regionVirtualH = Number(findArg('--region-overlay-virtual-h=') ?? '0');
const regionDisplaysRaw = findArg('--region-overlay-displays=');
interface OverlayDisplay {
  id: number;
  label: string;
  isPrimary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}
let regionDisplays: OverlayDisplay[] = [];
if (regionDisplaysRaw) {
  try {
    regionDisplays = JSON.parse(decodeURIComponent(regionDisplaysRaw));
  } catch {
    regionDisplays = [];
  }
}

interface VirtualRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const regionOverlay = regionRequestId
  ? {
      requestId: regionRequestId,
      virtualX: regionVirtualX,
      virtualY: regionVirtualY,
      virtualWidth: regionVirtualW,
      virtualHeight: regionVirtualH,
      displays: regionDisplays,
      submit: (rect: VirtualRect | null): void => {
        ipcRenderer.send(`region-overlay:result:${regionRequestId}`, rect);
      }
    }
  : undefined;

const countdownRequestId = findArg('--countdown-request=');
const countdownSecondsRaw = findArg('--countdown-seconds=');
const countdownSeconds = countdownSecondsRaw ? Number(countdownSecondsRaw) : undefined;

const countdown = countdownRequestId
  ? {
      requestId: countdownRequestId,
      seconds: countdownSeconds ?? 3,
      done: (): void => {
        ipcRenderer.send(`countdown:done:${countdownRequestId}`);
      }
    }
  : undefined;

const drawingOverlayDisplay = findArg('--drawing-overlay-display=');
const drawingOverlay = drawingOverlayDisplay
  ? {
      displayId: Number(drawingOverlayDisplay),
      hide: (): Promise<void> => ipcRenderer.invoke(IpcChannel.DrawingHide),
      toggleMode: (): Promise<DrawingState> => ipcRenderer.invoke(IpcChannel.DrawingToggleMode),
      cycleDisplay: (): Promise<DrawingState> =>
        ipcRenderer.invoke(IpcChannel.DrawingCycleDisplay),
      onState: (cb: (s: DrawingState) => void): (() => void) => {
        const listener = (_e: Electron.IpcRendererEvent, s: DrawingState): void => cb(s);
        ipcRenderer.on('drawing-overlay:state', listener);
        return () => ipcRenderer.removeListener('drawing-overlay:state', listener);
      },
      onClear: (cb: () => void): (() => void) => {
        const listener = (): void => cb();
        ipcRenderer.on('drawing-overlay:clear', listener);
        return () => ipcRenderer.removeListener('drawing-overlay:clear', listener);
      },
      onUndo: (cb: () => void): (() => void) => {
        const listener = (): void => cb();
        ipcRenderer.on('drawing-overlay:undo', listener);
        return () => ipcRenderer.removeListener('drawing-overlay:undo', listener);
      },
      onSetTool: (cb: (tool: string) => void): (() => void) => {
        const listener = (_e: Electron.IpcRendererEvent, tool: string): void => cb(tool);
        ipcRenderer.on('drawing-overlay:setTool', listener);
        return () => ipcRenderer.removeListener('drawing-overlay:setTool', listener);
      },
      onSetRecording: (
        cb: (payload: { recording: boolean; hideToolbar: boolean }) => void
      ): (() => void) => {
        const listener = (
          _e: Electron.IpcRendererEvent,
          payload: { recording: boolean; hideToolbar: boolean }
        ): void => cb(payload);
        ipcRenderer.on('drawing-overlay:setRecording', listener);
        return () => ipcRenderer.removeListener('drawing-overlay:setRecording', listener);
      }
    }
  : undefined;

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api);
    if (regionOverlay) contextBridge.exposeInMainWorld('regionOverlay', regionOverlay);
    if (countdown) contextBridge.exposeInMainWorld('countdown', countdown);
    if (drawingOverlay) contextBridge.exposeInMainWorld('drawingOverlay', drawingOverlay);
  } catch (err) {
    console.error('contextBridge expose failed', err);
  }
} else {
  (globalThis as unknown as { api: IngestraApi }).api = api;
  if (regionOverlay) {
    (globalThis as unknown as { regionOverlay: typeof regionOverlay }).regionOverlay = regionOverlay;
  }
  if (countdown) {
    (globalThis as unknown as { countdown: typeof countdown }).countdown = countdown;
  }
  if (drawingOverlay) {
    (globalThis as unknown as { drawingOverlay: typeof drawingOverlay }).drawingOverlay =
      drawingOverlay;
  }
}
