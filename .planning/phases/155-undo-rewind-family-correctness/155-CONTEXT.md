# Phase 155: Undo / Rewind Family Correctness - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the four undo/rewind defects (D1/UNDO-01, D2/UNDO-02, D5/UNDO-03, D6/UNDO-04) at the
library layer — server-side enforcement of `.notUndoable()`, a durable fence at the `execute()`
barrier and the `finished` phase, removal of the game-erasing `computeUndoInfo` fallback, and a
monotonic animation-event id sequence across rewind.

IN SCOPE: `src/session` (both undo executors + `utils.ts`), `src/engine/flow` (barrier record,
`moveCount` publication), `src/engine/element/game.ts` (animation seq / checkpoint volatility),
`src/ui/composables/useAnimationEvents.ts` (client watermark), and their regression tests.

OUT OF SCOPE: per-game workarounds in the game repos (that is Phase 169), the simultaneous-step
undo work (Phase 160), and any redesign of the checkpoint mechanism itself — checkpoints stay;
replay is not revisited.

</domain>

<decisions>
## Implementation Decisions

### Undo Enforcement Semantics (UNDO-01 + UNDO-02)
- The `hasNonUndoableAction` check lives in **one shared guard in `src/session/utils.ts`**, called by
  both `stateless-ops.handleUndo` and `StateHistory.undoToTurnStart`. Single source of truth; the
  two executors must not drift.
- A refused undo **throws an actionable error** naming why and which action blocked it (e.g.
  "Cannot undo: action 7 (`playCard`) is marked notUndoable"), consistent with the v4.5
  doAction-throws contract. It is not a silent no-op.
- The `execute()` barrier is fenced with a **durable barrier record** — persist the action index at
  which each execute node completed, and refuse an undo that would cross it. `frame.completed`
  (`engine.ts:1548-1559`) is transient and does not survive checkpoint restore, so it cannot be the
  fence on its own.
- Undo is **refused up front when `game.phase === 'finished'`** rather than silently rolling the
  phase back via a pre-finish checkpoint.

### Solo Undo & moveCount (UNDO-03)
- **Delete the backward-scan fallback** (branch C, `utils.ts:195-213`) entirely. It is the
  game-erasing path; there is no replacement fallback.
- Make **`FlowState.moveCount` non-optional / always published** so the authoritative branch B
  (`utils.ts:177-189`) always applies.
- **No solo special-casing** — with the fallback gone, solo is just the general case.
- **No backward compatibility** for snapshots lacking `moveCount`: treat as undo-unavailable
  (`canUndo: false`), per the project's no-back-compat hard rule.
- **AMENDED post-research (2026-07-20): "one undo = one action-step", not "one turn."**
  `moveCount` is scoped to the action-step *frame*, not the logical player turn. With the fallback
  deleted it becomes authoritative, so on a multi-frame turn (`sequence(actionStep, actionStep)`)
  one undo rewinds one action-step rather than the whole turn. This is the accepted contract — we do
  **not** build turn-scoped accumulation. `undo-authoritative.test.ts` and
  `stateful-undo-authoritative.test.ts` (which deliberately exercise the two-frame turn via
  `collect-turns-fixture.ts`) must be **rewritten to assert the new contract**; their current
  `undo.success === true` expectation for a mid-turn undo is superseded, not a regression to fix.

### Animation Watermark (UNDO-04)
- **Server-primary fix**: the animation-event sequence must never move backwards across a rewind.
  That alone makes the client's monotonic watermark correct.
- Achieve it by **not letting checkpoint restore lower the live sequence**, rather than a blanket
  `max(live, restored)` reconciliation everywhere.
- **CORRECTED post-research (2026-07-20): the premise that `volatile-state.ts:38` already excludes
  the field was FALSE.** `SAFE_PROPERTIES` there is a dev-only HMR console-warning suppression list
  with **zero effect on serialization or restore**. The real fix site is
  `Game.loadSerializedState`, which is the single shared call path for *both* full session restore
  (`GameSession.restore` — adopting the persisted seq is correct there) and undo/rewind checkpoint
  restore (`GameRunner.fromCheckpoint` — where the seq must not regress). The two callers must be
  explicitly distinguished (e.g. a `preserveAnimationSeq` option), and restored buffered events
  must be **re-stamped with fresh ids** above the live watermark so they are not filtered out.
  The decision is unchanged — server-primary, monotonic — only the mechanism is corrected.
- Replayed beats **do animate** after undo: restored buffered events re-emit with fresh, higher ids.
- **Also reset `lastQueuedId` / `lastProcessedId` on a detected rewind** in
  `useAnimationEvents.ts` as defense-in-depth, so a client that reconnects into a rewound session
  cannot carry a stale high-water mark.

### Test & Verification Strategy (PROC-01)
- Use the **session-level harness** — `createHeadlessSession` driven with typed `Op` objects,
  matching the existing undo suite in `src/session/testing/`. Engine-level `TestGame` only where a
  defect is genuinely engine-local.
- **Pre-fix failure must be proven by running** each regression test against stashed pre-fix code,
  and the observed failure recorded in the phase SUMMARY. Not asserted by inspection.
- Every fix lands in **both the stateless and stateful executors**, with the invariant enforced
  through `parity-contract.test.ts`.
- **Adversarial verification before close**: a reviewer actively attempts to defeat each fix —
  crafting a raw `{type:'undo'}` op and calling `undoToTurnStart()` directly, bypassing the UI's
  `canUndo` — and must fail to do so.

### Claude's Discretion
- Exact shape and storage location of the durable execute-barrier record (flow frame data vs.
  action-history entry) is Claude's call, provided it survives checkpoint restore.
- Error type/class used for refused undos, so long as the message is actionable and no
  implementation details (paths, line numbers, stack traces) leak.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `computeUndoInfo` (`src/session/utils.ts:164-213`) already computes `hasNonUndoableAction` — it is
  simply never consumed server-side. The shared guard can reuse it directly.
- Per-action checkpoints already exist: `GameRunner.actionCheckpoints` (`src/runtime/runner.ts:77`,
  seeded `:129`, refreshed `:136`, carried through `getSnapshot` `:453-462`, forward-carried on
  restore `:567`). No new persistence mechanism is needed for the barrier record.
- `FlowState.moveCount` is already declared (`src/engine/flow/types.ts:264`), populated
  (`src/engine/flow/engine.ts:580`), persisted in `frame.data.moveCount` (`engine.ts:384-386`,
  `:1323-1326`), and restored (`:436`). Both executors already pass it
  (`stateless-ops.ts:467`, `state-history.ts:285`).
- Volatile-state allowlist (`src/engine/element/volatile-state.ts:38`) already names
  `animationEvents` and `animationEventSeq` — the exclusion hook exists.

### Established Patterns
- **Two parallel undo executors that must stay in parity**: stateless snapshot round-trip
  (`src/session/stateless-ops.ts:447-495`, production path) and stateful
  (`src/session/state-history.ts:264-320`, wrapped at `game-session.ts:1856`). Rewind twins:
  `handleDebugRewind` (`stateless-ops.ts:966-981`) and `rewindToAction` (`state-history.ts:346-380`).
  `parity-contract.test.ts` is the existing enforcement point.
- Undo restores via **checkpoint, not replay** — replay was deliberately abandoned because it never
  re-applies pending/selection `Piece.putInto` mutations (see comments at `stateless-ops.ts:475-481`
  and `state-history.ts:294-300`). Do not reintroduce replay.
- Session tests drive real `Op` objects through `SnapshotSessionHost` + `executeOp`; fixtures live in
  `src/session/testing/fixtures/` (`collect-turns-fixture.ts` exercises the `Piece.putInto` path undo
  must preserve).

### Integration Points
- Enforcement gap: `stateless-ops.ts:464` and `state-history.ts:282` both destructure only
  `{ turnStartActionIndex, actionsThisTurn }`, discarding `hasNonUndoableAction`. These are the two
  call sites the shared guard plugs into.
- `hasNonUndoableAction` currently reaches only `buildPlayerState` (`utils.ts:249`) as advisory
  `canUndo` UI state.
- `.notUndoable()` sets `definition.undoable = false` (`src/engine/action/action-builder.ts:147`);
  recorded per action-history entry via `runtime/runner.ts:258`, `:272`.
- Execute node executor: `FlowEngine.executeExecute` (`src/engine/flow/engine.ts:1548-1559`) — where
  the barrier record gets written.
- `GamePhase = 'setup' | 'started' | 'finished'` (`src/engine/element/game.ts:247`); set by
  `finish()` (`:2456`) and `command/executor.ts:217`; read via `isFinished()` (`:2477`).
- Animation ids: `Game.pushAnimationEvent` (`game.ts:2637-2645`), counter `:519`, buffer `:516`,
  buffer cleared per action `:1130`, serialized `:2699-2703`, restored `:2939-2943`. Published at
  `session/utils.ts:323-326` as `animationEvents` + `lastAnimationEventId`.
- Client dedupe: `src/ui/composables/useAnimationEvents.ts` — filter `e.id > lastQueuedId` (`:381`),
  watermark advanced via `Math.max` (`:389`), also bumped by `skipAll()` (`:287-289`).

</code_context>

<specifics>
## Specific Ideas

- The post-mortem notes D1 and D2 share a root cause and should be **designed together as one fix**
  (the shared server-side guard), not as two independent patches.
- The animation defect will present to a designer as "undo eats my animations", not as an id bug —
  the regression test should assert on *beats delivered to the client*, not on raw counter values,
  so it fails for the reason a user would report.
- The four defects map to four plans, but UNDO-01 and UNDO-02 should land in the same plan or
  adjacent plans sharing the guard.

</specifics>

<deferred>
## Deferred Ideas

- Simultaneous-step per-seat undo and `completed`-map checkpointing — belongs to Phase 160, which
  depends on this phase's fencing.
- Removing the per-game undo workarounds in `~/BoardSmithGames/*` — Phase 169.
- Revisiting checkpoint-vs-replay as the restore mechanism — out of scope; checkpoints stay.

</deferred>

