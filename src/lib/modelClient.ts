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
        msg.type === 'precomputeItem' ||
        msg.type === 'precomputeSkipped' ||
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
    },
    { onProgress: opts.onProgress },
  );
  if (res.type !== 'lookupResult') throw new Error('Unexpected lookup response');
  log.info('lookup', `Done “${opts.word}” (${res.meaning.slice(0, 80)})`);
  return { meaning: res.meaning, cultural: res.cultural };
}

export async function precomputeOne(opts: {
  wordKey: string;
  word: string;
  sentence: string;
  modelId: string;
}): Promise<{ wordKey: string; meaning: string } | null> {
  const res = await send({
    id: nextId(),
    type: 'precomputeOne',
    wordKey: opts.wordKey,
    word: opts.word,
    sentence: opts.sentence,
    modelId: opts.modelId,
  });
  if (res.type === 'precomputeSkipped') {
    log.debug('precompute', `Skipped “${opts.word}”`);
    return null;
  }
  if (res.type !== 'precomputeItem') throw new Error('Unexpected precompute response');
  return { wordKey: res.wordKey, meaning: res.meaning };
}

export async function checkModelCached(modelId: string): Promise<boolean> {
  const res = await send({ id: nextId(), type: 'checkCached', modelId });
  if (res.type !== 'cacheStatus') return false;
  return res.cached;
}
