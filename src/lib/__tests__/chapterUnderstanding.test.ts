import { describe, expect, it } from 'vitest';
import { splitChapterChunks } from '@/lib/chapterUnderstanding';

describe('splitChapterChunks', () => {
  it('returns a single chunk for short text', () => {
    const chunks = splitChapterChunks('Hello world.\n\nSecond para.', 100);
    expect(chunks).toEqual(['Hello world.\n\nSecond para.']);
  });

  it('splits long chapters on paragraph boundaries', () => {
    const a = 'A'.repeat(50);
    const b = 'B'.repeat(50);
    const c = 'C'.repeat(50);
    const text = `${a}\n\n${b}\n\n${c}`;
    const chunks = splitChapterChunks(text, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('\n\n').replace(/\n\n/g, '')).toContain('A');
    expect(chunks.some((ch) => ch.includes('C'))).toBe(true);
  });
});
