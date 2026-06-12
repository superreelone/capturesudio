// Pure-renderer image encoders. PNG/JPG/WebP go through canvas.toBlob (browser-native).
// BMP and TIFF use small JS encoders since canvas doesn't speak those formats.

import bmp from 'bmp-js';
import UTIF from 'utif';
import type { ScreenshotFormat } from '@shared/screenshot.types';

function mimeFor(format: ScreenshotFormat): string {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'jpg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'bmp':
    case 'tiff':
      return 'image/png'; // unused; we encode manually
  }
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked encode to avoid stack overflow on large buffers
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + CHUNK)));
  }
  return btoa(bin);
}

function rgbaToAbgr(rgba: Uint8ClampedArray): Buffer {
  // bmp-js expects ABGR pixel buffer (A,B,G,R per pixel).
  const out = Buffer.alloc(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = rgba[i + 3]!; // A
    out[i + 1] = rgba[i + 2]!; // B
    out[i + 2] = rgba[i + 1]!; // G
    out[i + 3] = rgba[i]!; // R
  }
  return out;
}

export async function encodeCanvas(
  canvas: HTMLCanvasElement,
  format: ScreenshotFormat,
  quality: number
): Promise<{ base64: string; sizeBytes: number }> {
  if (format === 'png' || format === 'jpg' || format === 'webp') {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeFor(format), quality)
    );
    if (!blob) throw new Error(`canvas.toBlob returned null for ${format}`);
    const buf = await blobToArrayBuffer(blob);
    const u8 = new Uint8Array(buf);
    return { base64: bytesToBase64(u8), sizeBytes: u8.byteLength };
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  if (format === 'bmp') {
    const abgr = rgbaToAbgr(imageData.data);
    const encoded = bmp.encode({
      data: abgr,
      width: canvas.width,
      height: canvas.height
    });
    const bytes = encoded.data instanceof Uint8Array ? encoded.data : new Uint8Array(encoded.data);
    return { base64: bytesToBase64(bytes), sizeBytes: bytes.byteLength };
  }

  if (format === 'tiff') {
    const ab = UTIF.encodeImage(imageData.data.buffer, canvas.width, canvas.height);
    const bytes = new Uint8Array(ab);
    return { base64: bytesToBase64(bytes), sizeBytes: bytes.byteLength };
  }

  throw new Error(`unsupported format: ${String(format)}`);
}

export async function pngBase64FromCanvas(canvas: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob(png) returned null');
  const buf = await blobToArrayBuffer(blob);
  return bytesToBase64(new Uint8Array(buf));
}
