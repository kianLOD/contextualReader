# loop.md — how to build this project with an AI coding agent

This file is the operating manual for developing the Contextual Reader with an AI coding agent (e.g. Claude Code). It sits next to the MVP spec. The spec says *what* to build; this file says *how to run the loop* that builds it. Point the agent at both.

---

## The core loop
Every unit of work runs the same three-phase loop, repeated until a stop condition is met:

1. **Gather context** — read the spec, read the relevant existing files, restate the goal of *this* slice in one sentence. No editing yet.
2. **Act** — make the smallest change that moves the current slice forward.
3. **Verify** — run it, and show *evidence* it works (command output, a passing check, or a screenshot of the UI). Never just claim success.

Then loop. A tiny change might do one pass; a tricky one cycles many times. The agent decides how many passes each step needs — but it does not skip verify.

The human's job is not to type every instruction. It's to hold the goal, the invariants, and the stop conditions — and to check the evidence.

---

## Project invariants (never break these)
These override any local decision the agent makes. If a change would violate one, stop and flag it.

1. **Contextual, not dictionary.** Every word popup explains the word *as used in its sentence*. If output starts reading like a generic dictionary entry, that's a regression — fix it before anything else. This is the whole point of the product.
2. **Fully local.** No external / hosted API calls anywhere in the MVP. All inference is in-browser via WebGPU.
3. **Download the model once.** After first cache, no re-download on normal revisits. A change that triggers re-downloads is a bug.
4. **Frozen constants — do not silently change.** The frequency word list, the per-word prompt string, and the model-tier table live as single-source constants. The agent may not edit these to "make a test pass"; changing them is a deliberate human decision.
5. **Subtle by default.** The dotted underline stays ignorable; the popup stays short; the cultural note only appears on explicit request. Don't let UI creep add color, badges, or auto-expanded notes.

At the end of every slice, the agent re-checks invariant 1 explicitly.

---

## The slice loop
Build in the seven thin vertical slices from the spec, in order. One slice per working session. A slice is done only when its verify step passes and you've seen the evidence.

| # | Slice | Verify (evidence to show) |
|---|-------|---------------------------|
| 1 | Reading shell (hardcoded text, no AI) | Screenshot: a chapter renders cleanly, reads nicely |
| 2 | Rare-word marking + fake popups | Screenshot: subtle underlines; tap opens/dismisses popup |
| 3 | Book import + IndexedDB | Import a real EPUB, refresh, book still there |
| 4 | Model in a worker, live lookups | Tap a real word → real in-context meaning; refresh → no re-download |
| 5 | Per-chapter precompute + cache | After a few seconds on a chapter, taps resolve instantly from cache |
| 6 | Cultural note on request | Default popup stays short; note appears only on second tap |
| 7 | Robustness (re-download, WebGPU-off, quota warn) | Simulate cleared cache + a WebGPU-off browser; both handled gracefully |

**Per-slice procedure:**
1. Restate the slice goal in one sentence and list the files it will touch. Wait for the go-ahead before editing (plan before code).
2. Make the change, scoped to that slice only. Don't build ahead into later slices.
3. Run it. Produce the evidence in the table above.
4. Re-check invariant 1 (contextual, not dictionary).
5. Commit with a message naming the slice. Then stop and show the result before starting the next slice.

Slice 4 carries the most risk (WebGPU + WebLLM + worker + persistence landing together) — go slower there and test on two real devices.

---

## Verify, don't trust
- The definition of "works" is executable: the check runs and passes, or the UI does the thing in a screenshot.
- Prefer "run X, observe Y" over "this should work."
- For anything the agent authored, treat it like a junior engineer's PR: read the diff, don't rubber-stamp.
- Where practical, let a fresh check grade the work rather than the same pass that wrote it (write the code, then a separate review pass verifies it against the spec).

---

## Context hygiene
Context fills up fast, and quality drops as it does. To keep the loop sharp:
- Keep each slice small enough to review in minutes.
- Offload noisy research ("where is X handled across these files") to a subagent that reads widely and hands back a short summary, instead of dragging every file into the main session.
- Start a fresh session per slice when the previous context is spent. The spec + this file + a one-line state note ("slices 1–3 done, on slice 4") is enough to resume.
- Don't paste large files in when a path reference will do.

---

## Stop conditions
The agent stops and asks the human when:
- A slice's verify step can't be made to pass after a couple of honest attempts (don't thrash — surface it).
- A change would touch a frozen constant (invariant 4).
- Invariant 1 (contextual, not dictionary) can't be satisfied with the current model/prompt.
- Scope would expand beyond the current slice.
- A cut feature (comprehension %, known-words thinning, any API call) starts to creep back in.

---

## Reusable prompts
- **Start a slice:** "Read the spec and loop.md. We're on slice N. Restate the goal in one sentence, list the files you'll touch, and wait for my go-ahead before editing."
- **Verify:** "Run it and show me the evidence — command output or a screenshot. Don't tell me it works, show me."
- **Review pass:** "Diff this slice against the spec. Where does it drift? Check invariant 1 specifically."
- **After a weak fix:** "Knowing what you know now, scrap this and do the clean version."
- **Resume:** "Slices 1–N done. Here's the one-line state. Continue at slice N+1 per loop.md."
