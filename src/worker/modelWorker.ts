import {
  CreateMLCEngine,
  hasModelInCache,
  type MLCEngineInterface,
  type InitProgressReport,
} from '@mlc-ai/web-llm';
import {
  MEANING_SYSTEM_PROMPT,
  PASSAGE_SYSTEM_PROMPT,
  buildMeaningUserPrompt,
  buildPassageUserPrompt,
} from '../constants/prompts';

export type WorkerRequest =
  | { id: string; type: 'init'; modelId: string }
  | {
      id: string;
      type: 'lookupWord';
      word: string;
      sentence: string;
      wantCultural: boolean;
      modelId: string;
    }
  | {
      id: string;
      type: 'askPassage';
      passage: string;
      question: string;
      modelId: string;
    }
  | {
      id: string;
      type: 'precomputeOne';
      wordKey: string;
      word: string;
      sentence: string;
      modelId: string;
    }
  | { id: string; type: 'checkCached'; modelId: string }
  | { id: string; type: 'setPaused'; paused: boolean };

export type WorkerResponse =
  | { id: string; type: 'progress'; progress: number; text: string }
  | { id: string; type: 'initDone' }
  | { id: string; type: 'lookupResult'; meaning: string; cultural?: string }
  | { id: string; type: 'passageAnswer'; answer: string }
  | { id: string; type: 'precomputeItem'; wordKey: string; meaning: string }
  | { id: string; type: 'precomputeSkipped'; wordKey: string }
  | { id: string; type: 'cacheStatus'; cached: boolean }
  | { id: string; type: 'pausedAck'; paused: boolean }
  | { id: string; type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { id: string; type: 'error'; message: string };

let engine: MLCEngineInterface | null = null;
let currentModelId: string | null = null;
let idlePaused = false;
let busy = false;

type Queued = { msg: WorkerRequest; priority: number };

const highQueue: Queued[] = [];
const lowQueue: Queued[] = [];

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

function log(id: string, level: 'info' | 'warn' | 'error', message: string) {
  post({ id, type: 'log', level, message });
}

function priorityFor(type: WorkerRequest['type']): number {
  if (type === 'precomputeOne') return 0;
  return 1; // lookups / init / cache / pause
}

function pump() {
  if (busy) return;
  const next = highQueue.shift() ?? (!idlePaused ? lowQueue.shift() : undefined);
  if (!next) return;
  busy = true;
  void handle(next.msg).finally(() => {
    busy = false;
    pump();
  });
}

async function ensureEngine(
  modelId: string,
  requestId: string,
): Promise<MLCEngineInterface> {
  if (engine && currentModelId === modelId) return engine;

  log(requestId, 'info', `Loading model ${modelId}`);
  engine = await CreateMLCEngine(modelId, {
    initProgressCallback: (report: InitProgressReport) => {
      post({
        id: requestId,
        type: 'progress',
        progress: report.progress,
        text: report.text,
      });
    },
  });
  currentModelId = modelId;
  log(requestId, 'info', `Model ready: ${modelId}`);
  return engine;
}

async function generateMeaning(
  eng: MLCEngineInterface,
  word: string,
  sentence: string,
  wantCultural: boolean,
): Promise<{ meaning: string; cultural?: string }> {
  const user = buildMeaningUserPrompt(word, sentence, wantCultural);
  const reply = await eng.chat.completions.create({
    messages: [
      { role: 'system', content: MEANING_SYSTEM_PROMPT },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    max_tokens: wantCultural ? 180 : 120,
  });
  const content = reply.choices[0]?.message?.content?.trim() ?? '';
  if (!wantCultural) {
    return { meaning: content };
  }
  const parts = content.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { meaning: parts[0], cultural: parts.slice(1).join(' ') };
  }
  return { meaning: content, cultural: undefined };
}

async function handle(msg: WorkerRequest): Promise<void> {
  try {
    switch (msg.type) {
      case 'setPaused': {
        // Handled synchronously in onmessage
        break;
      }
      case 'checkCached': {
        const cached = await hasModelInCache(msg.modelId);
        log(msg.id, 'info', `Cache check ${msg.modelId}: ${cached ? 'hit' : 'miss'}`);
        post({ id: msg.id, type: 'cacheStatus', cached });
        break;
      }
      case 'init': {
        await ensureEngine(msg.modelId, msg.id);
        post({ id: msg.id, type: 'initDone' });
        break;
      }
      case 'lookupWord': {
        log(
          msg.id,
          'info',
          `Live lookup “${msg.word}”${msg.wantCultural ? ' (+cultural)' : ''}`,
        );
        const eng = await ensureEngine(msg.modelId, msg.id);
        const result = await generateMeaning(
          eng,
          msg.word,
          msg.sentence,
          msg.wantCultural,
        );
        log(msg.id, 'info', `Live lookup done “${msg.word}”`);
        post({ id: msg.id, type: 'lookupResult', ...result });
        break;
      }
      case 'askPassage': {
        log(msg.id, 'info', `Passage Q&A: ${msg.question.slice(0, 80)}`);
        const eng = await ensureEngine(msg.modelId, msg.id);
        const reply = await eng.chat.completions.create({
          messages: [
            { role: 'system', content: PASSAGE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: buildPassageUserPrompt(msg.passage, msg.question),
            },
          ],
          temperature: 0.3,
          max_tokens: 280,
        });
        const answer = reply.choices[0]?.message?.content?.trim() ?? '';
        post({ id: msg.id, type: 'passageAnswer', answer });
        break;
      }
      case 'precomputeOne': {
        if (idlePaused) {
          post({ id: msg.id, type: 'precomputeSkipped', wordKey: msg.wordKey });
          break;
        }
        log(msg.id, 'info', `Idle precompute “${msg.word}”`);
        const eng = await ensureEngine(msg.modelId, msg.id);
        // Model load may have taken a while — re-check pause before generating
        if (idlePaused || highQueue.length > 0) {
          log(msg.id, 'info', `Skip precompute “${msg.word}” (lookup waiting)`);
          post({ id: msg.id, type: 'precomputeSkipped', wordKey: msg.wordKey });
          break;
        }
        const { meaning } = await generateMeaning(eng, msg.word, msg.sentence, false);
        post({ id: msg.id, type: 'precomputeItem', wordKey: msg.wordKey, meaning });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(msg.id, 'error', message);
    post({ id: msg.id, type: 'error', message });
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;

  // Apply pause immediately so in-flight warm-up can notice it after model load.
  if (msg.type === 'setPaused') {
    idlePaused = msg.paused;
    if (idlePaused) {
      const dropped = lowQueue.splice(0, lowQueue.length);
      for (const item of dropped) {
        if (item.msg.type === 'precomputeOne') {
          post({
            id: item.msg.id,
            type: 'precomputeSkipped',
            wordKey: item.msg.wordKey,
          });
        }
      }
      log(msg.id, 'info', `Idle paused immediately; dropped ${dropped.length} queued warm-ups`);
    } else {
      log(msg.id, 'info', 'Idle resumed');
    }
    post({ id: msg.id, type: 'pausedAck', paused: idlePaused });
    // Don't need to queue setPaused — already applied
    if (!idlePaused) pump();
    return;
  }

  const priority = priorityFor(msg.type);
  if (priority > 0) highQueue.push({ msg, priority });
  else lowQueue.push({ msg, priority });
  pump();
};

export {};
