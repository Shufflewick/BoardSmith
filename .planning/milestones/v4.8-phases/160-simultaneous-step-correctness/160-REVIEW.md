# Phase 160: Simultaneous-Step Correctness — Code Review

**Reviewed:** 2026-07-20
**Fixes applied:** 2026-07-20

## Findings

### BLOCKER — D27 commit-leak gate is Action-Panel-only (FIXED)

`ActionPanel.vue:744` gated its own `executeAction` on `props.completed`, but
every custom/drag-drop UI executes through `useBoardActionBridge.executeAction`
(:189), which checked only `isExecuting`/`isMyTurn` and called
`controller.execute()` unconditionally. The shared chokepoint
`useActionController.execute` (:1040) also didn't check `completed`. A
committed seat could double-submit via a custom UI (the server independently
refused it, so no corruption — but a partial fix that violated the CLAUDE.md
UI-parity rule).

**Fix:** moved the gate into the shared chokepoint. `useActionController` now
accepts a `completed` option (threaded from GameShell's existing `myCompleted`
computed) and both `execute()` and `executeCurrentAction()` refuse once it's
true. ActionPanel and every custom UI routed through the bridge now inherit
the same refusal from one source. ActionPanel's own `props.completed`
early-return was kept as belt-and-suspenders (cheap, already tested).

- RED commit: `24e92cb8` — `test(160-fix): RED - bridge-driven re-submit is
  not gated on seat completed` (verbatim failure:
  `expected "spy" to be called 1 times, but got 2 times`)
- GREEN commit: `9e2ab30b` — `feat(160-fix): GREEN - gate commit at the
  shared chokepoint + W1/W3 cleanup`
- Test: `src/ui/composables/useBoardActionBridge.test.ts` — "D27 commit-leak
  parity: completed gate at the shared chokepoint (BLOCKER-160)"

**Status: FIXED**

### WARNING 1 — D3 nested aliasing (shallow `PlayerAwaitingState` copy) (FIXED)

`getState()`/`restoreFullState()` shallow-copied each `PlayerAwaitingState`
(`{ ...p }`) but shared the nested `availableActions` array by reference —
safe only because no mutation site currently `.push()`es it in place.

**Fix:** deep-clone `availableActions` too
(`{ ...p, availableActions: [...p.availableActions] }`) at both copy sites
(`engine.ts` `getState()` and `restoreFullState()`).

- Commit: `9e2ab30b`

**Status: FIXED**

### WARNING 2 — last-actor-loses-undo-window asymmetry (DEFERRED)

Entangled with whole-step-undo semantics the user declined during Phase 160
planning. Not addressed in this pass.

**Status: DEFERRED** (tracked, not fixed — see phase 160 CONTEXT/backlog)

### WARNING 3 — misleading comment on `resumeSimultaneousAction`'s no-eligible-actor branch (FIXED)

The "no eligible actor" branch (`engine.ts` ~:537-547) force-completes the
step WITHOUT calling `config.allDone`, but its doc comment claimed it
"consults allDone same as the normal post-action path."

**Fix:** corrected the comment to describe the actual behavior (force-complete
once no actor remains, regardless of `allDone`).

- Commit: `9e2ab30b`

**Status: FIXED**

## Verification

`npm test`: 202 files / 2871 tests green (2870 pre-existing + 1 new RED→GREEN
regression test). `ActionPanel.simultaneous.test.ts` remains green (8 tests).
