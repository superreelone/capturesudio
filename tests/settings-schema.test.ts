import { describe, expect, it } from 'vitest';
import {
  BITRATE_BPS,
  PartialSettingsSchema,
  SettingsSchema,
  buildDefaultSettings
} from '../src/shared/settings.schema';

const DEFAULT_PATHS = {
  videos: '/Users/me/Videos/Ingestra',
  pictures: '/Users/me/Pictures/Ingestra'
};

describe('buildDefaultSettings', () => {
  it('produces a value that parses cleanly against the schema', () => {
    const d = buildDefaultSettings(DEFAULT_PATHS);
    const parsed = SettingsSchema.safeParse(d);
    expect(parsed.success).toBe(true);
  });

  it('defaults output folders to the provided paths', () => {
    const d = buildDefaultSettings(DEFAULT_PATHS);
    expect(d.outputFolder).toBe(DEFAULT_PATHS.videos);
    expect(d.screenshotFolder).toBe(DEFAULT_PATHS.pictures);
  });

  it('uses sensible defaults for capture quality', () => {
    const d = buildDefaultSettings(DEFAULT_PATHS);
    expect(d.fps).toBe(60);
    expect(d.resolutionPreset).toBe('1080p');
    expect(d.bitratePreset).toBe('high');
    expect(d.defaultVideoFormat).toBe('mp4');
    expect(d.defaultScreenshotFormat).toBe('png');
  });

  it('default hotkeys are all distinct accelerators', () => {
    const d = buildDefaultSettings(DEFAULT_PATHS);
    const accels = Object.values(d.hotkeys);
    expect(new Set(accels).size).toBe(accels.length);
  });
});

describe('SettingsSchema', () => {
  it('rejects an unknown theme', () => {
    const d = buildDefaultSettings(DEFAULT_PATHS);
    const result = SettingsSchema.safeParse({ ...d, theme: 'sepia' });
    expect(result.success).toBe(false);
  });

  it('rejects a too-large countdown', () => {
    const d = buildDefaultSettings(DEFAULT_PATHS);
    const result = SettingsSchema.safeParse({ ...d, countdownSeconds: 99 });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported fps value', () => {
    const d = buildDefaultSettings(DEFAULT_PATHS);
    const result = SettingsSchema.safeParse({ ...d, fps: 45 });
    expect(result.success).toBe(false);
  });

  it('rejects mic gain out of [0, 4]', () => {
    const d = buildDefaultSettings(DEFAULT_PATHS);
    expect(SettingsSchema.safeParse({ ...d, micGain: -0.1 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...d, micGain: 4.5 }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...d, micGain: 1.5 }).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...d, micGain: 3.5 }).success).toBe(true);
  });

  it('PartialSettingsSchema accepts an empty object', () => {
    const result = PartialSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('PartialSettingsSchema accepts a single-field patch', () => {
    const result = PartialSettingsSchema.safeParse({ theme: 'light' });
    expect(result.success).toBe(true);
  });

  it('PartialSettingsSchema still rejects invalid values', () => {
    const result = PartialSettingsSchema.safeParse({ theme: 'sepia' });
    expect(result.success).toBe(false);
  });
});

describe('BITRATE_BPS', () => {
  it('is monotonic across presets', () => {
    expect(BITRATE_BPS.small).toBeLessThan(BITRATE_BPS.balanced);
    expect(BITRATE_BPS.balanced).toBeLessThan(BITRATE_BPS.high);
    expect(BITRATE_BPS.high).toBeLessThan(BITRATE_BPS.max);
  });

  it('all presets are positive', () => {
    for (const v of Object.values(BITRATE_BPS)) expect(v).toBeGreaterThan(0);
  });
});
