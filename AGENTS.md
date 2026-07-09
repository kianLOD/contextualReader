# AGENTS.md — Contextual Reader

Guidance for AI coding agents (Cursor, Claude Code, etc.) working in this repository.

## What this project is

**Contextual Reader** is a static, fully client-side Vite + React + TypeScript app. A second-language reader imports EPUB/TXT, sees rare words with a barely-there dotted underline, and taps for a meaning **as used in that sentence**, produced by WebLLM in a Web Worker over WebGPU. There is no backend and no external LLM API.

## Package manager

Always use **pnpm**:

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
```

Never introduce `package-lock.json` or `yarn.lock`. Keep `pnpm-lock.yaml` in sync.

## Source of truth

1. [`contextual-reader-mvp-spec.md`](contextual-reader-mvp-spec.md) — product requirements, architecture, data model, acceptance criteria.
2. [`loop.md`](loop.md) — gather → act → verify; one vertical slice at a time; stop conditions.
3. This file — day-to-day agent conventions for the codebase as implemented.

Prefer the spec over inventing features. Prefer `loop.md` process when continuing MVP slices.

## Invariants (never violate)

1. **Contextual, not dictionary.** Popup text must explain the word *in this sentence*. If output drifts toward sense lists, fix that first.
2. **Fully local.** No hosted/external inference APIs in MVP.
3. **Model downloads once.** Normal revisits must load from WebLLM cache.
4. **Frozen constants.** Do not silently edit:
   - `src/constants/frequencyList.ts`
   - `src/constants/prompts.ts`
   - `src/constants/modelTiers.ts`  
   Changing these is a deliberate human decision.
5. **Subtle UI.** Dotted underline only; short popup; cultural note only on explicit request. No modal that blocks the page for word meanings.

## Architecture (as built)

| Piece | Role |
|-------|------|
| Main thread UI | Library, Reader, WordPopup (anchored), ModelManager |
| `src/worker/modelWorker.ts` | WebLLM init + `lookupWord` / `askPassage` / `understandChapter` with priority queues |
| `src/lib/chapterUnderstanding.ts` | Idle chapter-notes builder; pause on live tap; halt on fatal GPU errors |
| `src/lib/modelClient.ts` | Main-thread ↔ worker messaging |
| `src/db/` | IndexedDB: `books`, `meanings`, `chapterUnderstandings`, `settings` |
| `src/lib/wordMarker.ts` | Rare-word detection + sentence extraction + wordKey hashing |
| shadcn/ui + Tailwind v4 | UI primitives; reading chrome stays light |

**Lookup priority:** live taps must not wait behind chapter understanding. Pause idle notes work, prefer high-priority worker jobs, then resume. Word/Ask prompts inject stored chapter notes when available.

**Popup:** anchored **above** the word (not a page modal). Auto-dismiss **10s after the answer arrives**, with visible “Disappear in N” countdown. Esc / outside tap / close also dismiss.

**Models:** use **q4f32** WebLLM IDs (not q4f16) for broader Intel compatibility. Weak iGPUs → recommend Light.

## Coding conventions

- TypeScript strict; path alias `@/` → `src/`.
- Prefer small, focused changes; do not expand scope beyond the asked slice/task.
- Log with `src/lib/logger.ts` (`[ContextualReader] …`) for model/cache/worker flows — keep it useful, not noisy.
- Do not commit GPU dumps (`about-gpu-*.txt`, `webgpureport-*.txt`) or secrets.
- UI: Tailwind + existing shadcn components; keep reading typography readable (`font-reading`).

## Verify before claiming done

- `pnpm build` must pass.
- For UI: show evidence (dev server behavior / screenshot), not just “should work”.
- After word-meaning changes: re-check invariant 1 (contextual).

## Out of scope (MVP)

Do not add: hosted APIs, accounts/sync, flashcards/SRS, known-word personalization, non-English source languages, pre-reading comprehension %.

## Resuming on another machine

```bash
pnpm install
pnpm dev
```

1. Confirm WebGPU on [webgpureport.org](https://webgpureport.org/).
2. **Model** → prefer **Light** on limited GPUs; download once.
3. Import EPUB/TXT or use **Demo**.
4. Read `contextual-reader-mvp-spec.md` + `loop.md` before large feature work.
