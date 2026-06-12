import { z } from 'zod';

export const ThemeSchema = z.enum(['light', 'dark', 'system']);
export type Theme = z.infer<typeof ThemeSchema>;

export const VideoFormatSchema = z.enum(['mp4', 'mkv', 'mov', 'webm', 'gif']);
export type VideoFormat = z.infer<typeof VideoFormatSchema>;

export const ScreenshotFormatSchema = z.enum(['png', 'jpg', 'webp', 'bmp', 'tiff']);
export type ScreenshotFormat = z.infer<typeof ScreenshotFormatSchema>;

export const ResolutionPresetSchema = z.enum(['720p', '1080p', '1440p', 'native']);
export type ResolutionPreset = z.infer<typeof ResolutionPresetSchema>;

export const FpsSchema = z.union([z.literal(30), z.literal(60)]);
export type Fps = z.infer<typeof FpsSchema>;

export const BitratePresetSchema = z.enum(['small', 'balanced', 'high', 'max']);
export type BitratePreset = z.infer<typeof BitratePresetSchema>;

export const BITRATE_BPS: Record<BitratePreset, number> = {
  small: 2_500_000,
  balanced: 6_000_000,
  high: 12_000_000,
  max: 24_000_000
};

export const HotkeyActionSchema = z.enum([
  'startStopRecording',
  'pauseResumeRecording',
  'screenshotRegion',
  'screenshotFullscreen',
  'screenshotWindow',
  'toggleDrawing',
  'cycleTab',
  'drawPen',
  'drawArrow',
  'drawLine',
  'drawRect',
  'drawClear'
]);
export type HotkeyAction = z.infer<typeof HotkeyActionSchema>;

export const AudioModeSchema = z.enum(['none', 'mic', 'system', 'both']);
export type AudioMode = z.infer<typeof AudioModeSchema>;

export const BluetoothPenActionSchema = z.enum([
  'toggleDrawing',
  'undoStroke',
  'clearStrokes'
]);
export type BluetoothPenActionT = z.infer<typeof BluetoothPenActionSchema>;

export const WebcamPositionSchema = z.enum([
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
  'custom'
]);
export type WebcamPosition = z.infer<typeof WebcamPositionSchema>;

export const WebcamSizeSchema = z.enum(['small', 'medium', 'large']);
export type WebcamSize = z.infer<typeof WebcamSizeSchema>;

export const WebcamShapeSchema = z.enum(['rect', 'circle']);
export type WebcamShape = z.infer<typeof WebcamShapeSchema>;

export const WebcamBackgroundModeSchema = z.enum(['none', 'blur', 'image']);
export type WebcamBackgroundMode = z.infer<typeof WebcamBackgroundModeSchema>;

export const WEBCAM_SIZE_PX: Record<WebcamSize, number> = {
  small: 180,
  medium: 270,
  large: 360
};

export const HotkeyBindingSchema = z.object({
  startStopRecording: z.string(),
  pauseResumeRecording: z.string(),
  screenshotRegion: z.string(),
  screenshotFullscreen: z.string(),
  screenshotWindow: z.string(),
  toggleDrawing: z.string(),
  cycleTab: z.string(),
  drawPen: z.string(),
  drawArrow: z.string(),
  drawLine: z.string(),
  drawRect: z.string(),
  drawClear: z.string()
});
export type HotkeyBindings = z.infer<typeof HotkeyBindingSchema>;

export const SettingsSchema = z.object({
  theme: ThemeSchema,
  outputFolder: z.string(),
  screenshotFolder: z.string(),
  defaultVideoFormat: VideoFormatSchema,
  defaultScreenshotFormat: ScreenshotFormatSchema,
  filenameTemplate: z.string(),
  hotkeys: HotkeyBindingSchema,
  countdownSeconds: z.number().int().min(0).max(10),
  showCursor: z.boolean(),
  clickHighlight: z.boolean(),
  fps: FpsSchema,
  resolutionPreset: ResolutionPresetSchema,
  bitratePreset: BitratePresetSchema,
  audioMode: AudioModeSchema,
  micDeviceId: z.string(),
  micGain: z.number().min(0).max(2),
  systemGain: z.number().min(0).max(2),
  audioMuted: z.boolean(),
  micNoiseSuppression: z.boolean(),
  micEchoCancellation: z.boolean(),
  micAutoGainControl: z.boolean(),
  webcamEnabled: z.boolean(),
  webcamDeviceId: z.string(),
  webcamPosition: WebcamPositionSchema,
  webcamCustomX: z.number().min(0).max(1),
  webcamCustomY: z.number().min(0).max(1),
  webcamSize: WebcamSizeSchema,
  webcamShape: WebcamShapeSchema,
  webcamMirror: z.boolean(),
  webcamMargin: z.number().int().min(0).max(200),
  webcamBackgroundMode: WebcamBackgroundModeSchema,
  webcamBackgroundBlurPx: z.number().int().min(2).max(40),
  webcamBackgroundImagePath: z.string(),
  hideDrawingToolbarWhileRecording: z.boolean(),
  bluetoothPenAction: BluetoothPenActionSchema,
  bluetoothPenDebounceMs: z.number().int().min(0).max(2000),
  crashReporterEnabled: z.boolean()
});
export type Settings = z.infer<typeof SettingsSchema>;

export const PartialSettingsSchema = SettingsSchema.partial();
export type PartialSettings = z.infer<typeof PartialSettingsSchema>;

export const DEFAULT_FILENAME_TEMPLATE = '{app}_{date}_{time}_{counter}';

export function buildDefaultSettings(paths: {
  videos: string;
  pictures: string;
}): Settings {
  return {
    theme: 'system',
    outputFolder: paths.videos,
    screenshotFolder: paths.pictures,
    defaultVideoFormat: 'mp4',
    defaultScreenshotFormat: 'png',
    filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
    hotkeys: {
      startStopRecording: 'CommandOrControl+Shift+R',
      pauseResumeRecording: 'CommandOrControl+Shift+P',
      screenshotRegion: 'CommandOrControl+Shift+S',
      screenshotFullscreen: 'CommandOrControl+Shift+F',
      screenshotWindow: 'CommandOrControl+Shift+W',
      toggleDrawing: 'CommandOrControl+Shift+D',
      cycleTab: 'CommandOrControl+Shift+Tab',
      // Avoid raw F1–F5: many laptops map those to OEM functions (brightness,
      // night-mode, mic-mute, etc.) which the OS intercepts before Electron's
      // globalShortcut sees the keypress.
      drawPen: 'CommandOrControl+Shift+1',
      drawArrow: 'CommandOrControl+Shift+2',
      drawLine: 'CommandOrControl+Shift+3',
      drawRect: 'CommandOrControl+Shift+4',
      drawClear: 'CommandOrControl+Shift+0'
    },
    countdownSeconds: 3,
    showCursor: true,
    clickHighlight: false,
    fps: 60,
    resolutionPreset: '1080p',
    bitratePreset: 'high',
    audioMode: 'mic',
    micDeviceId: '',
    micGain: 1,
    systemGain: 1,
    audioMuted: false,
    micNoiseSuppression: true,
    micEchoCancellation: true,
    micAutoGainControl: false,
    webcamEnabled: false,
    webcamDeviceId: '',
    webcamPosition: 'bottomRight',
    webcamCustomX: 0.7,
    webcamCustomY: 0.7,
    webcamSize: 'medium',
    webcamShape: 'rect',
    webcamMirror: true,
    webcamMargin: 24,
    webcamBackgroundMode: 'none',
    webcamBackgroundBlurPx: 14,
    webcamBackgroundImagePath: '',
    hideDrawingToolbarWhileRecording: false,
    bluetoothPenAction: 'toggleDrawing',
    bluetoothPenDebounceMs: 250,
    crashReporterEnabled: false
  };
}
