export type Chapter = {
  index: number;
  title: string;
  text: string;
};

export type Book = {
  id: string;
  title: string;
  addedAt: number;
  chapters: Chapter[];
};

export type MeaningRecord = {
  word: string;
  sentence: string;
  meaning: string;
  cultural?: string;
  model: string;
};

export type Bookmark = {
  id: string;
  bookId: string;
  chapterIndex: number;
  pageIndex: number;
  offset: number;
  label: string;
  createdAt: number;
};

export type ReadingProgress = {
  bookId: string;
  chapterIndex: number;
  pageIndex: number;
  /** 0–1 overall book progress. */
  percent: number;
  updatedAt: number;
};

export type ThemeMode = 'light' | 'dark' | 'sepia' | 'system';

/**
 * Background chapter-understanding intensity.
 * Replaces the old per-word meaning warm-up cache modes.
 */
export type CacheMode = 'off' | 'less' | 'full';

export type ChapterUnderstanding = {
  bookId: string;
  chapterIndex: number;
  /** Compact notes the model reuses for lookups / Ask. */
  text: string;
  model: string;
  /** How much of the chapter was covered (chars). */
  coveredChars: number;
  updatedAt: number;
};

export type AppSettings = {
  modelTier: 'light' | 'balanced' | 'best';
  persistGranted: boolean;
  lastOpened: {
    bookId: string;
    chapterIndex: number;
    pageIndex?: number;
  } | null;
  modelReady: boolean;
  hoverMeanings: boolean;
  theme: ThemeMode;
  /** Chapter understanding mode (legacy field name kept for settings migration). */
  cacheMode: CacheMode;
  /** Manual pause independent of mode. */
  cachePaused: boolean;
};

export function meaningsKey(
  bookId: string,
  chapterIndex: number,
  wordKey: string,
): string {
  return `${bookId}:${chapterIndex}:${wordKey}`;
}

export function chapterUnderstandingKey(
  bookId: string,
  chapterIndex: number,
): string {
  return `${bookId}:${chapterIndex}`;
}

export function computeBookPercent(
  chapterIndex: number,
  chapterCount: number,
  pageIndex: number,
  pageCount: number,
): number {
  if (chapterCount <= 0) return 0;
  const pageFrac =
    pageCount <= 1 ? 0 : Math.min(1, Math.max(0, pageIndex / (pageCount - 1)));
  return Math.min(1, (chapterIndex + pageFrac) / chapterCount);
}
