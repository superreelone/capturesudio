import type {
  ExportCodec,
  ExportContainer,
  ExportOptions,
  ExportQuality
} from '@shared/export.types';

const CRF: Record<ExportCodec, Record<ExportQuality, number>> = {
  h264: { high: 18, balanced: 23, small: 28 },
  h265: { high: 20, balanced: 26, small: 32 },
  vp9: { high: 24, balanced: 30, small: 36 }
};

const GIF_PRESETS: Record<ExportQuality, { fps: number; width: number }> = {
  high: { fps: 24, width: 1080 },
  balanced: { fps: 15, width: 720 },
  small: { fps: 10, width: 480 }
};

const AUDIO_BITRATE: Record<ExportQuality, number> = {
  high: 192,
  balanced: 128,
  small: 96
};

export interface BuiltArgs {
  args: string[];
  /** Hint for the renderer / handler: did we go fast-path? */
  copyMode: boolean;
}

/**
 * Build the ffmpeg argv (without the binary path) for a given export job.
 * Always: -y (overwrite), -hide_banner, -progress pipe:1, -nostats.
 */
export function buildFfmpegArgs(
  inputPath: string,
  outputPath: string,
  options: ExportOptions
): BuiltArgs {
  const args: string[] = ['-y', '-hide_banner'];

  // Fast-seek before -i is only correct when we don't re-encode; we apply it
  // either way and accept I-frame snap for the fast path; for re-encode we
  // also pass -ss after -i for accurate trimming.
  if (options.trim) {
    args.push('-ss', (options.trim.startMs / 1000).toFixed(3));
  }

  args.push('-i', inputPath);

  if (options.trim) {
    const durationSec = Math.max(0, (options.trim.endMs - options.trim.startMs) / 1000);
    args.push('-t', durationSec.toFixed(3));
  }

  args.push('-progress', 'pipe:1', '-nostats');

  if (options.container === 'gif') {
    const preset = GIF_PRESETS[options.quality];
    const fps = options.gifFps ?? preset.fps;
    const width =
      options.scale.height !== null
        ? // user picked target height; width follows aspect (handled by scale=-1)
          undefined
        : preset.width;
    const heightFilter = options.scale.height !== null ? options.scale.height : -1;
    const widthFilter = width !== undefined ? width : -1;
    const filter = `fps=${fps},scale=${widthFilter}:${heightFilter}:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    args.push('-vf', filter, '-loop', '0', '-an', outputPath);
    return { args, copyMode: false };
  }

  // Decide fast path: copyIfPossible && input is .webm && container webm && codec vp9 && no trim && no scale
  const inputIsWebm = inputPath.toLowerCase().endsWith('.webm');
  const noTransforms = !options.trim && options.scale.height === null;
  const canCopy =
    options.copyIfPossible &&
    options.container === 'webm' &&
    options.codec === 'vp9' &&
    inputIsWebm &&
    noTransforms;

  if (canCopy) {
    args.push('-c', 'copy');
    if (!options.includeAudio) args.push('-an');
    args.push(outputPath);
    return { args, copyMode: true };
  }

  const codec = options.codec ?? 'h264';
  const crf = CRF[codec][options.quality];

  // Video filters: scaling
  const vfParts: string[] = [];
  if (options.scale.height !== null) {
    // Round to even number to satisfy yuv420p chroma subsampling
    vfParts.push(`scale=-2:${options.scale.height}:flags=lanczos`);
  }

  switch (codec) {
    case 'h264': {
      args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf));
      args.push('-pix_fmt', 'yuv420p');
      if (options.container === 'mp4' || options.container === 'mov') {
        args.push('-movflags', '+faststart');
      }
      break;
    }
    case 'h265': {
      args.push('-c:v', 'libx265', '-preset', 'medium', '-crf', String(crf));
      args.push('-pix_fmt', 'yuv420p');
      if (options.container === 'mp4' || options.container === 'mov') {
        args.push('-tag:v', 'hvc1', '-movflags', '+faststart');
      }
      break;
    }
    case 'vp9': {
      args.push('-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0');
      args.push('-row-mt', '1', '-deadline', 'good', '-cpu-used', '3');
      break;
    }
  }

  if (vfParts.length > 0) {
    args.push('-vf', vfParts.join(','));
  }

  // Audio
  if (options.includeAudio) {
    if (options.container === 'webm' || options.container === 'mkv') {
      args.push('-c:a', 'libopus', '-b:a', `${AUDIO_BITRATE[options.quality]}k`);
    } else {
      args.push('-c:a', 'aac', '-b:a', `${AUDIO_BITRATE[options.quality]}k`);
    }
  } else {
    args.push('-an');
  }

  args.push(outputPath);
  return { args, copyMode: false };
}

export function containerExt(container: ExportContainer): string {
  return container;
}
