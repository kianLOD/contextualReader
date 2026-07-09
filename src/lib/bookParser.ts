import type { Book, Chapter } from '@/db/types';

function newId(): string {
  return crypto.randomUUID();
}

function normalizeInlineText(raw: string): string {
  return raw
    .replace(/\u00ad/g, '') // soft hyphen
    .replace(/\u00a0/g, ' ') // nbsp
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Walk a block element and preserve intentional breaks:
 * - <br> / <br/> → newline inside the paragraph
 * - nested inline spans (dropcaps, etc.) stay one flowing sentence
 */
function blockElementToText(el: Element): string {
  const parts: string[] = [];

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? '';
      if (t) parts.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const child = node as Element;
    const tag = child.tagName.toLowerCase();
    if (tag === 'br') {
      parts.push('\n');
      return;
    }
    if (tag === 'script' || tag === 'style') return;
    // Block children inside a <p> are uncommon; treat as paragraph break.
    if (['p', 'div', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4'].includes(tag)) {
      if (parts.length && !parts[parts.length - 1]?.endsWith('\n')) parts.push('\n');
      child.childNodes.forEach(walk);
      if (parts.length && !parts[parts.length - 1]?.endsWith('\n')) parts.push('\n');
      return;
    }
    child.childNodes.forEach(walk);
  };

  el.childNodes.forEach(walk);
  return normalizeInlineText(parts.join('').replace(/[ \t]*\n[ \t]*/g, '\n'));
}

/** Turn EPUB/XHTML into readable paragraphs (preserve <p> / headings / <br>). */
export function htmlToParagraphText(html: string): { title: string | null; text: string } {
  // Prefer HTML parser — many EPUBs are XHTML-ish but DOMParser XHTML is stricter.
  let root = new DOMParser().parseFromString(html, 'text/html');
  if (!root.body || root.body.childNodes.length === 0) {
    const xhtml = new DOMParser().parseFromString(html, 'application/xhtml+xml');
    if (xhtml.querySelector('parsererror') == null) root = xhtml as unknown as Document;
  }

  root.querySelectorAll('script, style, nav, link').forEach((el) => el.remove());

  const headingEl = root.querySelector('h1, h2, h3');
  const title =
    headingEl?.textContent?.replace(/\s+/g, ' ').trim() ||
    root.querySelector('title')?.textContent?.replace(/\s+/g, ' ').trim() ||
    null;

  const blocks: string[] = [];
  const body = root.body ?? root.documentElement;

  const pushBlock = (text: string) => {
    const t = text.trim();
    if (t) blocks.push(t);
  };

  // Document order: collect top-level-ish block content
  const blockSelector = 'p, h1, h2, h3, h4, blockquote, li, pre';
  const blockNodes = Array.from(body.querySelectorAll(blockSelector));

  if (blockNodes.length > 0) {
    for (const el of blockNodes) {
      // Skip nested blocks already covered by an ancestor we collect
      if (el.parentElement?.closest(blockSelector) && el.parentElement !== body) {
        // Still allow <p> inside blockquote/li — those parents are in the selector.
        // Skip only if ancestor is also a collected block of the same "leaf" kind.
        const ancestor = el.parentElement.closest('p, li, pre');
        if (ancestor && ancestor !== el) continue;
      }
      if (headingEl && el === headingEl) continue;
      if (title && /^(h1|h2|h3|h4)$/i.test(el.tagName) && el.textContent?.trim() === title) {
        continue;
      }
      pushBlock(blockElementToText(el));
    }
  } else {
    // Fallback: split on blank lines from body text
    const fallback = normalizeInlineText(body.textContent ?? '');
    fallback
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach(pushBlock);
  }

  return {
    title,
    // Blank line between paragraphs — Reader splits on /\n\n+/
    text: blocks.join('\n\n').trim(),
  };
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

function looksLikeFrontMatter(title: string, text: string, href: string): boolean {
  const t = `${title} ${href} ${text.slice(0, 400)}`.toLowerCase();
  if (
    /cover|titlepage|title.?page|htmltoc|toc\.xhtml|toc\.html|contents|copyright|imprint|certificate of incorporation|registration number|bb\s*ebooks|published in \d{4} by/.test(
      t,
    )
  ) {
    return true;
  }
  // Tiny spine items (half-title, part divider already handled elsewhere)
  if (text.length < 500 && !/chapter\s+\w+/i.test(title) && !/preface|introduction/i.test(title)) {
    return true;
  }
  return false;
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
    opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() ||
    opf.querySelector('metadata title, title')?.textContent?.trim() ||
    file.name.replace(/\.epub$/i, '') ||
    'Untitled';

  const manifest = new Map<string, { href: string; mediaType: string }>();
  opf.querySelectorAll('manifest > item').forEach((item) => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type') ?? '';
    if (id && href) manifest.set(id, { href, mediaType });
  });

  const spineIds = Array.from(opf.querySelectorAll('spine > itemref'))
    .map((el) => el.getAttribute('idref'))
    .filter((id): id is string => Boolean(id));

  const chapters: Chapter[] = [];
  let partPrefix = '';

  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) continue;
    if (item.mediaType && !/html|xml/i.test(item.mediaType)) continue;

    const path = resolvePath(rootfile, item.href);
    const html = await zip.file(path)?.async('string');
    if (!html) continue;

    const { title: sectionTitle, text } = htmlToParagraphText(html);
    if (!text || text.length < 80) {
      if (sectionTitle && /^part\b/i.test(sectionTitle)) {
        partPrefix = sectionTitle;
      }
      continue;
    }

    const heading = sectionTitle || `Section ${chapters.length + 1}`;
    if (looksLikeFrontMatter(heading, text, item.href)) {
      continue;
    }

    if (/table of contents/i.test(heading)) continue;

    let displayTitle = heading;
    if (partPrefix && /^chapter\b/i.test(heading)) {
      displayTitle = `${partPrefix} · ${heading}`;
    }
    if (/^part\b/i.test(heading) && text.length < 400) {
      partPrefix = heading;
      continue;
    }

    chapters.push({
      index: chapters.length,
      title: displayTitle,
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

/** Split chapter paragraphs into pages of roughly `targetChars`. */
export function paginateParagraphs(
  paragraphs: string[],
  targetChars = 2200,
): string[][] {
  if (paragraphs.length === 0) return [[]];
  const pages: string[][] = [];
  let current: string[] = [];
  let size = 0;

  for (const p of paragraphs) {
    const len = p.length + 2;
    if (current.length > 0 && size + len > targetChars) {
      pages.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += len;
  }
  if (current.length) pages.push(current);
  return pages.length ? pages : [[]];
}
