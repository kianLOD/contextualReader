import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppSettings, Book, MeaningRecord } from './types';
import { meaningsKey } from './types';

interface ContextualReaderDB extends DBSchema {
  books: {
    key: string;
    value: Book;
  };
  meanings: {
    key: string;
    value: MeaningRecord & { key: string };
  };
  settings: {
    key: string;
    value: AppSettings;
  };
}

const DB_NAME = 'contextual-reader';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ContextualReaderDB>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<ContextualReaderDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meanings')) {
          db.createObjectStore('meanings', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return dbPromise;
}

const DEFAULT_SETTINGS: AppSettings = {
  modelTier: 'balanced',
  persistGranted: false,
  lastOpened: null,
  modelReady: false,
};

export async function listBooks(): Promise<Book[]> {
  const db = await getDb();
  const books = await db.getAll('books');
  return books.sort((a, b) => b.addedAt - a.addedAt);
}

export async function getBook(id: string): Promise<Book | undefined> {
  const db = await getDb();
  return db.get('books', id);
}

export async function saveBook(book: Book): Promise<void> {
  const db = await getDb();
  await db.put('books', book);
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('books', id);
  const keys = await db.getAllKeys('meanings');
  const prefix = `${id}:`;
  await Promise.all(
    keys.filter((k) => String(k).startsWith(prefix)).map((k) => db.delete('meanings', k)),
  );
}

export async function getMeaning(
  bookId: string,
  chapterIndex: number,
  wordKey: string,
): Promise<MeaningRecord | undefined> {
  const db = await getDb();
  const row = await db.get('meanings', meaningsKey(bookId, chapterIndex, wordKey));
  if (!row) return undefined;
  const { key: _key, ...rest } = row;
  return rest;
}

export async function putMeaning(
  bookId: string,
  chapterIndex: number,
  wordKey: string,
  record: MeaningRecord,
): Promise<void> {
  const db = await getDb();
  await db.put('meanings', {
    key: meaningsKey(bookId, chapterIndex, wordKey),
    ...record,
  });
}

export async function hasMeaning(
  bookId: string,
  chapterIndex: number,
  wordKey: string,
): Promise<boolean> {
  const db = await getDb();
  const key = meaningsKey(bookId, chapterIndex, wordKey);
  return (await db.count('meanings', key)) > 0;
}

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  return (await db.get('settings', 'app')) ?? { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await getDb();
  await db.put('settings', settings, 'app');
}
