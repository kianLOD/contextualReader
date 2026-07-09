import { useMemo, useRef, useState } from 'react';
import { markRareWords, sentenceAt } from '@/lib/wordMarker';
import { WordPopup, type AnchorRect } from '@/components/WordPopup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ActiveWord = {
  word: string;
  sentence: string;
  start: number;
  anchor: AnchorRect;
};

type ReaderProps = {
  bookTitle: string;
  chapterTitle: string;
  text: string;
  chapterLabel?: string;
  precomputeLabel?: string | null;
  onPrevChapter?: () => void;
  onNextChapter?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  resolveMeaning: (word: string, sentence: string) => Promise<{
    meaning: string;
    cultural?: string;
    fromCache: boolean;
  }>;
  resolveCultural: (word: string, sentence: string) => Promise<string | undefined>;
};

export function Reader({
  bookTitle,
  chapterTitle,
  text,
  chapterLabel,
  precomputeLabel,
  onPrevChapter,
  onNextChapter,
  hasPrev,
  hasNext,
  resolveMeaning,
  resolveCultural,
}: ReaderProps) {
  const paragraphs = useMemo(
    () =>
      text
        .split(/\n\n+/)
        .map((p) => p.trim())
        .filter(Boolean),
    [text],
  );

  const [active, setActive] = useState<ActiveWord | null>(null);
  const [meaning, setMeaning] = useState<string | null>(null);
  const [cultural, setCultural] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [culturalLoading, setCulturalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lookupIdRef = useRef(0);

  async function handleWordTap(
    word: string,
    offsetInChapter: number,
    el: HTMLElement,
  ) {
    const rect = el.getBoundingClientRect();
    const sentence = sentenceAt(text, offsetInChapter);
    const id = ++lookupIdRef.current;

    setActive({
      word,
      sentence,
      start: offsetInChapter,
      anchor: {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height,
      },
    });
    setMeaning(null);
    setCultural(null);
    setError(null);
    setLoading(true);

    try {
      const result = await resolveMeaning(word, sentence);
      if (lookupIdRef.current !== id) return;
      setMeaning(result.meaning);
      if (result.cultural) setCultural(result.cultural);
    } catch (err) {
      if (lookupIdRef.current !== id) return;
      setError(err instanceof Error ? err.message : 'Lookup failed');
    } finally {
      if (lookupIdRef.current === id) setLoading(false);
    }
  }

  async function handleCultural() {
    if (!active) return;
    setCulturalLoading(true);
    setError(null);
    try {
      const note = await resolveCultural(active.word, active.sentence);
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

  const paragraphStarts = useMemo(() => {
    const starts: number[] = [];
    let searchFrom = 0;
    for (const paragraph of paragraphs) {
      const idx = text.indexOf(paragraph, searchFrom);
      starts.push(idx < 0 ? searchFrom : idx);
      searchFrom = (idx < 0 ? searchFrom : idx) + paragraph.length;
    }
    return starts;
  }, [paragraphs, text]);

  return (
    <article className="mx-auto max-w-[65ch] px-5 pb-16 pt-10 sm:px-6">
      <header className="mb-9 border-b border-border/70 pb-5">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {bookTitle}
        </p>
        <h1 className="font-reading text-2xl font-semibold leading-snug tracking-tight sm:text-[1.75rem]">
          {chapterTitle}
        </h1>
        {(chapterLabel || precomputeLabel) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {chapterLabel && (
              <Badge variant="secondary" className="font-normal">
                {chapterLabel}
              </Badge>
            )}
            {precomputeLabel && (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                {precomputeLabel}
              </Badge>
            )}
          </div>
        )}
      </header>

      <div className="font-reading text-[1.125rem] leading-[1.75] text-foreground">
        {paragraphs.map((paragraph, i) => {
          const paraStart = paragraphStarts[i] ?? 0;
          const tokens = markRareWords(paragraph);
          return (
            <p key={i} className="mb-[1.15em] last:mb-0">
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
                  >
                    {token.text}
                  </button>
                );
              })}
            </p>
          );
        })}
      </div>

      {(onPrevChapter || onNextChapter) && (
        <div className="mt-10 flex items-center justify-between gap-3 border-t border-border/70 pt-5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasPrev}
            onClick={onPrevChapter}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasNext}
            onClick={onNextChapter}
          >
            Next
          </Button>
        </div>
      )}

      <WordPopup
        open={Boolean(active)}
        word={active?.word ?? ''}
        sentence={active?.sentence ?? ''}
        meaning={meaning}
        cultural={cultural}
        loading={loading}
        culturalLoading={culturalLoading}
        error={error}
        anchor={active?.anchor ?? null}
        onClose={closePopup}
        onRequestCultural={handleCultural}
      />
    </article>
  );
}
