# Contextual Reader — MVP Spec

## Goal (one line)
A fully client-side web app where a second-language reader imports a book, sees rare words marked with a barely-there dotted underline, and taps one to get its meaning **in the context of that sentence** — powered by a small AI model running in the browser, with no server and no external API.

## The one principle not to lose
The popup explains the word **as used in this sentence**, not a dictionary list of senses. If a build decision ever pushes toward generic dictionary lookups, it's wrong. Comprehension of the *story* is the point.

---

## In scope (MVP)
- Import a book: EPUB and plain `.txt`.
- Render it as readable, paginated (or clean-scroll) text.
- Detect "rare" words via a frequency list (anything outside the top ~5,000 English words).
- Mark rare words with a subtle dotted underline (ignorable in flow).
- Tap a marked word → popup with a short contextual meaning.
- Optional second tap in the popup → cultural / idiom note (only on request).
- Local AI model via WebGPU (WebLLM). User picks a model tier; system-check recommends one.
- Download the model once; cache it persistently; graceful re-download if evicted.
- Per-chapter background precompute of rare-word meanings, cached to IndexedDB.

## Out of scope (explicitly NOT MVP)
- Pre-reading comprehension % estimate. (Cut.)
- "Known words" personalization / underlines thinning over time. (Cut — later version.)
- Any external/hosted API call. Fully local only.
- Accounts, sync, multi-device.
- Spaced repetition / flashcards / vocab review.
- Non-English source languages.

---

## Tech stack
- React + TypeScript (Vite).
- WebLLM (`@mlc-ai/web-llm`) for in-browser inference over WebGPU.
- A Web Worker to run the model off the main thread (keeps reading UI responsive).
- IndexedDB for app data (books, precomputed meanings, settings). WebLLM handles its own model-weight cache (Cache API / IndexedDB).
- No backend. Static hosting only (any static host / GitHub Pages).

---

## Architecture (all in the browser)
Three parts inside one tab:
1. **Reader UI (main thread):** parses the book, renders text, runs the frequency filter to decide which words get a dotted underline, handles taps, shows popups, reads meanings from cache.
2. **Model worker (web worker):** loads WebLLM, precomputes meanings for a chapter's rare words on request, returns them.
3. **Storage:** IndexedDB holds books + precomputed meanings + settings; WebLLM's own cache holds model shards on disk.

Data flow: book → reader → (rare-word list per chapter) → worker precomputes → results cached in IndexedDB → reader serves taps instantly from cache. A live single-word call to the worker is the fallback for anything not yet cached.

---

## Components
- `BookImporter` — file input; parse EPUB (e.g. via an epub parser) or `.txt`; split into chapters; store in IndexedDB.
- `Library` — list of imported books; open / delete.
- `Reader` — renders current chapter; wraps rare words in a tappable span; manages pagination/scroll.
- `WordMarker` (pure function/util) — given chapter text + frequency set, returns token positions to underline. Skips top-N common words, numbers, proper nouns (basic capitalization heuristic), and very short words.
- `WordPopup` — on tap: shows word, contextual meaning (from cache or live), and a "cultural context" button that lazy-loads the note.
- `ModelManager` — system check, tier recommendation, download-with-progress, persist request, cache-miss detection + re-download.
- `ModelWorker` — WebLLM init + two message types: `precomputeChapter` and `lookupWord`.
- `PrecomputeQueue` — on chapter open, enqueue its rare words, process in the worker, write results to IndexedDB, dedupe against already-cached.

---

## Data model (IndexedDB stores)
- `books`: `{ id, title, addedAt, chapters: [{ index, title, text }] }`
- `meanings`: key `bookId:chapterIndex:wordKey` → `{ word, sentence, meaning, cultural?, model }`
  - `wordKey` = normalized lowercased word + a hash of the sentence, so the same word in different sentences caches separately (context matters).
- `settings`: `{ modelTier, persistGranted, lastOpened }`

Note: cache the meaning against the **sentence context**, not the bare word — two occurrences of "recluse" in different sentences may deserve different explanations.

---

## Model layer

### System check → recommended tier (run on first launch)
Read what the browser exposes, then recommend:
- `navigator.gpu` present? If **no** → WebGPU unsupported → local model can't run. Show a clear "needs a WebGPU browser (recent Chrome/Edge desktop)" message. (No API fallback in MVP.)
- `const adapter = await navigator.gpu.requestAdapter()` → read `adapter.limits.maxBufferSize`, `maxStorageBufferBindingSize` (proxy for how big a model the GPU can hold).
- `navigator.deviceMemory` (approx RAM, Chrome, capped at 8).
- `navigator.hardwareConcurrency` (cores).
- Mobile check (UA + screen size + touch).
- `navigator.storage.estimate()` → free quota; warn before a large download if tight.
- `navigator.connection?.effectiveType` / `downlink` → warn on slow connection before download.

### Tiers (user-pickable; recommended one pre-selected, unrunnable ones disabled)
| Tier | Model | Download | Quality | Default for |
|------|-------|----------|---------|-------------|
| Light | ~0.5–1B | ~0.5–0.8 GB | basic meanings, weak nuance | mobile, ≤4GB RAM, slow net |
| Balanced | ~3B | ~1.8–2 GB | solid meanings, decent idioms | most laptops (default) |
| Best | ~7–8B | ~4–5 GB | strong cultural/nuance | desktop with real GPU |

Heuristic sketch (tune against real devices): mobile or `deviceMemory ≤ 4` → Light; `deviceMemory ≥ 8` + healthy GPU limits → offer Best, default Balanced; otherwise Balanced. Always gate on `storage.estimate()` having room for the chosen model + headroom.

### Download, cache, persistence
- Before download: call `navigator.storage.persist()` (works in a normal tab; often granted without PWA install). Store the boolean result.
- Download with a visible progress bar (WebLLM exposes progress callbacks). This is the one-time slow path.
- On every later launch: WebLLM loads weights from its on-disk cache — no network.
- **Graceful re-download:** on launch, if the model isn't in cache (eviction, cleared data), detect it and re-fetch with a "restoring model…" state instead of freezing.
- Optional, non-blocking: offer "install as app" (PWA) as a durability upgrade. Never required.

### Worker messages
- `precomputeChapter({ bookId, chapterIndex, items: [{ wordKey, word, sentence }] })` → streams/returns `{ wordKey, meaning }` for each; main thread writes to IndexedDB.
- `lookupWord({ word, sentence, wantCultural })` → returns `{ meaning, cultural? }` live; used for cache misses and for the on-request cultural note.

### Prompt shape (per word)
System: "You explain a single English word as it is used in one specific sentence, for a second-language reader. Give a short, plain meaning that fits THIS sentence — not a dictionary list. 1–2 sentences. No preamble."
User: `Word: "{word}"\nSentence: "{sentence}"\n{if cultural}Also add one short note on any cultural reference or idiom, only if relevant.{/if}`

Keep outputs short; small models stay more reliable when the task is narrow and the format is fixed.

---

## Word-marking rules (WordMarker)
- Underline a token only if: its lowercased form is **not** in the top-N frequency set, it's alphabetic, length ≥ some threshold (e.g. ≥ 5), and it isn't a mid-sentence capitalized proper noun (basic heuristic).
- Visual: `border-bottom: 1px dotted` in a muted color. No highlight, no color, no bold. It must be ignorable when reading in flow.
- Interaction: **tap only** (no hover). Popup is dismissable (tap-away, Esc, close button). One popup at a time.

---

## Build order (how to drive an AI coding agent through this)
Work in thin vertical slices; each slice ends at something you can actually see and click. Verify each before moving on.

1. **Reading shell.** Vite + React + TS. Hardcode one chapter of plain text. Render it cleanly (typography, scroll/pagination). No AI yet. — *Verify: it reads nicely.*
2. **Rare-word marking (fake data).** Add the frequency set + WordMarker. Underline rare words. Tap → popup showing a hardcoded string. — *Verify: underlines are subtle; tap/dismiss works.*
3. **Book import + storage.** EPUB/txt import → chapters → IndexedDB → Library → open a book into the reader. — *Verify: import a real book, reopen after refresh.*
4. **Model in a worker (no precompute).** ModelManager system-check + tier picker + download-with-progress + `persist()`. Wire `lookupWord` so a tap runs a **live** contextual lookup. — *Verify: tap a real word, get a real in-context meaning; refresh and confirm no re-download.*
5. **Per-chapter precompute + cache.** On chapter open, enqueue rare words, precompute in the worker, cache to IndexedDB; taps read cache first, live call only on miss. — *Verify: after a few seconds on a chapter, taps are instant.*
6. **Cultural note on request.** Second button in popup → lazy `lookupWord` with `wantCultural`. — *Verify: default popup stays short; note appears only when asked.*
7. **Robustness.** Graceful re-download on cache miss; WebGPU-unsupported message; storage-quota warning before download; optional PWA install prompt. — *Verify: simulate cleared cache and a WebGPU-off browser.*

Rules for the loop itself: give the agent this spec as the source of truth; have it build **one numbered slice per session**, run it, and show you the result before the next; keep the frequency list, prompt string, and tier table as single-source constants it can't silently change; after each slice, sanity-check the one principle (contextual, not dictionary) still holds.

---

## MVP acceptance criteria
- Import an EPUB, read it, refresh — book persists, model does not re-download.
- Rare words carry a subtle dotted underline; common words don't.
- Tapping a marked word gives a meaning that clearly reflects that sentence's usage.
- Cultural note appears only on the second, explicit tap.
- After a chapter has been open briefly, taps resolve from cache (instant).
- Works in a normal browser tab with no PWA install and no network calls after the model is cached.
