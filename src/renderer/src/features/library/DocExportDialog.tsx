import { useMemo, useState } from 'react';
import type { RecentFile } from '@shared/files.types';
import { mediaUrl } from './mediaUrl';
import {
  generateDOCX,
  generatePDF,
  saveDocument,
  type DocItem,
  type DocLayout,
  type DocTemplate,
  type PageOrient,
  type PageSize
} from './docExporter';

interface Props {
  files: RecentFile[];
  onClose: () => void;
}

type DocFormat = 'pdf' | 'docx';

const LAYOUTS: { value: DocLayout; label: string; hint: string }[] = [
  { value: '1-per-page', label: '1 / page', hint: 'Each screenshot full-page' },
  { value: '2-per-page', label: '2 / page', hint: 'Stacked vertically' },
  { value: '4-per-page', label: '4 / page', hint: '2 × 2 grid' },
  { value: '6-per-page', label: '6 / page', hint: '2 × 3 grid' }
];

function sanitizeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80);
}

function captionFromFilename(name: string): string {
  // Strip extension; the user can edit it freely after that.
  return name.replace(/\.[^.]+$/, '');
}

export function DocExportDialog({ files, onClose }: Props): JSX.Element {
  const initialItems: DocItem[] = useMemo(
    () =>
      files
        .filter((f) => f.kind === 'screenshot')
        .map((f) => ({ file: f, caption: captionFromFilename(f.filename) })),
    [files]
  );

  const [format, setFormat] = useState<DocFormat>('pdf');
  const [title, setTitle] = useState<string>('Documentation');
  const [author, setAuthor] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [pageSize, setPageSize] = useState<PageSize>('A4');
  const [orientation, setOrientation] = useState<PageOrient>('portrait');
  const [layout, setLayout] = useState<DocLayout>('4-per-page');
  const [includeCaptions, setIncludeCaptions] = useState<boolean>(true);
  const [includePageNumbers, setIncludePageNumbers] = useState<boolean>(true);
  const [includeCoverLogo, setIncludeCoverLogo] = useState<boolean>(true);

  const [items, setItems] = useState<DocItem[]>(initialItems);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const [phase, setPhase] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ path: string; sizeBytes?: number } | null>(null);

  const skipped = files.length - initialItems.length;

  function updateCaption(idx: number, caption: string): void {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, caption } : it)));
  }

  function updateSection(idx: number, section: string): void {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, section } : it)));
  }

  function removeItem(idx: number): void {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  /** Distinct section titles in current order — drives the visual hint summary. */
  const sectionCount = useMemo(() => {
    const seen = new Set<string>();
    for (const it of items) {
      const s = it.section?.trim();
      if (s) seen.add(s);
    }
    return seen.size;
  }, [items]);

  function moveItem(from: number, to: number): void {
    if (from === to) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  }

  function handleDragStart(e: React.DragEvent<HTMLDivElement>, idx: number): void {
    setDraggingIdx(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>, idx: number): void {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOverIdx(idx);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>, idx: number): void {
    e.preventDefault();
    const from = draggingIdx;
    setDraggingIdx(null);
    setOverIdx(null);
    if (from === null || from === idx) return;
    // If dropping after the dragged item's original position, decrement by 1
    // because removing the source first shifts the indices.
    const adjustedTo = from < idx ? idx - 1 : idx;
    moveItem(from, adjustedTo);
  }

  function handleDragEnd(): void {
    setDraggingIdx(null);
    setOverIdx(null);
  }

  async function handleGenerate(): Promise<void> {
    if (items.length === 0) {
      setError('No items to export.');
      setPhase('error');
      return;
    }
    setPhase('generating');
    setError(null);
    try {
      const template: DocTemplate = {
        title,
        author,
        notes,
        layout,
        pageSize,
        pageOrientation: orientation,
        includeCaptions,
        includePageNumbers,
        includeCoverLogo
      };
      const bytes =
        format === 'pdf'
          ? await generatePDF(items, template)
          : await generateDOCX(items, template);
      const defaultName = `${sanitizeFilename(title) || 'document'}.${format}`;
      const saved = await saveDocument(bytes, defaultName, format);
      if (saved.cancelled) {
        setPhase('idle');
        return;
      }
      setResult({ path: saved.path!, sizeBytes: saved.sizeBytes });
      setPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }

  const generating = phase === 'generating';

  return (
    <div className="modal" role="dialog" aria-modal="true">
      <div className="modal__backdrop" onClick={generating ? undefined : onClose} />
      <div className="modal__panel modal__panel--wide">
        <header className="modal__head">
          <h2>Export to document</h2>
          <button className="ghost" onClick={onClose} disabled={generating}>
            ✕
          </button>
        </header>

        <div className="modal__body">
          <p className="muted small">
            {items.length} screenshot{items.length === 1 ? '' : 's'} selected
            {skipped > 0 && ` · ${skipped} non-screenshot file${skipped === 1 ? '' : 's'} skipped`}
          </p>

          <div className="settings__row">
            <div className="preset-group">
              <label>Format</label>
              <div className="seg">
                {(['pdf', 'docx'] as DocFormat[]).map((f) => (
                  <button
                    key={f}
                    className={`seg__btn${format === f ? ' seg__btn--on' : ''}`}
                    onClick={() => setFormat(f)}
                    disabled={generating}
                  >
                    {f === 'pdf' ? 'PDF' : 'Word (.docx)'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="settings__row">
            <div className="field" style={{ flex: 1, minWidth: 240 }}>
              <label>Title</label>
              <input
                type="text"
                className="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={generating}
              />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <label>Author (optional)</label>
              <input
                type="text"
                className="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                disabled={generating}
                placeholder="Your name or team"
              />
            </div>
          </div>

          <div className="field">
            <label>Intro notes (optional)</label>
            <textarea
              className="text"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={generating}
              placeholder="Description, context, or instructions for the cover page…"
            />
          </div>

          <div className="settings__row">
            <div className="preset-group">
              <label>Page size</label>
              <div className="seg">
                {(['A4', 'Letter', 'Legal'] as PageSize[]).map((s) => (
                  <button
                    key={s}
                    className={`seg__btn${pageSize === s ? ' seg__btn--on' : ''}`}
                    onClick={() => setPageSize(s)}
                    disabled={generating}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="preset-group">
              <label>Orientation</label>
              <div className="seg">
                {(['portrait', 'landscape'] as PageOrient[]).map((o) => (
                  <button
                    key={o}
                    className={`seg__btn${orientation === o ? ' seg__btn--on' : ''}`}
                    onClick={() => setOrientation(o)}
                    disabled={generating}
                  >
                    {o[0]!.toUpperCase() + o.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="preset-group">
              <label>Layout</label>
              <div className="seg">
                {LAYOUTS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`seg__btn${layout === opt.value ? ' seg__btn--on' : ''}`}
                    onClick={() => setLayout(opt.value)}
                    title={opt.hint}
                    disabled={generating}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="settings__row">
            <div className="audio-mute">
              <label>
                <input
                  type="checkbox"
                  checked={includeCaptions}
                  onChange={(e) => setIncludeCaptions(e.target.checked)}
                  disabled={generating}
                />
                <span>Show captions under screenshots</span>
              </label>
            </div>
            <div className="audio-mute">
              <label>
                <input
                  type="checkbox"
                  checked={includePageNumbers}
                  onChange={(e) => setIncludePageNumbers(e.target.checked)}
                  disabled={generating}
                />
                <span>Show page numbers</span>
              </label>
            </div>
            <div className="audio-mute">
              <label>
                <input
                  type="checkbox"
                  checked={includeCoverLogo}
                  onChange={(e) => setIncludeCoverLogo(e.target.checked)}
                  disabled={generating}
                />
                <span>Show logo on cover page</span>
              </label>
            </div>
          </div>

          <div className="field">
            <label>
              Screenshots ({items.length}) · drag to reorder
              {sectionCount > 0 && (
                <span className="muted small">
                  {' '}
                  · {sectionCount} section{sectionCount === 1 ? '' : 's'}
                </span>
              )}
            </label>
            <p className="muted small">
              Tip: put a <em>Section</em> on any item to start a new chapter. Items
              underneath inherit until the next section starts.
            </p>
            <div className="doc-items">
              {items.map((item, idx) => {
                const isNewSection = !!item.section?.trim();
                return (
                  <div key={item.file.path} className="doc-item-wrap">
                    {isNewSection && (
                      <div className="doc-section-marker">
                        <span className="doc-section-marker__line" />
                        <span className="doc-section-marker__title">{item.section!.trim()}</span>
                        <span className="doc-section-marker__line" />
                      </div>
                    )}
                    <div
                      className={[
                        'doc-item',
                        draggingIdx === idx ? 'doc-item--dragging' : '',
                        overIdx === idx && draggingIdx !== null && draggingIdx !== idx
                          ? 'doc-item--over'
                          : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      draggable={!generating}
                      onDragStart={(e) => handleDragStart(e, idx)}
                      onDragOver={(e) => handleDragOver(e, idx)}
                      onDragLeave={() => setOverIdx((cur) => (cur === idx ? null : cur))}
                      onDrop={(e) => handleDrop(e, idx)}
                      onDragEnd={handleDragEnd}
                    >
                      <span className="doc-item__handle" title="Drag to reorder">
                        ⠿
                      </span>
                      <span className="doc-item__num">{idx + 1}</span>
                      <img
                        src={mediaUrl(item.file.path)}
                        className="doc-item__thumb"
                        alt=""
                        draggable={false}
                      />
                      <div className="doc-item__inputs">
                        <input
                          className="text doc-item__section"
                          value={item.section || ''}
                          onChange={(e) => updateSection(idx, e.target.value)}
                          placeholder="Section… (leave empty to inherit)"
                          disabled={generating}
                          draggable={false}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                        <input
                          className="text doc-item__caption"
                          value={item.caption}
                          onChange={(e) => updateCaption(idx, e.target.value)}
                          placeholder="Caption…"
                          disabled={generating}
                          draggable={false}
                          onMouseDown={(e) => e.stopPropagation()}
                        />
                      </div>
                      <button
                        className="ghost small-btn"
                        onClick={() => removeItem(idx)}
                        title="Remove from export"
                        disabled={generating}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
              {items.length === 0 && (
                <p className="muted small">
                  No screenshots to export. Close and pick some from Library.
                </p>
              )}
            </div>
          </div>

          {phase === 'generating' && (
            <p className="muted small">
              Generating {format.toUpperCase()}… loading {items.length} image
              {items.length === 1 ? '' : 's'}.
            </p>
          )}
          {phase === 'error' && error && <p className="error">{error}</p>}
          {phase === 'done' && result && (
            <div className="export-progress">
              <p>
                ✓ Saved: <code>{result.path}</code>
                {result.sizeBytes !== undefined && (
                  <span className="muted small">
                    {' '}
                    · {(result.sizeBytes / 1024 / 1024).toFixed(2)} MB
                  </span>
                )}
              </p>
            </div>
          )}
        </div>

        <footer className="modal__foot">
          {phase !== 'done' && (
            <>
              <button className="ghost" onClick={onClose} disabled={generating}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => void handleGenerate()}
                disabled={generating || items.length === 0}
              >
                {generating ? 'Generating…' : `Generate ${format.toUpperCase()}`}
              </button>
            </>
          )}
          {phase === 'done' && result && (
            <>
              <button className="ghost" onClick={onClose}>
                Close
              </button>
              <button onClick={() => window.api.recording.reveal(result.path)}>Reveal</button>
              <button className="primary" onClick={() => window.api.app.openPath(result.path)}>
                Open
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
