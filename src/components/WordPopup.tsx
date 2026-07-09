import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

export type WordPopupProps = {
  open: boolean;
  word: string;
  sentence: string;
  meaning: string | null;
  cultural: string | null;
  loading: boolean;
  culturalLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRequestCultural: () => void;
};

export function WordPopup({
  open,
  word,
  sentence,
  meaning,
  cultural,
  loading,
  culturalLoading,
  error,
  onClose,
  onRequestCultural,
}: WordPopupProps) {
  const [showSentence, setShowSentence] = useState(false);

  useEffect(() => {
    if (!open) setShowSentence(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md gap-4" showCloseButton>
        <DialogHeader>
          <DialogTitle className="font-reading text-xl tracking-tight">{word}</DialogTitle>
          <DialogDescription className="sr-only">
            Contextual meaning for {word}
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground">Looking up in context…</p>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && meaning && (
          <p className="font-reading text-[1.05rem] leading-relaxed text-foreground">
            {meaning}
          </p>
        )}

        {cultural && (
          <>
            <Separator />
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Cultural context
              </p>
              <p className="text-sm leading-relaxed text-foreground/90">{cultural}</p>
            </div>
          </>
        )}

        <button
          type="button"
          className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setShowSentence((s) => !s)}
        >
          {showSentence ? 'Hide sentence' : 'Show sentence'}
        </button>
        {showSentence && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-sm italic text-muted-foreground">
            {sentence}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          {!cultural && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loading || culturalLoading || !meaning}
              onClick={onRequestCultural}
            >
              {culturalLoading ? 'Loading…' : 'Cultural context'}
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
