/** Convert an absolute filesystem path into a local-media:// URL the renderer can fetch. */
export function mediaUrl(absPath: string): string {
  // Normalize backslashes to forward slashes; encode each path segment.
  const forward = absPath.replace(/\\/g, '/');
  const withLeading = forward.startsWith('/') ? forward : `/${forward}`;
  const encoded = withLeading
    .split('/')
    .map((seg) => (seg ? encodeURIComponent(seg) : seg))
    .join('/');
  return `local-media://x${encoded}`;
}
