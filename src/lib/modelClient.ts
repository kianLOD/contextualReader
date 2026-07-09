import type { WorkerRequest, WorkerResponse } from '@/worker/modelWorker';

type ProgressHandler = (progress: number, text: string) => void;

type Pending = {
  resolve: (value: WorkerResponse) => void;
  reject: (reason: Error) => void;
  onProgress?: ProgressHandler;
  onPrecomputeItem?: (wordKey: string, meaning: string) => void;
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
      const entry = pending.get(msg.id);
      if (!entry) return;

      if (msg.type === 'progress') {
        entry.onProgress?.(msg.progress, msg.text);
        return;
      }
      if (msg.type === 'precomputeItem') {
        entry.onPrecomputeItem?.(msg.wordKey, msg.meaning);
        return;
      }
      if (msg.type === 'error') {
        pending.delete(msg.id);
        entry.reject(new Error(msg.message));
        return;
      }
      // Terminal messages
      if (
        msg.type === 'initDone' ||
        msg.type === 'lookupResult' ||
        msg.type === 'precomputeDone' ||
        msg.type === 'cacheStatus'
      ) {
        pending.delete(msg.id);
        entry.resolve(msg);
      }
    };
    worker.onerror = (err) => {
      console.error('Model worker error', err);
    };
  }
  return worker;
}

function nextId(): string {
  return crypto.randomUUID();
}

function send(
  request: WorkerRequest,
  handlers?: {
    onProgress?: ProgressHandler;
    onPrecomputeItem?: (wordKey: string, meaning: string) => void;
  },
): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    pending.set(request.id, {
      resolve,
      reject,
      onProgress: handlers?.onProgress,
      onPrecomputeItem: handlers?.onPrecomputeItem,
    });
    getWorker().postMessage(request);
  });
}

export async function initModel(
  modelId: string,
  onProgress?: ProgressHandler,
): Promise<void> {
  const res = await send({ id: nextId(), type: 'init', modelId }, { onProgress });
  if (res.type !== 'initDone') throw new Error('Unexpected init response');
}

export async function lookupWord(opts: {
  word: string;
  sentence: string;
  wantCultural: boolean;
  modelId: string;
  onProgress?: ProgressHandler;
}): Promise<{ meaning: string; cultural?: string }> {
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
  return { meaning: res.meaning, cultural: res.cultural };
}

export async function precomputeChapter(opts: {
  items: { wordKey: string; word: string; sentence: string }[];
  modelId: string;
  onItem: (wordKey: string, meaning: string) => void;
  onProgress?: ProgressHandler;
}): Promise<void> {
  const res = await send(
    {
      id: nextId(),
      type: 'precomputeChapter',
      items: opts.items,
      modelId: opts.modelId,
    },
    { onProgress: opts.onProgress, onPrecomputeItem: opts.onItem },
  );
  if (res.type !== 'precomputeDone') throw new Error('Unexpected precompute response');
}

export async function checkModelCached(modelId: string): Promise<boolean> {
  const res = await send({ id: nextId(), type: 'checkCached', modelId });
  if (res.type !== 'cacheStatus') return false;
  return res.cached;
}
