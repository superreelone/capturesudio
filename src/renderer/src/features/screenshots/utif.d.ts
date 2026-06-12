declare module 'utif' {
  /** Encode an RGBA pixel buffer (width*height*4 bytes) into a TIFF ArrayBuffer. */
  export function encodeImage(rgba: ArrayBufferLike, width: number, height: number): ArrayBuffer;
}
