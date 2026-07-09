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
