# Phase 112 Plan 04 — Summary

**Plan:** 112-04 — Browser smoke: launch tutorial in both hosts, verify card anchoring (GFT-05, GFT-01 parity)
**Type:** checkpoint:human-verify
**Status:** Verified in browser — **gap discovered and fixed in-phase**
**Date:** 2026-06-30

## What was verified (Claude Code Chrome extension, `boardsmith dev` host)

1. **GFT-05 — launch surface (PASS):** The ControlsMenu (TEACHING group) shows a **"Start tutorial"** entry for go-fish, lit up purely from `tutorial: GO_FISH_TUTORIAL` on `gameDefinition` (no new BoardSmith substrate). The dev host renders the seat via a GameShell iframe in platform mode — i.e. the production GameShell code path — so this confirms the entry in GameShell as well. Clicking it resets to the tutorial preset (Your Hand = 7♥ 7♦ Q♥, pond = 48) and shows the first annotation.

2. **GFT-01 — card anchoring (PASS after fix):** The first `ask-for-rank` step targets `ref: { name: '7H' }`. The `bsg-tutorial-ring` highlight now anchors **exactly around the 7♥ card** in the learner's hand (ring box 320,145 76×106 vs card 323,148 70×100), with the "i" info chip on its corner — a card/hand anchor, NOT a board cell. Visual proof captured (teal ring around the seven of hearts).

## Substrate-vs-content gap discovered (and fixed)

The first browser run revealed the overlay tip floating top-right, **not** anchored — `querySelectorAll('[data-bs-el-id]').length === 0` across the whole game iframe; no `bsg-tutorial-ring` present.

**Root cause (proven, not guessed):** go-fish uses a **custom UI** (`src/ui/App.vue` → `src/ui/components/GameTable.vue`), not AutoUI, for the table. `GameTable.vue` rendered hand cards with bespoke `data-card-id`/`data-element-id`/`data-rank`/`data-suit` attributes but **omitted the standard `anchorAttrs`** (`data-bs-el-id`/`data-bs-el-name`) that the annotation overlay (`bsg-tutorial-overlay` → `overlay-utils.buildSelector`) queries. So `ref: { name: '7H' }` resolved in the engine model but matched no DOM node.

This is **NOT a BoardSmith substrate gap**: BoardSmith's AutoUI `CardRenderer` already emits the anchor attrs via `useSelectable` → `anchorAttrs`. The gap was the go-fish **custom UI** not reaching parity — exactly the v4.1-flagged "custom board omits `anchorAttrs`" risk and the CLAUDE.md hard rule that UI interactions must work in a Custom UI via `useBoardInteraction`.

**Fix (go-fish repo, commit `be497a6`):** import `anchorAttrs` from `boardsmith/ui` and bind `v-bind="anchorAttrs({ id: card.id, name: `${card.rank}${card.suit}` })"` on each hand card div in `GameTable.vue`. Card names match `createDeck`'s `${rank}${suit}` scheme (e.g. `'7H'`). Re-verified in the browser: the ring now anchors to the 7♥ card.

## Tests

- go-fish full suite green after the fix: **48/48** (tutorial-preset 15, tutorial 3, game 24, complete-game 6).
- The fix is a render-attribute addition; `GameTable.vue` is type-clean (the only `tsc` error is a pre-existing BoardSmith `useActionController.ts` looseness, unrelated; BoardSmith gates on vitest+eslint, not tsc).
- Dev server killed after verification (CLAUDE.md hard rule); port 5173 free.

## Requirements

- **GFT-05** — launchable in GameShell + dev host: **MET**.
- **GFT-01** — overlay anchors to a named card in hand (not a board cell): **MET** (after the custom-UI `anchorAttrs` fix).

## Note for the milestone audit

The research's "card anchoring works as-is" claim was correct for AutoUI but missed that go-fish ships a **custom** table UI. The fix is small and content-side (go-fish), keeping the BoardSmith substrate unchanged — consistent with the phase scope ("no BoardSmith `src/` changes unless a real substrate gap is found"; this was a go-fish content gap, not a substrate gap). Worth carrying into DOC-04 (Phase 115): document that custom UIs must emit `anchorAttrs` for overlays to anchor.
