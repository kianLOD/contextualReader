import {
  CreateMLCEngine,
  hasModelInCache,
  type MLCEngineInterface,
  type InitProgressReport,
} from '@mlc-ai/web-llm';
import { MEANING_SYSTEM_PROMPT, buildMeaningUserPrompt } from '../constants/prompts';

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
      type: 'precomputeChapter';
      items: { wordKey: string; word: string; sentence: string }[];
      modelId: string;
    }
  | { id: string; type: 'checkCached'; modelId: string };

export type WorkerResponse =
  | { id: string; type: 'progress'; progress: number; text: string }
  | { id: string; type: 'initDone' }
  | { id: string; type: 'lookupResult'; meaning: string; cultural?: string }
  | { id: string; type: 'precomputeItem'; wordKey: string; meaning: string }
  | { id: string; type: 'precomputeDone' }
  | { id: string; type: 'cacheStatus'; cached: boolean }
  | { id: string; type: 'error'; message: string };

let engine: MLCEngineInterface | null = null;
let currentModelId: string | null = null;

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

async function ensureEngine(
  modelId: string,
  requestId: string,
): Promise<MLCEngineInterface> {
  if (engine && currentModelId === modelId) return engine;

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
  // Prefer splitting cultural note if the model marks it; otherwise treat second paragraph as cultural.
  const parts = content.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { meaning: parts[0], cultural: parts.slice(1).join(' ') };
  }
  return { meaning: content, cultural: undefined };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'checkCached': {
        const cached = await hasModelInCache(msg.modelId);
        post({ id: msg.id, type: 'cacheStatus', cached });
        break;
      }
      case 'init': {
        await ensureEngine(msg.modelId, msg.id);
        post({ id: msg.id, type: 'initDone' });
        break;
      }
      case 'lookupWord': {
        const eng = await ensureEngine(msg.modelId, msg.id);
        const result = await generateMeaning(eng, msg.word, msg.sentence, msg.wantCultural);
        post({ id: msg.id, type: 'lookupResult', ...result });
        break;
      }
      case 'precomputeChapter': {
        const eng = await ensureEngine(msg.modelId, msg.id);
        for (const item of msg.items) {
          const { meaning } = await generateMeaning(eng, item.word, item.sentence, false);
          post({ id: msg.id, type: 'precomputeItem', wordKey: item.wordKey, meaning });
        }
        post({ id: msg.id, type: 'precomputeDone' });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    post({
      id: msg.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
