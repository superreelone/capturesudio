import { describe, expect, it } from 'vitest';
import { buildFfmpegArgs } from '../src/main/services/ffmpeg-args';
import type { ExportOptions } from '../src/shared/export.types';

function base(opts: Partial<ExportOptions> = {}): ExportOptions {
  return {
    container: 'mp4',
    codec: 'h264',
    quality: 'balanced',
    scale: { height: null },
    copyIfPossible: true,
    includeAudio: true,
    ...opts
  };
}

describe('buildFfmpegArgs', () => {
  it('always emits -y -hide_banner first', () => {
    const { args } = buildFfmpegArgs('in.webm', 'out.mp4', base());
    expect(args[0]).toBe('-y');
    expect(args[1]).toBe('-hide_banner');
  });

  it('always emits -progress pipe:1 -nostats so we can stream progress', () => {
    const { args } = buildFfmpegArgs('in.webm', 'out.mp4', base());
    expect(args).toContain('-progress');
    expect(args).toContain('pipe:1');
    expect(args).toContain('-nostats');
  });

  it('mp4 + h264 uses libx264 + faststart + AAC', () => {
    const { args, copyMode } = buildFfmpegArgs('in.webm', 'out.mp4', base());
    expect(args).toContain('-c:v');
    expect(args).toContain('libx264');
    expect(args).toContain('-movflags');
    expect(args).toContain('+faststart');
    expect(args).toContain('-c:a');
    expect(args).toContain('aac');
    expect(copyMode).toBe(false);
  });

  it('mp4 + h265 uses libx265 with hvc1 tag for QuickTime/Safari', () => {
    const { args } = buildFfmpegArgs('in.webm', 'out.mp4', base({ codec: 'h265' }));
    expect(args).toContain('libx265');
    expect(args).toContain('-tag:v');
    expect(args).toContain('hvc1');
  });

  it('webm + vp9 uses libvpx-vp9 with row-mt + opus audio (when fast path is disabled)', () => {
    const { args } = buildFfmpegArgs(
      'in.webm',
      'out.webm',
      base({ container: 'webm', codec: 'vp9', copyIfPossible: false })
    );
    expect(args).toContain('libvpx-vp9');
    expect(args).toContain('-row-mt');
    expect(args).toContain('1');
    expect(args).toContain('libopus');
  });

  it('mkv + vp9 uses libopus audio (not aac)', () => {
    const { args } = buildFfmpegArgs(
      'in.webm',
      'out.mkv',
      base({ container: 'mkv', codec: 'vp9' })
    );
    expect(args).toContain('libopus');
    expect(args).not.toContain('aac');
  });

  it('mkv + h264 uses libopus audio (mkv prefers opus per builder rules)', () => {
    const { args } = buildFfmpegArgs(
      'in.webm',
      'out.mkv',
      base({ container: 'mkv', codec: 'h264' })
    );
    expect(args).toContain('libx264');
    expect(args).toContain('libopus');
  });

  it('fast path: webm + vp9 + copyIfPossible + .webm input + no trim/scale = -c copy', () => {
    const { args, copyMode } = buildFfmpegArgs(
      'in.webm',
      'out.webm',
      base({ container: 'webm', codec: 'vp9', copyIfPossible: true })
    );
    expect(copyMode).toBe(true);
    expect(args).toContain('-c');
    expect(args).toContain('copy');
    expect(args).not.toContain('libvpx-vp9');
  });

  it('fast path disabled when trim is present', () => {
    const { copyMode } = buildFfmpegArgs(
      'in.webm',
      'out.webm',
      base({
        container: 'webm',
        codec: 'vp9',
        trim: { startMs: 1000, endMs: 5000 }
      })
    );
    expect(copyMode).toBe(false);
  });

  it('fast path disabled when scale is set', () => {
    const { copyMode } = buildFfmpegArgs(
      'in.webm',
      'out.webm',
      base({
        container: 'webm',
        codec: 'vp9',
        scale: { height: 720 }
      })
    );
    expect(copyMode).toBe(false);
  });

  it('fast path disabled when input is not .webm', () => {
    const { copyMode } = buildFfmpegArgs(
      'in.mp4',
      'out.webm',
      base({ container: 'webm', codec: 'vp9' })
    );
    expect(copyMode).toBe(false);
  });

  it('trim adds -ss before -i and -t with duration', () => {
    const { args } = buildFfmpegArgs(
      'in.webm',
      'out.mp4',
      base({ trim: { startMs: 1500, endMs: 5500 } })
    );
    expect(args).toContain('-ss');
    expect(args).toContain('-t');
    // duration is 4.000s
    const tIdx = args.indexOf('-t');
    expect(args[tIdx + 1]).toBe('4.000');
  });

  it('scale uses -vf scale=-2:H with even rounding for yuv420p', () => {
    const { args } = buildFfmpegArgs(
      'in.webm',
      'out.mp4',
      base({ scale: { height: 720 } })
    );
    expect(args).toContain('-vf');
    const vfIdx = args.indexOf('-vf');
    expect(args[vfIdx + 1]).toContain('scale=-2:720');
  });

  it('includeAudio: false adds -an', () => {
    const { args } = buildFfmpegArgs(
      'in.webm',
      'out.mp4',
      base({ includeAudio: false })
    );
    expect(args).toContain('-an');
    expect(args).not.toContain('aac');
  });

  it('GIF uses palette pipeline + -loop 0 + -an', () => {
    const { args, copyMode } = buildFfmpegArgs(
      'in.webm',
      'out.gif',
      base({ container: 'gif', codec: null })
    );
    expect(copyMode).toBe(false);
    expect(args).toContain('-vf');
    const vf = args[args.indexOf('-vf') + 1]!;
    expect(vf).toContain('palettegen');
    expect(vf).toContain('paletteuse');
    expect(args).toContain('-loop');
    expect(args).toContain('0');
    expect(args).toContain('-an');
  });

  it('last arg is the output path', () => {
    const { args } = buildFfmpegArgs('in.webm', 'out.mp4', base());
    expect(args[args.length - 1]).toBe('out.mp4');
  });
});
