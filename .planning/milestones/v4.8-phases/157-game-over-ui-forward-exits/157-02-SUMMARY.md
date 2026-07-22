---
requirements-completed: [ENDGAME-02, PROC-01]
---

# Plan 157-02 Summary — Forward-Exit Routing: DevHost debug:restart handler + New Game restarts (ENDGAME-02, PROC-01)

**Plan:** 157-02 (execute — re-scoped after plan-check: ROUTING fix, not a guard relaxation)
**Completed:** 2026-07-20
**Result:** PASS — D11 is closed by fixing the TWO real routing gaps (DevHost never handled the
`debug:restart` postMessage; GameShell's "New Game" called the inert `leaveGame()`), not by relaxing
`handleRestart`'s guard — that guard was proven, both at plan-check and again here, to already admit a
finished game. The routing fixes are what makes Rematch, New Game, dev-restart, and DebugPanel restart
all actually reach the one real restart path.

## What was done

1. **Task 1 (RED):** Wrote tests against CURRENT (pre-fix) source only — no production code touched.
   - **TRUE RED (the real D11 bugs):**
     - `DevHost.restart.test.ts` — a `server_request` postMessage with `op:'debug:restart'` does NOT
       result in `{type:'restart'}` on the wire (DevHost's `onWindowMessage` had no branch for it, so it
       fell into the generic forward and shipped an unhandled `server_request` frame to the host instead).
     - `GameShell.restart.test.ts` — `handleMenuItemClick('new-game')` in platform mode called
       `leaveGame()` and never requested a restart.
   - **CHARACTERIZATION/ADVERSARIAL (already passing pre-fix, NOT RED)** — new describe block in
     `multiplayer-host.test.ts`, "restart from a finished game (D11 characterization + adversarial)":
     a `{type:'restart'}` sent to a FINISHED game already restarts with a fresh runner+seed (isComplete
     cleared, a new `start` op fires with a distinct seed each time); the restarted game is genuinely
     playable from move 0 (not the stale finished runner) and a second restart loops (3 distinct seeds
     across 2 restarts); a restart with no live session (never started) is still rejected with "No game
     in progress to restart." All 3 cases passed on current source, proving the guard was never the bug —
     exactly as the plan-check correction predicted.
2. **Task 2 (GREEN):** The actual fix.
   - `DevHost.vue` `onWindowMessage`: added a branch, placed BEFORE the generic `server_request` forward,
     routing `op:'debug:restart'` to the working `newGame()` → `wsSend({type:'restart'})` path.
   - `GameShell.vue` `handleMenuItemClick`: `'new-game'` now calls `handleRestartGame()` (the same
     platform path as Rematch) instead of `leaveGame()`. `'leave'` is unchanged.
   - `multiplayer-host.ts` `handleRestart`: defensive-only hardening — tightened the guard to
     `this.phase !== 'playing' || !this.session`. NOT the D11 fix; a finished game already passed before
     this change (no `'complete'` phase value exists). Kept for the mid-setup/no-session edge case.
   - Updated `GameShell.restart.test.ts`'s harness (which mirrors production verbatim, per the
     established codebase convention — see `GameShell.test.ts`) to the post-fix `handleMenuItemClick`
     body, and added a non-platform-mode parity case.
3. **Task 3 (adversarial + full suite):** The adversarial reset proof (fresh seed / reset move count /
   cleared `isComplete` / genuinely-playable-not-stale runner / second-restart loop / mid-setup rejection)
   was already written into Task 1's characterization block — those 3 cases are the adversarial proof,
   passing unchanged across RED and GREEN (which is the point: the host-level restart was never broken).
   Fixed one stale template comment in `GameShell.vue` (`@new-game → ...goes back to lobby` was no longer
   accurate after the fix). Ran the full suite: 195 files / 2808 tests, above the 157-01 baseline
   (194/2800).

## PROC-01 verbatim RED output (Task 1, before any production-code fix)

```
 ❯ src/ui/components/GameShell.restart.test.ts (2 tests | 1 failed)
   × GameShell — handleMenuItemClick("new-game") routing (D11 RED #2) > platform mode: requests a
     restart via platformRequest("debug:restart"), NOT leaveGame()
     AssertionError: expected "spy" to be called with arguments: [ 'debug:restart', {} ]
     Number of calls: 0

 ❯ src/cli/dev-host/DevHost.restart.test.ts (7 tests | 2 failed)
   × DevHost — debug:restart postMessage routing (D11 RED #1) > a server_request postMessage with
     op:"debug:restart" results in {type:"restart"} being sent on the wire
     AssertionError: expected undefined to be defined
   × DevHost — debug:restart postMessage routing (D11 RED #1) > does NOT forward debug:restart to the
     host as a generic unhandled server_request
     AssertionError: expected { type: 'server_request', op: 'debug:restart', requestId: 'req-1',
     payload: {} } to be undefined

 ✓ src/cli/dev-host/multiplayer-host.test.ts (38 tests) — ALL PASS (characterization + adversarial
   restart-from-finished + mid-setup-rejection cases included; the host-level restart was never gated)

Test Files  2 failed | 1 passed (3)
     Tests  3 failed | 44 passed (47)
```

## PROC-01 verbatim GREEN output (Task 2, after the fix)

```
 ✓ src/ui/components/GameShell.restart.test.ts (3 tests)
 ✓ src/cli/dev-host/multiplayer-host.test.ts (38 tests)
 ✓ src/cli/dev-host/DevHost.restart.test.ts (7 tests)

 Test Files  3 passed (3)
      Tests  48 passed (48)
```

## Adversarial reset evidence (Task 3, unchanged since Task 1 — proves the host restart was never the bug)

- `expect(seeds[1]).not.toBe(seeds[0])` — the post-restart `start` op fires with a NEW, distinct seed.
- `expect(lastOfType('A', 'game_state').isComplete).toBe(false)` — cleared, not carried over.
- `await pass('A', 'r2'); expect(lastOfType('A', 'game_state').isComplete).toBe(true)` — the restarted
  game is genuinely playable from move 0 and completes again; a stale/finished runner would reject the
  action or stay complete.
- `await host.handleMessage('A', { type: 'restart' })` a second time after re-completing — the loop
  repeats; `expect(new Set(seeds).size).toBe(3)` — three distinct seeds across the initial start + two
  restarts.
- Mid-setup/no-session: a `{type:'restart'}` sent to a host that was never told `hello` (never started)
  is rejected with `"No game in progress to restart."`.

## Full suite

195 files / 2808 tests pass (`npm test`), above the 157-01 baseline of 194/2800 (+1 new test file
`GameShell.restart.test.ts`, +8 net-new tests across the 3 touched test files: 2 new DevHost cases, 3 new
multiplayer-host cases, 3 new/changed GameShell cases).

## Verification

- `npx vitest run src/cli/dev-host/multiplayer-host.test.ts src/cli/dev-host/DevHost.restart.test.ts src/ui/components/GameShell.restart.test.ts` — 48/48 pass.
- `npm test` — 195 files / 2808 tests pass, above baseline.
- Grep gate: `grep -c "debug:restart" src/cli/dev-host/DevHost.vue` → **2** (≥1 required).
- Grep gate: `handleMenuItemClick`'s `'new-game'` branch (`GameShell.vue:1763-1770`) calls
  `handleRestartGame()`, confirmed by diff review — no longer calls `leaveGame()`.
- Grep gate: `grep -n "No game in progress to restart" src/cli/dev-host/multiplayer-host.ts` → retained.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 - bug/doc accuracy] Stale template comment in GameShell.vue**
- **Found during:** Task 3, final review pass.
- **Issue:** `GameShell.vue:2148`'s comment read `@new-game → handleMenuItemClick goes back to lobby;
  @rematch → restarts same game.` — no longer true after the Task 2 fix (both now restart).
- **Fix:** Rewrote the comment to state both `@new-game` and `@rematch` restart via the one real restart
  path, and that `@leave` (menu-only) is the only forward exit returning to the lobby.
- **Files modified:** `src/ui/components/GameShell.vue`.
- **Commit:** `ca276201`.

No other deviations. The plan's `files_modified` list included `src/ui/components/GameShell.restart.test.ts`
which did not previously exist and was created as specified; `src/cli/dev-host/DevHost.restart.test.ts`
already existed (from an earlier DEV-07 plan) and was extended in place rather than replaced, per the
plan's own file path.

### Auth gates
None encountered.

## Known Stubs
None.

## Threat Flags
None — this plan closes the T-157-06 mitigation already declared in its own threat model (guard rejects
mid-setup/no-session restarts) and introduces no new, unlisted security-relevant surface. T-157-04/T-157-05
(accepted, not mitigated) required no code changes; unchanged from the threat register.

## Self-Check: PASSED

- `src/cli/dev-host/DevHost.vue` — FOUND
- `src/ui/components/GameShell.vue` — FOUND
- `src/cli/dev-host/multiplayer-host.ts` — FOUND
- `src/cli/dev-host/DevHost.restart.test.ts` — FOUND
- `src/ui/components/GameShell.restart.test.ts` — FOUND
- `src/cli/dev-host/multiplayer-host.test.ts` — FOUND
- Commit `bf73ed2b` (RED) — FOUND in `git log`
- Commit `87e91429` (GREEN) — FOUND in `git log`
- Commit `ca276201` (adversarial confirmation + doc fix) — FOUND in `git log`
