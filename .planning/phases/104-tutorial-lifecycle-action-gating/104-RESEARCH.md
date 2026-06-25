# Phase 104: Tutorial Lifecycle & Action Gating - Research

**Researched:** 2026-06-25
**Domain:** Engine/session substrate — serialized game attribute, disabled-selection reuse, session lifecycle controller, multi-step action gating
**Confidence:** HIGH (all claims verified against repo source; no external deps)

## Summary

Phase 104 builds a tutorial substrate entirely from primitives that already exist in the BoardSmith engine + session. The CONTEXT integration map is accurate and is not re-derived here. This research confirms the load-bearing mechanics and surfaces the **non-obvious edge cases** the planner must task explicitly:

1. **Serialization round-trips only for plain public instance fields.** `GameElement.toJSON()` (`src/engine/element/game-element.ts:699-714`) serializes via `Object.keys(this)`, skipping `_`-prefixed keys and `unserializableAttributes`. A `#private` field or a getter-backed property will **silently not round-trip**, and `loadSerializedState` re-applies by direct assignment (`src/engine/element/game.ts:2483-2487`), which would throw/no-op on a getter-only property. Tutorial progress must be a plain public field initialized in the constructor.
2. **Target-level gating reuses the v2.8 `disabled` path with zero new validation.** Disabling all-but-one choice leaves the action available (`hasValidSelectionPath` keeps it if ≥1 enabled — `src/engine/action/action.ts:1218-1221`) and the UI auto-fills the single enabled choice (`src/ui/composables/useActionController.ts:481-500`). This is the desirable behavior and it falls out for free.
3. **Action-level "disabled with reason" is NOT yet on the wire.** `disabled?: string` exists only at the choice/element level (`src/types/protocol.ts:473-487`). Action availability is a binary `string[]` (`PlayerGameState.availableActions`). Surfacing a *reason* for a gated-out action (success criterion #3) requires net-new surface — the planner must task this, not assume it exists.
4. **MCTS clone, undo, and snapshot restore all funnel through `loadSerializedState`**, so a correctly-serialized progress attribute round-trips through every path automatically (`src/runtime/runner.ts:351-416`, `src/ai/mcts-bot.ts:1201-1234`).

**Primary recommendation:** Store progress as a plain public `Game` instance field (e.g. `tutorialProgress: Record<number, TutorialProgress>` or, preferably, `Map<number, TutorialProgress>` to preserve numeric seat keys). Hold the tutorial **definition** on the game instance (passed via constructor options, mirroring how `_actions`/flow live on the instance and how `GameDefinition.ai` is passed to `AIController` un-serialized). Implement the gate as an augmentation of the engine's existing `getChoices` (target/choice level) plus a new action-level annotation in available-actions computation. Own lifecycle in a session-layer `TutorialController` peer to `PendingActionManager`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tutorial progress storage | Engine (Game state) | — | Must ride `toJSON()` to be checkpoint/undo/replay-safe (CONTEXT Area 2) |
| Tutorial definition (steps/gates) | Engine (instance, non-serialized) | Session (source) | Gate evaluation runs in engine `getChoices`/availability; definition must reach the engine like `_actions` does |
| Gate enforcement (target/choice) | Engine (`getChoices` disabled) | — | Reuse v2.8 disabled path — success criterion #4 (no parallel validator) |
| Gate enforcement (action-level reason) | Engine availability + Session metadata | Wire (`protocol.ts`) | Action-level disabled reason is net-new surface |
| Lifecycle (start/advance/skip/exit) | Session (`TutorialController`) | Engine (mutates progress) | Orchestration peer to `PendingActionManager`; durable state stays in engine |
| Client surfacing of active step | Session (`buildPlayerState`) + host (`createPlayerView`) | Wire (`PlayerGameState`) | Both projection paths must match or embed/platform diverges |

## Standard Stack

No new packages. This phase is pure first-party TypeScript inside `src/engine`, `src/session`, `src/types`, with tests in `src/**/*.test.ts` (Vitest, already configured). **No `## Package Legitimacy Audit` required — zero external packages installed.**

## Validation Architecture

> nyquist_validation is not set to `false` in `.planning/config.json` → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (repo standard; colocated `*.test.ts`) |
| Config file | `vitest.config.ts` (repo root) |
| Quick run command | `npx vitest run src/engine/action src/session` |
| Full suite command | `npm test` |

### Test utilities to reuse (`src/testing/`)
- `TestGame.create(GameClass, { playerCount, seed })` — `src/testing/test-game.ts:68-93`; `.performAction()` at `:189`, `.getSnapshot()`-style snapshot at `:211-213`. Drives a real `GameRunner`, so undo/checkpoint/serialization paths are exercised exactly as production.
- `assertActionAvailable` / `assertActionNotAvailable` — `src/testing/assertions.ts:180,216` — for gate on/off assertions.
- `assertFlowState` — `src/testing/assertions.ts:64`.
- A minimal in-test `Game` subclass with one two-step action + a registered tutorial is the cheapest harness; the engine `*.test.ts` files (e.g. `src/engine/flow/engine.test.ts`) already follow this pattern. Do **not** depend on external game packages (project memory: external-rules-dependent tests are excluded from Vitest).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| TUT-02 | Gated out-of-step action surfaces a reason (not silent) | unit | `npx vitest run src/engine/action/<gate>.test.ts` | ❌ Wave 0 |
| TUT-02 | Target gating: only allowed element/choice enabled, others disabled-with-reason | unit | same | ❌ Wave 0 |
| TUT-02 | Auto-fill resolves the single allowed target (no break) | unit (UI) | `npx vitest run src/ui/composables/useActionController.test.ts` | extend existing |
| TUT-02 | hasValidSelectionPath keeps action available when ≥1 target allowed | unit | engine gate test | ❌ Wave 0 |
| TUT-05 | Progress round-trips snapshot → restore identically | unit | `npx vitest run src/runtime/runner.test.ts` or new | ❌ Wave 0 |
| TUT-05 | Undo a move rewinds the tutorial step in lockstep | unit | `npx vitest run src/session/stateless-ops.test.ts` (mirror) | ❌ Wave 0 |
| TUT-05 | MCTS clone carries progress attribute safely | unit | `npx vitest run src/ai/<restore>.test.ts` | ❌ Wave 0 |
| TUT-05 | start/advance/skip/exit transitions + broadcast | unit | `npx vitest run src/session/<tutorial-controller>.test.ts` | ❌ Wave 0 |
| TUT-05 | buildPlayerState + createPlayerView both surface active step (parity) | unit | `npx vitest run src/session/build-player-state.test.ts` | extend existing |

### Critical round-trip test (the highest-risk item per STATE.md)
A single test that proves the **serialized-attribute discipline**: set progress, `runner.getSnapshot()`, `GameRunner.fromSnapshot()`, assert progress is byte-identical. This test is the guard that catches the "implemented as `#private`/getter → silent data loss" trap. It MUST fail if progress is stored anywhere but a plain public field. Place in `src/session/restore-snapshot-authoritative.test.ts` (existing file) or a new `tutorial-serialization.test.ts`.

### Sampling Rate
- **Per task commit:** `npx vitest run src/engine/action src/session/<tutorial files>`
- **Per wave merge:** `npm test` (full ~1245-test suite, must stay green per v4.0 baseline)
- **Phase gate:** Full suite green + at least one cross-layer integration test (engine progress → session lifecycle → client projection) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/session/tutorial-controller.test.ts` — lifecycle transitions + broadcast
- [ ] `src/engine/action/tutorial-gate.test.ts` — target + action gating, reason surfacing, auto-fill interplay
- [ ] Tutorial serialization round-trip test (snapshot, undo, MCTS clone) — colocate per path
- [ ] Extend `src/session/build-player-state.test.ts` for active-step projection parity

## Architecture Patterns

### System data flow

```
GameDefinition.tutorial (author, static)
        │  threaded via GameSession.create() → game constructor options
        ▼
Game instance ──holds──► tutorialDefinition (non-serialized, like _actions)
        │                tutorialProgress[seat]  (PLAIN PUBLIC FIELD → toJSON)
        │
        ├──► getChoices(selection)  ─── augmented: OR-in gate disabled reason ──► AnnotatedChoice[].disabled
        │         │                                                                      │
        │         └──► validateSelection (checks disabled FIRST, action.ts:678) ◄────────┘
        │         └──► hasValidSelectionPath (filters disabled===false) ──► action availability
        │
        ├──► getAvailableActions ── augmented: annotate gated-out actions with reason (NEW surface)
        │
        ▼
GameRunner.getSnapshot() ──► game.toJSON() carries tutorialProgress ──► snapshot/checkpoint/undo/MCTS all reuse loadSerializedState
        │
        ▼
TutorialController (session) ── start/advance/skip/exit ── mutates game.tutorialProgress ── broadcast()
        │
        ▼
buildPlayerState (utils.ts:404) + createPlayerView (snapshot.ts:206) ── project active step ──► PlayerGameState.tutorial (NEW) ──► client
```

### Pattern 1: Definition on instance, progress in state
**What:** Static gate config lives on the game instance (un-serialized), per-seat progress lives in serialized state.
**Why:** The gate evaluation runs in the engine (`getChoices`), which has no access to session controllers. `GameDefinition.ai` already demonstrates passing static config un-serialized into a controller (`src/session/game-session.ts:565-566`, `AIController` ctor). Mirror it: pass `tutorial` through `GameSession.create()` into the game constructor options so the engine holds it like `_actions`.
**Evidence:** `_actions`, flow definition, and seeded RNG all live on the instance and are deliberately preserved across `loadSerializedState` (`src/engine/element/game.ts:2441-2443`).

### Pattern 2: Gate as a central augmentation of `getChoices`
**What:** When a tutorial is active for the seat, the substrate computes each choice/element's gate-disabled reason and OR-s it into the existing `disabled` result (`src/engine/action/action.ts:365-368, 410-415, 425-430`).
**Why:** `validateSelection` already checks disabled first (`:678-680`) and `hasValidSelectionPath` already filters `disabled === false` (`:1148, 1171, 1196, 1218`). Injecting at `getChoices` means every downstream consumer (validation, availability, UI metadata, pick-handler at `src/session/pick-handler.ts:203,272,288`) inherits the gate with **zero parallel path** — satisfying success criterion #4.

### Pattern 3: Lifecycle controller peer to PendingActionManager
**What:** `TutorialController` in `src/session/`, constructed in `GameSession` alongside `#pickHandler` / `#pendingActionManager` (`src/session/game-session.ts:179-213`), with a `broadcast: () => this.broadcast()` callback (the universal post-mutation funnel, `:1462-1489`).
**Why:** Established session pattern; gets undo-sync and rebroadcast for free.

### Anti-Patterns to Avoid
- **Storing progress as `#private` or a getter.** `Object.keys(this)` in `toJSON` (`game-element.ts:707`) only sees own enumerable data properties. A `#field`/getter silently won't serialize → progress resets on every undo/snapshot/MCTS clone. **This is the single most likely defect in this phase.**
- **A `Record<number, …>` if you need numeric seat keys back.** JSON object keys stringify; restore yields `"1"` not `1`. `serializeValue` encodes a `Map` losslessly via `__map` (`game-element.ts:830-837`) preserving numeric keys. Prefer `Map<number, TutorialProgress>` for the per-seat store, or accept string-key lookups (JS coerces `obj[player.seat]` fine, but `Object.keys`/iteration sees strings).
- **A second validation pipeline.** Do not add a "tutorial validator" that runs alongside `validateSelection`. Route everything through `disabled`.
- **Gating that disables ALL choices of a required selection.** That makes the action vanish (`hasValidSelectionPath` returns false at `:1219-1221`) instead of surfacing a reason. Always leave the intended target enabled; use the action-level reason surface for "this action isn't part of the current step."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persisting progress across undo/checkpoint/replay/MCTS | Session-layer `StoredGameState` field + custom save path | A plain public `Game` field carried by `toJSON()` | All four paths already funnel through `loadSerializedState`; one field covers them all |
| Disabling out-of-step targets | New filter that removes choices | v2.8 `disabled` annotation in `getChoices` | Removing choices loses the reason; disabled keeps it visible + reasoned |
| Auto-selecting the one allowed target | Tutorial-specific auto-advance | Existing single-enabled-choice auto-fill | `useActionController.ts:481-500` already auto-fills exactly-one-enabled |
| Lifecycle broadcast/undo-sync | Custom event emitter | `TutorialController` + `this.broadcast()` funnel | `broadcast()` is the universal post-mutation rebroadcast (`game-session.ts:1462`) |

**Key insight:** The engine already separates "visible (filter)" from "selectable (disabled)". The tutorial gate is purely a *selectability* concern → it belongs in the disabled layer, full stop.

## Serialization + Undo Edge Cases (deep-dive)

| Path | Carries game attributes? | Mechanism | Evidence |
|------|--------------------------|-----------|----------|
| `toJSON()` | Yes, plain public own keys only | `Object.keys(this)`, skip `_`/unserializable, `serializeValue` (handles nested obj/array/Map/Set/element-ref) | `game-element.ts:699-714, 790-853` |
| Snapshot `createSnapshot` | Yes | `state: game.toJSON()` | `snapshot.ts:141` |
| `ActionCheckpoint` (undo/time-travel) | Yes | `state: game.toJSON()` per action-count boundary | `snapshot.ts:160-168`, `runner.ts:119-123` |
| `fromSnapshot` restore | Yes | `loadSerializedState(snapshot.state)` re-applies attributes by assignment | `runner.ts:383`, `game.ts:2483-2487` |
| `fromCheckpoint` (undo op) | Yes | builds a synthetic snapshot → `fromSnapshot` | `runner.ts:438-462`; undo op `stateless-ops.ts:362-405` |
| MCTS clone (`restoreGame`) | Yes | `loadSerializedState` on a fresh instance | `mcts-bot.ts:1201-1234` |
| `toJSONForPlayer` (client view) | **Filters by visibility** | Hidden elements redacted; game-level attributes flow through `super.toJSON()` | `game.ts:2285-2393` |

**Undo-sync confirmation:** Because each `ActionCheckpoint` captures the full `toJSON()` at its action-count boundary and the undo op restores `actionCheckpoints[turnStartActionIndex]` directly (`runner.ts:438`, `stateless-ops.ts:397-405`), undoing a move restores the progress value as it was at that boundary. **Undo rewinds the tutorial step automatically** — no extra wiring — *provided progress lives in the serialized attribute*. This is the CONTEXT "undo-sync for free" claim, verified.

**MCTS caution:** the bot mutates `searchGame` during playouts via commands and rolls back with `undoCommands` to `rootCommandCount` (`mcts-bot.ts:1195-1199`). Progress is a plain attribute, **not** a command-tracked element, so it is NOT mutated by playout commands and NOT rolled back — but the bot also never advances the tutorial (lifecycle is session-only). The root is restored from the snapshot each search (`restoreGame`), which re-establishes the correct progress. Net: safe. Flag a test asserting a cloned search game carries the root's progress value.

**Where to surface the active step to the client:** add an optional `tutorial?` projection to `PlayerGameState` (`src/session/types.ts:360-386`), populated in `buildPlayerState` (`src/session/utils.ts:404-415`) from `game.tutorialProgress[seat]` + the active step's `id`/reserved `content` slot. **Parity requirement:** the host-embedded view `createPlayerView` (`src/engine/utils/snapshot.ts:206-219`) is a separate projection — if the client reads the active step it must be added to BOTH or platform/embed mode diverges (same class of bug called out in the snapshot.ts comment at `:181-186`).

## Gating × Multi-Step Actions & Auto-Fill (deep-dive)

Checkers `move` is two steps (select piece → select destination) with auto-fill. Target-level gating interacts as follows:

1. **Disabling non-allowed choices keeps the action available.** `hasValidSelectionPath` returns true as long as ≥1 enabled choice exists per required selection (`action.ts:1148-1151, 1196-1199, 1218-1221`). Gating to a single allowed piece/destination → action stays available. ✅
2. **Auto-fill picks the single allowed choice.** `tryAutoFillSelection` filters `choices.filter(c => !c.disabled)` and fills when exactly one remains (`useActionController.ts:485-489`), recursing to the next selection (`:518-524`). So gating destination to only `d4` auto-resolves it. ✅ Desirable.
3. **Validation rejects a disabled value with the reason.** `validateSelection` checks disabled FIRST and emits `Selection disabled: <reason>` (`action.ts:677-680`, elements variant `:704-709`). A learner who submits a non-allowed target (e.g. via custom UI) gets the reason, not a silent drop. ✅ Satisfies "surface a reason."
4. **Double-edged: auto-fill can rob a teaching interaction.** If the *first* selection (piece) is gated to one piece, auto-fill (`getAutoFill()`, default on — `useActionController.ts:482`) selects it immediately, skipping the "click piece c3" teaching beat. For steps that want the learner to perform the click, the gate should leave multiple pieces *enabled-but-untaught* OR the tutorial should suppress auto-fill (`autoFill: false` option exists). **Flag for Phase 105/109 content design; the substrate must expose the choice.** (Engine ref: auto-fill is a UI-layer behavior; the engine gate is identical regardless.)

## Lifecycle Surfacing (deep-dive)

**Two op surfaces exist:**
- **Stateless ops** — discriminated `Op` union (`src/session/stateless-ops.ts:29-59`): `start | action | selectionStep | resolveChoices | cancelAction | undo | aiTurn | debug*`. New tutorial ops (`tutorialStart | tutorialAdvance | tutorialSkip | tutorialExit`) would be added here and dispatched in the `switch` at `:675-712` if the stateless path must support tutorials.
- **Stateful `GameSession`** — exposes public methods (`performAction`, `processSelectionStep`, `undo`, etc.) that the transport/dev-host calls; mutations end in `broadcast()` (`:1462`). `TutorialController` adds `start/advance/skip/exit` methods here, each ending in `this.broadcast()`.

**Cleanest path (consistent with existing patterns):** add `TutorialController` methods on the stateful `GameSession` (peer to pending-action methods at `game-session.ts:1357+`) AND add matching `Op` variants for the stateless path. The wire message type follows the existing `Op` discriminated-union convention — there is no separate "MessageType" enum; the dev-host/transport routes `{type: '...'}` ops. Use `Claude's Discretion` (CONTEXT) to choose op names; keep them parallel to `cancelAction`/`undo` (verb-named, carry `player`/`seat`).

## Common Pitfalls

### Pitfall 1: Progress stored as `#private` or getter → silent serialization loss
**What goes wrong:** Progress resets to constructor default after any undo/snapshot/MCTS clone.
**Why:** `toJSON` only enumerates plain own data keys (`game-element.ts:707-708`); `loadSerializedState` assigns directly (`game.ts:2485`).
**How to avoid:** Plain public field initialized in constructor. Guard with the round-trip test above.
**Warning signs:** A test that mutates progress then snapshots/restores shows the default.

### Pitfall 2: Numeric seat keys come back as strings
**What goes wrong:** `Object.keys(progress)` returns `["1","2"]`; strict `===` seat comparisons or `Object.entries` numeric assumptions break.
**Why:** JSON object keys are strings.
**How to avoid:** Use `Map<number, …>` (lossless via `__map`, `game-element.ts:830-837`) or always index with coercion and never rely on key identity.

### Pitfall 3: Gating hides an action instead of reasoning it
**What goes wrong:** Out-of-step action vanishes from `availableActions` with no reason (violates success criterion #3).
**Why:** Action availability is binary (`getAvailableActions` → `string[]`); there is no action-level `disabled` on the wire (`protocol.ts` only has choice/element disabled).
**How to avoid:** Add an action-level reason surface (e.g. annotate `actionMetadata` or a new `disabledActions: Record<name,reason>` in `PlayerGameState`). Task this explicitly — it does not exist yet.
**Warning signs:** The "blocked action surfaces a reason" test has nowhere to read the reason from.

### Pitfall 4: Client projection parity miss
**What goes wrong:** Active step shows in dev server but not in platform/embed (or vice-versa).
**Why:** `buildPlayerState` (session) and `createPlayerView` (host snapshot) are two independent projections (`utils.ts:342` vs `snapshot.ts:174`).
**How to avoid:** Project the active step in both, or assert parity in a test (mirrors the documented awaitingPlayers parity fix at `snapshot.ts:181-186`).

## Runtime State Inventory

> Greenfield substrate (new fields + new controller). No rename/migration. Section included for completeness; the only "runtime state" introduced is the serialized progress attribute, fully covered by the Serialization deep-dive above.

| Category | Items | Action |
|----------|-------|--------|
| Stored data | New `tutorialProgress` game attribute (serialized) | Covered by `toJSON`/`loadSerializedState` — no migration (no existing saves contain tutorials) |
| Live service config | None — verified, this is library code | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None (no package rename) | None |

## Environment Availability

Step 2.6: SKIPPED (no external dependencies — first-party TS/Vitest only, already present).

## Security Domain

> `security_enforcement` not set to `false`. Tutorial gating is a **client-experience constraint, not a trust boundary.**

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V4 Access Control | partial | Gating is per-seat but is a teaching constraint, not authorization. The server already validates that only the due seat may act (`runner.ts:157` `canPlayerAct`; `seat-activity.ts`). Tutorial gating must NOT be relied on for security. |
| V5 Input Validation | yes | Reuse `validateSelection` — gated values rejected server-side with reason (`action.ts:677-680`). No new untrusted-input parser. |
| V6 Cryptography | no | — |

| Threat | STRIDE | Mitigation |
|--------|--------|------------|
| Learner-seat client submits an out-of-step action directly | Tampering | Server `validateSelection`/availability already authoritative; gate enforced engine-side, not just UI |
| Tutorial progress forged by client | Tampering | Progress is server-owned game state; lifecycle ops mutate it only through `TutorialController` (no client-set of arbitrary step) |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Action-level disabled-reason surface should live in `PlayerGameState`/`actionMetadata` (exact shape is planner's choice) | Pitfall 3 | Low — CONTEXT explicitly wants action-level reason; only the field placement is open |
| A2 | `Map<number, TutorialProgress>` preferred over `Record` for seat keys | Anti-Patterns | Low — both round-trip; Map only avoids key stringification |

All other claims are `[VERIFIED: repo source]` with file:line. (No external packages → no registry/slopcheck claims.)

## Open Questions (RESOLVED)

1. **Action-level reason wire shape.** RESOLVED: a new `disabledActions: Record<actionName, reason>` map on `PlayerGameState` (and the parity projection `createPlayerView`), read by `useBoardInteraction` — implemented in Plans 104-01/104-02/104-04.
2. **Auto-fill suppression during taught selections.** RESOLVED: the substrate exposes a per-step `suppressAutoFill` signal and does NOT force auto-fill on; wired into `tryAutoFillSelection` — implemented in Plan 104-03, end-to-end trace in 104-04 Task 3.
3. **Stateless-ops parity.** RESOLVED: implement stateful `GameSession`/`TutorialController` only for Phase 104 (the demo runs stateful via GameShell/dev-host); stateless `Op`-union tutorial ops deferred until a stateless consumer needs them.

## Sources

### Primary (HIGH confidence — repo source, this session)
- `src/engine/element/game-element.ts:699-854` — `toJSON`/`serializeValue` (attribute round-trip rules, Map/Set/ref handling)
- `src/engine/element/game.ts:2258-2520` — `toJSON`, `toJSONForPlayer`, `loadSerializedState`, `restoreGame`
- `src/engine/action/action.ts:316-441, 642-824, 947-960, 1121-1245` — `getChoices`, `validateSelection` (disabled-first), `isActionAvailable`, `hasValidSelectionPath`
- `src/engine/action/types.ts:15-23` — `AnnotatedChoice<T>` / `disabled`
- `src/engine/utils/snapshot.ts:130-219` — `createSnapshot`, `createActionCheckpoint`, `createPlayerView`
- `src/runtime/runner.ts:100-462` — checkpoint/snapshot/`fromSnapshot`/`fromCheckpoint`
- `src/ai/mcts-bot.ts:1201-1234` — MCTS `restoreGame`
- `src/session/game-session.ts:179-213, 1357-1489` — manager wiring, broadcast funnel
- `src/session/utils.ts:342-448` — `buildPlayerState`
- `src/session/types.ts:64-78, 360-386` — `GameDefinition`, `PlayerGameState`
- `src/session/stateless-ops.ts:29-59, 362-405, 675-712` — `Op` union, undo op, dispatch
- `src/ui/composables/useActionController.ts:474-525` — auto-fill (`tryAutoFillSelection`, `fetchAndAutoFill`)
- `src/types/protocol.ts:468-487` — `disabled?: string` (choice/element only)
- `src/engine/flow/engine.ts:1239-1291` — action-step availability computation
- `src/testing/test-game.ts:50-189`, `src/testing/assertions.ts:64-216` — test utilities

## Metadata

**Confidence breakdown:**
- Serialization/undo/MCTS round-trip: HIGH — traced every path to `loadSerializedState`/`toJSON`
- Gating reuse + auto-fill interplay: HIGH — exact code paths cited
- Action-level reason surface gap: HIGH — confirmed absent in `protocol.ts`
- Lifecycle/op surfacing: HIGH — mirrors `PendingActionManager`/`AIConfig` precedent

**Research date:** 2026-06-25
**Valid until:** ~2026-07-25 (stable first-party code; re-verify if action/snapshot internals change)
