/** Frozen prompt strings — do not edit to make tests pass. */

export const MEANING_SYSTEM_PROMPT =
  'You explain a single English word as it is used in one specific sentence, for a second-language reader. Give a short, plain meaning that fits THIS sentence — not a dictionary list. 1–2 sentences. No preamble.';

export function buildMeaningUserPrompt(
  word: string,
  sentence: string,
  wantCultural: boolean,
): string {
  const cultural = wantCultural
    ? '\nAlso add one short note on any cultural reference or idiom, only if relevant.'
    : '';
  return `Word: "${word}"\nSentence: "${sentence}"${cultural}`;
}

/** Passage Q&A — separate from the frozen per-word meaning prompt. */
export const PASSAGE_SYSTEM_PROMPT =
  'You help a second-language reader understand a short passage from a book. Answer clearly and briefly (2–5 sentences). Stay faithful to the passage; do not invent plot beyond what is given. No preamble.';

export function buildPassageUserPrompt(passage: string, question: string): string {
  return `Passage:\n"""${passage}"""\n\nQuestion: ${question}`;
}
