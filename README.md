# Contextual Reader

Fully client-side reader for second-language learners: import a book, see rare words with a subtle dotted underline, tap for a **contextual** meaning from a local in-browser model (WebLLM / WebGPU). No server, no external API.

## Stack

- Vite + React + TypeScript
- Tailwind CSS v4 + shadcn/ui
- `@mlc-ai/web-llm` in a Web Worker
- IndexedDB (`idb`) for books + meanings
- Optional PWA install (durability only)

## Develop

```bash
pnpm install
pnpm dev
```

```bash
pnpm build
pnpm preview
```

## Usage

1. Open the app → **Demo** for a sample chapter with fake contextual glosses, or **Import EPUB or TXT**.
2. **Model** → system check recommends a tier → download once (WebGPU required).
3. Open a book; rare words are underlined. Tap for meaning; optional **Cultural context** on request.
4. Chapter open triggers background precompute into IndexedDB so later taps are instant.

## Invariants

1. Contextual meanings, not dictionary lists
2. Fully local inference
3. Model downloads once, then loads from cache
4. Frozen constants: `src/constants/frequencyList.ts`, `prompts.ts`, `modelTiers.ts`
5. Subtle UI — dotted underline, short popup, cultural note only on request

See `contextual-reader-mvp-spec.md` and `loop.md`.
