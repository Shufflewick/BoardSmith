# Phase 155: Undo / Rewind Family Correctness - Research

**Researched:** 2026-07-20
**Domain:** BoardSmith engine/session undo & rewind correctness (server-authoritative game state machine)
**Confidence:** HIGH (all findings are direct code reads of this repo; no external libraries involved)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Undo Enforcement Semantics (UNDO-01 + UNDO-02)**
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

**Solo Undo & moveCount (UNDO-03)**
- **Delete the backward-scan fallback** (branch C, `utils.ts:195-213`) entirely. It is the
  game-erasing path; there is no replacement fallback.
- Make **`FlowState.moveCount` non-optional / always published** so the authoritative branch B
  (`utils.ts:177-189`) always applies.
- **No solo special-casing** — with the fallback gone, solo is just the general case.
- **No backward compatibility** for snapshots lacking `moveCount`: treat as undo-unavailable
  (`canUndo: false`), per the project's no-back-compat hard rule.

**Animation Watermark (UNDO-04)**
- **Server-primary fix**: the animation-event sequence must never move backwards across a rewind.
  That alone makes the client's monotonic watermark correct.
- Achieve it by **excluding `animationEventSeq` from checkpoint restore** — it is volatile
  presentation state, not game state (it already sits in the volatile-state allowlist,
  `volatile-state.ts:38`), rather than a `max(live, restored)` reconciliation.
- Replayed beats **do animate** after undo: restored buffered events re-emit with fresh, higher ids.
- **Also reset `lastQueuedId` / `lastProcessedId` on a detected rewind** in
  `useAnimationEvents.ts` as defense-in-depth, so a client that reconnects into a rewound session
  cannot carry a stale high-water mark.

**Test & Verification Strategy (PROC-01)**
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

### Deferred Ideas (OUT OF SCOPE)
- Simultaneous-step per-seat undo and `completed`-map checkpointing — belongs to Phase 160, which
  depends on this phase's fencing.
- Removing the per-game undo workarounds in `~/BoardSmithGames/*` — Phase 169.
- Revisiting checkpoint-vs-replay as the restore mechanism — out of scope; checkpoints stay.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UNDO-01 (D1) | `.notUndoable()` enforced server-side | Section A/E: shared guard site, exact destructure points to patch, zero existing test coverage today |
| UNDO-02 (D2) | Undo fenced at `execute()` barrier and `finished` phase | Section A: durable-barrier home recommendation; `finished`-phase check is a one-line addition at both executors |
| UNDO-03 (D5) | Solo undo no longer wipes the game; `moveCount` published | Section B + critical Open Question: `moveCount` is per-action-step-FRAME, not per logical multi-frame turn — the existing `collect-turns-fixture` regression exercises exactly the case this breaks naively |
| UNDO-04 (D6) | Rewind doesn't break the animation-event watermark | Section C: the CONTEXT's premise ("volatile-state allowlist already excludes it from restore") is FALSE — `SAFE_PROPERTIES` is an unrelated dev-only HMR-warning list; the real fix site is `loadSerializedState`, shared with full-session restore |
| PROC-01 | Fix → test-proven-red → fix → adversarial verify | Section D: `vitest run`, single-file/`-t` invocation, no-stash RED/GREEN mechanic |
</phase_requirements>

## Summary

The four defects share two real implementation risks the CONTEXT decisions did not fully anticipate,
and both are HIGH-confidence, code-verified findings the planner must resolve explicitly:

1. **`moveCount` is scoped to a single action-step *frame*, not a logical player "turn."** When a
   turn is expressed as `sequence(actionStep, actionStep)` (two separate frames — a real, tested
   shape in this codebase, `collect-turns-fixture.ts`), `frame.data.moveCount` resets to 0 at the
   second frame even though the player already committed one action in the first frame. Naively
   "always publish `this.moveCount`" (removing the `minMoves||maxMoves` gate at `engine.ts:579`)
   makes `undo-authoritative.test.ts`'s existing, locked-in scenario (undo the first action of a
   two-action turn while still mid-turn) fail with "No actions to undo" — a straight regression of
   an existing, currently-passing test. This must be resolved as a deliberate design decision before
   planning tasks, not discovered mid-implementation.

2. **The CONTEXT's premise about `volatile-state.ts:38` is incorrect.** `SAFE_PROPERTIES` is a
   dev-only HMR console-warning suppression list (`checkForVolatileState`, gated on
   `NODE_ENV !== 'production'`) — it has zero effect on serialization, checkpoint restore, or
   hashing. It does not "already exclude `animationEventSeq` from checkpoint restore." The actual
   mechanism that must change is `Game.loadSerializedState` (`game.ts:2938-2943`), which
   unconditionally overwrites `_animationEventSeq` from the incoming JSON — and that single method
   is shared by BOTH full-session restore (`GameSession.restore` via `game-session.ts:865`, where
   adopting the persisted seq IS correct) and undo/rewind checkpoint restore (`GameRunner.fromCheckpoint`
   → `fromSnapshot` → the same `loadSerializedState`, where it is NOT correct). The fix needs a way
   to distinguish these two call sites — it cannot be a blanket allowlist change.

Everything else in the four defects is mechanically straightforward given the scout's mapping: the
shared guard is a small, well-isolated addition to `utils.ts` consumed identically by both
executors; the `finished`-phase check is a one-line early-return in each executor; the durable
execute-barrier has a clean, low-risk home (see Section A); and the `.notUndoable()` enforcement
path currently has **zero** test coverage anywhere in the repo (verified by grep — no test file
references `hasNonUndoableAction` or `notUndoable` together with an undo op), so every UNDO-01 test
written in this phase is net-new, not a modification.

**Primary recommendation:** Sequence the plans so the `moveCount`-scope Open Question is resolved
first (it blocks UNDO-03 and touches the same `computeUndoInfo`/`buildPlayerState` code UNDO-01/02
also touch), then land UNDO-01+UNDO-02 together (shared guard + barrier), then UNDO-03, then UNDO-04
(animation fix is fully independent of the other three and can be parallelized).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Undo enforcement (notUndoable, execute barrier, finished-phase fence) | API / Backend (session) | Engine (flow) | Enforcement decision belongs to the two session-layer undo executors; the barrier RECORD is written by the flow engine during normal execution |
| moveCount computation & publication | Engine (flow) | API / Backend | `FlowEngine` owns the counter; `session/utils.ts` (`computeUndoInfo`, `buildPlayerState`) is the sole consumer that turns it into undo eligibility |
| Checkpoint restore fidelity (animation seq) | Engine (element/game.ts) | API / Backend (session restore call sites) | `loadSerializedState` is the mechanical restore; the *decision* of which call site wants monotonic-seq-preservation vs. full-adopt is a session-layer concern (which restore is happening) |
| Client animation watermark reset | Browser / Client (`useAnimationEvents.ts`) | — | Pure client-side dedupe state; defense-in-depth only per CONTEXT, primary fix is server-side |

## Standard Stack

Not applicable — this phase is a bug-fix phase within the existing engine/session code. No new
libraries or packages are introduced. `## Package Legitimacy Audit` is therefore omitted (no
installs).

## A. Durable Execute-Barrier Design

**Candidate homes evaluated:**

| Option | Survives checkpoint restore? | Serialization cost | Stateless/stateful drift risk |
|--------|------------------------------|---------------------|-------------------------------|
| (i) Action-history entry (`runner.ts:258/272`, alongside `undoable`) | Yes — `actionHistory` is always carried through both `getSnapshot`/`fromSnapshot` and `fromCheckpoint` (which slices `actionHistory.slice(0, actionIndex)`) | Zero new fields needed beyond one boolean/index per entry; already-serialized array | **Lowest** — both executors already read `runner.actionHistory` directly, no new plumbing |
| (ii) Flow `frame.data` (per-node persisted metadata, `FlowPosition.frameData`) | Yes — `frame.data` is explicitly "needed for accurate restore" (`types.ts:44`) and round-trips through `FlowState.position.frameData` at `engine.ts:384-386`/`:436` | Requires the barrier check to walk the flow-position stack to find the relevant `execute` frame at undo time — nontrivial, since undo doesn't have a "current frame" concept, it has an action-INDEX | **Higher** — frame data is keyed to flow structure, not action count; correlating "action index N crossed execute-node-at-path-P" requires a second index |
| (iii) Dedicated parallel array on `GameRunner` (mirroring `actionCheckpoints[k]`) | Yes, IF explicitly added to `GameStateSnapshot` and threaded through `getSnapshot`/`fromSnapshot`/`fromCheckpoint` the same way `actionCheckpoints` is (`runner.ts:77,:129,:136,:453-462,:567`) | New field + new plumbing at every one of those 5 sites, duplicating work already done for `actionCheckpoints` | Medium — new code path, but mechanically identical to a pattern that already exists and is proven correct |

**Recommendation: Option (i), the action-history entry.** Add a field to the serialized action-history
entry shape (parallel to how `undoable` is already recorded per entry at `runner.ts:258,:272` and
consumed by `computeUndoInfo`) marking "an `execute()` node completed at or before this action index."
Concretely: `FlowEngine.executeExecute` (`engine.ts:1548-1559`) needs a way to signal "a barrier was
crossed" back up to the runner at the moment the NEXT action is recorded — the natural mechanism is
the same one already used for `undoable`: `GameRunner.serializeForHistory`
(`runner.ts:453 area`, reads `actionDef?.undoable`) is the single chokepoint that shapes every history
entry. A parallel `crossedExecuteBarrier: boolean` (or, cheaper: track the barrier as a monotonic
`highestBarrierActionIndex: number` on the runner, updated whenever `executeExecute` runs, and simply
persist that single number wherever `actionHistory`/`actionCheckpoints` already round-trip — e.g. as
a top-level `GameStateSnapshot.executeBarrierIndex` sibling to `actionCheckpoints`) avoids per-entry
storage entirely and is O(1) to check ("is `turnStartActionIndex <= executeBarrierIndex`? refuse").
This mirrors the exact plumbing pattern `actionCheckpoints` already established (new snapshot field →
carried in `getSnapshot` → carried in `fromSnapshot`/`fromCheckpoint`) and needs no flow-frame
correlation logic. **Do not use option (ii)** — frame data is the right place for step-scoped
concerns (move counts, branch selections) but the wrong shape for an action-index-scoped fence.

## B. moveCount Non-Optionality — CRITICAL FINDING

**Every reset site, classified:**

| Line | Site | What resets | Legitimate? |
|------|------|--------------|-------------|
| `engine.ts:261` | `FlowEngine.start()` | `this.moveCount = 0` (fresh flow) | Yes — new game |
| `engine.ts:413` | `completeActionStep()` | `this.moveCount = 0` (engine-level cache) after `frame.completed = true` | Yes — leaving the frame |
| `engine.ts:441` | `restoreActionStepTracking()`, non-action-step branch | `this.moveCount = 0` after a restore lands the flow position outside any action-step | Yes — cache resync after restore |
| `engine.ts:1317` | `executeActionStep`, `skipIf` true | `this.moveCount = 0` | Yes — leaving the frame without acting |
| `engine.ts:1338` | `executeActionStep`, `maxMoves` reached | `this.moveCount = 0` | Yes — leaving the frame, limit hit |
| `engine.ts:1378` | `executeActionStep`, no available actions & `minMoves` met | `this.moveCount = 0` | Yes — leaving the frame |

**All six resets are legitimate.** They reset the ENGINE-LEVEL CACHE (`this.moveCount`), which
mirrors `frame.data.moveCount` for whichever action-step frame is currently active. None of them are
bugs. The actual per-frame counter, `frame.data.moveCount`, is initialized to 0 exactly once per
frame (`engine.ts:1323-1324`, `if (frame.data?.moveCount === undefined)`) and is never explicitly
reset elsewhere — its lifecycle is tied to the frame's own push/pop on the flow stack.

**The real gap is not a reset bug — it is scope.** `state.moveCount` is currently populated in
`getState()` (`engine.ts:579-580`) ONLY when `this.currentActionConfig && (minMoves || maxMoves)` is
configured on the active action-step. For the common case — a plain `actionStep({ actions: [...] })`
with no move limits, which is how MOST simple turn-based games (including the fixtures) are written —
`moveCount` is `undefined` today, and `computeUndoInfo` therefore ALWAYS falls into branch C (the
fallback) for these games. **This is the direct mechanism of the D5/UNDO-03 solo-game-wipe defect**:
Doom (a solo game) almost certainly has no `minMoves`/`maxMoves` on its action step, so every undo
went through the backward-scan fallback.

**The CONTEXT-mandated fix (always publish `moveCount`) is correct as far as it goes** — remove the
`(minMoves || maxMoves)` gate at `engine.ts:579` and always set `state.moveCount = this.moveCount`.
But this exposes a SECOND, deeper problem that the CONTEXT decision does not address:

> **`moveCount` (and hence `turnStartActionIndex`) is scoped to the CURRENTLY ACTIVE action-step
> FRAME, not to a logical "player turn" that may span multiple sequential frames.**

`src/session/testing/fixtures/collect-turns-fixture.ts` deliberately encodes a turn as
`sequence(actionStep({...}), actionStep({...}))` — TWO separate frames, each with its own
`frame.data.moveCount` starting at 0. `src/session/testing/undo-authoritative.test.ts` (the
project's own authoritative-undo regression test) exercises EXACTLY this: player 1 takes the first
action of a two-action turn (completing actionStep frame #1, moveCount there was 1 when the frame
completed), the flow advances into actionStep frame #2 (fresh `frame.data.moveCount = 0`), and THEN
the player sends `undo` — expecting the first action to be undone while still mid-turn
(`currentPlayer(p1turn3)` is still 1; comment: `// still player 1's turn (second actionStep pending)`).

Tracing this against the CONTEXT's planned change: at the moment of `undo`, `this.moveCount` mirrors
the ACTIVE frame (#2), which is 0 — nothing has happened in frame #2 yet. Branch B would compute
`turnStartActionIndex = actionHistory.length - 0` (rewind nothing) and `actionsThisTurn = 0`, so
`handleUndo` would return `errorResult('No actions to undo')` — **`undo.success` would flip from
`true` to `false`, breaking this exact, currently-passing test.** This is not a hypothetical; it is
traceable line-by-line through the current source.

**This must be surfaced to the planner as an explicit decision point, not discovered mid-execution.**
Two honest paths forward (Claude's discretion per CONTEXT, but the tradeoff must be documented and
chosen deliberately):

1. **Redefine "one undo = one move" to mean "one action-step frame's worth."** Undoing a completed
   frame from within the NEXT frame (as `collect-turns-fixture` currently expects) becomes
   unsupported — `canUndo` would correctly report `false` once the flow has advanced past the
   action-step frame boundary, even if `currentPlayer` hasn't changed. This is arguably MORE correct
   game-design semantics (a completed action-step is a real boundary) but is a genuine, documented
   behavior change to `undo-authoritative.test.ts`'s expected outcome — the test's assertion must be
   rewritten, not just "made pass."
2. **Extend `moveCount` semantics to accumulate across sibling action-step frames that belong to the
   same logical turn.** This requires new engine bookkeeping (e.g., a turn-scoped counter distinct
   from the per-frame counter) that does not exist today and is materially more engine work than the
   CONTEXT decision implies ("`FlowState.moveCount` is already declared... both executors already
   pass it" — true for the FRAME-scoped counter, not a turn-scoped one).

Given "No Backward Compatibility" and "no solo special-casing," option 1 is the lower-risk,
lower-scope path consistent with the rest of the CONTEXT's decisions — but the planner must make this
call explicitly and update `undo-authoritative.test.ts` (and `stateful-undo-authoritative.test.ts`,
which likely mirrors it — verify) as a KNOWN, INTENTIONAL change, with a plan task and a SUMMARY
line, not as accidental test breakage discovered during verification.

## C. animationEventSeq Volatility — CONTEXT PREMISE IS FALSE

**What `volatile-state.ts:38`'s `SAFE_PROPERTIES` actually does:** `checkForVolatileState()` runs
only when `NODE_ENV !== 'production'`, scans `Object.keys(game)` for native `Map`/`Set` instances,
and prints a `console.warn` suggesting `persistentMap()` if found. `SAFE_PROPERTIES` (including
`_animationEvents`, `_animationEventSeq`) is the list of property names EXEMPTED from that warning
because they are known to serialize correctly through the normal `toJSON()` path. **It has zero
runtime effect on serialization, checkpoint restore, hashing, or diffing.** It does not exclude
anything from checkpoint restore. The CONTEXT decision's assumption — "it already sits in the
volatile-state allowlist... the exclusion hook exists" — is **incorrect** and must not be taken as
given by the planner.

**Where the actual restore happens:** `Game.loadSerializedState` (`game.ts:2938-2943`):
```typescript
const jsonWithEvents = json as { animationEvents?: AnimationEvent[]; animationEventSeq?: number };
if (jsonWithEvents.animationEvents) {
  this._animationEvents = jsonWithEvents.animationEvents.map((e) => ({ ...e }));
  this._animationEventSeq = jsonWithEvents.animationEventSeq ?? 0;
}
```
This unconditionally overwrites the LIVE `_animationEventSeq` counter from whatever value is in the
incoming JSON. `loadSerializedState` is called from exactly ONE place, `GameRunner.fromSnapshot`
(`runner.ts` — grep-verified single call site), which is in turn shared by:
- `GameSession.restore()` (`game-session.ts:865`) — **full session restore** (server process
  restart / reconnect from persisted storage). Here adopting the persisted seq IS correct: there is
  no "live" counter running that must not regress, since the process is starting fresh.
- `GameRunner.fromCheckpoint()` (`runner.ts:630-654`) — used by BOTH undo executors
  (`stateless-ops.ts` `handleUndo`/`handleDebugRewind`, `state-history.ts`
  `undoToTurnStart`/`rewindToAction`) — **mid-session temporal rewind**. Here the live counter IS
  already running ahead, and overwriting it backward is precisely the D6 defect.

**The minimal correct change** cannot be a one-line allowlist edit. It requires distinguishing the
two call sites so `loadSerializedState` (or its caller) knows whether to adopt the incoming seq
(full restore) or preserve-and-relabel it (checkpoint/undo restore). Two concrete implementation
shapes, either viable — planner's call:
- Add an explicit parameter, e.g. `loadSerializedState(json, { preserveAnimationSeq?: boolean })`,
  defaulted `false` (today's behavior, used by `GameSession.restore`), set `true` by
  `GameRunner.fromCheckpoint`'s call path. When `true`: do not overwrite `_animationEventSeq`; keep
  the live monotonic counter; and re-stamp each restored `animationEvents` buffer entry (if any) with
  a fresh id from the (still-advancing) live counter rather than the id it carried in the checkpoint,
  so "replayed beats do animate... with fresh, higher ids" (per CONTEXT) is satisfied.
- Alternatively, perform the re-stamping OUTSIDE `loadSerializedState` entirely, at the two undo/
  rewind call sites in `stateless-ops.ts`/`state-history.ts`, immediately after `fromCheckpoint`
  returns — leaving `loadSerializedState` itself untouched (lower blast radius on the shared restore
  path, but duplicates the re-stamp logic at 4 call sites: `handleUndo`, `handleDebugRewind`,
  `undoToTurnStart`, `rewindToAction`). Given the "two executors must not drift" principle already
  established for the `hasNonUndoableAction` guard, prefer a SHARED helper (e.g. in `utils.ts`)
  called by all four, not inline duplication.

**Client-side rewind-detection signal for the defense-in-depth reset:** `createAnimationEvents` is
wired in `GameShell` purely to `state.value?.animationEvents` (`useAnimationEvents.ts`, watched at
`:378`) — there is currently NO field reaching the client that regresses specifically on
undo/rewind (the animation seq itself will no longer regress once the primary fix lands, so it
cannot be used as its own detector). The one existing candidate already published today,
`turnStartActionIndex` (`utils.ts:294-295`), is only sent to the ACTING player (`isMyTurn ? ... :
undefined`) — not usable as a universal signal for spectators/other seats. **Recommend exposing the
raw `runner.actionHistory.length` as a new, always-published `state.actionCount` field** (cheap,
already computed, no visibility/privacy concern — it's a count, not content) and have
`useAnimationEvents`'s host wiring pass `() => state.value?.actionCount` as a second watched source;
when it DECREASES between two observations, reset `lastQueuedId`/`lastProcessedId` to 0 before
processing the new `animationEvents`. This is a small, net-new addition — not a field that exists
today under a different name.

## D. Pre-Fix Failure Proof Mechanics

**Test command:** `npm test` → `vitest run` (from `package.json:64`). Single file:
`npx vitest run src/session/testing/undo-authoritative.test.ts`. Single test by name:
`npx vitest run src/session/testing/undo-authoritative.test.ts -t "undoing the current turn"`.

**No git stash needed.** CONTEXT's phrase "stashed pre-fix code" describes the STATE (code before
the fix exists), not a literal `git stash` operation. Since the repo's current HEAD *is* pre-fix code
for every one of D1/D2/D5/D6, the natural, stash-free mechanic is standard RED→GREEN TDD sequencing
within the plan's own task structure:
1. **Task N (RED):** author the regression test only, against current (unfixed) source. Run it with
   `npx vitest run <file> -t "<name>"`. It MUST fail — capture the actual failure output (assertion
   diff, or in the D5 case, the game-erasing symptom) verbatim into the task's commit message or the
   phase SUMMARY. Commit the test-only change (a genuinely red commit is fine here — this project's
   own git history shows deliberately-red commits are an accepted pattern, e.g. `[Phase 138-02]:
   go-fish/cribbage Playwright smokes intentionally left failing... documented as a blocker rather
   than papered over`).
2. **Task N+1 (GREEN):** implement the fix. Re-run the SAME test invocation. It MUST pass. Record
   the before/after pair in the SUMMARY.

This requires zero stash/branch gymnastics and fits directly into the existing plan-task commit
granularity already used throughout this project's phase history (see STATE.md's Phase 131-155
decision log — every recent phase already follows a verify-then-fix task split).

## E. Blast Radius — Tests At Risk

| File | Risk | Why |
|------|------|-----|
| `src/session/testing/undo-authoritative.test.ts` | **HIGH — will break as written** | Exercises the exact per-frame `moveCount`-scope gap in Section B; its core assertion (`undo.success === true` for a mid-turn, cross-frame undo) is incompatible with a naive "always publish frame-scoped moveCount" change unless the semantic redefinition (Section B, option 1) is adopted AND this test's expectation is deliberately rewritten |
| `src/session/testing/stateful-undo-authoritative.test.ts` | **HIGH — likely mirrors the above** | Scout-confirmed as the stateful twin of `undo-authoritative.test.ts`; same fixture (`collect-turns-fixture.ts`), same risk — must be updated in lockstep with its stateless counterpart or `parity-contract.test.ts` will start reporting real drift |
| `src/session/testing/stateful-timetravel-authoritative.test.ts` | MEDIUM | Uses rewind (the D6-adjacent debug-timetravel path); needs review once the execute-barrier fence (UNDO-02) and animation re-stamping (UNDO-04) land, since rewind targets may now be refused or animation ids may shift |
| `src/session/testing/parity-contract.test.ts` | MEDIUM (enforcement, not victim) | This is the CONTEXT-mandated invariant check — new assertions should be ADDED here for the `hasNonUndoableAction`/barrier/finished-phase behaviors, and it must be re-run after every executor change since it is the drift detector |
| `src/session/build-player-state.test.ts` | LOW-MEDIUM | Exercises `buildPlayerState`/`computeUndoInfo`'s `canUndo` output; grep shows no current `moveCount`/`hasNonUndoableAction` assertions, but any test fixture there without `minMoves`/`maxMoves` configured will see its `canUndo` value change once branch C is deleted and branch B always applies — audit for false-`canUndo`-was-true-via-fallback cases |
| `src/session/pending-action-manager.test.ts` | LOW | Grep hit on `moveCount`-adjacent territory; skim for any implicit reliance on `computeUndoInfo`'s fallback branch |
| `src/engine/command/undo.test.ts`, `src/engine/element/animation-events.test.ts` | LOW | Engine-level, likely test the mechanics `.notUndoable()`/animation-event pushing rather than session-level undo policy — verify they don't assert on `animationEventSeq` values directly (would break under re-stamping) |

**Confirmed via grep: zero existing tests reference `hasNonUndoableAction` or exercise `notUndoable`
together with an undo op anywhere in the repo.** Every UNDO-01 regression test is net-new — there is
no pre-existing test to "update," only new coverage to add (good news: less risk of drift, but also
means PROC-01's RED-proof for UNDO-01 has no prior art to copy the harness pattern from beyond the
existing undo-authoritative suites' general shape).

## F. Sibling-Repo Impact (informational — do not fix, Phase 169 does)

Grep of `~/BoardSmithGames/*/src` and `~/Dropbox/MERC/BoardSmith/MERC/src`:

- **`.notUndoable()` callers (will be newly ENFORCED, not just newly hidden):**
  `one-two-punch/src/rules/actions.ts`, `one-two-punch/src/rules/game.ts`,
  `seven/src/rules/actions.ts`, `seven/src/rules/elements.ts`,
  `MERC/src/rules/actions/day-one-actions.ts`, `MERC/src/rules/actions/rebel-economy.ts`.
  These games declared `.notUndoable()` already, presumably as documentation-only intent (since
  server-side enforcement didn't exist until this phase) — once UNDO-01 lands, any of these games'
  own game-side "undo the button after a non-undoable action" workarounds may now be REDUNDANT
  (server refuses first) rather than broken; either way this is Phase 169's sweep, not this phase's
  concern, but the planner should note it so PROC-01's adversarial-verification step can optionally
  smoke-test one of these games (e.g. `seven`) as an extra confidence signal without making it a
  gating requirement of this phase.
- **`canUndo`/`doUndo`/raw `{type:'undo'}` op callers:** `demo-complex-ui`, `doom-machine` (both UI
  and rules), `one-two-punch/src/rules/actions.ts`, `seven/src/rules/actions.ts`. Doom Machine is
  the D5/solo-wipe game named in REQUIREMENTS — a live, human-reachable repro exists in
  `~/BoardSmithGames/doom-machine` if the planner wants an end-to-end sanity check beyond the
  headless-session harness (optional, not required — session-level harness is the locked strategy).
- **Recommendation:** no verification step against a game repo is REQUIRED by this phase (checkpoints/
  APIs are unchanged in shape, only behavior tightens), but flagging `seven` (uses both
  `.notUndoable()` and `doUndo`) as a cheap optional smoke target is low-cost insurance.

## Common Pitfalls

### Pitfall 1: Treating `SAFE_PROPERTIES` as a real exclusion mechanism
**What goes wrong:** Implementing UNDO-04 by "just leaving `animationEventSeq` in the
`volatile-state.ts` allowlist" does nothing — that list only suppresses a dev console warning.
**Why it happens:** The CONTEXT.md decision document states this as settled fact; it is not.
**How to avoid:** The fix must live in `Game.loadSerializedState` (or a wrapper distinguishing full
restore from checkpoint restore) — see Section C.
**Warning signs:** If the UNDO-04 fix diff touches only `volatile-state.ts`, it is wrong.

### Pitfall 2: Publishing `moveCount` unconditionally without resolving the frame-vs-turn scope question
**What goes wrong:** `undo-authoritative.test.ts` and its stateful twin silently flip from pass to
fail (or worse, from "undo works" to "undo silently refuses," which could read as a false negative in
a quick vitest run if the assertion isn't inspected closely).
**Why it happens:** `moveCount` was designed and previously only used for `minMoves`/`maxMoves`
tracking WITHIN one action-step; repurposing it as the general undo-eligibility signal inherits that
narrower scope.
**How to avoid:** Resolve Section B's Open Question explicitly as a planning-time decision (with a
CONTEXT-equivalent note in the plan or a PLAN.md decision log entry), and treat updating
`undo-authoritative.test.ts`'s expectation as an explicit, named task — not a side effect discovered
during verification.
**Warning signs:** `vitest run src/session/testing/undo-authoritative.test.ts` failing after the
moveCount change with no corresponding plan task addressing it.

### Pitfall 3: Fixing `finished`-phase / execute-barrier checks in only one executor
**What goes wrong:** `parity-contract.test.ts` (or the adversarial-verification step) discovers the
stateless and stateful paths disagree — e.g. stateless refuses an undo across `finished` but
`state-history.ts`'s `undoToTurnStart` doesn't.
**Why it happens:** The two executors are structurally parallel but textually independent
(`stateless-ops.ts:447-495` vs. `state-history.ts:264-320`); it is easy to patch one and forget the
twin, and their rewind counterparts (`handleDebugRewind`/`rewindToAction`) as well — four call sites
total for the barrier/finished checks, not two.
**How to avoid:** Route both the `finished`-phase check and the barrier-index check through the SAME
shared helper in `utils.ts` used for `hasNonUndoableAction`, called from all four sites
(`handleUndo`, `handleDebugRewind`, `undoToTurnStart`, `rewindToAction`).
**Warning signs:** Any plan task that touches `stateless-ops.ts` without a paired task touching
`state-history.ts` for the same defect ID.

## Code Examples

### Existing shared-guard consumption pattern (what UNDO-01/02's shared guard should follow)
```typescript
// Source: src/session/stateless-ops.ts:464 (current — discards hasNonUndoableAction)
const { turnStartActionIndex, actionsThisTurn } = computeUndoInfo(
  runner.actionHistory,
  op.player,
  flowState.moveCount,
);
if (actionsThisTurn === 0) {
  return errorResult('No actions to undo');
}
```
```typescript
// Source: src/session/state-history.ts:282 — the parallel destructure to patch identically
const { turnStartActionIndex, actionsThisTurn } = computeUndoInfo(...);
```
Both call sites already exist and already call `computeUndoInfo` — the shared guard is a small
extension of code that is already shared, not a new subsystem.

### The restore call that must NOT regress the animation seq during undo/rewind
```typescript
// Source: src/engine/element/game.ts:2938-2943
const jsonWithEvents = json as { animationEvents?: AnimationEvent[]; animationEventSeq?: number };
if (jsonWithEvents.animationEvents) {
  this._animationEvents = jsonWithEvents.animationEvents.map((e) => ({ ...e }));
  this._animationEventSeq = jsonWithEvents.animationEventSeq ?? 0; // <-- regresses on undo/rewind
}
```

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Doom Machine's action step has no `minMoves`/`maxMoves` configured (inferred, not directly read from `~/BoardSmithGames/doom-machine`'s flow definition in this session) | Summary / Section B | If wrong, the specific causal chain asserted for D5 ("no move limits → moveCount undefined → branch C → wipe") would need a different concrete trigger, though the general mechanism (branch C's game-erasing potential) is independently verified in `utils.ts` regardless |
| A2 | `stateful-undo-authoritative.test.ts` mirrors `undo-authoritative.test.ts`'s exact scenario closely enough to break identically (asserted from file-naming/pattern convention and the scout's note that it's the "stateful twin," not from a full line-by-line read of the stateful file in this session) | Section E | If the stateful test's turn shape differs, only one of the pair needs the Section B fix — verify both directly before writing plan tasks |

## Open Questions

1. **Does "one undo = one move" mean "one action-step frame" or "one logical player turn" (which may
   span multiple sequential frames)?**
   - What we know: today's fallback (branch C, being deleted) implements the "logical turn" scope by
     scanning backward across `actionHistory` for a change of `currentPlayer` — it doesn't care about
     frame boundaries. The CONTEXT-mandated replacement (moveCount, branch B) is inherently
     frame-scoped as currently implemented.
   - What's unclear: whether extending moveCount to be turn-scoped (accumulating across sibling
     frames within a `sequence`) is in-scope for this phase or a follow-up.
   - Recommendation: Decide explicitly at planning time (Section B, option 1 vs. 2). Option 1
     (frame-scoped, redefine the test) is recommended as lower-risk and consistent with "no solo
     special-casing" / "no backward compatibility," but it is a genuine behavior change to
     `undo-authoritative.test.ts` that must be a named plan task, with the rationale recorded.

2. **Should the `executeBarrierIndex` (Section A) also gate `finished`-phase undo, or are these two
   independent fences?**
   - What we know: CONTEXT lists them as two separate bullet points under the same UNDO-02
     requirement, both refused "up front."
   - What's unclear: whether a single combined guard function checking both conditions is preferred,
     or two independent checks.
   - Recommendation: Implement as two independent, composable checks in the same shared `utils.ts`
     guard (barrier-index check, then phase check) — both cheap, both O(1), no reason to couple them
     structurally even though they're both part of UNDO-02.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing, `package.json` `"test": "vitest run"`) |
| Config file | `vitest.config.ts` (repo root, pre-existing) |
| Quick run command | `npx vitest run <file> -t "<test name>"` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UNDO-01 | Undo across a `.notUndoable()` action throws an actionable error, both executors | integration (session-level, `createHeadlessSession`) | `npx vitest run src/session/testing/notundoable-enforcement.test.ts` | ❌ Wave 0 — net-new file, zero existing coverage |
| UNDO-01 | `parity-contract.test.ts` asserts stateless/stateful agree on the refusal | integration | `npx vitest run src/session/testing/parity-contract.test.ts` | ✅ exists — extend with new case(s) |
| UNDO-02 | Undo refused across a completed `execute()` node (durable barrier survives checkpoint restore) | integration | `npx vitest run src/session/testing/execute-barrier-undo.test.ts` | ❌ Wave 0 — net-new |
| UNDO-02 | Undo refused when `game.phase === 'finished'` | integration | same new file or a sibling `finished-phase-undo.test.ts` | ❌ Wave 0 — net-new |
| UNDO-03 | Solo (single-player) game undo rewinds exactly one move, never wipes to empty history | integration | `npx vitest run src/session/testing/solo-undo-authoritative.test.ts` | ❌ Wave 0 — net-new (or extend `undo-authoritative.test.ts` with a 1-player variant) |
| UNDO-03 | `undo-authoritative.test.ts` / `stateful-undo-authoritative.test.ts` updated for the resolved frame-vs-turn scope decision (Open Question 1) | integration (modify existing) | `npx vitest run src/session/testing/undo-authoritative.test.ts src/session/testing/stateful-undo-authoritative.test.ts` | ✅ exist — MODIFY, not just re-verify |
| UNDO-04 | Rewind then a subsequent real action still delivers all buffered animation beats to the client with strictly increasing ids | integration, asserting on **beats delivered**, not raw counters (per CONTEXT's specifics note) | `npx vitest run src/session/testing/rewind-animation-watermark.test.ts` | ❌ Wave 0 — net-new |
| PROC-01 | Every fix above proven RED on pre-fix source before the corresponding GREEN commit | process gate, not a single command | N/A — enforced by task sequencing (Section D), verified in phase SUMMARY | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run <specific file>` (fast, targeted)
- **Per wave merge:** `npm test` (full suite — must stay at or above the pre-phase baseline pass count, with the deliberate `undo-authoritative.test.ts` behavior-change accounted for explicitly, not just "still green")
- **Phase gate:** Full suite green (with the intentional test-expectation changes documented) before `/gsd:verify-work`; `parity-contract.test.ts` green is a hard gate given the "two executors must not drift" locked decision

### Wave 0 Gaps
- [ ] `src/session/testing/notundoable-enforcement.test.ts` — covers UNDO-01
- [ ] `src/session/testing/execute-barrier-undo.test.ts` (+ finished-phase case) — covers UNDO-02
- [ ] `src/session/testing/solo-undo-authoritative.test.ts` — covers UNDO-03
- [ ] `src/session/testing/rewind-animation-watermark.test.ts` — covers UNDO-04
- [ ] Modify `src/session/testing/undo-authoritative.test.ts` + `stateful-undo-authoritative.test.ts` for the resolved moveCount-scope decision — no new file, but a required edit before the phase can close green
- [ ] No framework install needed — Vitest is already fully wired

## Security Domain

Not applicable in the ASVS sense — this phase changes server-authoritative game-state control flow
(undo/rewind), not authentication, session management, or externally-facing input validation. The
one security-adjacent property worth naming: **UNDO-01/02 ARE the fix for a class of "client-trusted
enforcement" bug** (the button was hidden but the server-side op still succeeded) — the adversarial
verification step in CONTEXT (raw `{type:'undo'}` op bypassing `canUndo`) is effectively an
authorization-boundary test, confirming the server, not the client UI, is the enforcement point. No
new ASVS category is newly "applicable" by this phase; it hardens an existing implicit V4-style
(Access Control / server-trusts-client-state) gap that already existed in the undo op handler.

## Sources

### Primary (HIGH confidence — direct repo reads this session)
- `src/session/utils.ts` (`computeUndoInfo`, `buildPlayerState`) — full read of lines 160-330
- `src/session/stateless-ops.ts` (`handleUndo`) — lines 440-500
- `src/runtime/runner.ts` (`GameRunner`, `actionCheckpoints`, `getSnapshot`, `fromCheckpoint`, `fromSnapshot` call sites) — lines 1-150, 230-290, 440-470, 550-655
- `src/engine/utils/snapshot.ts` (`GameStateSnapshot`, `ActionCheckpoint`, `createActionCheckpoint`) — lines 40-210
- `src/engine/flow/engine.ts` (`executeExecute`, `executeActionStep`, `completeActionStep`, `restoreActionStepTracking`, `getState`, all six `moveCount = 0` sites) — lines 200-450, 560-595, 1290-1400, 1500-1560
- `src/engine/flow/types.ts` (`FlowState`, `FlowPosition`) — lines 39-270
- `src/engine/element/game.ts` (`pushAnimationEvent`, `toJSON` animation fields, `loadSerializedState` animation restore) — lines 2620-2650, 2690-2710, 2925-2950
- `src/engine/element/volatile-state.ts` — full file read, confirming `SAFE_PROPERTIES`' actual (dev-HMR-warning-only) purpose
- `src/ui/composables/useAnimationEvents.ts` — lines 1-50, 260-300, 370-395; and its call sites (`ActionPanel.vue:89`, `AutoRenderer.vue:197`)
- `src/session/testing/undo-authoritative.test.ts`, `collect-turns-fixture.ts` — full reads, confirming the frame-vs-turn scope regression risk
- `package.json` — test script confirmation
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/phases/155-undo-rewind-family-correctness/155-CONTEXT.md` — upstream inputs

### Secondary (MEDIUM confidence)
- None — no external documentation or web sources were needed; this is entirely an internal
  codebase-correctness phase.

### Tertiary (LOW confidence)
- Assumption A1 (Doom Machine's action-step config) — see Assumptions Log

## Metadata

**Confidence breakdown:**
- Undo enforcement (A/UNDO-01/UNDO-02): HIGH — every call site and data shape directly read
- moveCount scope (B/UNDO-03): HIGH — the regression is traced line-by-line against a real, existing
  test; this is the most load-bearing finding in this document
- animationEventSeq (C/UNDO-04): HIGH — `SAFE_PROPERTIES`' actual behavior and `loadSerializedState`'s
  single call site were both directly read; the CONTEXT premise is verifiably false, not a guess
- Test/process mechanics (D/PROC-01): HIGH — `package.json` read directly
- Blast radius (E): HIGH for the two flagged files (traced), MEDIUM for the "LOW" rows (grep-only,
  not full reads)
- Sibling-repo impact (F): MEDIUM — grep-based inventory only, not full reads of each game

**Research date:** 2026-07-20
**Valid until:** Stable for the life of this phase (internal-codebase research, not
external-ecosystem-dependent) — re-verify only if CONTEXT.md or REQUIREMENTS.md changes before
planning completes.
