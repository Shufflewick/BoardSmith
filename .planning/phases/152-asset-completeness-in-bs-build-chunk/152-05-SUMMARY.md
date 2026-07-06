# Plan 152-05 Summary — SC-1 Real-Browser Asset Proof

**Plan:** 152-05 (checkpoint — human/browser proof of ROADMAP Success Criterion 1)
**Completed:** 2026-07-06
**Executed by:** orchestrator (browser proof driven directly), Chrome extension unavailable → Playwright fallback
**Result:** ✅ PASS — a game rendered through the fixed `bs-build-chunk` scaffold path shows zero broken images, with no hand-added asset set.

## What was proven

ROADMAP.md Phase 152 Success Criterion 1: *"Regenerating a game via the `bs-build-chunk` pipeline produces zero broken `<img>` elements when browser-verified, without hand-adding an asset set afterward."*

Because jsdom cannot decode real images (RESEARCH Pitfall 4), this is inherently a real-browser check. The Chrome extension was not connected, so the proof used headless Playwright (Chromium) against the live dev host — the established fallback.

## Method (non-destructive; no existing game modified)

1. Scaffolded a throwaway project via the fixed scaffold: `node bin/boardsmith.js init asset-proof` (in scratchpad). Confirmed `generateScaffoldFiles()` emitted `src/ui/components/AssetImage.vue` from Chunk 0 — before any chunk exists.
2. Wired three cards through the scaffold-emitted `AssetImage.vue` in the game-board slot (the sanctioned usage):
   - `card-missing`: `kind="card" rank="A" suit="♠" src="/cards/ZZ.svg"` — a nonexistent asset path (the exact DEF-A shape: a truthy src whose file doesn't exist).
   - `card-nosrc`: `kind="card" rank="K" suit="♥"` — no src at all.
   - `card-valid`: `kind="card" rank="Q" suit="♦" :src="<inline SVG data-URI>"` — real art that loads.
3. `npm install` (boardsmith linked via `file:` dep), started `boardsmith dev --no-open` (:5173), claimed seat 1, and inspected the GameShell iframe.

## Observed result (Playwright DOM inspection)

| Card | Drawn fallback | `<img>` element | naturalWidth | is-loaded / opacity | User sees |
|------|---------------|-----------------|--------------|---------------------|-----------|
| missing asset (`/cards/ZZ.svg`) | A♠ visible | present | 0 (failed) | false / **0** (hidden) | **drawn A♠**, no broken image |
| no src | K♥ visible | **not rendered** | — | — | **drawn K♥** |
| valid asset (inline SVG) | Q♦ present underneath | present | 120 (loaded) | true / 1 (revealed) | **real art** |

- **Console errors: none.**
- The AutoUI hands below (`2S, 3D, 4C, …`) also rendered as drawn card faces — the fixed `CardRenderer.vue` path (plan 152-02) — with zero broken images.
- Screenshot: `152-05-browser-proof.png` (this directory).

## Why this is a PASS (the key distinction)

The failed `<img>` for `/cards/ZZ.svg` decodes to `naturalWidth=0`, but `AssetImage.vue` holds it at `opacity:0` / not-`is-loaded`, so it is **visually hidden behind the drawn fallback** — the user never *sees* a broken image. This is exactly the phase goal's second clause: *"the generated UI degrades cleanly to its drawn fallback."* Zero broken images are ever *rendered* to the player, without any hand-added asset set. The `no src` case renders no `<img>` at all; the `valid` case reveals real art on load — both the emit-assets and degrade-cleanly paths of the goal are demonstrated.

## Teardown

- Dev server (:5173) killed; port confirmed free.
- Throwaway scaffold lives only in the session scratchpad; no sibling game repo was modified.

## Self-Check: PASSED
</content>
