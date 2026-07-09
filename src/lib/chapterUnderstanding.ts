import {
  getChapterUnderstanding,
  putChapterUnderstanding,
} from '@/db';
import { understandChapterChunk, setWorkerPaused } from '@/lib/modelClient';
import { log } from '@/lib/logger';
import type { CacheMode } from '@/db/types';

export type UnderstandingStatus = {
  active: boolean;
  /** Chunks completed in this run. */
  done: number;
  /** Chunks planned for this run. */
  total: number;
  paused: boolean;
  fatalError: string | null;
  mode: CacheMode;
  /** True once we have usable notes for this chapter. */
  ready: boolean;
};

type QueueArgs = {
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  text: string;
  modelId: string;
  cacheMode: CacheMode;
  cachePaused: boolean;
  /**
   * When mode is `less`, prefer covering text up through this char offset
   * (e.g. end of current page) instead of only the chapter start.
   */
  focusEndOffset?: number | null;
  onStatus: (status: UnderstandingStatus) => void;
  /** Called whenever stored understanding text changes. */
  onUnderstanding?: (text: string | null) => void;
};

const IDLE_DELAY_MS = 2500;
const BETWEEN_CHUNKS_MS = 600;
/** Soft cap per model call — small local models need short excerpts. */
const CHUNK_CHARS = 3800;
/** `less` mode: cover about this much of the chapter (or through focus). */
const LESS_TARGET_CHARS = 4500;

let generation = 0;
let pausedForLookup = false;
let manualPaused = false;
let running = false;
let chunks: string[] = [];
let chunkIndex = 0;
let ctx: {
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  modelId: string;
} | null = null;
let onStatus: ((status: UnderstandingStatus) => void) | null = null;
let onUnderstanding: ((text: string | null) => void) | null = null;
let currentText: string | null = null;
let fatalError: string | null = null;
let workerPaused = false;
let cacheMode: CacheMode = 'less';
let idleTimer: number | null = null;
let ready = false;

function isFatalModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /compatible GPU|WebGPU|Failed to create WebGPU|out of memory|OOM|shader/i.test(
    msg,
  );
}

function emit() {
  onStatus?.({
    active:
      !fatalError &&
      cacheMode !== 'off' &&
      (running || chunkIndex < chunks.length),
    done: chunkIndex,
    total: chunks.length,
    paused: pausedForLookup || manualPaused,
    fatalError,
    mode: cacheMode,
    ready,
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
    log.warn('understand', 'Failed to set worker pause', err);
  }
}

function haltOnFatal(message: string) {
  fatalError = message;
  clearIdleTimer();
  chunks = [];
  running = false;
  log.error('understand', `Stopped chapter understanding: ${message}`);
  emit();
}

/** Split text into overlapping-ish paragraph-aware chunks. */
export function splitChapterChunks(text: string, maxChars = CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const paras = trimmed.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = '';

  for (const para of paras) {
    if (!buf) {
      if (para.length <= maxChars) {
        buf = para;
      } else {
        for (let i = 0; i < para.length; i += maxChars) {
          out.push(para.slice(i, i + maxChars));
        }
      }
      continue;
    }
    if (buf.length + 2 + para.length <= maxChars) {
      buf = `${buf}\n\n${para}`;
    } else {
      out.push(buf);
      if (para.length <= maxChars) {
        buf = para;
      } else {
        buf = '';
        for (let i = 0; i < para.length; i += maxChars) {
          out.push(para.slice(i, i + maxChars));
        }
      }
    }
  }
  if (buf) out.push(buf);
  return out;
}

function planChunks(
  text: string,
  mode: CacheMode,
  focusEndOffset?: number | null,
): string[] {
  const all = splitChapterChunks(text);
  if (all.length === 0) return [];
  if (mode === 'full') return all;

  // less: cover through focus (page end) or a fixed prefix of the chapter
  const targetEnd = Math.max(
    LESS_TARGET_CHARS,
    focusEndOffset && focusEndOffset > 0 ? focusEndOffset + 400 : LESS_TARGET_CHARS,
  );
  const prefix = text.slice(0, Math.min(text.length, targetEnd));
  return splitChapterChunks(prefix);
}

async function tick(gen: number) {
  if (gen !== generation) return;
  if (fatalError || cacheMode === 'off') return;
  if (pausedForLookup || manualPaused) {
    emit();
    return;
  }
  if (!ctx || chunkIndex >= chunks.length) {
    running = false;
    emit();
    if (chunks.length > 0 && chunkIndex >= chunks.length) {
      log.info('understand', `Chapter understanding finished (${chunkIndex}/${chunks.length})`);
    }
    return;
  }

  running = true;
  emit();
  const excerpt = chunks[chunkIndex]!;
  log.debug(
    'understand',
    `Chunk ${chunkIndex + 1}/${chunks.length} (${excerpt.length} chars)`,
  );

  try {
    const result = await understandChapterChunk({
      chapterTitle: ctx.chapterTitle,
      excerpt,
      priorUnderstanding: currentText,
      modelId: ctx.modelId,
    });
    if (gen !== generation) return;

    if (result === null) {
      // Skipped because a live lookup took priority — retry later
      running = false;
      emit();
      return;
    }

    currentText = result;
    ready = true;
    onUnderstanding?.(result);
    await putChapterUnderstanding({
      bookId: ctx.bookId,
      chapterIndex: ctx.chapterIndex,
      text: result,
      model: ctx.modelId,
      coveredChars: chunks
        .slice(0, chunkIndex + 1)
        .reduce((n, c) => n + c.length, 0),
      updatedAt: Date.now(),
    });
    chunkIndex += 1;
    log.info('understand', `Updated notes (${chunkIndex}/${chunks.length})`);
    emit();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isFatalModelError(err)) {
      haltOnFatal(message);
      return;
    }
    chunkIndex += 1;
    log.warn('understand', `Chunk failed, continuing`, err);
    emit();
  }

  if (gen !== generation || fatalError) return;
  running = false;

  if (pausedForLookup || manualPaused) {
    emit();
    return;
  }
  if (chunkIndex < chunks.length) {
    scheduleIdleTick(BETWEEN_CHUNKS_MS);
  } else {
    emit();
  }
}

export async function enqueueChapterUnderstanding(args: QueueArgs): Promise<void> {
  cancelUnderstanding();
  generation += 1;
  const gen = generation;
  fatalError = null;
  cacheMode = args.cacheMode;
  manualPaused = args.cachePaused;
  ctx = {
    bookId: args.bookId,
    chapterIndex: args.chapterIndex,
    chapterTitle: args.chapterTitle,
    modelId: args.modelId,
  };
  onStatus = args.onStatus;
  onUnderstanding = args.onUnderstanding ?? null;
  pausedForLookup = false;
  chunkIndex = 0;
  ready = false;
  currentText = null;

  if (cacheMode === 'off') {
    log.info('understand', 'Chapter understanding off');
    onUnderstanding?.(null);
    emit();
    return;
  }

  const existing = await getChapterUnderstanding(args.bookId, args.chapterIndex);
  if (gen !== generation) return;

  if (existing?.text) {
    currentText = existing.text;
    ready = true;
    onUnderstanding?.(existing.text);
    log.info('understand', 'Loaded stored chapter understanding');
  } else {
    onUnderstanding?.(null);
  }

  const planned = planChunks(args.text, cacheMode, args.focusEndOffset);
  // If we already covered at least as much as this plan (same model), skip re-run
  if (
    existing &&
    existing.model === args.modelId &&
    existing.coveredChars >=
      planned.reduce((n, c) => n + c.length, 0) * 0.9
  ) {
    chunks = [];
    chunkIndex = 0;
    ready = true;
    emit();
    log.info('understand', 'Chapter understanding already sufficient — skipping');
    return;
  }

  // Refine from prior notes when re-running with more coverage
  chunks = planned;
  chunkIndex = 0;
  emit();

  log.info(
    'understand',
    `Queue ready: ${planned.length} chunk(s) (mode=${cacheMode})${manualPaused ? ' [paused]' : ''}`,
  );

  if (planned.length === 0 || manualPaused) return;
  scheduleIdleTick(IDLE_DELAY_MS);
}

export async function pauseUnderstandingForLookup(): Promise<void> {
  if (fatalError || cacheMode === 'off') return;
  if (!pausedForLookup) {
    log.info('understand', 'Pause — live lookup');
  }
  pausedForLookup = true;
  clearIdleTimer();
  emit();
  await setPausedState(true);
}

export async function resumeUnderstandingAfterLookup(): Promise<void> {
  if (fatalError || cacheMode === 'off') return;
  if (!pausedForLookup) return;
  pausedForLookup = false;
  log.info('understand', 'Resume after live lookup');
  emit();
  await setPausedState(manualPaused);
  if (!manualPaused && chunkIndex < chunks.length) {
    scheduleIdleTick(IDLE_DELAY_MS);
  }
}

export async function setUnderstandingPaused(paused: boolean): Promise<void> {
  manualPaused = paused;
  clearIdleTimer();
  emit();
  await setPausedState(paused || pausedForLookup);
  if (!paused && !pausedForLookup && chunkIndex < chunks.length && cacheMode !== 'off') {
    scheduleIdleTick(IDLE_DELAY_MS);
  }
  log.info('understand', paused ? 'Paused by user' : 'Resumed by user');
}

export function cancelUnderstanding(): void {
  generation += 1;
  clearIdleTimer();
  chunks = [];
  chunkIndex = 0;
  running = false;
  pausedForLookup = false;
  ctx = null;
  currentText = null;
  ready = false;
  if (workerPaused) {
    workerPaused = false;
    void setWorkerPaused(false).catch(() => undefined);
  }
  emit();
  onStatus = null;
  onUnderstanding = null;
}

/** @deprecated Use cancelUnderstanding */
export const cancelPrecompute = cancelUnderstanding;
/** @deprecated Use setUnderstandingPaused */
export const setCachePaused = setUnderstandingPaused;
