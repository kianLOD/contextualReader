import { hasMeaning, putMeaning } from '@/db';
import { collectRareWordItems, type RareWordItem } from '@/lib/wordMarker';
import { precomputeOne, setWorkerPaused } from '@/lib/modelClient';
import { log } from '@/lib/logger';

export type PrecomputeStatus = {
  active: boolean;
  done: number;
  total: number;
  paused: boolean;
  fatalError: string | null;
};

type QueueArgs = {
  bookId: string;
  chapterIndex: number;
  text: string;
  modelId: string;
  onStatus: (status: PrecomputeStatus) => void;
};

/** Wait longer before first warm-up so the reader can tap without racing model load. */
const IDLE_DELAY_MS = 5000;
const BETWEEN_ITEMS_MS = 800;

let generation = 0;
let pausedForLookup = false;
let running = false;
let queue: RareWordItem[] = [];
let ctx: Omit<QueueArgs, 'onStatus'> | null = null;
let onStatus: ((status: PrecomputeStatus) => void) | null = null;
let doneCount = 0;
let totalCount = 0;
let idleTimer: number | null = null;
let fatalError: string | null = null;
let workerPaused = false;

function isFatalModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /compatible GPU|WebGPU|Failed to create WebGPU|out of memory|OOM|shader/i.test(
    msg,
  );
}

function emit() {
  onStatus?.({
    active: !fatalError && (running || queue.length > 0),
    done: doneCount,
    total: totalCount,
    paused: pausedForLookup,
    fatalError,
  });
}

function clearIdleTimer() {
  if (idleTimer !== null) {
    window.clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleTick(delay = IDLE_DELAY_MS) {
  clearIdleTimer();
  if (pausedForLookup || fatalError) return;
  const gen = generation;
  idleTimer = window.setTimeout(() => {
    void tick(gen);
  }, delay);
}

async function setPausedState(paused: boolean): Promise<void> {
  if (workerPaused === paused) return;
  workerPaused = paused;
  try {
    await setWorkerPaused(paused);
  } catch (err) {
    log.warn('precompute', 'Failed to set worker pause', err);
  }
}

function haltOnFatal(message: string) {
  fatalError = message;
  clearIdleTimer();
  queue = [];
  running = false;
  log.error('precompute', `Stopped warm-up: ${message}`);
  emit();
}

async function tick(gen: number) {
  if (gen !== generation) return;
  if (fatalError) return;
  if (pausedForLookup) {
    emit();
    return;
  }
  if (!ctx || queue.length === 0) {
    running = false;
    emit();
    log.info('precompute', 'Idle queue empty');
    return;
  }

  running = true;
  const item = queue[0]!;
  emit();
  log.debug('precompute', `Warming “${item.word}” (${doneCount + 1}/${totalCount})`);

  try {
    if (await hasMeaning(ctx.bookId, ctx.chapterIndex, item.wordKey)) {
      queue.shift();
      doneCount += 1;
      emit();
    } else {
      const result = await precomputeOne({
        wordKey: item.wordKey,
        word: item.word,
        sentence: item.sentence,
        modelId: ctx.modelId,
      });
      if (gen !== generation) return;

      if (result === null) {
        running = false;
        emit();
        return;
      }

      queue.shift();
      await putMeaning(ctx.bookId, ctx.chapterIndex, result.wordKey, {
        word: item.word,
        sentence: item.sentence,
        meaning: result.meaning,
        model: ctx.modelId,
      });
      doneCount += 1;
      log.info('precompute', `Cached “${item.word}” (${doneCount}/${totalCount})`);
      emit();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isFatalModelError(err)) {
      haltOnFatal(message);
      return;
    }
    queue.shift();
    log.warn('precompute', `Failed “${item.word}”`, err);
    emit();
  }

  if (gen !== generation || fatalError) return;
  running = false;

  if (pausedForLookup) {
    emit();
    return;
  }
  if (queue.length > 0) {
    scheduleIdleTick(BETWEEN_ITEMS_MS);
  } else {
    emit();
    log.info('precompute', `Chapter warm-up finished (${doneCount}/${totalCount})`);
  }
}

export async function enqueueChapterPrecompute(args: QueueArgs): Promise<void> {
  cancelPrecompute();
  generation += 1;
  const gen = generation;
  fatalError = null;
  ctx = {
    bookId: args.bookId,
    chapterIndex: args.chapterIndex,
    text: args.text,
    modelId: args.modelId,
  };
  onStatus = args.onStatus;
  pausedForLookup = false;
  doneCount = 0;

  log.info('precompute', `Collecting rare words for chapter ${args.chapterIndex}`);
  const all = await collectRareWordItems(args.text);
  if (gen !== generation) return;

  const pending: RareWordItem[] = [];
  for (const item of all) {
    if (!(await hasMeaning(args.bookId, args.chapterIndex, item.wordKey))) {
      pending.push(item);
    }
  }
  if (gen !== generation) return;

  queue = pending;
  totalCount = pending.length;
  doneCount = all.length - pending.length;
  emit();

  log.info(
    'precompute',
    `Queue ready: ${pending.length} to warm, ${doneCount} already cached (starts in ${IDLE_DELAY_MS}ms idle)`,
  );

  if (pending.length === 0) return;
  scheduleIdleTick(IDLE_DELAY_MS);
}

export async function pausePrecomputeForLookup(): Promise<void> {
  if (fatalError) return;
  if (!pausedForLookup) {
    log.info('precompute', 'Pause — live lookup');
  }
  pausedForLookup = true;
  clearIdleTimer();
  emit();
  await setPausedState(true);
}

export async function resumePrecomputeAfterLookup(): Promise<void> {
  if (fatalError) return;
  if (!pausedForLookup) return;
  pausedForLookup = false;
  log.info('precompute', 'Resume idle warm-up');
  emit();
  await setPausedState(false);
  if (queue.length > 0) {
    scheduleIdleTick(IDLE_DELAY_MS);
  }
}

export function cancelPrecompute(): void {
  generation += 1;
  clearIdleTimer();
  queue = [];
  running = false;
  pausedForLookup = false;
  ctx = null;
  doneCount = 0;
  totalCount = 0;
  // Do not spam the worker with resume on every cancel/remount.
  if (workerPaused) {
    workerPaused = false;
    void setWorkerPaused(false).catch(() => undefined);
  }
  emit();
  onStatus = null;
}
