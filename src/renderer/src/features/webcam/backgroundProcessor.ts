/**
 * Webcam background blur / replacement via MediaPipe selfie segmentation.
 *
 * Takes an input MediaStream (the raw webcam), runs each frame through the
 * selfie segmenter, composites the foreground over a blurred copy of the same
 * frame (blur mode) or a static image (image mode), and exposes the result as
 * a fresh MediaStream via canvas.captureStream().
 *
 * Model + WASM are loaded from the MediaPipe CDN on first use. They're cached
 * by the browser between launches; first launch needs network.
 */
import {
  FilesetResolver,
  ImageSegmenter,
  type ImageSegmenterResult
} from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let segmenterPromise: Promise<ImageSegmenter> | null = null;

/** Hard cap on segmenter load so a dead CDN doesn't hang the webcam preview
 *  forever. useWebcam catches the rejection and falls back to the raw stream. */
const SEGMENTER_LOAD_TIMEOUT_MS = 10_000;

/** Lazy-load + cache the segmenter so multiple processors share one instance. */
function getSegmenter(): Promise<ImageSegmenter> {
  if (segmenterPromise) return segmenterPromise;
  const load = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        // CPU delegate: a touch slower than GPU but doesn't compete with the
        // Chromium screen-capture pipeline for the same D3D11 resources. On
        // Windows, running MediaPipe with the GPU delegate alongside DXGI/WGC
        // capture in the same renderer was contending for GPU and producing
        // frozen-frame recordings.
        delegate: 'CPU'
      },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false
    });
  })();
  segmenterPromise = Promise.race([
    load,
    new Promise<ImageSegmenter>((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`MediaPipe segmenter load timed out after ${SEGMENTER_LOAD_TIMEOUT_MS}ms`)
          ),
        SEGMENTER_LOAD_TIMEOUT_MS
      );
    })
  ]).catch((err) => {
    // Clear the cached rejection so a future toggle can retry instead of
    // immediately re-failing with the same stale error.
    segmenterPromise = null;
    throw err;
  });
  return segmenterPromise;
}

export type WebcamBackgroundMode = 'none' | 'blur' | 'image';

export interface BackgroundProcessorOptions {
  mode: WebcamBackgroundMode;
  blurPx: number;
  /** Local-media or http URL for the replacement image. Ignored unless mode === 'image'. */
  imageUrl: string | null;
  /** Frames per second to run segmentation at. */
  targetFps: number;
}

export interface ProcessorHandle {
  stream: MediaStream;
  /** Update options mid-stream (e.g. swap blur for image, change blur strength). */
  setOptions: (next: BackgroundProcessorOptions) => void;
  dispose: () => void;
}

/**
 * Build a processed MediaStream from the input webcam stream. Caller owns the
 * input stream's lifetime; processor stops its own canvas-capture tracks and
 * disconnects the video element on dispose, but does NOT stop the source
 * stream.
 */
export async function createBackgroundProcessor(
  input: MediaStream,
  initial: BackgroundProcessorOptions
): Promise<ProcessorHandle> {
  let options = { ...initial };

  const segmenter = await getSegmenter();

  const video = document.createElement('video');
  video.srcObject = input;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  await video.play().catch(() => undefined);
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
    const handler = (): void => {
      if (video.videoWidth > 0) {
        video.removeEventListener('loadeddata', handler);
        resolve();
      }
    };
    video.addEventListener('loadeddata', handler);
  });

  const W = video.videoWidth || 640;
  const H = video.videoHeight || 480;

  // Output canvas
  const outCanvas = document.createElement('canvas');
  outCanvas.width = W;
  outCanvas.height = H;
  const outCtx = outCanvas.getContext('2d', { alpha: false })!;

  // Offscreen canvases — one for the unmodified frame, one for the blurred/replaced
  // background, one for the mask. Reused every frame.
  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = W;
  frameCanvas.height = H;
  const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: false })!;

  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = W;
  bgCanvas.height = H;
  const bgCtx = bgCanvas.getContext('2d', { alpha: false })!;

  // Replacement image (only used in 'image' mode). Loaded async; on failure,
  // background mode silently falls back to a flat gray so we don't crash.
  let replacementImg: HTMLImageElement | null = null;
  let replacementImgUrl: string | null = null;

  async function loadReplacementImage(url: string | null): Promise<void> {
    if (!url) {
      replacementImg = null;
      replacementImgUrl = null;
      return;
    }
    if (url === replacementImgUrl) return;
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = 'anonymous';
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error(`failed to load background image: ${url}`));
        el.src = url;
      });
      replacementImg = img;
      replacementImgUrl = url;
    } catch (err) {
      console.error(err);
      replacementImg = null;
    }
  }
  if (options.mode === 'image' && options.imageUrl) {
    void loadReplacementImage(options.imageUrl);
  }

  let timer = 0;
  let disposed = false;
  // Re-entrancy guard. CPU-delegate MediaPipe can take 50-100ms per frame on
  // a typical laptop, easily longer than our setInterval tick. Without this
  // guard the event loop ends up servicing back-to-back segmenter calls with
  // no breathing room — starving everything else in the renderer (the audio
  // level meter, React updates, the captions banner) and recording itself.
  let runningSegment = false;

  function paintBackground(): void {
    if (options.mode === 'blur') {
      bgCtx.filter = `blur(${options.blurPx}px)`;
      bgCtx.drawImage(frameCanvas, 0, 0, W, H);
      bgCtx.filter = 'none';
    } else if (options.mode === 'image' && replacementImg) {
      // Cover-fit
      const ir = replacementImg.naturalWidth / replacementImg.naturalHeight;
      const cr = W / H;
      let sx = 0,
        sy = 0,
        sw = replacementImg.naturalWidth,
        sh = replacementImg.naturalHeight;
      if (ir > cr) {
        sw = sh * cr;
        sx = (replacementImg.naturalWidth - sw) / 2;
      } else {
        sh = sw / cr;
        sy = (replacementImg.naturalHeight - sh) / 2;
      }
      bgCtx.drawImage(replacementImg, sx, sy, sw, sh, 0, 0, W, H);
    } else {
      // Fallback flat color so we don't show stale pixels.
      bgCtx.fillStyle = '#1b2026';
      bgCtx.fillRect(0, 0, W, H);
    }
  }

  function compositeMaskedFrame(seg: ImageSegmenterResult): void {
    const mask = seg.categoryMask;
    if (!mask) {
      outCtx.drawImage(frameCanvas, 0, 0);
      return;
    }
    const maskData = mask.getAsUint8Array();

    paintBackground();

    // We need pixel-level masking. Cheapest: putImageData on outCanvas
    // using mask to choose between frame and bg per pixel.
    const frameData = frameCtx.getImageData(0, 0, W, H);
    const bgData = bgCtx.getImageData(0, 0, W, H);
    const outData = outCtx.createImageData(W, H);
    const fpx = frameData.data;
    const bpx = bgData.data;
    const opx = outData.data;
    // For the selfie segmenter, value 0 = foreground (person), 255 = background.
    for (let i = 0; i < maskData.length; i++) {
      const j = i * 4;
      if (maskData[i] === 0) {
        opx[j] = fpx[j]!;
        opx[j + 1] = fpx[j + 1]!;
        opx[j + 2] = fpx[j + 2]!;
        opx[j + 3] = 255;
      } else {
        opx[j] = bpx[j]!;
        opx[j + 1] = bpx[j + 1]!;
        opx[j + 2] = bpx[j + 2]!;
        opx[j + 3] = 255;
      }
    }
    outCtx.putImageData(outData, 0, 0);
    mask.close();
  }

  function loop(): void {
    if (disposed) return;
    // Skip if we're still mid-frame from the previous tick. The next tick
    // will pick up; we'd rather drop a frame than block the renderer.
    if (runningSegment) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;

    // Resize if the source video changes dimensions (rare but possible if device swaps).
    if (video.videoWidth !== W || video.videoHeight !== H) {
      // Hard-resize would require re-allocating canvases. Skip frame; next stable size handles itself.
      return;
    }

    if (options.mode === 'none') {
      // No segmentation needed — just blit the raw frame.
      outCtx.drawImage(video, 0, 0, W, H);
      return;
    }

    // Capture the current video frame for both color sample + segmentation.
    runningSegment = true;
    try {
      frameCtx.drawImage(video, 0, 0, W, H);
      try {
        const result = segmenter.segmentForVideo(video, performance.now());
        compositeMaskedFrame(result);
      } catch (err) {
        console.warn('segmentForVideo failed; passing through', err);
        outCtx.drawImage(video, 0, 0, W, H);
      }
    } finally {
      runningSegment = false;
    }
  }
  // 100ms = 10fps. We *used* to fire at 33ms (30fps), but on CPU delegate a
  // single segment-and-composite frame takes 50-100ms — way longer than the
  // tick interval — and the queued backlog was blocking the renderer's main
  // thread. The audio level meter (driven by rAF) and the main UI both
  // starved as a result. 10fps webcam-PiP background processing is visually
  // smooth enough for a small picture-in-picture and leaves the thread idle
  // 70-90% of the time for everything else.
  const intervalMs = 100;
  timer = window.setInterval(loop, intervalMs);

  const stream = outCanvas.captureStream(Math.max(15, options.targetFps));

  return {
    stream,
    setOptions(next) {
      const imageChanged = next.imageUrl !== options.imageUrl;
      options = { ...next };
      if (imageChanged) void loadReplacementImage(next.imageUrl);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) window.clearInterval(timer);
      try {
        video.pause();
      } catch {
        // ignore
      }
      video.srcObject = null;
      for (const t of stream.getTracks()) t.stop();
    }
  };
}
