import { hasMeaning, putMeaning } from '@/db';
import { collectRareWordItems, type RareWordItem } from '@/lib/wordMarker';
import { precomputeOne, setWorkerPaused } from '@/lib/modelClient';
import { log } from '@/lib/logger';
import type { CacheMode } from '@/db/types';

export type PrecomputeStatus = {
  active: boolean;
  done: number;
  total: number;
  paused: boolean;
  fatalError: string | null;
  mode: CacheMode;
};

type QueueArgs = {
  bookId: string;
  chapterIndex: number;
  text: string;
  modelId: string;
  cacheMode: CacheMode;
  cachePaused: boolean;
  /** When mode is `less`, only warm these wordKeys (e.g. current page). */
  limitWordKeys?: Set<string> | null;
  onStatus: (status: PrecomputeStatus) => void;
};

const IDLE_DELAY_MS = 5000;
const BETWEEN_ITEMS_MS = 800;
/** Cap for `less` mode when no page key set is provided. */
const LESS_MODE_CAP = 12;

let generation = 0;
let pausedForLookup = false;
let manualPaused = false;
let running = false;
let queue: RareWordItem[] = [];
let ctx: Omit<QueueArgs, 'onStatus' | 'limitWordKeys'> | null = null;
let onStatus: ((status: PrecomputeStatus) => void) | null = null;
let doneCount = 0;
let totalCount = 0;
let idleTimer: number | null = null;
let fatalError: string | null = null;
let workerPaused = false;
let cacheMode: CacheMode = 'less';

function isFatalModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /compatible GPU|WebGPU|Failed to create WebGPU|out of memory|OOM|shader/i.test(
    msg,
  );
}

function emit() {
  onStatus?.({
    active: !fatalError && cacheMode !== 'off' && (running || queue.length > 0),
    done: doneCount,
    total: totalCount,
    paused: pausedForLookup || manualPaused,
    fatalError,
    mode: cacheMode,
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
  if (pausedForLookup || manualPaused || fatalError || cacheMode === 'off') return;
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
  if (fatalError || cacheMode === 'off') return;
  if (pausedForLookup || manualPaused) {
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

  if (pausedForLookup || manualPaused) {
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
  cacheMode = args.cacheMode;
  manualPaused = args.cachePaused;
  ctx = {
    bookId: args.bookId,
    chapterIndex: args.chapterIndex,
    text: args.text,
    modelId: args.modelId,
    cacheMode: args.cacheMode,
    cachePaused: args.cachePaused,
  };
  onStatus = args.onStatus;
  pausedForLookup = false;
  doneCount = 0;

  if (cacheMode === 'off') {
    log.info('precompute', 'Cache mode off — skipping warm-up');
    emit();
    return;
  }

  log.info('precompute', `Collecting rare words for chapter ${args.chapterIndex} (mode=${cacheMode})`);
  const all = await collectRareWordItems(args.text);
  if (gen !== generation) return;

  let pending: RareWordItem[] = [];
  for (const item of all) {
    if (!(await hasMeaning(args.bookId, args.chapterIndex, item.wordKey))) {
      pending.push(item);
    }
  }
  if (gen !== generation) return;

  if (cacheMode === 'less') {
    if (args.limitWordKeys && args.limitWordKeys.size > 0) {
      pending = pending.filter((p) => args.limitWordKeys!.has(p.wordKey));
    } else {
      pending = pending.slice(0, LESS_MODE_CAP);
    }
  }

  queue = pending;
  totalCount = pending.length;
  doneCount = 0;
  emit();

  log.info(
    'precompute',
    `Queue ready: ${pending.length} to warm (mode=${cacheMode})${manualPaused ? ' [paused]' : ''}`,
  );

  if (pending.length === 0 || manualPaused) return;
  scheduleIdleTick(IDLE_DELAY_MS);
}

export async function pausePrecomputeForLookup(): Promise<void> {
  if (fatalError || cacheMode === 'off') return;
  if (!pausedForLookup) {
    log.info('precompute', 'Pause — live lookup');
  }
  pausedForLookup = true;
  clearIdleTimer();
  emit();
  await setPausedState(true);
}

export async function resumePrecomputeAfterLookup(): Promise<void> {
  if (fatalError || cacheMode === 'off') return;
  if (!pausedForLookup) return;
  pausedForLookup = false;
  log.info('precompute', 'Resume after live lookup');
  emit();
  await setPausedState(manualPaused);
  if (!manualPaused && queue.length > 0) {
    scheduleIdleTick(IDLE_DELAY_MS);
  }
}

/** User-facing pause/resume of idle warm-up. */
export async function setCachePaused(paused: boolean): Promise<void> {
  manualPaused = paused;
  clearIdleTimer();
  emit();
  await setPausedState(paused || pausedForLookup);
  if (!paused && !pausedForLookup && queue.length > 0 && cacheMode !== 'off') {
    scheduleIdleTick(IDLE_DELAY_MS);
  }
  log.info('precompute', paused ? 'Cache paused by user' : 'Cache resumed by user');
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
  if (workerPaused) {
    workerPaused = false;
    void setWorkerPaused(false).catch(() => undefined);
  }
  emit();
  onStatus = null;
}
