import { useCallback, useEffect, useMemo, useState } from 'react';
import { Library } from '@/components/Library';
import { Reader } from '@/components/Reader';
import { ModelManager } from '@/components/ModelManager';
import { ReadingSettingsPanel } from '@/components/ReadingSettingsPanel';
import { Button } from '@/components/ui/button';
import {
  deleteBook,
  deleteBookmark,
  getBook,
  getMeaning,
  getProgress,
  getSettings,
  listBookmarks,
  listBooks,
  putMeaning,
  saveBook,
  saveBookmark,
  saveProgress,
  saveSettings,
} from '@/db';
import type { AppSettings, Book, Bookmark } from '@/db/types';
import { computeBookPercent } from '@/db/types';
import { getTier, type ModelTierId } from '@/constants/modelTiers';
import { hashSentence, makeWordKey } from '@/lib/wordMarker';
import { askPassage, lookupWord } from '@/lib/modelClient';
import {
  cancelUnderstanding,
  enqueueChapterUnderstanding,
  pauseUnderstandingForLookup,
  resumeUnderstandingAfterLookup,
  setUnderstandingPaused,
  type UnderstandingStatus,
} from '@/lib/chapterUnderstanding';
import { paginateParagraphs } from '@/lib/bookParser';
import { SAMPLE_CHAPTER } from '@/data/sampleChapter';
import { log } from '@/lib/logger';
import { applyTheme } from '@/lib/theme';

type View = 'library' | 'reader' | 'model' | 'demo' | 'settings';

export default function App() {
  const [view, setView] = useState<View>('library');
  const [books, setBooks] = useState<Book[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [progressPercent, setProgressPercent] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chapterNotes, setChapterNotes] = useState<string | null>(null);
  const [understanding, setUnderstanding] = useState<UnderstandingStatus>({
    active: false,
    done: 0,
    total: 0,
    paused: false,
    fatalError: null,
    mode: 'less',
    ready: false,
  });

  const refreshBooks = useCallback(async () => {
    setBooks(await listBooks());
  }, []);

  const refreshBookmarks = useCallback(async (bookId: string) => {
    setBookmarks(await listBookmarks(bookId));
  }, []);

  useEffect(() => {
    void (async () => {
      const s = await getSettings();
      setSettings(s);
      applyTheme(s.theme);
      await refreshBooks();
      if (s.lastOpened) {
        const book = await getBook(s.lastOpened.bookId);
        if (book) {
          setActiveBook(book);
          setChapterIndex(s.lastOpened.chapterIndex);
          setPageIndex(s.lastOpened.pageIndex ?? 0);
          await refreshBookmarks(book.id);
          const prog = await getProgress(book.id);
          if (prog) setProgressPercent(prog.percent);
          setView('reader');
        }
      }
    })();
  }, [refreshBooks, refreshBookmarks]);

  const persistSettings = useCallback(async (next: AppSettings) => {
    setSettings(next);
    applyTheme(next.theme);
    await saveSettings(next);
  }, []);

  const chapter = activeBook?.chapters[chapterIndex];
  const pageCount = useMemo(() => {
    if (!chapter) return 1;
    const paras = chapter.text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    return Math.max(1, paginateParagraphs(paras, 2200).length);
  }, [chapter]);

  /** Char offset through the end of the current page (for `less` coverage). */
  const pageEndOffset = useMemo(() => {
    if (!chapter) return 0;
    const paras = chapter.text
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const pages = paginateParagraphs(paras, 2200);
    const safe = Math.min(pageIndex, Math.max(0, pages.length - 1));
    let offset = 0;
    for (let i = 0; i <= safe; i++) {
      const page = pages[i] ?? [];
      for (const p of page) {
        offset += p.length + 2;
      }
    }
    return offset;
  }, [chapter, pageIndex]);

  useEffect(() => {
    if (!activeBook || !settings || view !== 'reader') return;
    const percent = computeBookPercent(
      chapterIndex,
      activeBook.chapters.length,
      Math.min(pageIndex, pageCount - 1),
      pageCount,
    );
    setProgressPercent(percent);
    const safePage = Math.min(pageIndex, pageCount - 1);
    void persistSettings({
      ...settings,
      lastOpened: {
        bookId: activeBook.id,
        chapterIndex,
        pageIndex: safePage,
      },
    });
    void saveProgress({
      bookId: activeBook.id,
      chapterIndex,
      pageIndex: safePage,
      percent,
      updatedAt: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBook?.id, chapterIndex, pageIndex, pageCount, view]);

  async function handleImported(book: Book) {
    await saveBook(book);
    await refreshBooks();
    setActiveBook(book);
    setChapterIndex(0);
    setPageIndex(0);
    await refreshBookmarks(book.id);
    if (settings) {
      await persistSettings({
        ...settings,
        lastOpened: { bookId: book.id, chapterIndex: 0, pageIndex: 0 },
      });
    }
    setView('reader');
  }

  async function handleOpen(bookId: string) {
    const book = await getBook(bookId);
    if (!book) return;
    setActiveBook(book);
    const same = settings?.lastOpened?.bookId === bookId;
    const idx = same ? settings!.lastOpened!.chapterIndex : 0;
    const page = same ? (settings!.lastOpened!.pageIndex ?? 0) : 0;
    setChapterIndex(idx);
    setPageIndex(page);
    await refreshBookmarks(bookId);
    const prog = await getProgress(bookId);
    setProgressPercent(prog?.percent ?? 0);
    setView('reader');
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

  const understandingFocus =
    settings?.cacheMode === 'less' ? pageEndOffset : 0;

  useEffect(() => {
    if (view !== 'reader' || !activeBook || !settings?.modelReady) {
      cancelUnderstanding();
      setChapterNotes(null);
      return;
    }
    if (settings.cacheMode === 'off') {
      cancelUnderstanding();
      setChapterNotes(null);
      return;
    }
    const ch = activeBook.chapters[chapterIndex];
    if (!ch) return;
    void enqueueChapterUnderstanding({
      bookId: activeBook.id,
      chapterIndex,
      chapterTitle: ch.title,
      text: ch.text,
      modelId,
      cacheMode: settings.cacheMode,
      cachePaused: settings.cachePaused,
      focusEndOffset: settings.cacheMode === 'less' ? understandingFocus : null,
      onStatus: setUnderstanding,
      onUnderstanding: setChapterNotes,
    });
    return () => cancelUnderstanding();
  }, [
    view,
    activeBook,
    chapterIndex,
    settings?.modelReady,
    settings?.cacheMode,
    settings?.cachePaused,
    modelId,
    understandingFocus,
  ]);

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
      log.info('cache', `Hit “${word}”`);
      return { meaning: cached.meaning, cultural: cached.cultural, fromCache: true };
    }
    if (!settings.modelReady) {
      return {
        meaning: `“${word}” in this sentence would be explained by the local model. Enable a model under Model settings (needs WebGPU).`,
        fromCache: false,
      };
    }
    await pauseUnderstandingForLookup();
    try {
      log.info('cache', `Miss “${word}” — live lookup`);
      const result = await lookupWord({
        word,
        sentence,
        wantCultural: false,
        modelId,
        chapterUnderstanding: chapterNotes,
      });
      await putMeaning(activeBook.id, chapterIndex, wordKey, {
        word,
        sentence,
        meaning: result.meaning,
        cultural: result.cultural,
        model: modelId,
      });
      return { ...result, fromCache: false };
    } finally {
      await resumeUnderstandingAfterLookup();
    }
  }

  async function resolveCultural(word: string, sentence: string) {
    if (!activeBook || !settings?.modelReady) {
      return 'Enable the local model for cultural notes.';
    }
    const sentenceHash = await hashSentence(sentence);
    const wordKey = makeWordKey(word, sentenceHash);
    const cached = await getMeaning(activeBook.id, chapterIndex, wordKey);
    if (cached?.cultural) return cached.cultural;

    await pauseUnderstandingForLookup();
    try {
      const result = await lookupWord({
        word,
        sentence,
        wantCultural: true,
        modelId,
        chapterUnderstanding: chapterNotes,
      });
      await putMeaning(activeBook.id, chapterIndex, wordKey, {
        word,
        sentence,
        meaning: cached?.meaning ?? result.meaning,
        cultural: result.cultural,
        model: modelId,
      });
      return result.cultural;
    } finally {
      await resumeUnderstandingAfterLookup();
    }
  }

  async function resolvePassage(passage: string) {
    if (!settings?.modelReady) {
      return `In this passage — “${passage.slice(0, 80)}${passage.length > 80 ? '…' : ''}” — the wording carries a specific sense in the story. Enable the local model for a full explanation.`;
    }
    await pauseUnderstandingForLookup();
    try {
      return await askPassage({
        passage,
        question:
          'Explain this highlighted text clearly for a second-language reader. What does it mean in context? Keep it short.',
        modelId,
        chapterUnderstanding: chapterNotes,
      });
    } finally {
      await resumeUnderstandingAfterLookup();
    }
  }

  async function askAboutPassage(passage: string, question: string) {
    if (!settings?.modelReady) {
      return `Model not enabled. Your question was: “${question}” about “${passage.slice(0, 60)}…”. Enable WebLLM under Model to get an answer.`;
    }
    await pauseUnderstandingForLookup();
    try {
      return await askPassage({
        passage,
        question,
        modelId,
        chapterUnderstanding: chapterNotes,
      });
    } finally {
      await resumeUnderstandingAfterLookup();
    }
  }

  const understandingLabel = !settings?.modelReady
    ? 'Model not enabled'
    : settings.cacheMode === 'off'
      ? 'Chapter notes off'
      : understanding.fatalError
        ? 'Model unavailable on this GPU'
        : settings.cachePaused || understanding.paused
          ? `Notes paused ${understanding.done}/${understanding.total || '…'}`
          : understanding.active
            ? `Understanding chapter… ${understanding.done}/${understanding.total}`
            : understanding.ready
              ? 'Chapter notes ready'
              : null;

  const demoChapters = useMemo(
    () => [
      {
        index: 0,
        title: SAMPLE_CHAPTER.chapterTitle,
        text: SAMPLE_CHAPTER.text,
      },
    ],
    [],
  );

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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
          >
            Settings
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

        {view === 'reader' && activeBook && chapter && settings && (
          <Reader
            bookId={activeBook.id}
            bookTitle={activeBook.title}
            chapters={activeBook.chapters}
            chapterIndex={chapterIndex}
            pageIndex={pageIndex}
            bookmarks={bookmarks}
            progressPercent={progressPercent}
            statusLabel={understandingLabel}
            hoverMeanings={settings.hoverMeanings}
            onChapterChange={(idx) => {
              setChapterIndex(idx);
              setPageIndex(0);
            }}
            onPageChange={(idx) => setPageIndex(Math.max(0, idx))}
            onAddBookmark={(opts) => {
              const bm = {
                id: crypto.randomUUID(),
                bookId: activeBook.id,
                chapterIndex,
                pageIndex: opts.pageIndex,
                offset: opts.offset,
                label: opts.label,
                createdAt: Date.now(),
              };
              void saveBookmark(bm).then(() => refreshBookmarks(activeBook.id));
            }}
            onDeleteBookmark={(id) => {
              void deleteBookmark(id).then(() => refreshBookmarks(activeBook.id));
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            resolveMeaning={resolveMeaning}
            resolveCultural={resolveCultural}
            resolvePassage={resolvePassage}
            askAboutPassage={askAboutPassage}
          />
        )}

        {view === 'demo' && (
          <Reader
            bookId="demo"
            bookTitle={SAMPLE_CHAPTER.title}
            chapters={demoChapters}
            chapterIndex={0}
            pageIndex={0}
            bookmarks={[]}
            progressPercent={0}
            statusLabel={null}
            hoverMeanings={settings?.hoverMeanings ?? false}
            onChapterChange={() => undefined}
            onPageChange={() => undefined}
            onAddBookmark={() => undefined}
            onDeleteBookmark={() => undefined}
            onOpenSettings={() => setSettingsOpen(true)}
            resolveMeaning={async (word) => ({
              meaning: `In this sentence, “${word}” carries a sense that fits the surrounding story — a contextual gloss, not a dictionary dump of senses.`,
              fromCache: true,
            })}
            resolveCultural={async () =>
              'Optional cultural note would appear only after you ask for it.'
            }
            resolvePassage={async (passage) =>
              `This highlighted passage (“${passage.slice(0, 60)}${passage.length > 60 ? '…' : ''}”) would be explained in context once the local model is enabled.`
            }
            askAboutPassage={async (passage, question) =>
              `Demo answer for “${question}” about “${passage.slice(0, 40)}…”. Enable the model for real answers.`
            }
          />
        )}
      </main>

      {settings && (
        <ReadingSettingsPanel
          open={settingsOpen}
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onChange={(next) => {
            void persistSettings(next);
            if (next.cachePaused !== settings.cachePaused) {
              void setUnderstandingPaused(next.cachePaused);
            }
          }}
          onToggleCachePaused={() => {
            const next = { ...settings, cachePaused: !settings.cachePaused };
            void persistSettings(next);
            void setUnderstandingPaused(next.cachePaused);
          }}
        />
      )}
    </div>
  );
}
