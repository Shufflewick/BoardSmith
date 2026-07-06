---
status: passed
phase: 151
verified: 2026-07-05
mode: human_needed (human drove the browser)
---

# Phase 151 Verification — Human playtest the pipeline-built Go Fish

**Status: PASSED** (human gate closed by the user)

## Goal
A human verifies the pipeline-built Go Fish (`~/BoardSmithGames/go-fish-dryrun/`) in the browser, closing VAL-01's deferred human gate honestly.

## What happened
The user ran the Phase-150 regenerated Go Fish under `npx boardsmith dev` and walked the numbered playtest script. The gate did its job — it caught real browser-level defects the pipeline's automated bar (38/38, incl. random-sim, a11y floor, both hidden-info leak checks) is structurally blind to. All were root-caused and resolved:

- **DEF-A** (all cards render as broken images) — **FIXED**: generated the 52 face + 1 back card SVGs the game references (`go-fish-dryrun` commit `98d3d15`). Cards now render (verified: 0 broken `<img>`s, `/cards/*.svg` serves `image/svg+xml`).
- **DEF-B** (ask "lockup" with an AI opponent seat) — **FIXED**: root-caused as the latent dev-host lost-update race (`SnapshotSessionHost.handleOp`/`runAITurns` unserialized); fixed with a per-host op queue (BoardSmith commit `281e8155`) + regression tests. Full suite 2653/2653. Verified: 97-turn smooth AI play, no wedge.
- **DEF-C** ("Not Player 1's turn" in a 2-browser session) — **INVESTIGATED, not reproducible post-fix**: client+host instrumentation + guided repros proved the UI pipeline and turn handling (incl. AI-seat takeover) are correct; broadcasts reach every seat with the right turn. Did not reproduce in two clean re-playtests. Watch item, not a blocker (see `149-HUMAN-UAT.md`).

## Verified truths
- A human ran the pipeline-built game in the real dev-host browser and walked the script.
- Each checklist item was confirmed or its defect recorded + triaged (this-chunk defect / watch item).
- The generated game's rules, custom-UI action pipeline, hidden-info redaction, and turn handling are verified correct in clean play.
- VAL-01's human gate — the one gate v4.6 shipped outstanding — is closed.

## Follow-ups (captured, not blocking)
- `bs-build-chunk` skill gap: emit card assets (or CSS-fallback-guard the UI) so future generated games don't ship broken images.
- DEF-C watch item: dev-host multi-client reconnect-storm turn-desync — re-open with the on-file instrumentation approach if it recurs.
- MERC re-vendor to pick up the DEF-B session fix.
