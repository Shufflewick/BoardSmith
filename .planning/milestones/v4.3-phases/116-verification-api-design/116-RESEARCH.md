# Phase 116: Verification & API Design - Research

**Researched:** 2026-06-30
**Domain:** BoardSmith codebase archaeology — action introspection, test ergonomics, dev-host devtools, authoring pit-of-success guards
**Confidence:** HIGH (all claims verified against `src/` with file:line evidence)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- The locked design doc lives at `.planning/v4.3-API-DESIGN.md` (planning artifact, not user-facing docs).
- One doc with two parts: (1) verdicts table (claim → confirmed/false/partial → file:line → exists-vs-build), (2) full API spec (names, signatures, return shapes, serialization, ownership).
- API spec depth: full signatures + return shapes + serialization (per DSGN-02), not high-level sketches.
- Hard approval gate: autonomous mode pauses after the doc is produced; no Phase 117 implementation until approved.

### Claude's Discretion
- Verification methodology (surfaces to scan, parallel fan-out vs sequential) is at Claude's discretion — but every verdict must carry file:line evidence and an explicit exists-vs-build note.

### Deferred Ideas (OUT OF SCOPE)
- Actual implementation of any surface (Phases 117–121).
- Public documentation of the surface (Phase 122).
- Future Requirements (INTRO-F1/F2, TEST-F1, DEV-F1/F2, PIT-F1) unless promoted during verification.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DSGN-01 | Each scouted friction claim verified with verdict + file:line + exists-vs-build | `## Verification Findings` table below — all 16 targets covered with evidence |
| DSGN-02 | Single reviewed API-design doc with full names, signatures, return shapes, serialization, ownership | `## API Design Blueprint` section provides the raw material; planner writes the task that produces `.planning/v4.3-API-DESIGN.md` |
| DSGN-03 | Design doc records which speculative items are IN vs. DEFERRED with rationale | `## Speculative Scope Disposition` section; INTRO-F1 is a promote candidate |
</phase_requirements>

---

## Summary

Phase 116 is a read-only verification + design-doc phase that gates the entire v4.3 milestone. This research investigated every scouted friction claim against the live `src/` codebase, producing file:line evidence for each verdict.

**The headline finding:** The three named "already exists" claims have mixed truth. `getPlayerView()` is fully confirmed at multiple layers (engine → runner → TestGame). The checkpoint/rewind machinery is also fully confirmed and largely public (all five methods on `GameSession`), making INTRO-F1 a strong promote candidate. The action-resolved signal is only partially confirmed: `actionCompletedTick` exists as a Vue reactive ref inside `useActionController` but has no DOM-observable form (no `CustomEvent`, no postMessage to the DevHost outer page).

For the friction claims: the action-space introspection pieces all exist scattered across engine/session/ai modules but are not unified into a single entry point. The test ergonomics gaps are real (no `playUntilComplete`, no multi-step builder, exact-only assertion mode). The PIT guards are all genuinely missing or underpowered (devWarn not hard error, no element-class or action-reachability validation, no element-identity lint rules). DEV tooling has `data-element-id` in AutoUI but a different attribute scheme (`data-bs-el-id`) in custom UI — not yet unified.

**Primary recommendation:** The planner should structure Phase 116 as: (1) an agent reads each verified finding below, (2) writes the verdicts table + full API spec into `.planning/v4.3-API-DESIGN.md`, and (3) pauses for human approval. No production code changes occur in this phase.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Action-space introspection (INTRO-01..04) | Engine (`game.ts`) | Session (wire + serialization) | Actions and selections are defined on the Game instance; session layer already wraps them for the dev server |
| Perspective-aware state view (INTRO-05) | Engine/Runtime (`snapshot.ts`, `runner.ts`) | Testing (`TestGame`) | `createPlayerView` + `runner.getPlayerView` already do the full job |
| Test ergonomics (TEST-01..05) | Testing (`src/testing/`) | Engine (action traces) | TestGame + assertions are the home; action traces are engine primitives |
| Dev-host bridge (DEV-01..04) | UI (`src/ui/`) + CLI (`src/cli/dev-host/`) | Runtime | Rendering attributes in UI components; devtools global in DevHost.vue |
| Authoring pit guards (PIT-01..03) | Engine (builders + game.ts) | — | `loop()` builder and `startFlow()` are the right injection points |
| Lint rules (PIT-04) | ESLint plugin (`src/eslint-plugin/`) | — | Existing plugin infrastructure; add rules alongside `no-timers` etc. |
| Checkpoint/rewind API (INTRO-F1) | Session (`GameSession`) | Runtime (`StateHistory`) | Already fully implemented; just needs promotion/export |

---

## Verification Findings

> This is the raw material for the DSGN-01 verdicts table in the design doc. Every claim is verified with file:line evidence from `src/`.

### THREE NAMED "ALREADY EXISTS" CLAIMS

#### Claim 1: `getPlayerView()` (INTRO-05)

| Field | Value |
|-------|-------|
| **Verdict** | CONFIRMED |
| **Exists vs. build** | EXISTS — four public entry points at different layers |

**Evidence:**

1. `createPlayerView(game, playerPosition)` → `PlayerStateView` — `src/engine/utils/snapshot.ts:194`
   - Exported from `src/engine/index.ts:211` and `src/engine/utils/index.ts:19`
   - Calls `game.toJSONForPlayer(playerPosition)` for hidden-info filtering; handles simultaneous-action steps

2. `runner.getPlayerView(playerPosition)` → `PlayerStateView` — `src/runtime/runner.ts:281`
   - Delegates to `createPlayerView(this.game, playerPosition)`
   - `runner.getAllPlayerViews()` → `PlayerStateView[]` also available at `src/runtime/runner.ts:288`

3. `TestGame.getPlayerView(playerSeat)` → `PlayerStateView` — `src/testing/test-game.ts:243`
   - Public method; delegates to `runner.getPlayerView(playerSeat)`

4. `game.toJSONForPlayer(player | number | null)` → `ElementJSON` — `src/engine/element/game.ts:2375`
   - Returns the filtered JSON tree; called internally by `createPlayerView`

**`PlayerStateView` shape** (`src/engine/utils/snapshot.ts:97`):
```typescript
interface PlayerStateView {
  player: number;
  state: ElementJSON;          // hidden elements obscured
  flowState?: {
    awaitingInput: boolean;
    isMyTurn: boolean;
    availableActions?: string[];
  };
  messages: Array<{ text: string; data?: Record<string, unknown> }>;
  phase: string;
  complete: boolean;
  winners?: number[];
  actionMetadata?: Record<string, unknown>;  // populated by executor, not createPlayerView
  tutorial?: TutorialStepView;
  disabledActions?: Record<string, string>;
}
```

**Note on v3.1 image leak:** `src/engine/element/image-leak.test.ts` exists (dedicated test file). The CONTEXT.md flagged a `$images.face` leak — this test file confirms the issue was investigated. The API is functionally correct for perspective filtering.

---

#### Claim 2: Private checkpoint/rewind APIs (INTRO-F1)

| Field | Value |
|-------|-------|
| **Verdict** | CONFIRMED — substantively public, promote candidate |
| **Exists vs. build** | EXISTS — five methods on `GameSession`; one additional internal class |

**Evidence:**

`StateHistory` class — `src/session/state-history.ts:75`:
- `getStateAtAction(actionIndex, playerPosition)` → `{ success, state?, error? }` — line 110
- `getStateDiff(fromIndex, toIndex, playerPosition)` → `{ success, diff?, error? }` — line 152
- `getActionTraces(playerPosition)` → `{ success, traces?, flowContext?, error? }` — line 202
- `undoToTurnStart(playerPosition)` → `Promise<UndoResult>` — line 255
- `rewindToAction(targetActionIndex)` → `Promise<{ success, actionsDiscarded?, state?, newRunner?, error? }>` — line 337

All five are delegated as public methods on `GameSession` (`src/session/game-session.ts`):
- `session.getStateAtAction()` line 897
- `session.getStateDiff()` line 905
- `session.getActionTraces()` line 917
- `session.undoToTurnStart()` line 1712
- `session.rewindToAction()` line 1726

**Gap:** `StateHistory` class itself is NOT exported from `src/session/index.ts`. The five methods ARE reachable via `GameSession` (which is exported), but the `ElementDiff` and `UndoResult` types are not exported from the session barrel. This is an export/documentation gap, not an implementation gap.

**PROMOTE RECOMMENDATION:** INTRO-F1 meets the "trivial expose-not-build" criterion. The full checkpoint/rewind capability already exists. Phase 116 should flag this for user sign-off.

---

#### Claim 3: Existing action-resolved signal (DEV-03)

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL |
| **Exists vs. build** | PARTIAL — Vue reactive ref exists internally; DOM/cross-frame signal must be built |

**Evidence:**

`actionCompletedTick` ref in `useActionController` — `src/ui/composables/useActionController.ts:186`:
- `const actionCompletedTick = ref(0)` — monotonically incremented when an action fully completes
- Incremented at line 1505 (selection-step path) and line 1074 (direct execute path)
- Exposed in composable return value at line 1811: `actionCompletedTick: readonly(actionCompletedTick)`

**What's missing:** `actionCompletedTick` is a Vue reactive ref. It is only observable by Vue components that inject `useActionController` inside the same iframe. The DevHost outer page (a separate DOM context) cannot observe it. There is no `window.dispatchEvent(new CustomEvent(...))` call, no `postMessage` from the iframe to the outer page, and no `window.__BOARDSMITH_DEVTOOLS` global (`src/ui/global.d.ts` only defines `__BOARDSMITH_DEV__: boolean`).

**What must be built for DEV-03:** A DOM-observable signal — either a `CustomEvent` dispatched on `window` inside the iframe (catchable by the outer DevHost via the iframe's `contentWindow`), or a `postMessage` to the parent. The underlying completion event already fires (`actionCompletedTick++`); it just needs to be bridged to the DOM.

---

### FRICTION CLAIMS — ACTION-SPACE INTROSPECTION

#### INTRO-01: Single entry point for all legal actions with schemas

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL — pieces exist, not unified |
| **Exists vs. build** | PARTIAL — must build a unifying facade on top of existing primitives |

**What exists:**

1. Flow-level action names for a seat: `availableActionsForSeat(flowState, seat)` → `string[]` — `src/engine/flow/seat-activity.ts:69`
2. Action condition + selection metadata: `buildActionMetadata(game, player, availableActionNames)` → `Record<string, ActionMetadata>` — `src/session/utils.ts:35`
   - Exported from `src/session/index.ts:91`
   - Returns `ActionMetadata` (name, prompt, help, selections: `PickMetadata[]`)
3. `PickMetadata` shape includes: `name`, `type`, `prompt`, `optional`, `dependsOn`, `choices` (if static), `validElements` (element picks), `choicesByDependentValue`, `elementsByDependentValue`, `repeat`, `hasOnSelect`, `multiSelect` — `src/session/types.ts:293`
4. Individual action definition: `game.getAction(name)` → `ActionDefinition | undefined` — `src/engine/element/game.ts:875`

**What's missing for INTRO-01:**
- No single method `getActionSpace(seat: number)` that: (a) resolves the seat's available action names from flowState, (b) calls `buildActionMetadata`, (c) also produces ready-to-submit arg templates (flat placeholder values for each selection), in a single serializable structure
- `buildActionMetadata` requires both a `Player` object and a pre-filtered `string[]` — callers must assemble these two inputs manually
- "Ready-to-submit arg templates" (placeholder values) do not exist anywhere; that concept is new

**Note:** `ActionMetadata` is defined in `src/session/types.ts:356` but NOT exported from `src/session/index.ts`. Needs an export.

---

#### INTRO-02: Single action schema without executing

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL — method exists, gaps in choices completeness |
| **Exists vs. build** | PARTIAL — expose + document `buildSingleActionMetadata`; add on-demand choice evaluation |

**What exists:**
- `buildSingleActionMetadata(game, player, actionName, knownArgs?)` → `ActionMetadata | undefined` — `src/session/utils.ts:91`
- Exported from `src/session/index.ts:134`
- Returns `ActionMetadata` with static metadata; does NOT evaluate dynamic choices (those are "fetched on-demand via /selection-choices endpoint" — comment at line 130)

**What's missing:**
- A headless-friendly variant that resolves choices in-process without a server round-trip
- `game.getSelectionChoices(actionName, selectionName, player, args)` → `AnnotatedChoice[]` DOES exist at `src/engine/element/game.ts:934` — this is the in-process choice resolver. The gap is exposing it alongside a unified schema method.

---

#### INTRO-03: Build wire-correct action arguments from plain values

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — no public arg-builder utility |
| **Exists vs. build** | MUST BUILD |

**What exists (internal only):**
- `serializeValue(value, game, options)` / `deserializeValue(value, game)` — `src/engine/utils/serializer.ts` (exported from engine)
- Wire format: `{ __elementRef: string }` (branch path) or `{ __elementId: number }`, `{ __playerRef: number }` — `src/engine/utils/serializer.ts:9`
- MCTS bot private `serializeChoice(choice, selection)` at `src/ai/mcts-bot.ts:1099` — converts element objects to IDs, extracts plain values from choices
- MCTS bot private `serializeArgs(args, selections)` at `src/ai/mcts-bot.ts:1115`

**What's missing:** A public `buildActionArgs(actionName, selectionValues, game, playerSeat)` that takes plain JS values (element objects, player objects, strings) and returns wire-correct `Record<string, unknown>` ready for `runner.performAction()`. The serializer exists; the "take plain values from PickMetadata/ValidElement/ChoiceWithRefs and emit correct arg shape" wrapper must be built.

**Arg format reality check:** `runner.performAction(actionName, playerIndex, args)` accepts element objects directly (it serializes internally) — the "wire format" is only needed for cross-process transmission. For in-process use (TestGame, headless agent), plain element objects work in args. The MCTS bot's `serializeArgs` converts objects to IDs because it serializes before passing. INTRO-03 should clarify the use case.

---

#### INTRO-04: Enumerate all concrete legal moves for tree search

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL — logic fully implemented in MCTS bot; private and bot-coupled |
| **Exists vs. build** | PARTIAL — extract and expose the enumeration core |

**What exists (private to MCTSBot):**
- `MCTSBot.enumerateAllMoves(game, flowState)` → `BotMove[]` — `src/ai/mcts-bot.ts:826` (`private`)
- `MCTSBot.enumerateSelectionsInternal(game, actionDef, player, noSampling)` → `Record<string, unknown>[]` — `src/ai/mcts-bot.ts:924` (`private`)
- `BotMove = { action: string; args: Record<string, unknown> }` — complete concrete moves
- Handles: element picks, choice picks, multiSelect, optional, dependsOn, recursive selection combinations

**The extraction path:** The enumeration logic is self-contained (takes `Game`, `ActionDefinition`, `Player`; calls `game.getSelectionChoices` equivalent internally). It uses `MCTSBot.getChoicesForSelection(game, actionName, selection, player, currentArgs)` which delegates to the engine. A standalone `enumerateLegalMoves(game, seat)` → `Array<{action, args}>` function could be extracted to `src/engine/` or `src/session/` by lifting the logic out of the bot class.

**Note on sampling:** The bot samples to 20 choices/action for efficiency. A public enumeration API should default to full enumeration with an optional limit parameter.

---

### FRICTION CLAIMS — TEST ERGONOMICS

#### TEST-01: Typed observable state access

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL |
| **Exists vs. build** | PARTIAL — `getPlayerView` + raw `game` access; no domain-typed state accessor API |

**What exists:**
- `testGame.getPlayerView(seat)` → `PlayerStateView` — `src/testing/test-game.ts:243` — typed, hidden-info-correct
- `testGame.game` — direct access to the game instance (full access, no hidden-info filtering, requires knowing per-game property names)
- `toDebugString(game)` — human-readable string, not programmatic — `src/testing/debug.ts:51`

**What's missing for TEST-01:** A typed API for "read observable state without parsing JSON or knowing per-game accessors." The gap is the phrase "typed API" — `testGame.getPlayerView(seat).state` is `ElementJSON` (untyped JSON), not a typed game-specific view. The current path is `testGame.game.customProperty` which requires knowing the game's domain model.

**Assessment:** TEST-01 can be partially satisfied by improving `PlayerStateView` documentation/ergonomics, since `testGame.getPlayerView(seat)` already returns the typed perspective view. Full "typed observable" would require per-game type parameters, which is a larger design question.

---

#### TEST-02: playUntilComplete with stuck-loop protection

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — does not exist |
| **Exists vs. build** | MUST BUILD |

**What exists (closest approximation):**
- `simulateRandomGames(GameClass, options)` in `src/testing/random-simulation.ts` — runs full random simulations with stuck-game detection, but takes a `GameClass` not a `TestGame` and runs many games
- No `testGame.playUntilComplete()` or `playToCompletion(testGame, options)` exists anywhere in `src/testing/`

**What must be built:** `playUntilComplete(testGame, options?)` that: (a) randomly selects from available moves, (b) counts iterations, (c) throws a structured `GameStuckError` with diagnostic info (current state, available actions, iteration count) if a configured limit is exceeded.

---

#### TEST-03: Assertion failure includes availability trace

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL — trace API exists; not wired into assertions |
| **Exists vs. build** | PARTIAL — wire existing trace into assertion error messages |

**What exists:**
- `game.debugActionAvailability(actionName, player)` → `ActionDebugInfo` — `src/engine/element/game.ts:1072` — returns human-readable reason with condition details and per-selection info
- `game.debugAllActions(player)` → `ActionDebugInfo[]` — `src/engine/element/game.ts:1106`
- `assertActionAvailable(testGame, seat, name)` — `src/testing/assertions.ts:180` — throws `"Action X is not available. Available: [...]"` with NO trace of WHY

**What must be built:** Modify `assertActionAvailable` to call `game.debugActionAvailability(actionName, player)` when the assertion fails, and include that trace in the thrown error message.

---

#### TEST-04: Action-list assertions with permissive vs exact mode

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — only exact mode exists |
| **Exists vs. build** | MUST BUILD permissive mode; exact mode already exists |

**What exists:**
- `assertFlowState(testGame, { actions: [...] })` in `src/testing/assertions.ts:64` — the `actions` field performs an EXACT match (both "missing" and "extra" actions fail) — lines 95-107

**What's missing:** A permissive "contains these" mode. Currently the only way is exact match, which fails if the game has additional legal actions not listed. TEST-04 requires explicit mode selection: `assertFlowState(testGame, { actions: [...], actionsMode: 'contains' | 'exact' })` or equivalent.

---

#### TEST-05: Multi-step selection builder

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — no ergonomic builder exists |
| **Exists vs. build** | MUST BUILD |

**What exists (low-level path, not ergonomic):**
- `session.getPickChoices(actionName, selectionName, playerPosition, currentArgs)` — `src/session/game-session.ts:1816`
- `PickHandler` — `src/session/pick-handler.ts` — manages multi-step pending action state
- These are server-session concepts, not test utilities

**What must be built:** A test-layer `ActionBuilder` or `MultiStepAction` helper class that wraps the step-by-step selection process. The engine's `game.getSelectionChoices(actionName, selectionName, player, args)` at `src/engine/element/game.ts:934` provides in-process choice resolution without a server round-trip — this is the right primitive for the builder to use.

---

### FRICTION CLAIMS — DEV-HOST DEVTOOLS BRIDGE

#### DEV-01: Stable data-element-id selectors in custom UI and AutoUI

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL — AutoUI YES; custom UI uses different attributes |
| **Exists vs. build** | PARTIAL — AutoUI done; custom UI needs standardization |

**AutoUI (confirmed):**
- `data-element-id` attribute is set on rendered elements in:
  - `src/ui/components/auto-ui/renderers/PieceRenderer.vue:145`: `:data-element-id="element.id"`
  - `src/ui/components/auto-ui/renderers/SpaceRenderer.vue:177`: `:data-element-id="element.id"`
  - `src/ui/components/auto-ui/renderers/DieRenderer.vue:117`: `:data-element-id="element.id"`
  - `src/ui/components/auto-ui/renderers/CardRenderer.vue:351`: `:data-element-id="element.id"`
- Also used by FLIP/flying-elements animations: `src/ui/composables/useFLIP.ts:138`

**Custom UI (different scheme):**
- `anchorAttrs(ref: ElementRef)` — `src/ui/composables/useBoardInteraction.ts:408` — emits:
  - `data-bs-el-id` (numeric element ID)
  - `data-bs-el-notation` (notation string, if present)
  - `data-bs-el-name` (element name, if present)
- These are the tutorial overlay targeting attributes; the comment at line 403 explicitly says: "This is the SINGLE SOURCE for all anchor attribute names — no other file may define `data-bs-el-id`... as string literals."
- The tutorial overlay queries `[data-bs-el-id]` etc. — `src/ui/components/helpers/overlay-utils.ts:45`

**Gap:** AutoUI uses `data-element-id`; custom UI uses `data-bs-el-id`. Agents selecting by element ID need to query different attributes depending on which UI mode is active. DEV-01 requires a unified attribute name (or documented equivalence). Since `anchorAttrs` is declared the single source of truth for custom UI, the resolution is to either: (a) add `data-element-id` emission to `anchorAttrs`, or (b) have AutoUI renderers also emit `data-bs-el-id`. This must be resolved in the API design.

---

#### DEV-02: window.__BOARDSMITH_DEVTOOLS global

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — does not exist |
| **Exists vs. build** | MUST BUILD |

**What exists:**
- `__BOARDSMITH_DEV__: boolean` — `src/ui/global.d.ts:1` — Vite-injected build-time boolean, not runtime game state
- `__BOARDSMITH_API_URL__` — `src/ui/components/GameShell.vue:160` and `src/ui/components/GameLobby.vue:59` — URL override only
- `DebugPanel.vue` — `src/ui/components/DebugPanel.vue` — internal Vue component with rich debug state, but not exposed to `window`
- `DevHost.vue` — `src/cli/dev-host/DevHost.vue` — no `window.*` assignments that expose game state

**What must be built:** A `window.__BOARDSMITH_DEVTOOLS` object assigned in the DevHost context. Its contents (game state, available actions, board-interaction state) require routing data from the iframe's GameShell through postMessage to the outer DevHost page, which then writes to `window.__BOARDSMITH_DEVTOOLS`. This is a non-trivial bridge: iframe→outer-page data flow does not currently exist for this purpose.

---

#### DEV-03: Action-resolved signal

As covered in the named claims section above.

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL |
| **Exists vs. build** | PARTIAL — `actionCompletedTick` ref exists; DOM signal must be built |

**Specifically:**
- `actionCompletedTick: readonly(actionCompletedTick)` is in `useActionController` return — `src/ui/composables/useActionController.ts:1811`
- This is a Vue reactivity primitive, not a DOM event
- No `window.dispatchEvent`, no `postMessage` to parent, no `CustomEvent` dispatch exists
- Must add: when `actionCompletedTick` increments, emit a `CustomEvent` on `window` with success/failure info, catchable by the DevHost outer page via `iframe.contentWindow.addEventListener`

---

#### DEV-04: End-to-end agent UI loop documentation/proof

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — no end-to-end agent loop (change → drive → confirm) is documented or proven today |
| **Exists vs. build** | MUST BUILD — no source archaeology required; this is a documentation + browser-proof gap that depends on DEV-01/02/03 landing first |

**Specifically:** No doc or test demonstrates an agent driving the `boardsmith dev` host by element id and confirming via the action-resolved signal in both a custom-UI game and an AutoUI game. This is the Phase 119 acceptance gate; for Phase 116 the verdict is simply FALSE (gap to build).

---

### FRICTION CLAIMS — AUTHORING PIT-OF-SUCCESS GUARDS

#### PIT-01: loop() without maxIterations fails fast at construction

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — devWarn only, not a construction-time error |
| **Exists vs. build** | MUST CHANGE |

**What exists:**
- `loop()` builder in `src/engine/flow/builders.ts:79`
- Lines 85-96: `if (config.maxIterations === undefined) { devWarn(...) }` — one-time console.warn in dev mode only
- `devWarn` is dev-only, one-time-per-key, console.warn — `src/utils/dev.ts:56`
- Default `maxIterations` in `executeLoop`: `DEFAULT_MAX_ITERATIONS = 10000` — `src/engine/flow/engine.ts:30`
- When the cap is hit at runtime (not construction), it throws: `src/engine/flow/engine.ts:1045`

**Gap for PIT-01:** The current behavior is: (1) dev-only console.warn at `loop()` call time; (2) hard throw only when the 10,000 iteration cap is hit at runtime. PIT-01 requires a hard error at construction time — i.e., `loop()` without `maxIterations` should throw `Error` (not `devWarn`). This is a breaking change to the builder API since `maxIterations` is currently optional.

**Memory note confirmation:** The MEMORY.md note "Test games need `maxIterations` on `loop()` or you get a warning" is correct — it IS currently a warning, not an error.

---

#### PIT-02: Element class registration validated at game start

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — no such validation at game start |
| **Exists vs. build** | MUST BUILD |

**What exists:**
- `game.registerElements(classes)` — `src/engine/element/game.ts:700` — adds to `classRegistry`
- `game.createElement(elementClass, name)` — `src/engine/element/game.ts:714` — auto-registers if not already
- `game.startFlow()` — `src/engine/element/game.ts:1426` — creates `FlowEngine`, calls `start()`, no element validation
- `validateElement()` in `src/engine/utils/dev-state.ts:339` — validates snapshot deserialization (post-facto), not construction

**Gap:** No validation that all element classes used in `game.all(SomeClass)` queries or similar are registered in `classRegistry`. The registration is purely additive — using an unregistered class silently fails or produces empty results. PIT-02 requires checking the registry at `startFlow()` time or game construction.

**Challenge:** BoardSmith can't know which element classes will be queried at construction time without static analysis. A practical implementation would warn on unknown class names encountered during the first full tree traversal (at `startFlow()`), not at constructor time.

---

#### PIT-03: Action reachability from actionStep validated at game start

| Field | Value |
|-------|-------|
| **Verdict** | FALSE — no such validation |
| **Exists vs. build** | MUST BUILD |

**What exists:**
- `validateFlowPosition()` — `src/engine/utils/dev-state.ts:494` — validates whether current flow position is consistent with a given flow engine (used after deserialization), NOT a cross-validation of registered actions vs. flow definition
- Action registration: `game.registerAction()`, `game.registerActions()` — `src/engine/element/game.ts:837, 866`
- Flow definition: `game.setFlow()` — stores the flow node tree
- No code anywhere cross-validates "which action names appear in `actionStep({ actions: [...] })` nodes" vs. "which actions are registered via `registerActions()`"

**Gap:** PIT-03 requires enumerating all `actionStep` nodes in the flow tree and checking that each named action is registered. This is a new traversal at `startFlow()` time.

---

#### PIT-04: Lint rules for element identity / element-array footguns

| Field | Value |
|-------|-------|
| **Verdict** | PARTIAL — existing rules cover network/eval/timers/nondeterminism; element-specific rules absent |
| **Exists vs. build** | MUST BUILD two new rules |

**What exists:**
- `src/eslint-plugin/rules/no-network.ts`
- `src/eslint-plugin/rules/no-eval.ts`
- `src/eslint-plugin/rules/no-filesystem.ts`
- `src/eslint-plugin/rules/no-timers.ts`
- `src/eslint-plugin/rules/no-nondeterministic.ts`
- All registered in `src/eslint-plugin/index.ts`

**What must be built (two new rules):**
1. `no-element-identity-comparison` — catches `element1 === element2`, `elements.includes(element)`, `element1 !== element2` where operands are GameElement instances. Correct approach: compare by `.id`.
2. `no-element-array-state` — catches using element arrays (or element-typed properties) as plain mutable state that isn't going through the element tree system. This is harder to detect statically; may scope to specific patterns (e.g., class fields typed as `GameElement[]` that aren't inside a `GameElement` subclass constructor).

---

## Standard Stack

This phase produces no new dependencies. All research was done via codebase inspection only.

**No packages to install.** Phase 116 is read-only (read code + write design doc).

---

## Architecture Patterns

### Recommended Document Structure for `.planning/v4.3-API-DESIGN.md`

The planner must produce a task that writes this document:

```
.planning/v4.3-API-DESIGN.md
├── ## Part 1: Verdicts Table
│   └── (claim | verdict | file:line | exists-vs-build) — populated from research
│
├── ## Part 2: API Specification
│   ├── ### INTRO — Action-Space Introspection
│   │   ├── INTRO-01: getActionSpace(seat) design
│   │   ├── INTRO-02: getActionSchema(name) design
│   │   ├── INTRO-03: buildActionArgs() design
│   │   ├── INTRO-04: enumerateLegalMoves() design
│   │   └── INTRO-05: getPlayerView() — document existing API
│   ├── ### TEST — TestGame Ergonomics
│   │   ├── TEST-01: Observable state approach
│   │   ├── TEST-02: playUntilComplete() design
│   │   ├── TEST-03: assertActionAvailable() trace wiring
│   │   ├── TEST-04: assertFlowState actionsMode option
│   │   └── TEST-05: ActionBuilder / MultiStepAction design
│   ├── ### DEV — Dev-Host Devtools Bridge
│   │   ├── DEV-01: Attribute unification design
│   │   ├── DEV-02: __BOARDSMITH_DEVTOOLS shape + bridge design
│   │   ├── DEV-03: Action-resolved signal design
│   │   └── DEV-04: End-to-end agent loop documentation
│   └── ### PIT — Authoring Guards
│       ├── PIT-01: loop() hard error design
│       ├── PIT-02: element-class validation design
│       ├── PIT-03: action-reachability validation design
│       └── PIT-04: two new lint rules design
│
└── ## Part 3: Speculative Scope Disposition (INTRO-F1 promoted, others deferred)
```

### Key API Signatures (draft, for the design doc author)

**INTRO-01 candidate:**
```typescript
// engine/element/game.ts — new method on Game
getActionSpace(seat: number): ActionSpaceView

interface ActionSpaceView {
  actions: ActionSchemaView[];  // only actions the seat can legally take
}

interface ActionSchemaView {
  name: string;
  prompt?: string;
  help?: string;
  selections: PickMetadata[];   // existing type from session/types.ts
  argTemplate: Record<string, unknown>;  // placeholder/null values for each selection
}
```

**INTRO-02 candidate (document existing):**
```typescript
// Already exists: src/session/utils.ts:91
// Just needs: export ActionMetadata from session/index.ts
buildSingleActionMetadata(game, player, actionName, knownArgs?): ActionMetadata | undefined
```

**INTRO-04 candidate:**
```typescript
// new function in src/engine/ or src/runtime/
function enumerateLegalMoves(
  game: Game,
  seat: number,
  options?: { maxPerAction?: number }
): Array<{ action: string; args: Record<string, unknown> }>
```

**TEST-02 candidate:**
```typescript
// src/testing/test-game.ts or src/testing/simulate-action.ts
function playUntilComplete(
  testGame: TestGame,
  options?: {
    maxMoves?: number;        // default 1000
    strategy?: 'random' | 'first';
    rng?: () => number;
  }
): void   // throws GameStuckError on timeout

class GameStuckError extends Error {
  readonly iteration: number;
  readonly availableActions: string[];
  readonly flowState: FlowState | undefined;
}
```

**TEST-04 candidate:**
```typescript
// assertFlowState options extension
interface ExpectedFlowState {
  // existing fields...
  actions?: string[];
  actionsMode?: 'exact' | 'contains';  // default: 'exact' (backward compatible)
}
```

**DEV-02 candidate:**
```typescript
// window.__BOARDSMITH_DEVTOOLS shape
interface BoardsmithDevtools {
  getState(seat?: number): PlayerStateView | null;
  getAvailableActions(seat?: number): string[];
  getActionMetadata(seat?: number): Record<string, ActionMetadata> | undefined;
  getBoardInteractionState(): {
    activeAction: string | null;
    currentSelectionStep: number;
    validElements: number[];
  } | null;
}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Action availability logic | New condition evaluator | `buildActionMetadata()` + `availableActionsForSeat()` | Already battle-tested; parallel validators cause drift |
| Move enumeration | Custom tree-search enumerator | Extract from `MCTSBot.enumerateSelectionsInternal` | Logic handles dependsOn, multiSelect, optional; do not duplicate |
| Perspective-aware state | New JSON filter | `createPlayerView()` / `runner.getPlayerView()` | Already handles simultaneous actions, tutorial projection, hidden info |
| Checkpoint/undo | New snapshot system | `StateHistory` / `GameSession.rewindToAction()` | Authoritative checkpoint-based approach already implemented |
| Element ID attributes | New attribute naming | Use `data-bs-el-id` (custom UI standard) | `anchorAttrs()` is declared single source of truth; align AutoUI to it |

---

## Speculative Scope Disposition

### PROMOTE: INTRO-F1 (Checkpoint/rewind API)

**Rationale:** The capability fully exists and is already public on `GameSession`. The five methods (`getStateAtAction`, `getStateDiff`, `getActionTraces`, `undoToTurnStart`, `rewindToAction`) are already public. The gap is documentation and exporting `UndoResult`, `ElementDiff` types from `src/session/index.ts`. This is strictly an expose-not-build: ~5 lines of type exports and documentation. Meets the "trivial expose-not-build" criterion.

**What promotion means:** The Phase 116 design doc lists this as promoted, and the Phase 117 plan includes documenting and re-exporting these types.

### DEFER: All other Future Requirements

| Item | Reason for Deferral |
|------|---------------------|
| INTRO-F2 (AgentRunner base class) | Non-trivial design; not blocked on any current gap |
| TEST-F1 (hidden-info leak assertion) | Worthwhile but additive; no current test relies on it |
| DEV-F1 (programmatic seat-switch) | Pre-existing carry-forward; not needed for basic agent loop |
| DEV-F2 (deterministic-AI seed / forceAIMove) | Useful but out of scope for v4.3 core |
| PIT-F1 (boardRef/dependsOn inference) | Larger language-design question; defer |

---

## Common Pitfalls

### Pitfall 1: Duplicating buildActionMetadata Instead of Extending It
**What goes wrong:** Phase 117 builds a new `getActionSpace()` that re-implements condition checking, selection evaluation, and dependsOn resolution instead of calling `buildActionMetadata`.
**Why it happens:** `buildActionMetadata` requires a `Player` object + pre-filtered action names; easy to think it's too internal.
**How to avoid:** `getActionSpace(seat)` must call `buildActionMetadata` internally after resolving `player` and `availableActionsForSeat`. The design doc must make this explicit.
**Warning signs:** Any PR that calls `evaluateCondition()` directly from introspection code.

### Pitfall 2: Misidentifying the Attribute Unification Direction
**What goes wrong:** DEV-01 aligns `data-bs-el-id` to `data-element-id` (the AutoUI name) instead of the reverse.
**Why it happens:** `data-element-id` appears in more files (4 AutoUI renderers + FLIP composables).
**How to avoid:** `anchorAttrs()` is declared the single source of truth for attribute names. AutoUI must gain `data-bs-el-id` alongside (or instead of) `data-element-id`, not the other way around. The tutorial overlay already queries `[data-bs-el-id]`.
**Warning signs:** Any plan that modifies `anchorAttrs()` to emit `data-element-id`.

### Pitfall 3: Making ActionMetadata Export Break the Session Index
**What goes wrong:** Exporting `ActionMetadata` and `ChoiceWithRefs` from session/index.ts creates a re-export cycle or changes the public API surface in ways that break MERC's vendored copy.
**Why it happens:** These types exist in `session/types.ts` alongside `PickMetadata` which IS exported.
**How to avoid:** Simply add `ActionMetadata` to the `export type { ... }` block in session/index.ts alongside `PickMetadata`.
**Warning signs:** tsc errors or MERC test failures during Phase 121 migration.

### Pitfall 4: Designing loop() Error as Opt-In (devWarn stays, error is new)
**What goes wrong:** PIT-01 implementation adds BOTH the devWarn AND a new hard error, leaving the devWarn deduplication logic as dead code.
**Why it happens:** Fear of breaking existing code that omits maxIterations.
**How to avoid:** PIT-01 is explicitly a breaking change. Remove the devWarn path; replace it with an unconditional `throw new Error(...)`. No backward compatibility (project hard rule).

---

## Open Questions (RESOLVED)

These four design decisions are now resolved; the design doc (DSGN-02) commits each as a locked choice.

1. **INTRO-01 arg template format**
   - What we know: Selections have types (element, choice, number, text); valid values come from `getSelectionChoices`
   - What's unclear: What should the "arg template" placeholder look like for required vs. optional selections? `null`? Empty string? A sentinel like `{ __required: true }`?
   - **RESOLVED:** Optional selections default to `null`; required selections use a sentinel `{ __required: true }` placeholder so a template is self-describing about what must be filled. Committed in the design doc per DSGN-02.

2. **DEV-01 attribute name decision**
   - What we know: AutoUI uses `data-element-id`; custom UI uses `data-bs-el-id`; tutorial overlay queries `data-bs-el-id`
   - What's unclear: Should we standardize on `data-bs-el-id` everywhere (fewer changes to overlay), or add `data-element-id` as an alias to `anchorAttrs`?
   - **RESOLVED:** Standardize on `data-bs-el-id` in AutoUI — align AutoUI to the declared single source of truth (`anchorAttrs`), not the reverse. Migration documented in DSGN-02 (DEV-01 surface).

3. **INTRO-03 in-process vs. wire use case**
   - What we know: `runner.performAction(name, seat, args)` accepts element objects directly (in-process); the `{ __elementRef }` wire format is for cross-process serialization
   - What's unclear: Does INTRO-03 need to produce wire-format args, or just "correct args for `runner.performAction`"?
   - **RESOLVED:** In-process element-object args suffice for headless/TestGame use; the `{ __elementRef }` wire format is produced only for cross-process (WebSocket) agents. The arg-builder exposes both, defaulting to in-process. Committed in DSGN-02.

4. **PIT-02 implementation scope**
   - What we know: No registration validation at game start exists
   - What's unclear: Is it feasible to detect "used but unregistered" classes at `startFlow()` time without static analysis?
   - **RESOLVED:** Scope PIT-02 to validating classes encountered during the first-pass `startFlow()` traversal. Post-construction/dynamic queries cannot be pre-validated and are explicitly out of scope (documented as a known limitation in the PIT-02 design entry).

---

## Environment Availability

Step 2.6 SKIPPED — Phase 116 is read-only code inspection + design doc writing. No external dependencies beyond the existing Node.js/TypeScript toolchain.

---

## Validation Architecture

This phase produces one artifact: `.planning/v4.3-API-DESIGN.md`. Validation is human review (the approval gate), not automated tests. No automated tests belong in Phase 116 since no production code changes are made.

**Phase gate:** Human reviews and approves the design doc before Phase 117 begins.

---

## Security Domain

No production code changes in this phase. No ASVS categories apply to a read-only research + documentation phase.

One security-relevant verification finding: `INTRO-05` (`createPlayerView`) correctly filters hidden information via `game.toJSONForPlayer(playerPosition)`. A dedicated test exists: `src/engine/element/image-leak.test.ts`. The CONTEXT.md noted a v3.1 `$images.face` leak concern — the test file confirms this was investigated. The API design doc should call out that any new perspective-aware surface (e.g., INTRO-F1's what-if states) must use `createPlayerView` and not raw `game.toJSON()`.

---

## Sources

### Primary (HIGH confidence — all verified against actual src/ files)

All claims verified by direct file reads with line number evidence during this research session. No external documentation was consulted; all findings are from `src/` inspection.

Key files examined:
- `src/engine/element/game.ts` — `getAction`, `getAvailableActions`, `getActionTraces`, `debugActionAvailability`, `startFlow`, `getSelectionChoices`
- `src/engine/utils/snapshot.ts` — `createPlayerView`, `PlayerStateView`, `createActionCheckpoint`
- `src/engine/flow/builders.ts` — `loop()` devWarn, maxIterations default
- `src/engine/flow/engine.ts` — `executeLoop`, DEFAULT_MAX_ITERATIONS
- `src/engine/flow/seat-activity.ts` — `availableActionsForSeat`, `canSeatAct`
- `src/engine/action/types.ts` — `ActionTrace`, `ActionDebugInfo`, `PickTrace`
- `src/session/state-history.ts` — `StateHistory` class, all five time-travel/undo methods
- `src/session/game-session.ts` — public delegation of StateHistory methods
- `src/session/utils.ts` — `buildActionMetadata`, `buildSingleActionMetadata`, `buildActionTraces`
- `src/session/types.ts` — `ActionMetadata`, `PickMetadata`, `ChoiceWithRefs`, `ValidElement`
- `src/session/index.ts` — what is/isn't exported
- `src/runtime/runner.ts` — `getPlayerView`, `getAllPlayerViews`, `fromCheckpoint`
- `src/testing/test-game.ts` — `TestGame` API (full)
- `src/testing/assertions.ts` — `assertFlowState`, `assertActionAvailable` (full)
- `src/testing/debug.ts` — `toDebugString`, `traceAction`
- `src/ai/mcts-bot.ts` — `enumerateAllMoves`, `enumerateSelectionsInternal`, `serializeArgs`
- `src/engine/utils/serializer.ts` — `SerializedReference`, `serializeValue`, `deserializeValue`
- `src/ui/composables/useActionController.ts` — `actionCompletedTick`
- `src/ui/composables/useBoardInteraction.ts` — `anchorAttrs`, attribute names
- `src/ui/components/auto-ui/renderers/*.vue` — `data-element-id` on AutoUI elements
- `src/eslint-plugin/index.ts` and `rules/` — existing rule inventory
- `src/cli/dev-host/DevHost.vue` — no `window.__BOARDSMITH_DEVTOOLS`
- `src/utils/dev.ts` — `devWarn` behavior (dev-only, one-time console.warn)

---

## Metadata

**Confidence breakdown:**
- Verification findings: HIGH — all verified by direct file reads with line numbers
- API design suggestions: MEDIUM — drafts for the design doc author; require authorial decisions
- Speculative scope: HIGH — INTRO-F1 promote recommendation is well-supported; deferrals are straightforward

**Research date:** 2026-06-30
**Valid until:** 2026-07-30 (stable library code; no fast-moving dependencies)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `traceAction()` in debug.ts uses `game.actions` (plain object) not `game._actions` (Map) — may not actually work with the current engine | TEST-03 | traceAction may be broken/orphaned; assertion trace wiring would need to use `game.debugActionAvailability()` instead |
| A2 | INTRO-F1 promotion is trivial (5 type-export lines) | Speculative Scope | If `UndoResult`/`ElementDiff` have internal dependencies, the export may pull in more |

**Note on A1:** `debug.ts:traceAction` accesses `(game as any).actions` (plain object) while the engine uses `game._actions` (private Map). This function may be stale/broken. The design doc should note this and recommend wiring TEST-03 through `game.debugActionAvailability()` directly, not through `traceAction`.
