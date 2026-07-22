---
requirements-completed: [DEVHOST-03, PROC-01]
---

# Plan 161-04 Summary — First-Seat Orphan Race Fix (D15, PROC-01)

**Plan:** 161-04 (execute — `multiplayer-host.ts` seat reconciliation + new race test, file-disjoint
from Plans 01/02/03; ran serially after 161-02/161-03 landed)
**Completed:** 2026-07-21
**Result:** PASS — a client that disconnects WHILE `startGame`'s `await session.start()` is still
pending no longer orphans its seat. `startGame` now reconciles `humanSeats` (captured pre-await)
against live `connected` status right after the await: a vanished seat is AI-covered so
`runAITurns()` always has a driver. The reservation (`clientId`/`clientSeat`) is never released, and
`hello`'s reconnect branch now unconditionally yields the AI cover back — proven live, not just via
static state, by having the reconnected human successfully act on the very next round.

## What was done

1. **Task 1 (RED):** Created `multiplayer-host.startrace.test.ts` (new file, disjoint from
   `multiplayer-host.test.ts`). Added a `RaceGame` fixture (`loop({maxIterations:5, do: eachPlayer({do:
   actionStep(['pass'])})})`, 2 players, seat 1 before seat 2 each round) and `makeRaceHost(gate)` — a
   harness whose `executeOp` suspends the `start` op on a manually-controlled deferred when a `gate` is
   supplied. Proved the deterministic interleave technique works with NO manual microtask-flushing:
   because none of the layers between `hello()` and the stub (`startGame` → `session.start()` →
   `host.start()` → the `executeOp` closure) contains a genuine async gap before the gate, calling
   `host.handleMessage('A', {type:'hello'})` synchronously drives execution into the gated stub within
   the SAME synchronous turn — `host.disconnect('A')` called immediately after (still synchronous test
   code, before `await`ing the returned promise) lands truly INSIDE the `await session.start()` window.
   Captured the real pre-fix failure (seat 1 not AI-covered, game not progressed) — see verbatim RED
   output below. Included the required negative control (a plain post-start disconnect is unaffected).
   No production source touched. Commit `13a74d83`.
2. **Task 2 (GREEN):** In `startGame`, immediately after the successful `await session.start()` and
   before `runAITurns()`, added a reconciliation loop: for each seat in `humanSeats` (captured
   pre-await) whose `SeatInfo.connected === false`, call `addAiSeat(seat)` — the reservation
   (`info.clientId`, `this.clientSeat`) is left untouched. Additionally — a gap the plan's decisions
   implied but didn't spell out mechanically — `hello`'s reconnect branch now unconditionally calls
   `removeAiSeat(existing)` before its existing reinit logic, so a returning human's seat actually
   yields the bot instead of staying AI-driven forever once the reconciliation has covered it (a no-op
   for the ordinary case where the seat was never AI-covered, since `removeAiSeat` is a safe no-op when
   the seat isn't present in `aiSeats`). Verified against the Task 1 race test: GREEN. Commit `cad5319c`.
3. **Task 3 (adversarial):** Extended the race test with two more cases. (a) **Live reclaim proof**: a
   second human client B joins seat 2 mid-await (while the gate is still held), so `runAITurns()` halts
   after round 1 seat 1 (AI-covered) instead of auto-completing the whole game — leaving the game
   genuinely mid-play. Confirmed the pre-reconnect reservation is intact (`clientId==='A'`,
   `connected===false`), reconnected A, confirmed `aiSeats` no longer lists seat 1 and the lobby shows
   `clientId==='A'`/`connected===true`, then had B act (advancing the flow into round 2 seat 1) and A
   act on it directly — asserting `success:true` — proving seat 1's turn was genuinely still open, not
   already silently consumed by the bot. (b) **Scoping control**: a disconnect landing AFTER `startGame`
   has already committed (not during its own await) still leaves the seat un-covered — the existing
   pause-on-away-turn path, unchanged — confirmed by B's out-of-turn action failing (the game is
   genuinely paused, not silently reassigned). Ran target files + full suite: all green. Commit
   `61567e8e`.

## PROC-01 verbatim RED output (Task 1, before any fix)

```
 ❯ src/cli/dev-host/multiplayer-host.startrace.test.ts (2 tests | 1 failed) 10ms
   × MultiplayerHost — D15 disconnect-mid-startGame-await race (DEVHOST-03) > a disconnect landing INSIDE the `await session.start()` window leaves the seat AI-covered post-fix (pre-fix: orphaned, loop stalls) 8ms
     → expected false to be true // Object.is equality

 FAIL  src/cli/dev-host/multiplayer-host.startrace.test.ts > ... > a disconnect landing INSIDE the `await session.start()` window ...
AssertionError: expected false to be true // Object.is equality

- Expected
+ Received

- true
+ false

 ❯ src/cli/dev-host/multiplayer-host.startrace.test.ts:110:79

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```
The 1 passing test was the negative control (plain post-start disconnect stays un-reconciled) —
proving the fixture/harness doesn't fail everything and the interleave technique genuinely isolates
the D15 case. The failure is the real defect: `state` (the `game_state` sent to A during `startGame`'s
own reinit) was truthy (the interleave landed correctly, proving the race harness works), but
`aiSeats` did NOT contain seat 1 post-await — the orphan.

## GREEN output (Task 2, target files)

```
 ✓ src/cli/dev-host/multiplayer-host.startrace.test.ts (2 tests) 15ms
 ✓ src/cli/dev-host/multiplayer-host.test.ts (38 tests) 130ms

 Test Files  2 passed (2)
      Tests  40 passed (40)
```

## Adversarial + full suite (Task 3)

```
 ✓ src/cli/dev-host/multiplayer-host.startrace.test.ts (4 tests) 17ms
 ✓ src/cli/dev-host/multiplayer-host.test.ts (38 tests) 127ms

 Test Files  2 passed (2)
      Tests  42 passed (42)

...

 Test Files  206 passed (206)
      Tests  2906 passed (2906)
```
Baseline (post-161-03) was 205 files / 2902 tests; +1 file (`multiplayer-host.startrace.test.ts`),
+4 tests, all green, no regressions.

## Verification

- `npx vitest run src/cli/dev-host/multiplayer-host.startrace.test.ts src/cli/dev-host/multiplayer-host.test.ts` — 42/42 pass.
- `npm test` — 206 files / 2906 tests pass (baseline 205/2902).
- `npx tsc --noEmit -p tsconfig.json` — zero new errors touching `multiplayer-host.ts` or
  `multiplayer-host.startrace.test.ts`.
- Grep gate: `grep -c "this.connected" src/cli/dev-host/multiplayer-host.ts` → 9 (a new read inside
  `startGame`'s reconciliation loop, beyond the pre-existing reads).
- Grep gate: `git diff --stat -- src/cli/dev-host/connection-handler.ts` → empty (DEF-C guard
  untouched).

## Threat-model note (honest framing)

The reconciliation is **loop-driver cover only, never a seat-ownership change**: `addAiSeat` mutates
only the live `this.aiSeats` array (what `runAITurns`/`aiTurn` reads to decide who to drive); it never
touches `SeatInfo.clientId` or `this.clientSeat` (the actual reservation). The bot "playing" the seat is
purely a stopgap so the flow loop isn't wedged on a vanished human — the seat's ownership by the
original client is never revoked. The companion fix — `hello`'s reconnect branch unconditionally
`removeAiSeat`-ing the reclaimed seat — is what makes this genuinely reclaimable rather than a silent
permanent handoff to AI: Task 3's live-turn proof (B advances the flow, then A itself successfully acts
on the very next round) demonstrates the bot actually stopped acting for that seat the moment the human
returned, not just that some in-memory flag was flipped back cosmetically.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] `hello`'s reconnect branch never yielded AI cover back**
- **Found during:** Task 2, while implementing the reconciliation and reasoning through what "reclaimable,
  not permanent" (CONTEXT D15) actually requires operationally.
- **Issue:** The plan's Task 2 action text only specifies adding the seat to `aiSeats` post-await; it
  does not mention that something must later REMOVE it. Without a companion change, once a seat is
  AI-covered by the reconciliation, nothing ever un-covers it — a reconnecting human would find `hello`
  restores `connected=true`/reinit's them, but the bot would keep being handed that seat's turns by
  `runAITurnsInner` forever (or until an unrelated `leave`/`join`/`restart` happened to rebuild
  `aiSeats`), silently contradicting the "not permanently converted to AI" invariant the whole plan
  exists to guarantee.
- **Fix:** `hello`'s reconnect branch now unconditionally calls `this.removeAiSeat(existing)` right
  after marking the seat connected again — a safe no-op for the ordinary case (seat never AI-covered).
- **Files modified:** `src/cli/dev-host/multiplayer-host.ts`.
- **Commit:** `cad5319c`.

### Auth gates
None encountered.

## Known Stubs
None.

## Threat Flags
None — this plan implements the mitigation specified in its own threat model (T-161-04, T-161-07); the
DEF-C guard (connection-handler.ts) is untouched (`git diff --stat` confirms zero changes); no new,
unlisted security-relevant surface introduced. T-161-08 (accept) and T-161-SC (N/A) required no action.

## Self-Check: PASSED

- `src/cli/dev-host/multiplayer-host.startrace.test.ts` — FOUND
- `src/cli/dev-host/multiplayer-host.ts` (post-await reconciliation loop, `this.connected` reads,
  `removeAiSeat` on reconnect) — FOUND
- Commit `13a74d83` (RED) — FOUND in `git log`
- Commit `cad5319c` (GREEN) — FOUND in `git log`
- Commit `61567e8e` (adversarial) — FOUND in `git log`
