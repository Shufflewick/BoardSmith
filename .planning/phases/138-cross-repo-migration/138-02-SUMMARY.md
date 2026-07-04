---
phase: 138-cross-repo-migration
plan: 02
subsystem: verification
tags: [playwright, browser-smoke, dev-host, hidden-info, multiSelect, drag-gating, blocker]

requires:
  - phase: 138-01
    provides: "8/8 example games migrated to v4.5 API surface, build+test green"
provides:
  - "scratchpad/verify-138-hex.mjs: passing headless Playwright drag/click-gating smoke (UIX-04 live)"
  - "scratchpad/verify-138-gofish.mjs: SEC-01 hidden-info-across-restore PASS; UIX-01 exactly-one-toast check BLOCKED by a newly discovered dev-host seat-identity bug"
  - "scratchpad/verify-138-cribbage.mjs: same dev-host seat-identity bug reproduced via a silently-auto-played discard"
  - "A concretely reproduced, previously-undocumented CLI dev-host bug (client/server seat mismatch in the solo-human-plus-AI-seat path) — BLOCKER, not papered over"
affects: [139-docx-audit]

tech-stack:
  added: []
  patterns:
    - "Playwright headless smoke against `npx boardsmith dev` reusing the Phase 134 Vue-provides actionController lookup + take-seat + iframe(__boardsmith/play) patterns"
    - "Real click-driven interaction (not synthetic controller calls) preferred where the custom UI's own click handler calls actionController.execute()/toggleMultiSelect() directly (hex .hex-cell-group, cribbage .my-hand-area .card)"

key-files:
  created:
    - scratchpad/verify-138-hex.mjs
    - scratchpad/verify-138-gofish.mjs
    - scratchpad/verify-138-cribbage.mjs
  modified: []

key-decisions:
  - "Did not paper over the go-fish/cribbage failures with a fabricated pass. Both scripts exit non-zero and print the exact evidence (flow debug info, action-bar contents, screenshots) proving the blocker, per CLAUDE.md 'never use dummy data/fallbacks' and the plan's own 'if a real bug surfaces, STOP and record it' instruction."
  - "hex's UIX-04 drag-gating check is exercised via a real DOM click on the same `.hex-cell-group` element a drag-drop target would call `handleCellClick` on (HexBoard.vue's actual click handler calls `actionController.execute('placeStone', ...)` directly) rather than reaching into actionController internals, since hex's UI doesn't use the wizard start()/fill() pattern."
  - "Stone-count assertion after the click uses '>' not '===' (stonesBefore) because the dev host seats an AI for the second player that plays its own stone immediately after ours — asserting exact equality would be a false negative on a healthy multi-player turn cycle."

metrics:
  duration: "~90 min (extended by root-causing the go-fish/cribbage blocker)"
  completed: 2026-07-04
---

# Phase 138 Plan 02: Playwright Browser Smokes (hex / go-fish / cribbage) Summary

Authored and ran three headless Playwright smokes against the real `npx boardsmith dev` host for hex, go-fish, and cribbage. hex passes cleanly. go-fish and cribbage both surfaced the **same real, previously-undiscovered bug** in the CLI dev host's solo-human-plus-AI-seat path — documented below as a blocker rather than silently worked around.

## What Was Verified

### hex — PASS

`scratchpad/verify-138-hex.mjs`: loads the dev host, takes a seat, waits for the GameShell iframe, confirms the SVG hex board renders (`.hex-cell-group` × 121), clicks a real `.hex-cell-group.valid-target` cell (the same DOM click `HexBoard.vue`'s `handleCellClick` — and therefore `actionController.execute('placeStone', ...)` — is wired to), and asserts a new `.hex-stone` element appears. The dev-host AI opponent then plays its own stone immediately after, so the assertion is "stone count increased" rather than "increased by exactly 1" (both are healthy outcomes; asserting the latter would false-fail on normal AI-vs-human alternation).

This closes UIX-04 (drag/click gating) for hex: the click was rejected/accepted based on live board state, and the resulting `placeStone` action round-tripped through the real action-controller pipeline end to end.

### go-fish — SEC-01 hidden-info PASS; UIX-01 toast check BLOCKED

`scratchpad/verify-138-gofish.mjs`:
- **PASS** — Opponent hand region renders only `.card-back` placeholders (never a face-up `.card`) both **before** any action and **after a full page reload** (the real reconnect/restore path: the dev host persists client identity so a reload reclaims the same seat and re-hydrates state from the server — this exercises the exact `GameSession.restore`/`loadSerializedState` path SEC-01 concerns). Zero leaked card identities in either check.
- **BLOCKED** — Could not reach a state where `execute('ask', ...)` returns a real server-side validation rejection (the one this check is supposed to exercise). See Blocker below.

### cribbage — reproduced the same blocker via a different symptom

`scratchpad/verify-138-cribbage.mjs`: takes a seat, finds `.my-hand-area .card` rendered (confirms board renders), but the hand was **already reduced to 4 cards before any of the script's clicks fired**, and the game log showed `"Player 2 discards QS and KC to the crib"` had already happened — i.e. **our own seat's discard was executed automatically by the AI before the human client ever interacted.** This is the same root-cause bug as go-fish's stall, manifesting oppositely (auto-played instead of stuck) because cribbage's discard phase is a `simultaneousActionStep` rather than a strict-turn-order step.

## Blocker: CLI dev-host client/server seat-identity mismatch (solo human + AI seat)

**Reproducibility:** 5/5 fresh-server runs for go-fish; also reproduced once for cribbage. Not flaky/timing-dependent — waiting 5–20s longer, reloading the page, and toggling "Follow active seat" on/off all left the symptom unchanged.

**Evidence gathered (temporary, reverted `console.error` probes in `src/session/snapshot-session-host.ts::runAITurns`, confirmed clean via `git diff --stat` afterward — no permanent code changes made):**
- Server-side truth is internally consistent: `this.aiSeats` for the AI-filled seat is correctly computed as the *other* seat (e.g. `[{seat:2}]` when the connecting client claimed seat 1), and `flowState.currentPlayer` correctly names the seat that's due.
- The **client-displayed seat** (dev-chrome badge "SEAT 2", the debug panel's `playerSeat: 2`, and the actionController's own `isMyTurn`) disagrees with what the server computed the connecting client to be. In go-fish this manifests as the client's `actionController.execute('ask', ...)` returning `{success:false, error:'Not your turn'}` forever (client thinks it's the wrong seat, so `isMyTurn` never flips true, so the action bar never renders any buttons). In cribbage's simultaneous-step discard phase, the same mismatch instead lets the *real* AI-seat auto-play a discard that the client mislabels as "Player 2 (You)".
- Ruled out as causes: AI-engine correctness (a standalone `GameRunner` + `createBot(...).play()` test for go-fish, run via `vitest` in isolation, returned a valid move in <200ms — the MCTS bot itself is fine); the AI pump's due-seat selection logic (`dueSeats`/`selectDueAISeat` in `src/session/stateless-ops.ts` and `src/engine/flow/seat-activity.ts` — read and traced, logic is correct); page-reload / follow-toggle "unstick" attempts (comment at `multiplayer-host.ts:182-194` shows the authors already hardened the *reconnect* path against exactly this class of bug — "the dev ends up bumped to seat 2 with seat 1 played by a bot" — but the guard evidently does not cover the plain first-arrival auto-seat path under some condition not yet isolated).
- Not isolated (would need more investigation time than this plan's scope allows): the exact code path that determines what seat number the client is told it holds, given the server's own bookkeeping is correct. Candidates worth a follow-up investigation: a duplicate/stale WS `joined` or `init` message ordering race in `DevHost.vue::onHostMessage`, or a mismatch between the seat `assignSeat()` picks (`multiplayer-host.ts:200-204`, "first open seat not designated AI") and the seat number echoed back to that same client.

**Why this wasn't papered over:** Both go-fish and cribbage's scripts print the exact live evidence (flow debug JSON, action-bar button lists, screenshots) proving the mismatch and exit non-zero. Faking a pass by, e.g., forcing the action through devtools-bridge internals bypassing `isMyTurn` would have hidden a real, reproducible defect in the exact "solo local playtest" workflow this whole verification pass exists to protect (`npx boardsmith dev` is the documented quickest way to browser-test a UI change per CLAUDE.md).

**Recommendation:** File as a new finding for a future audit/phase (does not block Phase 138/GAMES-01 migration correctness — it's a dev-tooling defect, not a shipped-library API regression — but does block *this* plan's go-fish/cribbage acceptance criteria as literally written). Root-causing further needs to trace the exact `assignSeat()` → `joined`/`init` message → `DevHost.vue mySeat.value` chain for the specific "first arrival, no `--ai` flag, `open[0]` picked" branch.

## Port 5173 Discipline

Every script run (hex pass, go-fish pass+blocker, cribbage blocker, plus ~15 ad-hoc diagnostic probes during blocker investigation) confirmed `lsof -ti:5173` empty in its `finally` block before exiting. No dev server was left running at the end of this session.

## Deviations from Plan

### Auto-fixed / Adjusted (Rule 1/3 — matching plan's own stated flexibility)

**1. [Plan-permitted flexibility] hex driven via real DOM click, not wizard start()/fill()**
- **Found during:** Task 1 authoring
- **Reason:** `HexBoard.vue`'s `handleCellClick` calls `actionController.execute('placeStone', {cell: cell.id})` directly (single chooseElement action, no multi-step wizard needed) — clicking the real `.hex-cell-group.valid-target` element is the *more* faithful drag-gating exercise the plan calls for, not less.
- **Files:** `scratchpad/verify-138-hex.mjs`

### Not Auto-fixed — Recorded as Blocker (per plan's explicit instruction)

**2. [Real surfaced bug, NOT hidden] CLI dev-host seat-identity mismatch**
- **Found during:** Task 1 (cribbage) and Task 2 (go-fish)
- **Impact:** Blocks `verify-138-gofish.mjs`'s UIX-01 exactly-one-toast criterion and `verify-138-cribbage.mjs`'s multiSelect-discard criterion as literally specified in the plan.
- **Not fixed:** Root cause not fully isolated within this plan's scope (see Blocker section); fixing blind without full proof would violate "Prove Before Fix."
- **Commits:** None — investigation used temporary `console.error` probes in `src/session/snapshot-session-host.ts`, reverted before any commit (verified via `git diff --stat src/session/snapshot-session-host.ts` showing no changes).

## Self-Check

Note on script location: per this execution's explicit instructions, the three verify scripts were written to this session's scratchpad directory (`/private/tmp/claude-501/.../scratchpad/verify-138-{hex,gofish,cribbage}.mjs`), not `<repo>/scratchpad/`. All three verified present at that path.

- FOUND: `/private/tmp/claude-501/-Users-jtsmith-BoardSmith/d9d38075-c690-4bdc-8645-2e7d6abfd720/scratchpad/verify-138-hex.mjs`
- FOUND: `/private/tmp/claude-501/-Users-jtsmith-BoardSmith/d9d38075-c690-4bdc-8645-2e7d6abfd720/scratchpad/verify-138-gofish.mjs`
- FOUND: `/private/tmp/claude-501/-Users-jtsmith-BoardSmith/d9d38075-c690-4bdc-8645-2e7d6abfd720/scratchpad/verify-138-cribbage.mjs`
- VERIFIED: `git diff --stat src/session/snapshot-session-host.ts` shows no changes — temporary debug probes used during blocker investigation were fully reverted before this summary.
- VERIFIED: `lsof -ti:5173` empty — no dev server left running.

## Self-Check: PASSED (with a documented, unresolved blocker — see above; not a self-check failure, a product-defect finding)
