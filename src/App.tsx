import { useCallback, useEffect, useState } from 'react';
import { Library } from '@/components/Library';
import { Reader } from '@/components/Reader';
import { ModelManager } from '@/components/ModelManager';
import { Button } from '@/components/ui/button';
import {
  deleteBook,
  getBook,
  getMeaning,
  getSettings,
  listBooks,
  putMeaning,
  saveBook,
  saveSettings,
} from '@/db';
import type { AppSettings, Book } from '@/db/types';
import { getTier, type ModelTierId } from '@/constants/modelTiers';
import { hashSentence, makeWordKey } from '@/lib/wordMarker';
import { lookupWord } from '@/lib/modelClient';
import {
  cancelPrecompute,
  enqueueChapterPrecompute,
  type PrecomputeStatus,
} from '@/lib/precomputeQueue';
import { SAMPLE_CHAPTER } from '@/data/sampleChapter';

type View = 'library' | 'reader' | 'model' | 'demo';

export default function App() {
  const [view, setView] = useState<View>('library');
  const [books, setBooks] = useState<Book[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [precompute, setPrecompute] = useState<PrecomputeStatus>({
    active: false,
    done: 0,
    total: 0,
  });

  const refreshBooks = useCallback(async () => {
    setBooks(await listBooks());
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setSettings(s);
      await refreshBooks();
      if (s.lastOpened) {
        const book = await getBook(s.lastOpened.bookId);
        if (book) {
          setActiveBook(book);
          setChapterIndex(s.lastOpened.chapterIndex);
          setView(s.modelReady ? 'reader' : 'library');
        }
      }
    })();
  }, [refreshBooks]);

  const persistSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    await saveSettings(next);
  }, []);

  async function handleImported(book: Book) {
    await saveBook(book);
    await refreshBooks();
    setActiveBook(book);
    setChapterIndex(0);
    if (settings) {
      await persistSettings({
        ...settings,
        lastOpened: { bookId: book.id, chapterIndex: 0 },
      });
    }
    setView(settings?.modelReady ? 'reader' : 'model');
  }

  async function handleOpen(bookId: string) {
    const book = await getBook(bookId);
    if (!book) return;
    setActiveBook(book);
    const idx = settings?.lastOpened?.bookId === bookId ? settings.lastOpened.chapterIndex : 0;
    setChapterIndex(idx);
    if (settings) {
      await persistSettings({
        ...settings,
        lastOpened: { bookId, chapterIndex: idx },
      });
    }
    setView(settings?.modelReady ? 'reader' : 'model');
  }

  async function handleDelete(bookId: string) {
    await deleteBook(bookId);
    if (activeBook?.id === bookId) {
      setActiveBook(null);
      setView('library');
    }
    await refreshBooks();
  }

  const modelId = settings ? getTier(settings.modelTier).modelId : getTier('balanced').modelId;

  useEffect(() => {
    if (view !== 'reader' || !activeBook || !settings?.modelReady) {
      cancelPrecompute();
      return;
    }
    const chapter = activeBook.chapters[chapterIndex];
    if (!chapter) return;
    void enqueueChapterPrecompute({
      bookId: activeBook.id,
      chapterIndex,
      text: chapter.text,
      modelId,
      onStatus: setPrecompute,
    });
    return () => cancelPrecompute();
  }, [view, activeBook, chapterIndex, settings?.modelReady, modelId]);

  async function resolveMeaning(word: string, sentence: string) {
    if (!activeBook || !settings) {
      return {
        meaning: `In this sentence, “${word}” is used in a specific sense that fits the surrounding story — not a generic dictionary list.`,
        fromCache: true,
      };
    }
    const sentenceHash = await hashSentence(sentence);
    const wordKey = makeWordKey(word, sentenceHash);
    const cached = await getMeaning(activeBook.id, chapterIndex, wordKey);
    if (cached) {
      return { meaning: cached.meaning, cultural: cached.cultural, fromCache: true };
    }
    if (!settings.modelReady) {
      throw new Error('Enable the local model to look up meanings.');
    }
    const result = await lookupWord({
      word,
      sentence,
      wantCultural: false,
      modelId,
    });
    await putMeaning(activeBook.id, chapterIndex, wordKey, {
      word,
      sentence,
      meaning: result.meaning,
      cultural: result.cultural,
      model: modelId,
    });
    return { ...result, fromCache: false };
  }

  async function resolveCultural(word: string, sentence: string) {
    if (!activeBook || !settings?.modelReady) {
      throw new Error('Enable the local model for cultural notes.');
    }
    const sentenceHash = await hashSentence(sentence);
    const wordKey = makeWordKey(word, sentenceHash);
    const cached = await getMeaning(activeBook.id, chapterIndex, wordKey);
    if (cached?.cultural) return cached.cultural;

    const result = await lookupWord({
      word,
      sentence,
      wantCultural: true,
      modelId,
    });
    await putMeaning(activeBook.id, chapterIndex, wordKey, {
      word,
      sentence,
      meaning: cached?.meaning ?? result.meaning,
      cultural: result.cultural,
      model: modelId,
    });
    return result.cultural;
  }

  const chapter = activeBook?.chapters[chapterIndex];
  const precomputeLabel = precompute.active
    ? `Caching meanings ${precompute.done}/${precompute.total}`
    : precompute.total > 0
      ? 'Meanings cached'
      : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/80 bg-background/90 px-4 py-3 backdrop-blur-md sm:px-5">
        <button
          type="button"
          className="text-sm font-semibold tracking-wide"
          onClick={() => setView('library')}
        >
          Contextual Reader
        </button>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setView('demo')}>
            Demo
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setView('model')}>
            Model
          </Button>
          {view !== 'library' && (
            <Button type="button" variant="outline" size="sm" onClick={() => setView('library')}>
              Library
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1">
        {view === 'library' && (
          <Library
            books={books}
            onOpen={(id) => void handleOpen(id)}
            onDelete={(id) => void handleDelete(id)}
            onImported={(book) => void handleImported(book)}
          />
        )}

        {view === 'model' && settings && (
          <ModelManager
            selectedTier={settings.modelTier}
            modelReady={settings.modelReady}
            onTierChange={(tier: ModelTierId) =>
              void persistSettings({ ...settings, modelTier: tier })
            }
            onReady={({ tier, persistGranted }) =>
              void persistSettings({
                ...settings,
                modelTier: tier,
                persistGranted,
                modelReady: true,
              }).then(() => setView(activeBook ? 'reader' : 'library'))
            }
            onSkip={() => setView(activeBook ? 'reader' : 'library')}
          />
        )}

        {view === 'reader' && activeBook && chapter && (
          <Reader
            bookTitle={activeBook.title}
            chapterTitle={chapter.title}
            text={chapter.text}
            chapterLabel={`Chapter ${chapterIndex + 1} of ${activeBook.chapters.length}`}
            precomputeLabel={settings?.modelReady ? precomputeLabel : 'Model not enabled'}
            hasPrev={chapterIndex > 0}
            hasNext={chapterIndex < activeBook.chapters.length - 1}
            onPrevChapter={() => {
              const next = Math.max(0, chapterIndex - 1);
              setChapterIndex(next);
              if (settings) {
                void persistSettings({
                  ...settings,
                  lastOpened: { bookId: activeBook.id, chapterIndex: next },
                });
              }
            }}
            onNextChapter={() => {
              const next = Math.min(activeBook.chapters.length - 1, chapterIndex + 1);
              setChapterIndex(next);
              if (settings) {
                void persistSettings({
                  ...settings,
                  lastOpened: { bookId: activeBook.id, chapterIndex: next },
                });
              }
            }}
            resolveMeaning={resolveMeaning}
            resolveCultural={resolveCultural}
          />
        )}

        {view === 'demo' && (
          <Reader
            bookTitle={SAMPLE_CHAPTER.title}
            chapterTitle={SAMPLE_CHAPTER.chapterTitle}
            text={SAMPLE_CHAPTER.text}
            chapterLabel="Sample chapter"
            precomputeLabel={null}
            resolveMeaning={async (word) => ({
              meaning: `In this sentence, “${word}” carries a sense that fits the surrounding story — a contextual gloss, not a dictionary dump of senses.`,
              fromCache: true,
            })}
            resolveCultural={async () =>
              'Optional cultural note would appear only after you ask for it.'
            }
          />
        )}
      </main>
    </div>
  );
}
