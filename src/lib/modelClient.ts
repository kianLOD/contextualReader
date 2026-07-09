import type { WorkerRequest, WorkerResponse } from '@/worker/modelWorker';
import { log } from '@/lib/logger';

type ProgressHandler = (progress: number, text: string) => void;

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
  onProgress?: ProgressHandler;
};

let worker: Worker | null = null;
const pending = new Map<string, Pending>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../worker/modelWorker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'log') {
        log[msg.level]('worker', msg.message);
        return;
      }

      const entry = pending.get(msg.id);
      if (!entry) return;

      if (msg.type === 'progress') {
        log.debug('model', `progress ${(msg.progress * 100).toFixed(0)}% — ${msg.text}`);
        entry.onProgress?.(msg.progress, msg.text);
        return;
      }
      if (msg.type === 'error') {
        pending.delete(msg.id);
        log.error('model', msg.message);
        entry.reject(new Error(msg.message));
        return;
      }
      if (
        msg.type === 'initDone' ||
        msg.type === 'lookupResult' ||
        msg.type === 'passageAnswer' ||
        msg.type === 'understandingResult' ||
        msg.type === 'understandingSkipped' ||
        msg.type === 'cacheStatus' ||
        msg.type === 'pausedAck'
      ) {
        pending.delete(msg.id);
        entry.resolve(msg);
      }
    };
    worker.onerror = (err) => {
      log.error('worker', 'Worker error', err);
    };
  }
  return worker;
}

function nextId(): string {
  return crypto.randomUUID();
}

function send(
  request: WorkerRequest,
  handlers?: { onProgress?: ProgressHandler },
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    pending.set(request.id, {
      resolve,
      reject,
      onProgress: handlers?.onProgress,
    });
    getWorker().postMessage(request);
  });
}

export async function initModel(
  modelId: string,
  onProgress?: ProgressHandler,
): Promise<void> {
  log.info('model', `Init requested: ${modelId}`);
  const res = await send({ id: nextId(), type: 'init', modelId }, { onProgress });
  if (res.type !== 'initDone') throw new Error('Unexpected init response');
  log.info('model', `Init complete: ${modelId}`);
}

export async function setWorkerPaused(paused: boolean): Promise<void> {
  const res = await send({ id: nextId(), type: 'setPaused', paused });
  if (res.type !== 'pausedAck') throw new Error('Unexpected pause response');
}

export async function lookupWord(opts: {
  word: string;
  sentence: string;
  wantCultural: boolean;
  modelId: string;
  chapterUnderstanding?: string | null;
  onProgress?: ProgressHandler;
}): Promise<{ meaning: string; cultural?: string }> {
  log.info('lookup', `Request “${opts.word}” cultural=${opts.wantCultural}`);
  const res = await send(
    {
      id: nextId(),
      type: 'lookupWord',
      word: opts.word,
      sentence: opts.sentence,
      wantCultural: opts.wantCultural,
      modelId: opts.modelId,
      chapterUnderstanding: opts.chapterUnderstanding,
    },
    { onProgress: opts.onProgress },
  );
  if (res.type !== 'lookupResult') throw new Error('Unexpected lookup response');
  log.info('lookup', `Done “${opts.word}” (${res.meaning.slice(0, 80)})`);
  return { meaning: res.meaning, cultural: res.cultural };
}

export async function askPassage(opts: {
  passage: string;
  question: string;
  modelId: string;
  chapterUnderstanding?: string | null;
}): Promise<string> {
  log.info('passage', `Ask: ${opts.question.slice(0, 80)}`);
  const res = await send({
    id: nextId(),
    type: 'askPassage',
    passage: opts.passage,
    question: opts.question,
    modelId: opts.modelId,
    chapterUnderstanding: opts.chapterUnderstanding,
  });
  if (res.type !== 'passageAnswer') throw new Error('Unexpected passage response');
  return res.answer;
}

export async function understandChapterChunk(opts: {
  chapterTitle: string;
  excerpt: string;
  priorUnderstanding?: string | null;
  modelId: string;
}): Promise<string | null> {
  const res = await send({
    id: nextId(),
    type: 'understandChapter',
    chapterTitle: opts.chapterTitle,
    excerpt: opts.excerpt,
    priorUnderstanding: opts.priorUnderstanding,
    modelId: opts.modelId,
  });
  if (res.type === 'understandingSkipped') {
    log.debug('understand', 'Chunk skipped (busy)');
    return null;
  }
  if (res.type !== 'understandingResult') {
    throw new Error('Unexpected understanding response');
  }
  return res.text;
}

export async function checkModelCached(modelId: string): Promise<boolean> {
  const res = await send({ id: nextId(), type: 'checkCached', modelId });
  if (res.type !== 'cacheStatus') return false;
  return res.cached;
}
