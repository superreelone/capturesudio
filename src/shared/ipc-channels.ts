export const IpcChannel = {
  AppGetVersion: 'app:getVersion',
  AppOpenPath: 'app:openPath',
  AppChooseDirectory: 'app:chooseDirectory',

  SettingsGet: 'settings:get',
  SettingsUpdate: 'settings:update',
  SettingsReset: 'settings:reset',

  CaptureListDisplays: 'capture:listDisplays',
  CaptureListSources: 'capture:listSources',
  CaptureOpenRegionOverlay: 'capture:openRegionOverlay',
  CaptureRunCountdown: 'capture:runCountdown',

  RecordingStart: 'recording:start',
  RecordingAppendChunk: 'recording:appendChunk',
  RecordingFinalize: 'recording:finalize',
  RecordingCancel: 'recording:cancel',
  RecordingReveal: 'recording:reveal',

  HotkeysRegister: 'hotkeys:register',
  HotkeysUnregister: 'hotkeys:unregister',

  ExportStart: 'export:start',
  ExportCancel: 'export:cancel',

  ScreenshotCapture: 'screenshot:capture',
  ScreenshotSave: 'screenshot:save',
  ScreenshotClipboard: 'screenshot:clipboard',

  FilesListRecents: 'files:listRecents',
  FilesDelete: 'files:delete',
  FilesSaveAs: 'files:saveAs',

  DrawingShow: 'drawing:show',
  DrawingHide: 'drawing:hide',
  DrawingToggleMode: 'drawing:toggleMode',
  DrawingClear: 'drawing:clear',
  DrawingState: 'drawing:state',
  DrawingSetTool: 'drawing:setTool',
  DrawingSetRecording: 'drawing:setRecording',
  DrawingCycleDisplay: 'drawing:cycleDisplay',
  DrawingMoveToDisplay: 'drawing:moveToDisplay',
  DrawingListDisplays: 'drawing:listDisplays',

  LicenseStatus: 'license:status',
  LicenseActivate: 'license:activate',
  LicenseDeactivate: 'license:deactivate',

  DrawingUndo: 'drawing:undo',

  BluetoothPickDevice: 'bluetooth:pickDevice',
  BluetoothCancelPick: 'bluetooth:cancelPick',

  UpdaterCheck: 'updater:check',
  UpdaterDownload: 'updater:download',
  UpdaterInstall: 'updater:install',
  UpdaterState: 'updater:state'
} as const;

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];

export const IpcEvent = {
  HotkeyTriggered: 'evt:hotkeyTriggered',
  ExportProgress: 'evt:exportProgress',
  ExportDone: 'evt:exportDone',
  ExportError: 'evt:exportError',
  DrawingStateChanged: 'evt:drawingStateChanged',
  LicenseStatusChanged: 'evt:licenseStatusChanged',
  BluetoothDevicesDiscovered: 'evt:bluetoothDevicesDiscovered',
  UpdaterStateChanged: 'evt:updaterStateChanged'
} as const;
