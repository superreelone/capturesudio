import { useEffect, useRef, useState } from 'react';
import type { RecentFile } from '@shared/files.types';
import { mediaUrl } from './mediaUrl';

interface Props {
  file: RecentFile;
}

export function Thumbnail({ file }: Props): JSX.Element {
  const url = mediaUrl(file.path);

  if (file.kind === 'screenshot') {
    return (
      <div className="thumb__art thumb__art--img">
        <img src={url} alt={file.filename} loading="lazy" />
      </div>
    );
  }

  if (file.ext === 'gif') {
    return (
      <div className="thumb__art thumb__art--img">
        <img src={url} alt={file.filename} loading="lazy" />
      </div>
    );
  }

  return <VideoThumb file={file} url={url} />;
}

function VideoThumb({ file, url }: { file: RecentFile; url: string }): JSX.Element {
  const [poster, setPoster] = useState<string | null>(null);
  const [failed, setFailed] = useState<boolean>(false);
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.crossOrigin = 'anonymous';
    v.src = url;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    function cleanup(): void {
      if (timeout) clearTimeout(timeout);
      v.removeAttribute('src');
      v.load();
    }

    v.addEventListener('loadedmetadata', () => {
      if (cancelled) return;
      const target = Math.min(1.0, Math.max(0, v.duration - 0.1));
      v.currentTime = target;
    });
    v.addEventListener('seeked', () => {
      if (cancelled) return;
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) {
          setFailed(true);
          cleanup();
          return;
        }
        const targetH = 180;
        const aspect = w / h;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(targetH * aspect);
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          setPoster(canvas.toDataURL('image/jpeg', 0.75));
        }
      } catch {
        setFailed(true);
      } finally {
        cleanup();
      }
    });
    v.addEventListener('error', () => {
      if (!cancelled) setFailed(true);
      cleanup();
    });
    timeout = setTimeout(() => {
      if (!cancelled && !poster) {
        setFailed(true);
        cleanup();
      }
    }, 8000);

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [url, poster]);

  if (failed) {
    return (
      <div className="thumb__art thumb__art--placeholder">
        <span>{file.ext.toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div className="thumb__art thumb__art--img">
      {poster ? (
        <img src={poster} alt={file.filename} />
      ) : (
        <div className="thumb__art thumb__art--placeholder">
          <span>Loading…</span>
        </div>
      )}
    </div>
  );
}
