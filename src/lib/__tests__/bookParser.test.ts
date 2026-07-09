import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { htmlToParagraphText, parseEpubFile, paginateParagraphs } from '@/lib/bookParser';

const EPUB_PATH = '/home/kian/Downloads/CrimePunishment-EPUB2.epub';

describe('htmlToParagraphText', () => {
  it('keeps separate <p> blocks as blank-line-separated paragraphs', () => {
    const html = `
      <html><body>
        <h2>Chapter One</h2>
        <p><span>O</span><span>n an exceptionally hot evening</span> early in July.</p>
        <p>He had successfully avoided meeting his landlady.</p>
        <p>This was not because he was cowardly.</p>
      </body></html>
    `;
    const { title, text } = htmlToParagraphText(html);
    expect(title).toBe('Chapter One');
    const paras = text.split(/\n\n+/);
    expect(paras).toHaveLength(3);
    expect(paras[0]).toMatch(/^On an exceptionally hot evening/);
    expect(paras[1]).toMatch(/^He had successfully avoided/);
    // Dropcap spans must not insert breaks inside the sentence
    expect(paras[0]).not.toContain('\n');
  });

  it('preserves <br> as a soft line break inside a paragraph', () => {
    const html = `
      <html><body>
        <p>First line<br/>Second line<br>Third line</p>
        <p>Next paragraph</p>
      </body></html>
    `;
    const { text } = htmlToParagraphText(html);
    const paras = text.split(/\n\n+/);
    expect(paras).toHaveLength(2);
    expect(paras[0].split('\n')).toEqual(['First line', 'Second line', 'Third line']);
    expect(paras[1]).toBe('Next paragraph');
  });
});

describe('paginateParagraphs', () => {
  it('does not split a short chapter into empty pages', () => {
    const pages = paginateParagraphs(['a', 'b'], 100);
    expect(pages).toEqual([['a', 'b']]);
  });
});

describe('parseEpubFile (Crime and Punishment)', () => {
  it.skipIf(!existsSync(EPUB_PATH))(
    'extracts titled chapters with real paragraph breaks',
    async () => {
      const buf = readFileSync(EPUB_PATH);
      const file = new File([buf], 'CrimePunishment-EPUB2.epub', {
        type: 'application/epub+zip',
      });
      const book = await parseEpubFile(file);

      expect(book.title).toMatch(/Crime and Punishment/i);
      expect(book.chapters.length).toBeGreaterThan(20);

      const chapterOne = book.chapters.find((c) => /Chapter One/i.test(c.title));
      expect(chapterOne).toBeTruthy();

      const paras = chapterOne!.text.split(/\n\n+/).filter(Boolean);
      expect(paras.length).toBeGreaterThan(20);
      expect(paras[0]).toMatch(/exceptionally hot evening/i);
      expect(paras[1]).toMatch(/landlady/i);

      // Must not be one giant smashed blob
      expect(chapterOne!.text.includes('\n\n')).toBe(true);
      expect(paras[0].length).toBeLessThan(800);
    },
  );
});
