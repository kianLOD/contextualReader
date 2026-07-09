import type { Book, Chapter } from '@/db/types';

function newId(): string {
  return crypto.randomUUID();
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style').forEach((el) => el.remove());
  const text = doc.body.textContent ?? '';
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitTxtChapters(text: string, fallbackTitle: string): Chapter[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const parts = normalized.split(/\n(?=Chapter\s+\d+)/i).filter((p) => p.trim());
  if (parts.length > 1) {
    return parts.map((part, index) => {
      const lines = part.trim().split('\n');
      const title = lines[0]?.trim() || `Chapter ${index + 1}`;
      const body = lines.slice(1).join('\n').trim() || part.trim();
      return { index, title, text: body };
    });
  }
  return [{ index: 0, title: fallbackTitle, text: normalized }];
}

export async function parseTxtFile(file: File): Promise<Book> {
  const text = await file.text();
  const title = file.name.replace(/\.txt$/i, '') || 'Untitled';
  return {
    id: newId(),
    title,
    addedAt: Date.now(),
    chapters: splitTxtChapters(text, 'Chapter 1'),
  };
}

function resolvePath(base: string, relative: string): string {
  const cleaned = relative.replace(/^\//, '');
  const baseParts = base.split('/').filter(Boolean);
  baseParts.pop();
  const relParts = cleaned.split('/');
  for (const part of relParts) {
    if (part === '..') baseParts.pop();
    else if (part !== '.') baseParts.push(part);
  }
  return baseParts.join('/');
}

export async function parseEpubFile(file: File): Promise<Book> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Invalid EPUB: missing container.xml');

  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const rootfile = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!rootfile) throw new Error('Invalid EPUB: missing rootfile');

  const opfText = await zip.file(rootfile)?.async('string');
  if (!opfText) throw new Error('Invalid EPUB: missing OPF');

  const opf = new DOMParser().parseFromString(opfText, 'application/xml');
  const title =
    opf.querySelector('metadata > title, dc\\:title, title')?.textContent?.trim() ||
    file.name.replace(/\.epub$/i, '') ||
    'Untitled';

  const manifest = new Map<string, string>();
  opf.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  });

  const spineIds = Array.from(opf.querySelectorAll('spine > itemref'))
    .map((el) => el.getAttribute('idref'))
    .filter((id): id is string => Boolean(id));

  const chapters: Chapter[] = [];
  for (const id of spineIds) {
    const href = manifest.get(id);
    if (!href) continue;
    const path = resolvePath(rootfile, href);
    const html = await zip.file(path)?.async('string');
    if (!html) continue;
    const text = stripHtml(html);
    if (text.length < 40) continue;
    const heading =
      new DOMParser()
        .parseFromString(html, 'text/html')
        .querySelector('h1, h2, h3, title')
        ?.textContent?.trim() || `Chapter ${chapters.length + 1}`;
    chapters.push({
      index: chapters.length,
      title: heading,
      text,
    });
  }

  if (chapters.length === 0) {
    throw new Error('No readable chapters found in EPUB');
  }

  return {
    id: newId(),
    title,
    addedAt: Date.now(),
    chapters,
  };
}

export async function parseBookFile(file: File): Promise<Book> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.epub')) return parseEpubFile(file);
  if (name.endsWith('.txt')) return parseTxtFile(file);
  throw new Error('Unsupported file type. Use .epub or .txt');
}
