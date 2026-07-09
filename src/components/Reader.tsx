import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { markRareWords, sentenceAt, collectRareWordItems } from '@/lib/wordMarker';
import { paginateParagraphs } from '@/lib/bookParser';
import { WordPopup, type AnchorRect } from '@/components/WordPopup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Bookmark, Chapter } from '@/db/types';
import {
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
  MessageSquareQuoteIcon,
  SettingsIcon,
  XIcon,
} from 'lucide-react';

export type ActiveLookup = {
  label: string;
  selection: string;
  sentence: string;
  start: number;
  anchor: AnchorRect;
  kind: 'word' | 'passage';
};

type ReaderProps = {
  bookId: string;
  bookTitle: string;
  chapters: Chapter[];
  chapterIndex: number;
  pageIndex: number;
  bookmarks: Bookmark[];
  progressPercent: number;
  precomputeLabel?: string | null;
  hoverMeanings?: boolean;
  onChapterChange: (index: number) => void;
  onPageChange: (index: number) => void;
  onAddBookmark: (opts: { pageIndex: number; offset: number; label: string }) => void;
  onDeleteBookmark: (id: string) => void;
  onOpenSettings: () => void;
  resolveMeaning: (word: string, sentence: string) => Promise<{
    meaning: string;
    cultural?: string;
    fromCache: boolean;
  }>;
  resolveCultural: (word: string, sentence: string) => Promise<string | undefined>;
  resolvePassage?: (passage: string, sentence: string) => Promise<string>;
  askAboutPassage?: (passage: string, question: string) => Promise<string>;
  onPageWordKeys?: (keys: string[]) => void;
};

function rectFromDOMRect(r: DOMRect): AnchorRect {
  return {
    top: r.top,
    left: r.left,
    bottom: r.bottom,
    right: r.right,
    width: r.width,
    height: r.height,
  };
}

function isSingleWord(text: string): boolean {
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(text.trim());
}

function firstContentWord(text: string): string {
  const m = text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/);
  return m?.[0] ?? text.trim().slice(0, 40);
}

export function Reader({
  bookTitle,
  chapters,
  chapterIndex,
  pageIndex,
  bookmarks,
  progressPercent,
  precomputeLabel,
  hoverMeanings = false,
  onChapterChange,
  onPageChange,
  onAddBookmark,
  onDeleteBookmark,
  onOpenSettings,
  resolveMeaning,
  resolveCultural,
  resolvePassage,
  askAboutPassage,
  onPageWordKeys,
}: ReaderProps) {
  const chapter = chapters[chapterIndex];
  const text = chapter?.text ?? '';

  const paragraphs = useMemo(
    () =>
      text
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean),
    [text],
  );

  const pages = useMemo(() => paginateParagraphs(paragraphs, 2200), [paragraphs]);
  const safePage = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const pageParagraphs = pages[safePage] ?? [];

  const bodyRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | null>(null);
  const [active, setActive] = useState<ActiveLookup | null>(null);
  const [meaning, setMeaning] = useState<string | null>(null);
  const [cultural, setCultural] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [culturalLoading, setCulturalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tocOpen, setTocOpen] = useState(false);
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [askPassage, setAskPassage] = useState('');
  const [askQuestion, setAskQuestion] = useState('');
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [askLoading, setAskLoading] = useState(false);
  const lookupIdRef = useRef(0);
  const skipSelectionRef = useRef(false);

  // Notify parent of rare-word keys on the current page (for "less" cache mode)
  useEffect(() => {
    if (!onPageWordKeys) return;
    const pageText = pageParagraphs.join('\n\n');
    void collectRareWordItems(pageText).then((items) => {
      onPageWordKeys(items.map((i) => i.wordKey));
    });
  }, [pageParagraphs, onPageWordKeys]);

  // Clamp page when chapter changes
  useEffect(() => {
    if (pageIndex !== safePage) onPageChange(safePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterIndex, pages.length]);

  const runLookup = useCallback(
    async (opts: {
      label: string;
      selection: string;
      sentence: string;
      start: number;
      anchor: AnchorRect;
      kind: 'word' | 'passage';
    }) => {
      const id = ++lookupIdRef.current;
      setActive({
        label: opts.label,
        selection: opts.selection,
        sentence: opts.sentence,
        start: opts.start,
        anchor: opts.anchor,
        kind: opts.kind,
      });
      setMeaning(null);
      setCultural(null);
      setError(null);
      setLoading(true);

      try {
        if (opts.kind === 'passage' && resolvePassage) {
          const answer = await resolvePassage(opts.selection, opts.sentence);
          if (lookupIdRef.current !== id) return;
          setMeaning(answer);
        } else {
          const focus = opts.kind === 'word' ? opts.label : firstContentWord(opts.selection);
          const result = await resolveMeaning(
            focus,
            opts.kind === 'passage' ? opts.selection : opts.sentence,
          );
          if (lookupIdRef.current !== id) return;
          setMeaning(result.meaning);
          if (result.cultural) setCultural(result.cultural);
        }
      } catch (err) {
        if (lookupIdRef.current !== id) return;
        setError(err instanceof Error ? err.message : 'Lookup failed');
      } finally {
        if (lookupIdRef.current === id) setLoading(false);
      }
    },
    [resolveMeaning, resolvePassage],
  );

  async function handleWordTap(word: string, offsetInChapter: number, el: HTMLElement) {
    skipSelectionRef.current = true;
    window.getSelection()?.removeAllRanges();
    const sentence = sentenceAt(text, offsetInChapter);
    await runLookup({
      label: word,
      selection: word,
      sentence,
      start: offsetInChapter,
      anchor: rectFromDOMRect(el.getBoundingClientRect()),
      kind: 'word',
    });
  }

  function handleWordHover(word: string, offsetInChapter: number, el: HTMLElement) {
    if (!hoverMeanings) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => {
      const sentence = sentenceAt(text, offsetInChapter);
      void runLookup({
        label: word,
        selection: word,
        sentence,
        start: offsetInChapter,
        anchor: rectFromDOMRect(el.getBoundingClientRect()),
        kind: 'word',
      });
    }, 450);
  }

  function clearHoverTimer() {
    if (hoverTimer.current) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  }

  function handleTextSelect() {
    if (skipSelectionRef.current) {
      skipSelectionRef.current = false;
      return;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const raw = sel.toString().replace(/\s+/g, ' ').trim();
    if (raw.length < 2) return;
    const range = sel.getRangeAt(0);
    const body = bodyRef.current;
    if (!body || !body.contains(range.commonAncestorContainer)) return;

    const snippet = raw.slice(0, Math.min(48, raw.length));
    let start = text.indexOf(snippet);
    if (start < 0) start = 0;
    const sentence = sentenceAt(text, start);
    const kind = isSingleWord(raw) ? 'word' : 'passage';
    const label = kind === 'word' ? raw : raw.length > 42 ? `${raw.slice(0, 40)}…` : raw;
    sel.removeAllRanges();

    // Also stash for "Ask about selection"
    if (kind === 'passage') setAskPassage(raw);

    void runLookup({
      label,
      selection: raw,
      sentence: kind === 'passage' ? (raw.length > sentence.length ? raw : sentence) : sentence,
      start,
      anchor: rectFromDOMRect(range.getBoundingClientRect()),
      kind,
    });
  }

  async function handleCultural() {
    if (!active || active.kind !== 'word') return;
    setCulturalLoading(true);
    setError(null);
    try {
      const note = await resolveCultural(active.label, active.sentence);
      setCultural(note ?? 'No notable cultural reference or idiom in this sentence.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cultural lookup failed');
    } finally {
      setCulturalLoading(false);
    }
  }

  function closePopup() {
    lookupIdRef.current += 1;
    setActive(null);
    setMeaning(null);
    setCultural(null);
    setError(null);
    setLoading(false);
    setCulturalLoading(false);
  }

  async function submitAsk() {
    if (!askAboutPassage || !askPassage.trim() || !askQuestion.trim()) return;
    setAskLoading(true);
    setAskAnswer(null);
    try {
      const answer = await askAboutPassage(askPassage.trim(), askQuestion.trim());
      setAskAnswer(answer);
    } catch (err) {
      setAskAnswer(err instanceof Error ? err.message : 'Ask failed');
    } finally {
      setAskLoading(false);
    }
  }

  // Offset of current page start within chapter text (for bookmarks)
  const pageOffset = useMemo(() => {
    if (safePage === 0) return 0;
    const before = pages.slice(0, safePage).flat().join('\n\n');
    return before.length + 2;
  }, [pages, safePage]);

  const chapterBookmarks = bookmarks.filter((b) => b.chapterIndex === chapterIndex);

  return (
    <div className="relative mx-auto flex min-h-[calc(100dvh-3.5rem)] max-w-3xl flex-col px-4 pb-8 pt-4 sm:px-6">
      {/* Top chrome */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setTocOpen(true)}>
          <ListIcon className="size-3.5" />
          Chapters
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setBookmarksOpen(true)}>
          <BookmarkIcon className="size-3.5" />
          Bookmarks
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setAskPassage(active?.selection || askPassage);
            setAskOpen(true);
          }}
        >
          <MessageSquareQuoteIcon className="size-3.5" />
          Ask
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onAddBookmark({
              pageIndex: safePage,
              offset: pageOffset,
              label: `${chapter?.title ?? 'Chapter'} · p.${safePage + 1}`,
            })
          }
        >
          Bookmark page
        </Button>
        <div className="ml-auto">
          <Button type="button" variant="ghost" size="sm" onClick={onOpenSettings}>
            <SettingsIcon className="size-3.5" />
            Settings
          </Button>
        </div>
      </div>

      <div className="mb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{bookTitle}</span>
          <span>·</span>
          <span>
            Ch. {chapterIndex + 1}/{chapters.length}
          </span>
          <span>·</span>
          <span>
            Page {safePage + 1}/{pages.length}
          </span>
          {precomputeLabel && (
            <Badge variant="outline" className="font-normal">
              {precomputeLabel}
            </Badge>
          )}
        </div>
        <Progress value={Math.round(progressPercent * 100)} className="h-1.5" />
        <p className="text-[11px] text-muted-foreground">
          {Math.round(progressPercent * 100)}% through book
        </p>
      </div>

      <header className="mb-6 border-b border-border/70 pb-4">
        <h1 className="font-reading text-2xl font-semibold leading-snug tracking-tight">
          {chapter?.title}
        </h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Tap a dotted word, or highlight any word or sentence for its meaning.
        </p>
      </header>

      <div
        ref={bodyRef}
        className="font-reading flex-1 text-[1.125rem] leading-[1.75] text-foreground selection:bg-primary/20"
        onMouseUp={handleTextSelect}
        onTouchEnd={() => window.setTimeout(handleTextSelect, 0)}
      >
        {pageParagraphs.map((paragraph, i) => {
          // Approximate offset within chapter for this paragraph on this page
          const priorOnPage = pageParagraphs.slice(0, i).join('\n\n');
          const paraStart =
            pageOffset + (i === 0 ? 0 : priorOnPage.length + 2);
          const tokens = markRareWords(paragraph);
          return (
            <p key={`${safePage}-${i}`} className="mb-[1.15em] last:mb-0">
              {tokens.map((token, ti) => {
                if (!token.rare) {
                  return <span key={ti}>{token.text}</span>;
                }
                const absoluteStart = paraStart + token.start;
                return (
                  <button
                    key={ti}
                    type="button"
                    className={cn(
                      'cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit',
                      'border-b border-dotted border-muted-foreground/55',
                      'hover:border-muted-foreground/80',
                    )}
                    onClick={(e) =>
                      void handleWordTap(token.text, absoluteStart, e.currentTarget)
                    }
                    onMouseEnter={(e) =>
                      handleWordHover(token.text, absoluteStart, e.currentTarget)
                    }
                    onMouseLeave={clearHoverTimer}
                  >
                    {token.text}
                  </button>
                );
              })}
            </p>
          );
        })}
      </div>

      {/* Page + chapter nav */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={safePage <= 0 && chapterIndex <= 0}
          onClick={() => {
            if (safePage > 0) {
              onPageChange(safePage - 1);
              return;
            }
            if (chapterIndex > 0) {
              const prev = chapters[chapterIndex - 1];
              const prevParas = (prev?.text ?? '')
                .split(/\n\n+/)
                .map((p) => p.trim())
                .filter(Boolean);
              const prevPages = paginateParagraphs(prevParas, 2200);
              onChapterChange(chapterIndex - 1);
              onPageChange(Math.max(0, prevPages.length - 1));
            }
          }}
        >
          <ChevronLeftIcon className="size-3.5" />
          Prev
        </Button>
        <span className="text-xs text-muted-foreground">
          {safePage + 1} / {pages.length}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            safePage >= pages.length - 1 && chapterIndex >= chapters.length - 1
          }
          onClick={() => {
            if (safePage < pages.length - 1) onPageChange(safePage + 1);
            else if (chapterIndex < chapters.length - 1) {
              onChapterChange(chapterIndex + 1);
              onPageChange(0);
            }
          }}
        >
          Next
          <ChevronRightIcon className="size-3.5" />
        </Button>
      </div>

      <WordPopup
        open={Boolean(active)}
        word={active?.label ?? ''}
        sentence={active?.sentence ?? ''}
        meaning={meaning}
        cultural={cultural}
        loading={loading}
        culturalLoading={culturalLoading}
        error={error}
        anchor={active?.anchor ?? null}
        showCultural={active?.kind === 'word'}
        onClose={closePopup}
        onRequestCultural={handleCultural}
      />

      {/* TOC drawer */}
      {tocOpen && (
        <SidePanel title="Chapters" onClose={() => setTocOpen(false)}>
          <ul className="flex flex-col gap-1">
            {chapters.map((ch) => (
              <li key={ch.index}>
                <button
                  type="button"
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                    ch.index === chapterIndex && 'bg-primary/10 font-medium',
                  )}
                  onClick={() => {
                    onChapterChange(ch.index);
                    onPageChange(0);
                    setTocOpen(false);
                  }}
                >
                  {ch.title}
                </button>
              </li>
            ))}
          </ul>
        </SidePanel>
      )}

      {/* Bookmarks drawer */}
      {bookmarksOpen && (
        <SidePanel title="Bookmarks" onClose={() => setBookmarksOpen(false)}>
          {bookmarks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookmarks yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {bookmarks.map((b) => (
                <li
                  key={b.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-border px-3 py-2"
                >
                  <button
                    type="button"
                    className="text-left text-sm hover:underline"
                    onClick={() => {
                      onChapterChange(b.chapterIndex);
                      onPageChange(b.pageIndex);
                      setBookmarksOpen(false);
                    }}
                  >
                    {b.label}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteBookmark(b.id)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {chapterBookmarks.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {chapterBookmarks.length} on this chapter
            </p>
          )}
        </SidePanel>
      )}

      {/* Ask about passage */}
      {askOpen && (
        <SidePanel title="Ask about a passage" onClose={() => setAskOpen(false)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Passage
              </label>
              <Textarea
                value={askPassage}
                onChange={(e) => setAskPassage(e.target.value)}
                rows={5}
                placeholder="Highlight text in the chapter, or paste a passage here…"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Your question
              </label>
              <Textarea
                value={askQuestion}
                onChange={(e) => setAskQuestion(e.target.value)}
                rows={3}
                placeholder="e.g. Why is he afraid of the landlady?"
              />
            </div>
            <Button
              type="button"
              disabled={askLoading || !askPassage.trim() || !askQuestion.trim()}
              onClick={() => void submitAsk()}
            >
              {askLoading ? 'Thinking…' : 'Ask'}
            </Button>
            {askAnswer && (
              <>
                <Separator />
                <p className="font-reading text-sm leading-relaxed">{askAnswer}</p>
              </>
            )}
          </div>
        </SidePanel>
      )}
    </div>
  );
}

function SidePanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-background p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            onClick={onClose}
            aria-label="Close"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}
