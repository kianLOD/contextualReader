import { FREQUENCY_SET } from '@/constants/frequencyList';

export type MarkedToken = {
  text: string;
  start: number;
  end: number;
  rare: boolean;
};

const MIN_LENGTH = 5;
const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

function isAlphabeticWord(word: string): boolean {
  return /^[A-Za-z]+(?:'[A-Za-z]+)?$/.test(word);
}

function looksLikeProperNoun(word: string, preceding: string): boolean {
  if (word[0] !== word[0].toUpperCase() || word[0] === word[0].toLowerCase()) {
    return false;
  }
  const trimmed = preceding.replace(/\s+$/u, '');
  if (!trimmed) return true;
  const last = trimmed[trimmed.length - 1];
  // Sentence start → not treated as proper noun for marking skip
  if ('.!?…"“‘\'"'.includes(last)) return false;
  return true;
}

/** Given chapter text + frequency set, return token spans; rare ones should be underlined. */
export function markRareWords(text: string): MarkedToken[] {
  const tokens: MarkedToken[] = [];
  let lastIndex = 0;
  WORD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_RE.exec(text)) !== null) {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;
    if (start > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, start), start: lastIndex, end: start, rare: false });
    }
    const lower = word.toLowerCase();
    const preceding = text.slice(0, start);
    const rare =
      isAlphabeticWord(word) &&
      lower.length >= MIN_LENGTH &&
      !FREQUENCY_SET.has(lower) &&
      !looksLikeProperNoun(word, preceding);
    tokens.push({ text: word, start, end, rare });
    lastIndex = end;
  }
  if (lastIndex < text.length) {
    tokens.push({
      text: text.slice(lastIndex),
      start: lastIndex,
      end: text.length,
      rare: false,
    });
  }
  return tokens;
}

/** Extract the sentence containing a character offset. */
export function sentenceAt(text: string, offset: number): string {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if ('.!?'.includes(text[i])) {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (j < text.length) starts.push(j);
    }
  }
  let sentenceStart = 0;
  for (const s of starts) {
    if (s <= offset) sentenceStart = s;
    else break;
  }
  let sentenceEnd = text.length;
  for (let i = offset; i < text.length; i++) {
    if ('.!?'.includes(text[i])) {
      sentenceEnd = i + 1;
      break;
    }
  }
  return text.slice(sentenceStart, sentenceEnd).replace(/\s+/g, ' ').trim();
}

export async function hashSentence(sentence: string): Promise<string> {
  const data = new TextEncoder().encode(sentence.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function makeWordKey(word: string, sentenceHash: string): string {
  return `${word.toLowerCase()}:${sentenceHash}`;
}

export type RareWordItem = {
  wordKey: string;
  word: string;
  sentence: string;
};

export async function collectRareWordItems(text: string): Promise<RareWordItem[]> {
  const tokens = markRareWords(text);
  const seen = new Set<string>();
  const items: RareWordItem[] = [];
  for (const token of tokens) {
    if (!token.rare) continue;
    const sentence = sentenceAt(text, token.start);
    const sentenceHash = await hashSentence(sentence);
    const wordKey = makeWordKey(token.text, sentenceHash);
    if (seen.has(wordKey)) continue;
    seen.add(wordKey);
    items.push({ wordKey, word: token.text, sentence });
  }
  return items;
}
