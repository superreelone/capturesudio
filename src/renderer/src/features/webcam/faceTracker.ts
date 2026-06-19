/**
 * Webcam face tracker using MediaPipe BlazeFace short-range model.
 *
 * Detects the largest face in the webcam feed every ~150ms and exposes the
 * smoothed face centre as a normalised (0..1) coordinate. The compositor and
 * preview use it to drive the crop-zoom — instead of cropping to the centre
 * of the frame, they crop around the face so it stays framed even when you
 * lean / move around.
 *
 * Re-entrancy guarded the same way the segmenter is (CPU-delegate MediaPipe
 * detection takes 20-50ms per frame on a typical laptop, and the interval
 * tick can fire before the previous detect has finished).
 *
 * Uses CPU delegate to avoid contending with Chromium's screen-capture
 * pipeline on the GPU.
 */
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';

const LOAD_TIMEOUT_MS = 10_000;

let detectorPromise: Promise<FaceDetector> | null = null;

function getDetector(): Promise<FaceDetector> {
  if (detectorPromise) return detectorPromise;
  const load = (async () => {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    return FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO'
    });
  })();
  detectorPromise = Promise.race([
    load,
    new Promise<FaceDetector>((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`MediaPipe face detector load timed out after ${LOAD_TIMEOUT_MS}ms`)
          ),
        LOAD_TIMEOUT_MS
      );
    })
  ]).catch((err) => {
    detectorPromise = null;
    throw err;
  });
  return detectorPromise;
}

export interface FaceCenter {
  /** 0..1, fraction of video width — UN-mirrored coordinates. */
  x: number;
  /** 0..1, fraction of video height. */
  y: number;
}

export interface FaceTrackerHandle {
  /** Latest smoothed face centre, or null when no face has been seen yet. */
  getFaceCenter: () => FaceCenter | null;
  dispose: () => void;
}

/**
 * Build a face tracker against the given MediaStream. Starts polling
 * immediately; the first call to getFaceCenter() returns null until the
 * first detection lands.
 */
export async function createFaceTracker(stream: MediaStream): Promise<FaceTrackerHandle> {
  const detector = await getDetector();

  const video = document.createElement('video');
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  await video.play().catch(() => undefined);
  await new Promise<void>((resolve) => {
    if (video.readyState >= 2 && video.videoWidth > 0) return resolve();
    video.addEventListener('loadeddata', () => resolve(), { once: true });
  });

  let smoothed: FaceCenter | null = null;
  let disposed = false;
  let running = false;

  // Detection rate. Faces don't move that fast — 7Hz is enough to keep up
  // with normal motion and leaves plenty of CPU for everything else.
  const intervalMs = 150;

  // Exponential smoothing factor (0..1). Higher = snappier tracking, lower =
  // more damping. 0.25 looks lively without being twitchy.
  const SMOOTH = 0.25;

  const tick = (): void => {
    if (disposed || running) return;
    if (video.readyState < 2 || video.videoWidth === 0) return;
    running = true;
    try {
      const result = detector.detectForVideo(video, performance.now());
      if (result.detections.length > 0) {
        // Pick the largest face (closest to camera). MediaPipe sometimes
        // returns multiple if there are people in the background.
        let largest = result.detections[0]!;
        let largestArea = 0;
        for (const d of result.detections) {
          const b = d.boundingBox;
          if (!b) continue;
          const area = b.width * b.height;
          if (area > largestArea) {
            largest = d;
            largestArea = area;
          }
        }
        const box = largest.boundingBox;
        if (box) {
          const cx = (box.originX + box.width / 2) / video.videoWidth;
          const cy = (box.originY + box.height / 2) / video.videoHeight;
          // Bias the vertical centre upward by ~10% so the framing puts the
          // eyes near the upper third (rule of thirds) instead of dead-centre
          // on the nose.
          const cyBiased = Math.max(0, Math.min(1, cy - 0.08));
          if (smoothed) {
            smoothed = {
              x: smoothed.x * (1 - SMOOTH) + cx * SMOOTH,
              y: smoothed.y * (1 - SMOOTH) + cyBiased * SMOOTH
            };
          } else {
            smoothed = { x: cx, y: cyBiased };
          }
        }
      }
      // If no face was detected this tick we keep the last smoothed value so
      // a brief detection miss doesn't jerk the framing back to centre.
    } catch (err) {
      console.warn('face detector failed', err);
    } finally {
      running = false;
    }
  };

  const timer = window.setInterval(tick, intervalMs);
  tick();

  return {
    getFaceCenter: () => smoothed,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      window.clearInterval(timer);
      try {
        video.pause();
        video.srcObject = null;
      } catch {
        // ignore
      }
    }
  };
}
