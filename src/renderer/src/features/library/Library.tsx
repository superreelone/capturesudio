import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RecentFile } from '@shared/files.types';
import { ExportDialog } from '../export/ExportDialog';
import { Thumbnail } from './Thumbnail';
import { mediaUrl } from './mediaUrl';
import { useRecents } from './useRecents';
import { DocExportDialog } from './DocExportDialog';

type Filter = 'all' | 'recording' | 'screenshot';

const VIDEO_EXTS = new Set(['webm', 'mp4', 'mkv', 'mov']);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days} d ago`;
  return new Date(ms).toLocaleDateString();
}

export function Library(): JSX.Element {
  const { state, refresh, remove } = useRecents();
  const [filter, setFilter] = useState<Filter>('all');
  const [exportTarget, setExportTarget] = useState<RecentFile | null>(null);
  const [selecting, setSelecting] = useState<boolean>(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [docExportOpen, setDocExportOpen] = useState<boolean>(false);

  const filtered = useMemo(() => {
    if (filter === 'all') return state.files;
    return state.files.filter((f) => f.kind === filter);
  }, [state.files, filter]);

  const selectedFiles = useMemo(
    () => state.files.filter((f) => selected.has(f.path)),
    [state.files, selected]
  );
  const selectedScreenshotCount = selectedFiles.filter((f) => f.kind === 'screenshot').length;

  const toggleSelected = useCallback((path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const f of filtered) next.add(f.path);
      return next;
    });
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
  }, []);

  function exitSelectionMode(): void {
    setSelecting(false);
    setSelected(new Set());
  }

  async function handleDelete(file: RecentFile): Promise<void> {
    const ok = window.confirm(`Move "${file.filename}" to the Trash / Recycle Bin?`);
    if (!ok) return;
    await remove(file.path);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(file.path);
      return next;
    });
  }

  async function handleBulkDelete(): Promise<void> {
    if (selectedFiles.length === 0) return;
    const ok = window.confirm(
      `Move ${selectedFiles.length} item${selectedFiles.length === 1 ? '' : 's'} to the Trash / Recycle Bin?`
    );
    if (!ok) return;
    for (const f of selectedFiles) {
      await remove(f.path);
    }
    setSelected(new Set());
  }

  // Exit selection mode if no items left selected after operations
  useEffect(() => {
    if (selecting && state.files.length === 0) exitSelectionMode();
  }, [selecting, state.files.length]);

  return (
    <section className="library">
      <header className="library__head">
        <div className="library__filters">
          {(['all', 'recording', 'screenshot'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`tab-btn${filter === f ? ' tab-btn--on' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? `All (${state.files.length})`
                : f === 'recording'
                  ? `Recordings (${state.files.filter((x) => x.kind === 'recording').length})`
                  : `Screenshots (${state.files.filter((x) => x.kind === 'screenshot').length})`}
            </button>
          ))}
        </div>
        <div className="library__actions">
          {!selecting && (
            <button onClick={() => setSelecting(true)} disabled={state.files.length === 0}>
              Select…
            </button>
          )}
          <button onClick={() => void refresh()} disabled={state.loading}>
            {state.loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            className="ghost"
            onClick={() => void window.api.app.openPath(state.recordingFolder)}
          >
            Open recordings folder
          </button>
          <button
            className="ghost"
            onClick={() => void window.api.app.openPath(state.screenshotFolder)}
          >
            Open screenshots folder
          </button>
        </div>
      </header>

      {selecting && (
        <div className="library__bulk">
          <span>
            <strong>{selected.size}</strong> selected
            {selected.size > 0 && selectedScreenshotCount !== selected.size && (
              <span className="muted small">
                {' '}
                · {selectedScreenshotCount} screenshot{selectedScreenshotCount === 1 ? '' : 's'} eligible for export
              </span>
            )}
          </span>
          <div className="library__bulk-actions">
            <button onClick={selectAllVisible}>Select all visible</button>
            <button onClick={clearSelection} disabled={selected.size === 0}>
              Clear
            </button>
            <button
              className="primary"
              onClick={() => setDocExportOpen(true)}
              disabled={selectedScreenshotCount === 0}
              title={
                selectedScreenshotCount === 0
                  ? 'Pick one or more screenshots to enable document export'
                  : ''
              }
            >
              Export to document…
            </button>
            <button
              className="ghost"
              onClick={() => void handleBulkDelete()}
              disabled={selected.size === 0}
            >
              Delete
            </button>
            <button className="ghost" onClick={exitSelectionMode}>
              Done
            </button>
          </div>
        </div>
      )}

      {state.error && <p className="error">{state.error}</p>}

      {filtered.length === 0 && !state.loading && (
        <div className="library__empty">
          <p className="muted">No files yet. Record something or take a screenshot.</p>
        </div>
      )}

      <div className="library__grid">
        {filtered.map((f) => (
          <LibraryCard
            key={f.path}
            file={f}
            selecting={selecting}
            selected={selected.has(f.path)}
            onToggleSelect={() => toggleSelected(f.path)}
            onReveal={() => window.api.recording.reveal(f.path)}
            onOpen={() => window.api.app.openPath(f.path)}
            onExport={() => setExportTarget(f)}
            onDelete={() => void handleDelete(f)}
            onExportSingleDoc={() => {
              setSelected(new Set([f.path]));
              setDocExportOpen(true);
            }}
          />
        ))}
      </div>

      {exportTarget && (
        <ProbeAndExport file={exportTarget} onClose={() => setExportTarget(null)} />
      )}

      {docExportOpen && (
        <DocExportDialog
          files={selectedFiles}
          onClose={() => {
            setDocExportOpen(false);
          }}
        />
      )}
    </section>
  );
}

interface LibraryCardProps {
  file: RecentFile;
  selecting: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onReveal: () => void;
  onOpen: () => void;
  onExport: () => void;
  onDelete: () => void;
  onExportSingleDoc: () => void;
}

function LibraryCard({
  file,
  selecting,
  selected,
  onToggleSelect,
  onReveal,
  onOpen,
  onExport,
  onDelete,
  onExportSingleDoc
}: LibraryCardProps): JSX.Element {
  const exportable = file.kind === 'recording' && VIDEO_EXTS.has(file.ext);
  const isScreenshot = file.kind === 'screenshot';

  function handleArtClick(): void {
    if (selecting) onToggleSelect();
    else onOpen();
  }

  return (
    <article
      className={`lib-card${selected ? ' lib-card--selected' : ''}`}
      title={file.filename}
    >
      <button
        className="lib-card__art-btn"
        onClick={handleArtClick}
        aria-label={selecting ? `Toggle ${file.filename}` : `Open ${file.filename}`}
      >
        <Thumbnail file={file} />
        <span className={`lib-card__badge lib-card__badge--${file.kind}`}>
          {file.ext.toUpperCase()}
        </span>
        {(selecting || selected) && (
          <span className={`lib-card__check${selected ? ' lib-card__check--on' : ''}`}>
            {selected ? '✓' : ''}
          </span>
        )}
      </button>
      <div className="lib-card__meta">
        <span className="lib-card__name">{file.filename}</span>
        <span className="lib-card__sub">
          {formatBytes(file.sizeBytes)} · {formatRelative(file.mtimeMs)}
        </span>
      </div>
      <div className="lib-card__actions">
        <button className="lib-card__action" onClick={onOpen} title="Open">
          Open
        </button>
        <button className="lib-card__action" onClick={onReveal} title="Reveal in folder">
          Reveal
        </button>
        {exportable && (
          <button className="lib-card__action" onClick={onExport} title="Re-export with ffmpeg">
            Re-export…
          </button>
        )}
        {isScreenshot && (
          <button
            className="lib-card__action"
            onClick={onExportSingleDoc}
            title="Export to PDF or Word"
          >
            To doc…
          </button>
        )}
        <button
          className="lib-card__action lib-card__action--danger"
          onClick={onDelete}
          title="Move to Trash"
        >
          Delete
        </button>
      </div>
    </article>
  );
}

function ProbeAndExport({ file, onClose }: { file: RecentFile; onClose: () => void }): JSX.Element {
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const url = mediaUrl(file.path);
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = url;

    const cleanup = (): void => {
      v.removeAttribute('src');
      v.load();
    };

    v.onloadedmetadata = () => {
      if (cancelled) return;
      const ms = Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : 0;
      setDurationMs(ms);
      cleanup();
    };
    v.onerror = () => {
      if (cancelled) return;
      setProbeError(`Could not read ${file.filename}`);
      cleanup();
    };

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [file.filename, file.path]);

  if (probeError) {
    return (
      <div className="modal">
        <div className="modal__backdrop" onClick={onClose} />
        <div className="modal__panel">
          <header className="modal__head">
            <h2>Export</h2>
            <button className="ghost" onClick={onClose}>
              ✕
            </button>
          </header>
          <div className="modal__body">
            <p className="error">{probeError}</p>
          </div>
        </div>
      </div>
    );
  }
  if (durationMs === null) {
    return (
      <div className="modal">
        <div className="modal__backdrop" onClick={onClose} />
        <div className="modal__panel">
          <header className="modal__head">
            <h2>Reading file…</h2>
            <button className="ghost" onClick={onClose}>
              ✕
            </button>
          </header>
          <div className="modal__body">
            <p className="muted">Probing duration…</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <ExportDialog
      inputPath={file.path}
      inputFilename={file.filename}
      inputDurationMs={durationMs}
      sourceLabel={file.filename.replace(/\.[^.]+$/, '')}
      onClose={onClose}
    />
  );
}
