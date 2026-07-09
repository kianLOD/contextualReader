import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const AUTO_DISMISS_MS = 10_000;
const AUTO_DISMISS_SECS = 10;
const POPUP_MAX_WIDTH = 320;
const GAP = 8;

export type AnchorRect = {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
};

export type WordPopupProps = {
  open: boolean;
  word: string;
  sentence: string;
  meaning: string | null;
  cultural: string | null;
  loading: boolean;
  culturalLoading: boolean;
  error: string | null;
  anchor: AnchorRect | null;
  /** Hide cultural button for passage explanations. Default true. */
  showCultural?: boolean;
  onClose: () => void;
  onRequestCultural: () => void;
};

type Position = { top: number; left: number };

/** Always prefer above the word so reading below stays clear. */
function computePosition(anchor: AnchorRect, popupHeight: number): Position {
  const vw = window.innerWidth;
  const width = Math.min(POPUP_MAX_WIDTH, vw - 16);

  let left = anchor.left + anchor.width / 2 - width / 2;
  left = Math.max(8, Math.min(left, vw - width - 8));

  const aboveTop = anchor.top - GAP - popupHeight;
  const top = aboveTop >= 8 ? aboveTop : 8;

  return { top, left };
}

export function WordPopup({
  open,
  word,
  sentence,
  meaning,
  cultural,
  loading,
  culturalLoading,
  error,
  anchor,
  showCultural = true,
  onClose,
  onRequestCultural,
}: WordPopupProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [showSentence, setShowSentence] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const dismissTimer = useRef<number | null>(null);
  const tickTimer = useRef<number | null>(null);
  const touchedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  function clearTimers() {
    if (dismissTimer.current !== null) {
      window.clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
    if (tickTimer.current !== null) {
      window.clearInterval(tickTimer.current);
      tickTimer.current = null;
    }
  }

  function armDismissCountdown() {
    clearTimers();
    if (touchedRef.current) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(AUTO_DISMISS_SECS);
    const startedAt = Date.now();

    tickTimer.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const left = Math.max(0, Math.ceil((AUTO_DISMISS_MS - elapsed) / 1000));
      setSecondsLeft(left);
    }, 250);

    dismissTimer.current = window.setTimeout(() => {
      clearTimers();
      setSecondsLeft(null);
      onCloseRef.current();
    }, AUTO_DISMISS_MS);
  }

  function markTouched() {
    touchedRef.current = true;
    clearTimers();
    setSecondsLeft(null);
  }

  useEffect(() => {
    if (!open) {
      setShowSentence(false);
      touchedRef.current = false;
      clearTimers();
      setSecondsLeft(null);
      return;
    }
    clearTimers();
    setSecondsLeft(null);
    return clearTimers;
  }, [open, word]);

  // Countdown starts only once the model answer (or error) is visible.
  useEffect(() => {
    if (!open) return;
    if (loading) {
      clearTimers();
      setSecondsLeft(null);
      return;
    }
    if (meaning || error) {
      armDismissCountdown();
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, word, loading, meaning, error]);

  useLayoutEffect(() => {
    if (!open || !anchor || !panelRef.current) {
      setPos(null);
      return;
    }
    const height = panelRef.current.offsetHeight || 120;
    setPos(computePosition(anchor, height));
  }, [open, anchor, meaning, cultural, loading, error, showSentence, secondsLeft]);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCloseRef.current();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) {
        markTouched();
        return;
      }
      onCloseRef.current();
    }

    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);

  if (!open || !anchor) return null;

  const width = Math.min(POPUP_MAX_WIDTH, window.innerWidth - 16);
  const fallbackTop = Math.max(8, anchor.top - GAP - 120);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Meaning of ${word}`}
      className={cn(
        'fixed z-50 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg',
        'animate-in fade-in-0 zoom-in-95 duration-100',
      )}
      style={{
        top: pos?.top ?? fallbackTop,
        left: pos?.left ?? Math.max(8, anchor.left),
        width,
        maxWidth: `calc(100vw - 16px)`,
      }}
      onPointerDown={markTouched}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        {secondsLeft !== null ? (
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Disappear in {secondsLeft}
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close"
          onClick={onClose}
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <p className="mb-2 font-reading text-base font-semibold leading-tight tracking-tight">
        {word}
      </p>

      {loading && (
        <p className="text-sm text-muted-foreground">Looking up in context…</p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && meaning && (
        <p className="font-reading text-sm leading-relaxed text-foreground">{meaning}</p>
      )}

      {cultural && (
        <>
          <Separator className="my-2" />
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Cultural context
          </p>
          <p className="text-sm leading-relaxed text-foreground/90">{cultural}</p>
        </>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {showCultural && !cultural && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={loading || culturalLoading || !meaning}
            onClick={() => {
              markTouched();
              onRequestCultural();
            }}
          >
            {culturalLoading ? 'Loading…' : 'Cultural context'}
          </Button>
        )}
        <button
          type="button"
          className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => {
            markTouched();
            setShowSentence((s) => !s);
          }}
        >
          {showSentence ? 'Hide sentence' : 'Show sentence'}
        </button>
      </div>

      {showSentence && (
        <p className="mt-2 rounded-md bg-muted/60 px-2 py-1.5 text-xs italic text-muted-foreground">
          {sentence}
        </p>
      )}
    </div>,
    document.body,
  );
}
