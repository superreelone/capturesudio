interface DesktopVideoConstraints {
  mandatory: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId: string;
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    maxFrameRate?: number;
  };
}

interface DesktopAudioConstraints {
  mandatory: {
    chromeMediaSource: 'desktop';
  };
}

interface VideoSpec {
  width: number;
  height: number;
  fps: number;
}

export function getVideoSpec(preset: '720p' | '1080p' | '1440p' | 'native', fps: 30 | 60): VideoSpec {
  switch (preset) {
    case '720p':
      return { width: 1280, height: 720, fps };
    case '1080p':
      return { width: 1920, height: 1080, fps };
    case '1440p':
      return { width: 2560, height: 1440, fps };
    case 'native':
      return { width: 3840, height: 2160, fps };
  }
}

export interface DesktopStreamOptions {
  withSystemAudio: boolean;
}

export interface DesktopStreamResult {
  stream: MediaStream;
  /** true if the stream actually came back with an audio track. */
  hasAudio: boolean;
}

export async function getDesktopStream(
  sourceId: string,
  spec: VideoSpec,
  options: DesktopStreamOptions = { withSystemAudio: false }
): Promise<DesktopStreamResult> {
  const video: DesktopVideoConstraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      minWidth: 640,
      minHeight: 360,
      maxWidth: spec.width,
      maxHeight: spec.height,
      maxFrameRate: spec.fps
    }
  };

  if (options.withSystemAudio) {
    const audio: DesktopAudioConstraints = { mandatory: { chromeMediaSource: 'desktop' } };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio,
        video
      } as unknown as MediaStreamConstraints);
      const hasAudio = stream.getAudioTracks().length > 0;
      return { stream, hasAudio };
    } catch (err) {
      // Fall back to video-only if system audio capture fails (common on window capture).
      console.warn('system audio capture failed, retrying video-only', err);
    }
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video
  } as unknown as MediaStreamConstraints);
  return { stream, hasAudio: false };
}

export function cropStreamToRegion(
  stream: MediaStream,
  region: { x: number; y: number; width: number; height: number },
  scaleFactor: number,
  fps: number
): MediaStream {
  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  void video.play();

  const sx = Math.round(region.x * scaleFactor);
  const sy = Math.round(region.y * scaleFactor);
  const sw = Math.max(2, Math.round(region.width * scaleFactor));
  const sh = Math.max(2, Math.round(region.height * scaleFactor));

  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas 2d context unavailable');

  let raf = 0;
  const draw = (): void => {
    if (video.readyState >= 2) {
      ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);

  const output = canvas.captureStream(fps);

  const origVideoTracks = stream.getVideoTracks();
  for (const t of origVideoTracks) {
    t.addEventListener('ended', () => {
      cancelAnimationFrame(raf);
      output.getTracks().forEach((track) => track.stop());
    });
  }

  return output;
}
