import { describe, expect, it } from 'vitest';
import { renderFilenameTemplate } from '../src/shared/filename-template';

const fixedDate = new Date('2026-06-08T14:23:45');

describe('renderFilenameTemplate', () => {
  it('expands all known tokens', () => {
    const name = renderFilenameTemplate(
      '{app}_{type}_{source}_{date}_{time}_{counter}',
      {
        app: 'Ingestra',
        type: 'recording',
        source: 'Display 1',
        ext: 'webm',
        counter: 7,
        date: fixedDate
      }
    );
    expect(name).toBe('Ingestra_recording_Display 1_2026-06-08_142345_0007.webm');
  });

  it('zero-pads the counter to 4 digits', () => {
    const a = renderFilenameTemplate('{counter}', {
      app: 'a',
      type: 'recording',
      source: 's',
      ext: 'webm',
      counter: 3,
      date: fixedDate
    });
    expect(a).toBe('0003.webm');
  });

  it('handles year/month/day/hour/minute/second tokens individually', () => {
    const name = renderFilenameTemplate(
      '{year}-{month}-{day}T{hour}{minute}{second}',
      {
        app: 'a',
        type: 'recording',
        source: 's',
        ext: 'png',
        counter: 1,
        date: fixedDate
      }
    );
    expect(name).toBe('2026-06-08T142345.png');
  });

  it('sanitizes characters illegal in Windows filenames', () => {
    const name = renderFilenameTemplate('{source}', {
      app: 'a',
      type: 'screenshot',
      source: 'foo/bar:baz<>"|?*',
      ext: 'png',
      counter: 1,
      date: fixedDate
    });
    // /, :, <, >, ", |, ?, * should all be replaced with underscore
    expect(name).not.toMatch(/[/:<>"|?*]/);
    expect(name).toMatch(/\.png$/);
  });

  it('falls back to "capture" when the template renders to empty', () => {
    const name = renderFilenameTemplate('{source}', {
      app: 'a',
      type: 'recording',
      source: '   ',
      ext: 'webm',
      counter: 1,
      date: fixedDate
    });
    expect(name).toBe('capture.webm');
  });

  it('preserves the extension exactly as given', () => {
    for (const ext of ['png', 'jpg', 'webp', 'bmp', 'tiff', 'mp4', 'mkv', 'webm']) {
      const name = renderFilenameTemplate('{app}', {
        app: 'a',
        type: 'recording',
        source: 's',
        ext,
        counter: 1,
        date: fixedDate
      });
      expect(name.endsWith(`.${ext}`)).toBe(true);
    }
  });

  it('does not blow up on an empty template', () => {
    const name = renderFilenameTemplate('', {
      app: 'a',
      type: 'recording',
      source: 's',
      ext: 'webm',
      counter: 1,
      date: fixedDate
    });
    expect(name).toBe('capture.webm');
  });
});
