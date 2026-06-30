---
phase: 114-go-fish-action-help-host-lockout
reviewed: 2026-06-30T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/actions.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/tests/action-help.test.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/tests/host-lockout.test.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 114: Code Review Report

**Reviewed:** 2026-06-30
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Phase 114 adds a `.help()` string to the Go Fish `ask` action and two test suites verifying
(a) that ActionMetadata propagates the help text and (b) that `teachingDisabled` sessions
correctly throw the lockout error for hint/demo/tutorial ops while leaving action help
unaffected.

The Phase-114-specific changes are clean. The `.help()` call is placed correctly in the
builder chain (after `.prompt()`, before the first `.chooseFrom()`), the text is accurate,
and both test suites are non-vacuous. No issues were introduced by this phase.

One pre-existing Warning was uncovered during full-file review of `actions.ts`: the
`execute()` block broadcasts the target player's private hand contents (all card ranks and
suits) through `game.message()` to every player in the game. This is a real game-rule
violation — opponent hands are hidden information in Go Fish — and the path is confirmed:
`createPlayerView` (`snapshot.ts:244`) calls `game.getFormattedMessages()` identically for
every seat without per-player filtering.

---

## Warnings

### WR-01: execute() broadcasts the target player's private hand to all players

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/src/rules/actions.ts:92-93` (also 111-112)

**Issue:** `game.message()` at lines 92-93 (BEFORE log) and 111-112 (AFTER log) calls
`formatHand(targetHand)`, which enumerates every card in the target's hand (rank + suit) and
pushes it into the game's shared message list. Per `snapshot.ts:244`,
`game.getFormattedMessages()` is called without any per-player filtering and the result is
placed in every player's `PlayerStateView.messages`. Consequently, any client or log consumer
receives the complete contents of the opponent's hand — in violation of Go Fish's
hidden-hand rule — on every `ask` action.

This is pre-existing code (not introduced by Phase 114), but it is in the file submitted for
review and the path is fully confirmed through the call chain:
`execute()` → `game.message()` → `game.messages[]` → `getFormattedMessages()` →
`createPlayerView` (all seats) → `PlayerGameState.messages` → broadcast.

**Fix:** Remove or gate the target-hand log lines. The asking player's own hand is fair to
show; the target's hand is not.

```typescript
// Remove or delete these two lines (lines 92-93):
// game.message(`BEFORE - ${target.name}'s hand ...`);

// Remove or delete these two lines (lines 111-112):
// game.message(`AFTER - ${target.name}'s hand ...`);
```

If full hand tracing is needed for server-side debugging, route it through a debug channel
that is never included in `PlayerStateView.messages` (e.g., a server-only log or a dedicated
`debugInfo` field), not `game.message()`.

---

## Info

### IN-01: DEBUG-style logging artifacts throughout execute()

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/src/rules/actions.ts:89-178`

**Issue:** Approximately 20 `game.message()` calls use ALL-CAPS developer-tracing labels
(`--- ACTION:`, `BEFORE -`, `AFTER -`, `TRANSFER:`, `GO FISH:`, `DRAW:`, `RESULT:`,
`LUCKY:`, `POND EMPTY:`). These are development tracing artifacts rather than meaningful
game-event messages. Because go-fish is a BoardSmithGames reference game that developers
read and copy from, this pattern is likely to be replicated. The CLAUDE.md rule
("Do not ever remove debug before confirming with the user that the problem has been fixed")
covers keeping these in while active bugs are being diagnosed — once the game is stable
these should be replaced with real player-facing game event messages or removed.

**Fix:** Replace ALL-CAPS tracing messages with natural-language game events
(e.g., `game.message('{{player}} asked {{target}} for {{rank}}s')`) or remove the tracing
calls entirely once the game logic is confirmed correct.

---

### IN-02: ASK_HELP_TEXT string duplicated across both test files

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/tests/action-help.test.ts:6-7`
and `/Users/jtsmith/BoardSmithGames/go-fish/tests/host-lockout.test.ts:55-56`

**Issue:** The exact help string is copy-pasted verbatim into two separate test files as a
local constant. If the canonical text in `actions.ts` changes, both must be updated manually;
a mismatch would surface only when both test suites run.

**Fix:** Extract the constant to a shared test fixture (e.g.
`tests/fixtures/action-constants.ts`) and import it in both files.

```typescript
// tests/fixtures/action-constants.ts
export const ASK_HELP_TEXT =
  'Ask an opponent for a rank you already hold. If they have it they give you all of them and you go again; if not, you draw from the pond (Go Fish!).';
```

---

_Reviewed: 2026-06-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Resolution (2026-06-30)

- **IN-02 (duplicated `ASK_HELP_TEXT`)** — FIXED: exported `ASK_HELP_TEXT` from `actions.ts` (re-exported via `src/rules/index.ts`); `.help()` and both test files now reference the single constant. go-fish 72/72 green.
- **WR-01 (execute() broadcasts the target's private hand to all players)** — FLAGGED, NOT auto-changed. This is a **real, observable Go Fish rule violation**: the `ask` execute() emits ~20 ALL-CAPS developer-trace `game.message()` calls (BEFORE/AFTER/TRANSFER hand dumps) that flow into every player's `PlayerStateView.messages` and broadcast to all seats — so every client sees the opponent's complete hand. Confirmed live during the 114-03 browser run (the LOG panel showed "AFTER - Player 2's hand: 2C, 3H, 4S, 5D, 8C, QH"). It is **pre-existing** (not introduced by Phase 114) and out of this phase's scope. Per CLAUDE.md ("Do not ever remove debug before confirming with the user that the problem has been fixed"), the debug tracing is NOT removed here — surfaced to the user / flagged for the milestone audit as a high-priority go-fish bug (remove or server-only-gate the BEFORE/AFTER/target-hand log lines).
- **IN-01 (ALL-CAPS developer-trace `game.message()` calls)** — NOTED: the same leftover debug-tracing block as WR-01; replace with natural-language player-facing events or remove once the game logic is confirmed stable (user decision; do not strip debug unilaterally).

### WR-01 update (2026-06-30): FIXED (user-approved)

The user approved fixing the hidden-info leak. go-fish commit `4a9b3c1` replaces the ~20 developer-trace `game.message()` calls (BEFORE/AFTER full-hand dumps, per-card transfer list, the privately-drawn card identity) with public, hidden-info-safe events (ask, transfer rank+count, Go-Fish-draw-occurred without the card, books via checkForBooks). Removed the unused `formatHand`/`formatCards` helpers + `Hand` import. Added `tests/no-hidden-info-leak.test.ts` (asserts no broadcast message contains a full card identity across seeds). go-fish 77/77 green. IN-01 is subsumed by this fix (the ALL-CAPS debug block is gone).
