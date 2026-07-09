# Contextual Reader

A fully **client-side** web app for second-language readers: import a book, see rare words with a subtle dotted underline, tap one for its meaning **in the context of that sentence** — powered by a small AI model running in the browser via WebGPU. No server. No external API.

## Package manager

This project uses **pnpm** only.

```bash
pnpm install
pnpm dev
pnpm build
pnpm preview
pnpm lint
```

Do not use `npm` or `yarn` for installs — keep the lockfile as `pnpm-lock.yaml`.

## Requirements

- Node.js 20+ recommended
- **pnpm** (`corepack enable` then `corepack prepare pnpm@latest --activate`, or install via your preferred method)
- A browser with working **WebGPU** for local inference (recent Chrome/Edge on a capable GPU)
- Older Intel iGPUs (e.g. UHD 620) often fail WebLLM — use **Light** tier or test on a stronger GPU

## Quick start

```bash
git clone <repo-url>
cd contextualReader
pnpm install
pnpm dev
```

Open the printed local URL. Use **Demo** for UI without a model, or **Model** to download a tier, then import an EPUB/TXT.

Sample text for import: [`public/sample-pride.txt`](public/sample-pride.txt).

## Stack

| Area | Choice |
|------|--------|
| App | Vite + React 19 + TypeScript |
| UI | Tailwind CSS v4 + shadcn/ui |
| Inference | `@mlc-ai/web-llm` in a Web Worker |
| Storage | IndexedDB (`idb`) for books + meanings |
| Books | EPUB (JSZip) + plain `.txt` |
| Optional | PWA via `vite-plugin-pwa` (durability only) |

## How it works

1. **Import** EPUB/TXT → chapters stored in IndexedDB.
2. **WordMarker** underlines rare tokens (outside top ~5k English words).
3. **Tap** → anchored popup above the word with a contextual gloss.
4. **Model worker** runs WebLLM; live lookup on cache miss.
5. **Idle precompute** warms meanings one word at a time when idle; taps pause warm-up and take priority.
6. Popup auto-dismisses after **10s** once an answer is shown (countdown in UI).

## Project docs

| File | Purpose |
|------|---------|
| [`AGENTS.md`](AGENTS.md) | Instructions for AI coding agents working in this repo |
| [`contextual-reader-mvp-spec.md`](contextual-reader-mvp-spec.md) | Product MVP spec (source of truth for *what*) |
| [`loop.md`](loop.md) | Build loop / slice process (source of truth for *how*) |

## Invariants (do not break)

1. **Contextual, not dictionary** — meanings fit *this* sentence.
2. **Fully local** — no hosted LLM APIs.
3. **Download the model once** — later loads use cache.
4. **Frozen constants** — do not silently edit `src/constants/frequencyList.ts`, `prompts.ts`, or `modelTiers.ts`.
5. **Subtle UI** — dotted underline; short popup; cultural note only on request.

## Layout

```
src/
  constants/     # frequency list, prompts, model tiers (frozen)
  db/            # IndexedDB schema + helpers
  lib/           # wordMarker, parsers, systemCheck, precompute, logger
  worker/        # WebLLM model worker
  components/    # Reader, Library, WordPopup, ModelManager, shadcn ui/
  App.tsx
```

## GPU / WebLLM notes

- Prefer **q4f32** model IDs (not q4f16) — many Intel adapters reject WGSL `f16`.
- On limited iGPUs, use **Light** (`Llama-3.2-1B-Instruct-q4f32_1-MLC`).
- If the console shows “Unable to find a compatible GPU”, warm-up stops; switch tier or machine.
- Check [webgpureport.org](https://webgpureport.org/) on the target computer.

## License

Private/public as published on GitHub; content samples are public-domain excerpts where noted.
