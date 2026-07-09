import { hasMeaning, putMeaning } from '@/db';
import { collectRareWordItems, type RareWordItem } from '@/lib/wordMarker';
import { precomputeChapter } from '@/lib/modelClient';

export type PrecomputeStatus = {
  active: boolean;
  done: number;
  total: number;
};

type QueueArgs = {
  bookId: string;
  chapterIndex: number;
  text: string;
  modelId: string;
  onStatus: (status: PrecomputeStatus) => void;
};

let abortToken = 0;

export async function enqueueChapterPrecompute(args: QueueArgs): Promise<void> {
  const token = ++abortToken;
  args.onStatus({ active: true, done: 0, total: 0 });

  const all = await collectRareWordItems(args.text);
  if (token !== abortToken) return;

  const pending: RareWordItem[] = [];
  for (const item of all) {
    if (!(await hasMeaning(args.bookId, args.chapterIndex, item.wordKey))) {
      pending.push(item);
    }
  }

  if (token !== abortToken) return;
  args.onStatus({ active: pending.length > 0, done: 0, total: pending.length });
  if (pending.length === 0) {
    args.onStatus({ active: false, done: 0, total: 0 });
    return;
  }

  let done = 0;
  try {
    await precomputeChapter({
      items: pending,
      modelId: args.modelId,
      onItem: async (wordKey, meaning) => {
        if (token !== abortToken) return;
        const item = pending.find((p) => p.wordKey === wordKey);
        if (!item) return;
        await putMeaning(args.bookId, args.chapterIndex, wordKey, {
          word: item.word,
          sentence: item.sentence,
          meaning,
          model: args.modelId,
        });
        done += 1;
        args.onStatus({ active: true, done, total: pending.length });
      },
    });
  } catch (err) {
    console.error('Precompute failed', err);
  }

  if (token === abortToken) {
    args.onStatus({ active: false, done, total: pending.length });
  }
}

export function cancelPrecompute(): void {
  abortToken += 1;
}
