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

export type AppSettings = {
  modelTier: 'light' | 'balanced' | 'best';
  persistGranted: boolean;
  lastOpened: { bookId: string; chapterIndex: number } | null;
  modelReady: boolean;
};

export function meaningsKey(
  bookId: string,
  chapterIndex: number,
  wordKey: string,
): string {
  return `${bookId}:${chapterIndex}:${wordKey}`;
}
