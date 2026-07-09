/** Frozen prompt strings — do not edit to make tests pass. */

export const MEANING_SYSTEM_PROMPT =
  'You explain a single English word as it is used in one specific sentence, for a second-language reader. Give a short, plain meaning that fits THIS sentence — not a dictionary list. Use the chapter understanding when provided so the gloss fits the story so far. 1–2 sentences. No preamble.';

export function buildMeaningUserPrompt(
  word: string,
  sentence: string,
  wantCultural: boolean,
  chapterUnderstanding?: string | null,
): string {
  const cultural = wantCultural
    ? '\nAlso add one short note on any cultural reference or idiom, only if relevant.'
    : '';
  const chapter = chapterUnderstanding?.trim()
    ? `\nChapter understanding (use as background; do not retell the whole plot):\n"""${chapterUnderstanding.trim()}"""\n`
    : '';
  return `${chapter}Word: "${word}"\nSentence: "${sentence}"${cultural}`;
}

/** Passage Q&A — separate from the frozen per-word meaning prompt. */
export const PASSAGE_SYSTEM_PROMPT =
  'You help a second-language reader understand a short passage from a book. Answer clearly and briefly (2–5 sentences). Use the chapter understanding when provided. Stay faithful to the text; do not invent plot beyond what is given. No preamble.';

export function buildPassageUserPrompt(
  passage: string,
  question: string,
  chapterUnderstanding?: string | null,
): string {
  const chapter = chapterUnderstanding?.trim()
    ? `Chapter understanding:\n"""${chapterUnderstanding.trim()}"""\n\n`
    : '';
  return `${chapter}Passage:\n"""${passage}"""\n\nQuestion: ${question}`;
}

/** Build a durable chapter understanding the model can reuse for later lookups. */
export const CHAPTER_UNDERSTANDING_SYSTEM_PROMPT =
  'You are preparing reading notes for a second-language reader. From the chapter excerpt, write a compact understanding the app will reuse later: who is involved, where we are, what just happened, and any tone or conflict that matters. 5–8 short sentences or bullet-like lines. No preamble, no spoilers beyond this excerpt.';

export function buildChapterUnderstandingUserPrompt(
  chapterTitle: string,
  excerpt: string,
  priorUnderstanding?: string | null,
): string {
  const prior = priorUnderstanding?.trim()
    ? `\nPrior notes to refine (keep what still holds; update with this excerpt):\n"""${priorUnderstanding.trim()}"""\n`
    : '';
  return `Chapter: ${chapterTitle}${prior}\nExcerpt:\n"""${excerpt}"""\n\nWrite the updated chapter understanding.`;
}
