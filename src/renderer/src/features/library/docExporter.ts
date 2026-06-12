/**
 * Generates a PDF or DOCX document from a list of screenshot files using a
 * documentation-style template. Pure-renderer: pdf-lib and docx are both
 * JS-only and have no native deps.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Header,
  ImageRun,
  PageNumber,
  PageOrientation,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx';
import type { RecentFile } from '@shared/files.types';
import { mediaUrl } from './mediaUrl';
import logoUrl from '../../assets/logo.png';

export type DocLayout = '1-per-page' | '2-per-page' | '4-per-page' | '6-per-page';
export type PageSize = 'A4' | 'Letter' | 'Legal';
export type PageOrient = 'portrait' | 'landscape';

export interface DocItem {
  file: RecentFile;
  caption: string;
  /**
   * Optional section heading. When non-empty, this item STARTS a new section
   * with this title. Subsequent items with empty section inherit it. Items
   * before the first sectioned item belong to a no-title group.
   */
  section?: string;
}

export interface DocTemplate {
  title: string;
  author: string;
  notes: string;
  layout: DocLayout;
  pageSize: PageSize;
  pageOrientation: PageOrient;
  includeCaptions: boolean;
  includePageNumbers: boolean;
  includeCoverLogo: boolean;
}

interface LoadedItem extends DocItem {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/* ---------------- size tables ---------------- */

const PDF_DIMS: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
  Legal: { width: 612, height: 1008 }
};

const DOCX_DIMS: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 11906, height: 16838 },
  Letter: { width: 12240, height: 15840 },
  Legal: { width: 12240, height: 20160 }
};

const DOCX_INCH: Record<PageSize, { width: number; height: number }> = {
  A4: { width: 8.27, height: 11.69 },
  Letter: { width: 8.5, height: 11 },
  Legal: { width: 8.5, height: 14 }
};

function gridFor(layout: DocLayout): { cols: number; rows: number; perPage: number } {
  switch (layout) {
    case '1-per-page':
      return { cols: 1, rows: 1, perPage: 1 };
    case '2-per-page':
      return { cols: 1, rows: 2, perPage: 2 };
    case '4-per-page':
      return { cols: 2, rows: 2, perPage: 4 };
    case '6-per-page':
      return { cols: 2, rows: 3, perPage: 6 };
  }
}

function pdfPageDims(size: PageSize, o: PageOrient): { width: number; height: number } {
  const d = PDF_DIMS[size];
  return o === 'landscape' ? { width: d.height, height: d.width } : d;
}

// PageOrientation is exported as a const-object value in docx, not a type.
type DocxOrientation = (typeof PageOrientation)[keyof typeof PageOrientation];

function docxPageDims(size: PageSize, o: PageOrient): {
  width: number;
  height: number;
  orientation: DocxOrientation;
} {
  const d = DOCX_DIMS[size];
  return o === 'landscape'
    ? { width: d.height, height: d.width, orientation: PageOrientation.LANDSCAPE }
    : { width: d.width, height: d.height, orientation: PageOrientation.PORTRAIT };
}

function docxInnerPx(size: PageSize, o: PageOrient): { w: number; h: number } {
  const i = DOCX_INCH[size];
  const wIn = o === 'landscape' ? i.height : i.width;
  const hIn = o === 'landscape' ? i.width : i.height;
  return { w: Math.max(120, (wIn - 1.5) * 96), h: Math.max(120, (hIn - 1.5) * 96) };
}

/* ---------------- image loading ---------------- */

async function loadOne(item: DocItem): Promise<LoadedItem> {
  const res = await fetch(mediaUrl(item.file.path));
  if (!res.ok) throw new Error(`Failed to load ${item.file.filename}: ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const blob = new Blob([buf]);
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`image decode failed: ${item.file.filename}`));
      el.src = url;
    });
    return { ...item, bytes, width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadAll(items: DocItem[]): Promise<LoadedItem[]> {
  return Promise.all(items.map(loadOne));
}

interface SectionGroup {
  title: string | null;
  items: LoadedItem[];
}

/**
 * Group items into consecutive runs sharing the same section. An item with a
 * non-empty `section` starts a new group with that title; items with empty
 * section join the preceding group (or a "no title" group if none yet).
 */
function groupBySection(items: LoadedItem[]): SectionGroup[] {
  const groups: SectionGroup[] = [];
  let curr: SectionGroup | null = null;
  for (const item of items) {
    const sec = item.section?.trim();
    if (sec) {
      curr = { title: sec, items: [item] };
      groups.push(curr);
    } else {
      if (!curr) {
        curr = { title: null, items: [item] };
        groups.push(curr);
      } else {
        curr.items.push(item);
      }
    }
  }
  return groups;
}

async function loadLogoBytes(): Promise<Uint8Array | null> {
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function fmtBytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + CHUNK)));
  }
  return btoa(bin);
}

/* ---------------- PDF ---------------- */

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        out.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
    out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

export async function generatePDF(
  items: DocItem[],
  template: DocTemplate
): Promise<Uint8Array> {
  const loaded = await loadAll(items);
  const { width: pageW, height: pageH } = pdfPageDims(template.pageSize, template.pageOrientation);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const margin = 48;
  const innerWidth = pageW - margin * 2;

  // ----- COVER -----
  const cover = doc.addPage([pageW, pageH]);
  let y = pageH - margin - 40;

  let logoImg: PDFImage | null = null;
  if (template.includeCoverLogo) {
    const logoBytes = await loadLogoBytes();
    if (logoBytes) {
      try {
        logoImg = await doc.embedPng(logoBytes);
      } catch {
        try {
          logoImg = await doc.embedJpg(logoBytes);
        } catch {
          logoImg = null;
        }
      }
    }
  }

  const logoSize = 64;
  let titleX = margin;
  if (logoImg) {
    cover.drawImage(logoImg, {
      x: margin,
      y: y - logoSize + 24,
      width: logoSize,
      height: logoSize
    });
    titleX = margin + logoSize + 18;
  }
  cover.drawText(template.title || 'Documentation', {
    x: titleX,
    y,
    font: fontBold,
    size: logoImg ? 24 : 28,
    color: rgb(0.11, 0.13, 0.15)
  });
  const subY = y - 24;
  const subtitle = `${new Date().toLocaleDateString()} · ${loaded.length} screenshot${
    loaded.length === 1 ? '' : 's'
  }`;
  cover.drawText(subtitle, {
    x: titleX,
    y: subY,
    font,
    size: 10,
    color: rgb(0.4, 0.45, 0.5)
  });
  if (template.author.trim()) {
    cover.drawText(`by ${template.author}`, {
      x: titleX,
      y: subY - 14,
      font,
      size: 10,
      color: rgb(0.4, 0.45, 0.5)
    });
  }
  y = Math.min(y - (logoImg ? logoSize : 36), subY - 30) - 16;

  if (template.notes.trim()) {
    const lines = wrapText(template.notes.trim(), font, 12, innerWidth);
    for (const line of lines) {
      if (y < margin + 16) break;
      cover.drawText(line, {
        x: margin,
        y,
        font,
        size: 12,
        color: rgb(0.15, 0.18, 0.21)
      });
      y -= 16;
    }
  }

  // ----- IMAGE PAGES (with section groups) -----
  const { cols, rows, perPage } = gridFor(template.layout);
  const captionH = template.includeCaptions ? 14 : 0;
  const cellGap = 14;
  const cellW = (innerWidth - cellGap * (cols - 1)) / cols;
  const cellH = (pageH - margin * 2 - cellGap * (rows - 1)) / rows;
  const imgMaxW = cellW;
  const imgMaxH = cellH - captionH - 4;

  const groups = groupBySection(loaded);

  for (const group of groups) {
    // Section heading page (chapter-style divider)
    if (group.title) {
      const headPage = doc.addPage([pageW, pageH]);
      const titleSize = 36;
      const tw = fontBold.widthOfTextAtSize(group.title, titleSize);
      headPage.drawText(group.title, {
        x: (pageW - tw) / 2,
        y: pageH / 2 + 30,
        font: fontBold,
        size: titleSize,
        color: rgb(0.11, 0.13, 0.15)
      });
      const sub = `${group.items.length} screenshot${group.items.length === 1 ? '' : 's'}`;
      const sw = font.widthOfTextAtSize(sub, 14);
      headPage.drawText(sub, {
        x: (pageW - sw) / 2,
        y: pageH / 2 - 4,
        font,
        size: 14,
        color: rgb(0.4, 0.45, 0.5)
      });
    }

    // Image grid pages for this group
    for (let i = 0; i < group.items.length; i++) {
      const slot = i % perPage;
      const page =
        slot === 0 ? doc.addPage([pageW, pageH]) : doc.getPages()[doc.getPageCount() - 1]!;
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const cellX = margin + col * (cellW + cellGap);
      const cellY = pageH - margin - (row + 1) * cellH - row * cellGap;

      const item = group.items[i]!;
      const ext = item.file.ext.toLowerCase();
      let embedded: PDFImage;
      try {
        embedded =
          ext === 'jpg' || ext === 'jpeg'
            ? await doc.embedJpg(item.bytes)
            : await doc.embedPng(item.bytes);
      } catch {
        try {
          embedded = await doc.embedJpg(item.bytes);
        } catch {
          continue;
        }
      }
      const ratio = Math.min(imgMaxW / item.width, imgMaxH / item.height);
      const drawW = item.width * ratio;
      const drawH = item.height * ratio;
      const offX = cellX + (cellW - drawW) / 2;
      const offY = cellY + captionH + (cellH - captionH - drawH) / 2;
      page.drawImage(embedded, { x: offX, y: offY, width: drawW, height: drawH });

      if (template.includeCaptions) {
        const caption = item.caption || item.file.filename;
        const fontSize = 9;
        let drawn = caption;
        while (font.widthOfTextAtSize(drawn, fontSize) > cellW && drawn.length > 4) {
          drawn = drawn.slice(0, -2) + '…';
        }
        const cw = font.widthOfTextAtSize(drawn, fontSize);
        page.drawText(drawn, {
          x: cellX + Math.max(0, (cellW - cw) / 2),
          y: cellY + 2,
          font,
          size: fontSize,
          color: rgb(0.35, 0.4, 0.45)
        });
      }
    }
  }

  if (template.includePageNumbers) {
    const total = doc.getPageCount();
    const pages = doc.getPages();
    for (let i = 0; i < pages.length; i++) {
      const label = `${i + 1} / ${total}`;
      const w = font.widthOfTextAtSize(label, 9);
      pages[i]!.drawText(label, {
        x: pageW - margin - w,
        y: margin / 2,
        font,
        size: 9,
        color: rgb(0.45, 0.5, 0.55)
      });
    }
  }

  return await doc.save();
}

/* ---------------- DOCX ---------------- */

const TRANSPARENT_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
};

export async function generateDOCX(
  items: DocItem[],
  template: DocTemplate
): Promise<Uint8Array> {
  const loaded = await loadAll(items);
  const page = docxPageDims(template.pageSize, template.pageOrientation);
  const inner = docxInnerPx(template.pageSize, template.pageOrientation);

  const { cols, rows, perPage } = gridFor(template.layout);
  const captionH = template.includeCaptions ? 18 : 0;
  const gap = 8;
  const cellW = (inner.w - gap * (cols - 1)) / cols;
  const cellH = (inner.h - gap * (rows - 1)) / rows;
  const imgMaxW = cellW;
  const imgMaxH = cellH - captionH;

  const children: (Paragraph | Table)[] = [];

  if (template.includeCoverLogo) {
    const logoBytes = await loadLogoBytes();
    if (logoBytes) {
      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: logoBytes as Buffer | Uint8Array,
              transformation: { width: 96, height: 96 },
              type: 'png'
            } as ConstructorParameters<typeof ImageRun>[0])
          ]
        })
      );
    }
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: template.title || 'Documentation', bold: true, size: 48 })]
    })
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `${new Date().toLocaleDateString()} · ${loaded.length} screenshot${
            loaded.length === 1 ? '' : 's'
          }`,
          italics: true,
          color: '666666',
          size: 20
        })
      ]
    })
  );
  if (template.author.trim()) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `by ${template.author}`,
            italics: true,
            color: '666666',
            size: 20
          })
        ]
      })
    );
  }

  if (template.notes.trim()) {
    for (const line of template.notes.trim().split('\n')) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: line, size: 22 })],
          spacing: { after: 100 }
        })
      );
    }
  }

  const docxGroups = groupBySection(loaded);

  for (const group of docxGroups) {
    // Section heading: full-page chapter divider (centered, large, page-break before).
    if (group.title) {
      children.push(
        new Paragraph({
          pageBreakBefore: true,
          alignment: AlignmentType.CENTER,
          spacing: { before: 4000, after: 200 },
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: group.title, bold: true, size: 56 })]
        })
      );
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: `${group.items.length} screenshot${group.items.length === 1 ? '' : 's'}`,
              italics: true,
              color: '666666',
              size: 24
            })
          ]
        })
      );
    }

    for (let i = 0; i < group.items.length; i += perPage) {
      const chunk = group.items.slice(i, i + perPage);
      children.push(
        new Paragraph({ children: [new TextRun({ text: '' })], pageBreakBefore: true })
      );
      const rowsArr: TableRow[] = [];
      for (let r = 0; r < rows; r++) {
        const cells: TableCell[] = [];
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          const item = chunk[idx];
          if (!item) {
            cells.push(
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
                width: { size: 100 / cols, type: WidthType.PERCENTAGE },
                borders: TRANSPARENT_BORDERS
              })
            );
            continue;
          }
          const ratio = Math.min(imgMaxW / item.width, imgMaxH / item.height);
          const w = Math.max(40, Math.floor(item.width * ratio));
          const h = Math.max(40, Math.floor(item.height * ratio));
          const ext = item.file.ext.toLowerCase();
          const imgType: 'png' | 'jpg' = ext === 'jpg' || ext === 'jpeg' ? 'jpg' : 'png';

          const innerParas: Paragraph[] = [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new ImageRun({
                  data: item.bytes as Buffer | Uint8Array,
                  transformation: { width: w, height: h },
                  type: imgType
                } as ConstructorParameters<typeof ImageRun>[0])
              ]
            })
          ];
          if (template.includeCaptions) {
            const caption = item.caption || item.file.filename;
            innerParas.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: caption, italics: true, color: '666666', size: 18 })
                ]
              })
            );
          }
          cells.push(
            new TableCell({
              children: innerParas,
              width: { size: 100 / cols, type: WidthType.PERCENTAGE },
              borders: TRANSPARENT_BORDERS
            })
          );
        }
        rowsArr.push(new TableRow({ children: cells }));
      }
      children.push(
        new Table({
          rows: rowsArr,
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: TRANSPARENT_BORDERS
        })
      );
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: page.width, height: page.height, orientation: page.orientation }
          }
        },
        footers: template.includePageNumbers
          ? {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '888888' }),
                      new TextRun({ text: ' / ', size: 18, color: '888888' }),
                      new TextRun({
                        children: [PageNumber.TOTAL_PAGES],
                        size: 18,
                        color: '888888'
                      })
                    ]
                  })
                ]
              })
            }
          : undefined,
        children
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const ab = await blob.arrayBuffer();
  return new Uint8Array(ab);
}

/* ---------------- save helper ---------------- */

export async function saveDocument(
  bytes: Uint8Array,
  defaultName: string,
  ext: 'pdf' | 'docx'
): Promise<{ cancelled: boolean; path?: string; sizeBytes?: number }> {
  const contentBase64 = fmtBytesToBase64(bytes);
  return window.api.files.saveAs({
    defaultName,
    ext,
    filterLabel: ext === 'pdf' ? 'PDF document' : 'Word document',
    contentBase64
  });
}

void Header;
