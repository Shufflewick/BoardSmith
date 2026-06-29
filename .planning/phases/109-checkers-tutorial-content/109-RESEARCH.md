# Phase 109: Checkers Tutorial Content — Research

**Researched:** 2026-06-28
**Domain:** Tutorial substrate gap-fills (per-selection gate + launch surface) + checkers tutorial content authoring; cross-repo
**Confidence:** HIGH

---

## Summary

Phase 109 spans two repos and four technical areas. The research confirms all four are buildable
against the existing substrate with no new external packages.

**Area 1 (LR-02 gate):** `TutorialGateAllowList.from`/`to` are typed `unknown`, were always
RESERVED for this phase. Replace them with `selections?: Record<string, SelectionMatcher>`. Three
call sites in `action.ts` already have `selection.name` in scope — adding a 4th argument is the
complete mechanical change. Gate matching for element selections must use element `.id` (not
notation — `CheckerPiece` has no notation property; its parent Square does). For choice selections
(`destination`), field-equality matching on the choice object works.

**Area 2 (launch surface):** `GameSession.startTutorial(seat)` mutates only `game.tutorialProgress`
(a serialized engine field). This is a pure snapshot mutation — implement as a new stateless Op
type (`startTutorial`) in `stateless-ops.ts`, which means the dev bridge (`bridge.ts`) picks it
up automatically via the standard `handleOp` path. No stateful side-channel needed. The `hasTutorial`
signal to gate the ControlsMenu item belongs in `buildPlayerState` (reads `runner.game.tutorialDefinition`).

**Area 3 (checkers content):** The checkers `move` action is two-step (`chooseElement('piece', …)`
then `chooseFrom('destination', …)`). Mandatory capture must use a custom `advanceWhen` predicate
calling `game.playerHasCaptures(player)` — NOT `whenForced('move')` (which would never fire since
`move` is always available even when captures are mandatory). Multi-jump continuation is detected
via `game.continuingPiece !== null`. The tutorial preset needs a custom game option
(`tutorialSetup: boolean`) to place a minimal board position that forces capture + multi-jump at
known squares — the standard 24-piece opening has no immediate captures.

**Area 4 (cross-repo build):** The boardsmith `node_modules` symlink + all-`src/` exports map
means NO rebuild is required. New exports to `src/engine/index.ts` and `src/testing/index.ts`
are immediately importable from checkers vitest.

**Primary recommendation:** Implement `start-tutorial` as a new stateless Op; extend
`TutorialGateAllowList.selections` map with field-equality matching; author checkers content
with a custom `tutorialSetup` option and custom `advanceWhen` predicates.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Area 1 — Per-selection-name gate API (LR-02 substrate, BoardSmith)
- Extend `TutorialGateAllowList` with a **`selections` map keyed by selection name** (e.g.
  `{ piece: <matcher>, destination: <matcher> }`). Plumb `selection.name` as a 4th argument into
  `getGateReasonForValue` (3 call sites in `src/engine/action/action.ts:388,440,460`) and match each
  selection's value ONLY against its own matcher — not a merged set.
- Matchers use **ElementRef-style `{ notation }` / value matching**, reusing the existing `matchesRef`
  precedence for board element selections; a `DestinationChoice` matches on `toNotation` (and/or `pieceId`).
- **Additive / back-compatible:** the existing flat `action`-only allow-list keeps working unchanged.
  The reserved flat `from`/`to` fields are superseded by `selections` (remove or repurpose them —
  no deprecation cycle per project hard-rule).
- Lands in BoardSmith substrate with unit tests.

#### Area 2 — Tutorial launch surface (CHK-04 substrate, BoardSmith)
- Add a **`start-tutorial` platform op** routed through the existing `platformRequest` pattern →
  `GameSession.startTutorial(seat)`.
- Surface a **"Start tutorial" item in ControlsMenu**, shown only when the game has a `tutorial`
  definition (mirror the Teaching-group gating). Works in production GameShell AND `boardsmith dev`.
- **Restartable:** (re)start from step 0; if tutorial is already running, restart cleanly (no error).
- Lands in BoardSmith substrate (GameShell + dev host + session op) with tests.

#### Area 3 — Checkers tutorial content (CHK-01/02/03, checkers repo)
- Dedicated deterministic **tutorial preset/position** that forces a capture and a multi-jump at
  known squares.
- **CHK-02 mandatory-capture tip:** custom `advanceWhen` predicate reading `game.playerHasCaptures(player)`
  — NOT `whenForced` (mandatory capture restricts destinations within `move`, so `move` is always
  available and `whenForced('move')` would always fire prematurely).
- **CHK-01 two-step teaching:** per-selection gate on `piece` selection (annotation highlights piece);
  per-selection gate on `destination` selection (annotation highlights target square).
- **CHK-03 multi-jump:** step gating continuation `move` with annotation "the turn continues while
  more jumps exist"; advance when `game.continuingPiece` clears.

#### Area 4 — CI-verifiable test, cross-repo build & scope
- CI test in `~/BoardSmithGames/checkers/tests/tutorial.test.ts` using `simulateTutorial` +
  `assertTutorialCompletes`. Prove green→red by deliberately breaking mandatory-capture rule.
- `.planning/` tracking stays in BoardSmith; two commit streams.
- After substrate lands, **rebuild BoardSmith and refresh checkers' dependency** before authoring
  + running the checkers CI test.
- Browser confirmation is the Phase 110 gate (DEMO-01), NOT this phase.

### Claude's Discretion
- Exact matcher field names on the `selections` map; the precise platform-op name/payload;
  the ControlsMenu label/placement for "Start tutorial"; the preset's exact board layout;
  the number of tutorial steps; and how the checkers dep is refreshed.

### Deferred Ideas (OUT OF SCOPE)
- End-to-end browser run of the checkers tutorial in GameShell + dev host → Phase 110 (DEMO-01).
- Tutorials for other games (cribbage etc.) → future milestone (v2 CRIB).
- Help text authoring (Phase 108 HELP) for checkers actions — only if it naturally supports
  the tutorial, otherwise out of scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHK-01 | Guided checkers tutorial teaching two-step piece selection → destination move via action gating + annotation overlays | Per-selection gate (Area 1) + TutorialStep.content annotations; suppressAutoFill for piece selection prevents premature auto-fill |
| CHK-02 | Tutorial teaches mandatory-capture rule via predicate-triggered tip shown first time capture becomes forced | Custom `advanceWhen` reading `game.playerHasCaptures(player)`; NOT `whenForced` |
| CHK-03 | Tutorial walks through forced multi-jump, teaching continuation | Gate continuation `move` step; `advanceWhen` fires when `game.continuingPiece === null` |
| CHK-04 | Tutorial launchable from game and `boardsmith dev` host | `start-tutorial` stateless Op + bridge routing + `hasTutorial` signal + ControlsMenu item |
</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-selection gate evaluation | Engine (`src/engine/tutorial/gate.ts`) | — | Gate runs inside `getChoices()` hot path; engine-only dependency chain |
| `TutorialGateAllowList` type extension | Engine (`src/engine/tutorial/types.ts`) | — | Engine type; no session or UI layer dependency |
| `start-tutorial` op execution | Engine (stateless via `stateless-ops.ts`) | — | `game.tutorialProgress.set(...)` is a pure snapshot mutation |
| `start-tutorial` wire routing | Session bridge (`src/cli/dev-host/bridge.ts`) | Session (`stateless-ops.ts` Op union) | Bridge translates wire op → typed Op; executor handles it |
| `hasTutorial` broadcast signal | Session (`src/session/utils.ts` buildPlayerState) | — | Reads `runner.game.tutorialDefinition`; available in both GameSession + stateless path |
| "Start tutorial" menu item | UI (`src/ui/components/ControlsMenu.vue`) | — | New `hasTutorial` prop, new `teaching-action` emit value |
| `handleTeachingAction` extension | UI (`src/ui/components/GameShell.vue`) | — | Routes `start-tutorial` through `platformRequest` |
| Tutorial content definition | Checkers repo (`src/rules/index.ts`) | Checkers (`src/rules/actions.ts` for selection names) | Content lives in the game package, not the library |
| Tutorial preset board position | Checkers repo (`src/rules/game.ts`) | — | `tutorialSetup` option modifies `placePieces()` |
| CI tutorial test | Checkers repo (`tests/tutorial.test.ts`) | — | Cross-repo test using `boardsmith/testing` DSL |

---

## Standard Stack

### Core (no new external packages — all changes are internal BoardSmith + checkers source)

| File | Purpose | Change |
|------|---------|--------|
| `src/engine/tutorial/types.ts` | `TutorialGateAllowList` + new `SelectionMatcher` type | Replace `from`/`to` with `selections?: Record<string, SelectionMatcher>` |
| `src/engine/tutorial/gate.ts` | `getGateReasonForValue` | Add 4th param `selectionName: string`; add per-selection matching branch |
| `src/engine/action/action.ts` | 3 call sites (lines 388, 440, 460) | Pass `selection.name` as 4th arg |
| `src/session/stateless-ops.ts` | `Op` union + `executeOp` switch | Add `{ type: 'startTutorial'; player: number }` Op variant |
| `src/session/types.ts` | `PlayerGameState` | Add `hasTutorial?: boolean` field |
| `src/session/utils.ts` | `buildPlayerState` | Emit `state.hasTutorial = true` when `runner.game.tutorialDefinition` is set |
| `src/cli/dev-host/bridge.ts` | `WireOp`, `translateOp`, `shapeResult` | Add `'start-tutorial'` wire op → `startTutorial` Op |
| `src/ui/components/ControlsMenu.vue` | Props + emit + template | Add `hasTutorial?: boolean` prop; `'start-tutorial'` emit; "Start tutorial" menu item |
| `src/ui/components/GameShell.vue` | `handleTeachingAction` + ControlsMenu usage | Handle `'start-tutorial'`; compute `hasTutorialProp` from state; pass to ControlsMenu |
| `~/BoardSmithGames/checkers/src/rules/index.ts` | `gameDefinition` | Add `tutorial: CHECKERS_TUTORIAL` field |
| `~/BoardSmithGames/checkers/src/rules/game.ts` | `CheckersOptions` + `CheckersGame` | Add `tutorialSetup?: boolean` option; conditional `placePieces()` path |
| `~/BoardSmithGames/checkers/tests/tutorial.test.ts` | NEW — CI tutorial test | `simulateTutorial` + `assertTutorialCompletes` + deliberate break |

**No external packages are installed in this phase.** The Package Legitimacy Audit section is not applicable.

---

## Architecture Patterns

### System Architecture Diagram

```
Area 1: Gate extension
─────────────────────
  TutorialStep.gate (allow-list)
       │ { action: 'move', selections: { piece: { id:N }, destination: { toNotation:'d4' } } }
       ▼
  getGateReasonForValue(step, actionName, value, selectionName)   [gate.ts]
       │ selectionName='piece' → match value.id === N (element ref)
       │ selectionName='destination' → match value.toNotation === 'd4' (field equality)
       ▼
  Action.getChoices() [action.ts:388,440,460] → AnnotatedChoice with disabled reason

Area 2: Launch surface
──────────────────────
  GameShell (platform mode, iframe)
    platformRequest('start-tutorial', { seat })
       │ postMessage → parent
       ▼
  DevHost.vue
    forward WS 'server_request'
       │
       ▼
  MultiplayerHost.handleServerRequest
    → bridge.createDevSession.handleServerRequest
       │
       ▼
  bridge.translateOp('start-tutorial', seat, {})
    → { type: 'startTutorial', player: seat }
       │
       ▼
  SnapshotSessionHost.handleOp
    → stateless-ops.executeOp switch case 'startTutorial'
       │ game.tutorialProgress.set(seat, initialProgress(def))
       │ return new snapshot
       ▼
  broadcast → PlayerGameState includes tutorial step view

Area 3: hasTutorial signal
──────────────────────────
  buildPlayerState (utils.ts)
    if (runner.game.tutorialDefinition) state.hasTutorial = true
       │
       ▼
  GameShell: hasTutorialProp = computed(() => state.value?.state?.hasTutorial ?? false)
       │
       ▼
  ControlsMenu :has-tutorial="hasTutorialProp"
    shows "Start tutorial" item when true

Area 4: Checkers content
────────────────────────
  CheckersGame(options.tutorialSetup=true)
    → placePieces() → minimal position (capture + multi-jump at known squares)
       │
       ▼
  CHECKERS_TUTORIAL (TutorialDefinition)
    steps: [ intro, capture-tip, execute-capture, multi-jump-continue, confirm-turn ]
       │ gates using per-selection gate (Area 1)
       │ advanceWhen: custom predicates on game state
       ▼
  gameDefinition.tutorial = CHECKERS_TUTORIAL   [src/rules/index.ts]
```

### Recommended Project Structure (new files only)

```
src/engine/tutorial/
├── types.ts               # SelectionMatcher type + updated TutorialGateAllowList
└── gate.ts                # getGateReasonForValue extended with selectionName param

~/BoardSmithGames/checkers/
├── src/rules/
│   ├── index.ts           # add tutorial: CHECKERS_TUTORIAL to gameDefinition
│   ├── game.ts            # add tutorialSetup option + conditional placePieces()
│   └── tutorial.ts        # NEW: CHECKERS_TUTORIAL TutorialDefinition constant
└── tests/
    └── tutorial.test.ts   # NEW: CI-verifiable tutorial test
```

---

## Area 1: LR-02 Per-Selection Gate — Exact Seam Analysis

### Current `TutorialGateAllowList` (types.ts:118)

```typescript
export interface TutorialGateAllowList {
  action: string;
  from?: unknown;   // RESERVED Phase 109 — REMOVE (no deprecation cycle)
  to?: unknown;     // RESERVED Phase 109 — REMOVE (no deprecation cycle)
}
```

**Phase 109 replacement** [VERIFIED: direct source reading]:

```typescript
/**
 * Matches a single selection value against authored criteria.
 *
 * For element selections (type:'element'|'elements'): use ElementRef-style
 * fields — id takes precedence, then notation, then name. Match is field
 * equality: { id: 5 } matches any element where el.id === 5.
 *
 * For choice selections (type:'choice'): field equality on the choice object —
 * { toNotation: 'd4' } matches any choice where choice.toNotation === 'd4'.
 *
 * Supply only the fields you care about; unspecified fields are ignored.
 */
export type SelectionMatcher = Record<string, unknown>;

export interface TutorialGateAllowList {
  /** The single action name the learner must perform on this step. */
  action: string;
  /**
   * Optional per-selection value restrictions.
   *
   * Keys are selection names (matching `selection.name` in the action
   * definition). Values are SelectionMatcher objects: each field in the
   * matcher must equal the corresponding field on the value for a match.
   *
   * When absent (or a selection name has no entry), all values for that
   * selection are permitted.
   *
   * @example
   * // Gate the 'piece' selection to element id 42, destination to square e5:
   * { action: 'move', selections: { piece: { id: 42 }, destination: { toNotation: 'e5' } } }
   */
  selections?: Record<string, SelectionMatcher>;
}
```

### Current `getGateReasonForValue` signature (gate.ts:117)

```typescript
// CURRENT:
export function getGateReasonForValue(
  step: TutorialStep,
  actionName: string,
  value: unknown,
): string | null
```

**Phase 109 extended signature** [VERIFIED]:

```typescript
// PHASE 109:
export function getGateReasonForValue(
  step: TutorialStep,
  actionName: string,
  value: unknown,
  selectionName: string,   // NEW 4th param
): string | null {
  const { gate } = step;
  if (!isAllowListGate(gate)) return null;
  if (gate.action !== actionName) return null;

  // Check per-selection restriction first (new in Phase 109).
  if (gate.selections && selectionName in gate.selections) {
    const matcher = gate.selections[selectionName];
    const isAllowed = selectionMatchesValue(matcher, value);
    if (isAllowed) return null;
    return `Tutorial step requires a specific ${selectionName}: ${JSON.stringify(matcher)}`;
  }

  // Legacy: no selections restriction → all values in the allowed action permitted.
  return null;
  // NOTE: The old `from`/`to` flat set logic is REMOVED (no deprecation cycle).
}
```

### `selectionMatchesValue` helper

```typescript
// Element ref precedence matching + fallback field equality for choice objects:
function selectionMatchesValue(matcher: SelectionMatcher, value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const val = value as Record<string, unknown>;

  // ElementRef precedence: if matcher specifies id, that alone determines match.
  if ('id' in matcher) return val['id'] === matcher['id'];
  if ('notation' in matcher) return val['notation'] === matcher['notation'];
  if ('name' in matcher) return val['name'] === matcher['name'];

  // General field equality for choice objects (DestinationChoice, etc.).
  return Object.entries(matcher).every(([k, v]) => val[k] === v);
}
```

### 3 Call Sites in action.ts

All three call sites are within `getChoices(selection: Selection, player, args, actionName?)`:

| Line | Selection type | Variable | Change needed |
|------|---------------|----------|---------------|
| 388 | `'choice'` | `selection` is `ChoiceSelection` (has `.name`) | `getGateReasonForValue(tutorialStep, actionName!, choice, selection.name)` |
| 440 | `'element'` | `selection` is `ElementSelection` (has `.name`) | `getGateReasonForValue(tutorialStep, actionName!, el, selection.name)` |
| 460 | `'elements'` | `selection` is `ElementsSelection` (has `.name`) | `getGateReasonForValue(tutorialStep, actionName!, el, selection.name)` |

`BaseSelection` (which all selection types extend) always has `name: string`. [VERIFIED: `src/engine/action/types.ts:39`]

### `TutorialGateCondition` interaction

Per-selection gating ONLY applies to `TutorialGateAllowList`. The `TutorialGateCondition` (predicate record form) has no value-level discrimination — it returns `null` from `getGateReasonForValue` unchanged. [VERIFIED: gate.ts:126-128]

### PITFALL: CheckerPiece has no `.notation` property

`CheckerPiece` extends `GameElement`. Only `Square` has `get notation()` that returns `'a1'`–`'h8'` style strings. [VERIFIED: `src/rules/elements.ts`]

**Consequence:** Gate matcher `{ notation: 'c3' }` for the `'piece'` selection WILL NOT MATCH a `CheckerPiece` element (its `notation` field is undefined). The `selectionMatchesValue` helper with `'notation' in matcher` → checks `value.notation === 'c3'` → fails because the piece has no `.notation`.

**Solution:** Gate piece elements by **element id** (`{ id: pieceElementId }`). The tutorial preset board position is fixed and deterministic (same options + same seed = same element IDs). The CI test looks up the piece programmatically and uses its `.id`.

Alternatively, match by `{ name: 'piece-name' }` if pieces have distinct names in the preset. The cleanest approach is `{ id }` since element IDs are stable within a game instance.

---

## Area 2: Tutorial Launch Surface — Exact Seam Analysis

### Why `start-tutorial` can be a stateless Op

`GameSession.startTutorial(seat)` [VERIFIED: `src/session/game-session.ts:1842`] delegates to:
```typescript
startTutorial(seat: number): void {
  this.#tutorialController.start(seat);
}
```

`TutorialController.start(seat)` [VERIFIED: `src/session/tutorial-controller.ts:115`]:
```typescript
start(seat: number): void {
  const def = this.#requireDefinition();
  validateTutorialDefinition(def);
  const game = this.#getRunner().game;
  const progress = initialProgress(def);       // pure function
  game.tutorialProgress.set(seat, progress);   // engine state mutation
  this.#callbacks.broadcast();
}
```

`game.tutorialProgress` is a serialized `Map<number, TutorialProgress>` in the engine snapshot.
Setting it is a pure snapshot mutation. This is exactly the pattern used by other stateless ops
(`action`, `undo`, etc.) — mutate engine state, return new snapshot, broadcast. No AI inference,
no I/O, no external state.

**MR-03 restart semantics:** `start()` unconditionally overwrites existing progress with
`initialProgress(def)`. No check for already-running. Restart is clean and idempotent already.
[VERIFIED: tutorial-controller.ts line reads `game.tutorialProgress.set(seat, progress)` with no
pre-check]

**Empty steps:** `validateTutorialDefinition(def)` throws on `def.steps.length === 0`. [VERIFIED:
`src/engine/tutorial/progress.ts:178-184`] MR-03 is already resolved.

### Full wire path (confirmed by reading all files in chain)

```
GameShell.handleTeachingAction('start-tutorial')
  → platformRequest('start-tutorial', { seat: playerSeat.value })
  → postMessage { type:'server_request', op:'start-tutorial', payload:{seat}, requestId }
  → DevHost.vue onWindowMessage
      forward WebSocket msg { type:'server_request', op, payload, requestId }
  → MultiplayerHost.handleServerRequest [multiplayer-host.ts:307-326]
      → this.session.handleServerRequest(seat, requestId, 'start-tutorial', payload)
  → bridge.createDevSession.handleServerRequest [bridge.ts:241-265]
      const op = translateOp('start-tutorial', seat, payload)
      → { type: 'startTutorial', player: seat }
      result = await host.handleOp(seat, op)
      postServerResponse(seat, requestId, shapeResult('start-tutorial', result))
```

[VERIFIED: reading DevHost.vue:212-219, multiplayer-host.ts:307-326, bridge.ts:91-165,213]

### Changes required in each file

**`src/session/stateless-ops.ts` — Op union + executeOp** [VERIFIED: line 29-59 is the Op union, line 651 is executeOp]:
```typescript
// Add to Op union:
| { type: 'startTutorial'; player: number }

// Add to READ_ONLY_OP_TYPES? No — this mutates state.

// Add case in executeOp switch:
case 'startTutorial': {
  const def = runner.game.tutorialDefinition;
  if (!def) return { success: false, error: 'No tutorial definition on this game.' };
  validateTutorialDefinition(def);
  runner.game.tutorialProgress.set(op.player, initialProgress(def));
  // Return new snapshot via the standard result-building path.
}
```

**`src/cli/dev-host/bridge.ts` — WireOp + translateOp + shapeResult** [VERIFIED: lines 21-37, 92-165, 172-213]:
```typescript
// Add to WireOp union:
| 'start-tutorial'

// Add to translateOp switch:
case 'start-tutorial':
  return { type: 'startTutorial', player: seat };

// Add to shapeResult switch:
case 'start-tutorial':
  return { success: result.success, error: result.error };
```

### `hasTutorial` signal — ControlsMenu gate

The Teaching group in ControlsMenu is gated on `showHint !== undefined`:
```typescript
// ControlsMenu.vue:259
<template v-if="showHint !== undefined">
  <div class="grouplabel">Teaching</div>
  ...
</template>
```
`showHint` comes from `lobbyInfo?.slots?.some(s => s.aiLevel != null) ? true : undefined`.
In platform mode (boardsmith dev), `lobbyInfo` is null → Teaching group hidden.

The comment at line 692 reads: "In platform mode (no lobbyInfo), the group is hidden — **bridge integration**". This was the placeholder for Phase 109 work. [VERIFIED: GameShell.vue:692]

**Design:** Add `hasTutorial?: boolean` to `PlayerGameState` (`src/session/types.ts`), set in
`buildPlayerState` when `runner.game.tutorialDefinition` is set. GameShell reads it from
`state.value?.state?.hasTutorial`. ControlsMenu gets a new `hasTutorial` prop.

The "Start tutorial" item should appear in a Tutorial section separate from or within the Teaching
group. The cleanest is a separate Tutorial group that shows when `hasTutorial` is true, independent
of AI availability.

**`buildPlayerState` addition** [VERIFIED: `src/session/utils.ts:345`]:
```typescript
// Add near bottom of buildPlayerState, before return:
if (runner.game.tutorialDefinition) {
  state.hasTutorial = true;
}
```

**ControlsMenu changes:**
```typescript
// New prop:
hasTutorial?: boolean;

// New emit value:
'teaching-action': [action: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle' | 'start-tutorial'];

// New menu item (suggested: Tutorial section above Session, or at bottom of Teaching):
<template v-if="hasTutorial">
  <div class="sep"></div>
  <div class="grouplabel">Tutorial</div>
  <button class="mi" type="button" role="menuitem"
    @click="emit('teaching-action', 'start-tutorial'); close()">
    <!-- icon -->
    Start tutorial
  </button>
</template>
```

**GameShell.handleTeachingAction:**
```typescript
// Extend type:
async function handleTeachingAction(
  teachAction: 'hint' | 'demo-toggle' | 'heatmap-toggle' | 'help-toggle' | 'start-tutorial'
) {
  // ...existing cases...
  } else if (teachAction === 'start-tutorial') {
    try {
      await platformRequest('start-tutorial', { seat: playerSeat.value });
    } catch {
      toast.error('Failed to start tutorial.');
    }
  }
}
```

### Open Question for Planner: hint/heatmap/demo bridge ops

STATE.md records "Teaching controls wired via platformRequest ops (hint/demo-start/demo-stop/heatmap-toggle) — **bridge integration deferred to Phase 109**." [VERIFIED: STATE.md decisions section]

Currently, `translateOp` in `bridge.ts` has NO case for `'hint'`, `'heatmap-toggle'`, `'demo-start'`, `'demo-stop'`. These wire ops fall to `default: return undefined` → bridge responds `{ success: false, error: "Unknown server op: 'hint'" }`. [VERIFIED: bridge.ts:162-165]

These ops require AI inference (stateful `GameSession` methods: `requestHint`, `setHeatmapVisible`, `startDemo`, `stopDemo`) and cannot be implemented as stateless ops. Implementing them in the dev bridge would require a separate stateful layer in `createDevSession`.

**The planner must decide:** Should Phase 109 implement hint/heatmap/demo bridge support in `boardsmith dev`? The CONTEXT.md Phase 109 scope explicitly mentions only `start-tutorial`. Hint/heatmap/demo working in dev are not required by CHK-01..04. They would be tested in DEMO-01 (Phase 110).

**Recommendation:** Scope Phase 109 to `start-tutorial` only. Note the hint/heatmap/demo bridge gap as a carry-forward to Phase 110 where the browser demo will expose it.

---

## Area 3: Checkers Tutorial Content — Exact Seam Analysis

### Action structure (confirmed by reading checkers actions.ts)

```typescript
// Selection 1 — name: 'piece', type: 'element', elementClass: CheckerPiece
.chooseElement('piece', {
  boardRef: (piece) => ({ notation: square?.notation }),  // UI ref only
  // ...filter, display...
})

// Selection 2 — name: 'destination', type: 'choice', choices: DestinationChoice[]
.chooseFrom('destination', {
  choices: (ctx) => moves.map(m => ({
    pieceId: m.piece.id,
    fromNotation: m.from.notation,
    toNotation: m.to.notation,
    isCapture: m.captures.length > 0,
    becomesKing: m.becomesKing,
    capturedNotations: m.captures.map(s => s.notation),
  })),
  filterBy: { key: 'pieceId', selectionName: 'piece' },  // links selection 2 to selection 1
})
```

Selection names confirmed: `'piece'` and `'destination'`. [VERIFIED: actions.ts lines 83, 120]

### Gate patterns for checkers tutorial steps

**Piece gate** (use element id since CheckerPiece has no notation):
```typescript
gate: { action: 'move', selections: { piece: { id: TUTORIAL_PIECE_ID } } }
```
The `TUTORIAL_PIECE_ID` is looked up in the CI test setup:
```typescript
const p1 = testGame.game.getPlayer(1) as CheckersPlayer;
const tutorialPiece = testGame.game.getPlayerPieces(p1)[0]; // known from preset
```

**Destination gate** (use toNotation field of DestinationChoice):
```typescript
gate: { action: 'move', selections: {
  piece: { id: TUTORIAL_PIECE_ID },
  destination: { toNotation: KNOWN_CAPTURE_SQUARE }
}}
```

**Auto-fill suppression:** In the tutorial preset position, seat-1 may have only ONE piece
eligible to move (the tutorial piece). `suppressAutoFill: true` or `suppressAutoFillFor: 'piece'`
prevents the engine from auto-selecting the only valid piece before the learner clicks.

### CHK-02: Mandatory capture advanceWhen (CRITICAL PITFALL)

`whenForced('move')` would ALWAYS fire because `move` is never the sole available action —
`endTurn` is also available when `hasMovedThisTurn` is true, and before moving there are always
multiple pieces that could move. **Never use `whenForced` for mandatory capture.**

Correct approach:
```typescript
{
  id: 'capture-tip',
  gate: { action: 'move' },
  content: [{
    text: 'A capture is available! In checkers, captures are mandatory.',
    target: { kind: 'action', actionName: 'move' },
  }],
  advanceWhen: {
    'first capture forced': (ctx) => {
      const game = ctx.game as CheckersGame;
      const player = game.getPlayer(ctx.seat) as CheckersPlayer;
      if (!player) return false;
      return game.playerHasCaptures(player);
    },
  },
}
```

[VERIFIED: `game.playerHasCaptures(player)` exists at `src/rules/game.ts:208`]

### CHK-03: Multi-jump detection

After a capture that has additional jumps available, `game.continuingPiece` is set to the
capturing piece and a `followUp: { action: 'move', args: { piece: move.piece.id } }` is returned.
[VERIFIED: actions.ts:220-231]

The continuation step:
```typescript
{
  id: 'multi-jump-continue',
  gate: { action: 'move', selections: { destination: { toNotation: KNOWN_SECOND_JUMP_SQUARE } } },
  suppressAutoFill: true,
  content: [{ text: 'The turn continues! Jump again to finish the capture chain.' }],
  advanceWhen: {
    'multi-jump chain complete': (ctx) => {
      return (ctx.game as CheckersGame).continuingPiece === null;
    },
  },
}
```

### endTurn gate consideration

The checkers flow loop after a non-capture move: `game.hasMovedThisTurn = true` → loop body
repeats → `actionStep({ actions: ['move', 'endTurn'] })`. The tutorial gate for `{ action: 'move' }`
BLOCKS `endTurn`. This creates a deadlock unless:

1. The `advanceWhen` predicate fires IMMEDIATELY after `move` (before `endTurn` is needed), OR
2. An explicit `endTurn` step follows with `gate: { action: 'endTurn' }`

For the capture steps: after `move` with `isCapture=true` + multi-jump, `continuingPiece` is
non-null and `hasMovedThisTurn` is false. No `endTurn` is needed during multi-jump. The loop
continues offering `move` only. No deadlock.

For non-capture intro moves (if any): after `move`, `hasMovedThisTurn=true`, loop offers
`endTurn`. A gate-only `{ action: 'move' }` blocks it. **The tutorial should include an explicit
`endTurn` step** for any turn that requires it:

```typescript
{ id: 'confirm-turn', gate: { action: 'endTurn' },
  content: [{ text: 'Click End Turn to confirm your move.' }],
  advanceWhen: { 'turn confirmed': (ctx) => !(ctx.game as CheckersGame).hasMovedThisTurn }
}
```

Alternatively, design the preset position so the FIRST teaching beat is immediately a CAPTURE
(no intro non-capture move needed). The learner starts at a position where a capture is forced.
Then no `endTurn` is needed until after the multi-jump sequence completes. This is the simpler
design — start with capture already forced.

### Tutorial preset board position

Add `tutorialSetup?: boolean` to `CheckersOptions`. When true, `placePieces()` creates a minimal
position designed to force a two-jump chain for seat-1. Example layout (exact squares at
implementation discretion):

```
Seat-1 (player 1, pieces on dark squares, moves toward row 7):
  - One piece at c3 (row 5, col 2) — positioned to jump d4→e5, then e5→f6→g7 or similar

Seat-2 (player 2, pieces on dark squares):
  - Pieces at d4 and f6 (enemy pieces in the jump path)
  - Additional pieces elsewhere so seat-2 can make valid moves when needed
```

The exact notation depends on the game's coordinate system (row 0 is the top, row 7 is the
bottom; `notation = colLetter + (8-row)`). The preset must have enough pieces for seat-2 to
make at least one move in the CI scenario (so the flow advances past seat-2's turn).

### CI test scenario design (tests/tutorial.test.ts)

```typescript
const testGame = TestGame.create(CheckersGame, {
  playerCount: 2,
  playerNames: ['Learner', 'Opponent'],
  seed: 'checkers-tutorial-pinned',
  tutorialSetup: true,  // custom initial position
});

// Look up piece IDs from the known preset position:
const learner = testGame.game.getPlayer(1) as CheckersPlayer;
const tutorialPiece = testGame.game.getPlayerPieces(learner)[0]; // only piece in preset
const validMoves = testGame.game.getValidMoves(learner);
const firstCapture = validMoves.find(m => m.captures.length > 0)!;
const captureDestination = /* build DestinationChoice from move */;

const WALKTHROUGH: TutorialScenarioMove[] = [
  // Step: capture-tip triggers (seat-1 sees capture is forced; advanceWhen fires)
  // No action needed if advanceWhen fires at game start via simulateTutorial initial pump.

  // Execute the capture move:
  { action: 'move', args: { piece: tutorialPiece, destination: captureDestination },
    expectStep: 'multi-jump-continue' },

  // Execute the continuation jump (no endTurn — still seat-1's turn):
  { action: 'move', args: { piece: tutorialPiece, destination: secondJumpDestination },
    expectStep: 'confirm-turn' },

  // End seat-1's turn:
  { action: 'endTurn', expectStep: 'done' },  // or tutorial completes

  // Seat-2 must take a turn to advance the flow:
  { seat: 2, action: 'move', args: { piece: seat2Piece, destination: seat2Destination } },
  { seat: 2, action: 'endTurn' },
];

const result = simulateTutorial(testGame, CHECKERS_TUTORIAL, { seat: 1, scenario: WALKTHROUGH });
assertTutorialCompletes(result);
```

**Green→red proof** (mandatory capture rule break):
```typescript
it('break: mandatory-capture rule removed → tutorial never advances past capture-tip', () => {
  // Create a checkers variant where getValidMoves() ignores captures (mandatory rule removed).
  // The custom advanceWhen predicate playerHasCaptures() still returns true,
  // but we need a different break: make playerHasCaptures() always return false.
  // Approach: in the test, monkey-patch the game's playerHasCaptures method
  // after TestGame.create to return false:
  testGame.game.playerHasCaptures = () => false;
  expect(() => simulateTutorial(testGame, CHECKERS_TUTORIAL, {
    seat: 1,
    scenario: WALKTHROUGH,
    // ... broken because capture-tip step never advances
  })).toThrow(/Tutorial drift/);
});
```

Or more robustly: create a `BrokenCheckersGame` subclass that overrides `getValidMoves` to
never return captures (removing mandatory capture enforcement). The `playerHasCaptures` will
return false → `advanceWhen` for capture-tip never fires → `expectStep` assertion throws.

### `doAction` args for two-step `move` in tests

`testGame.doAction(seat, 'move', args)` passes args directly to `runner.performAction` → `game.continueFlow(actionName, args, seat)`. The action execute callback receives `args.piece` and `args.destination` directly. [VERIFIED: runner.ts:128-170]

- `args.piece` = actual `CheckerPiece` element instance (or element id — runner resolves it)
- `args.destination` = full `DestinationChoice` object (the exact choice object from `choices()`)

The cleanest test pattern: build the destination choice from `game.getValidMoves()`:
```typescript
const moves = testGame.game.getValidMoves(learner);
const captureMove = moves.find(m => m.captures.length > 0)!;
const destinationArg: DestinationChoice = {
  pieceId: captureMove.piece.id,
  fromNotation: captureMove.from.notation,
  toNotation: captureMove.to.notation,
  isCapture: true,
  becomesKing: captureMove.becomesKing,
  capturedNotations: captureMove.captures.map(s => s.notation),
};
testGame.doAction(1, 'move', { piece: captureMove.piece, destination: destinationArg });
```

---

## Area 4: Cross-Repo Build Reality

### Symlink + exports map — no rebuild needed

[VERIFIED: `readlink ~/BoardSmithGames/checkers/node_modules/boardsmith` → `../../../BoardSmith`]

[VERIFIED: `package.json` exports map — every entry uses `./src/...` paths (TypeScript source), never `./dist/`]:
```json
".":         { "import": "./src/engine/index.ts" },
"./testing": { "import": "./src/testing/index.ts" },
```

[VERIFIED: checkers `vitest.config.ts` — no aliases; standard `@vitejs/plugin-vue` setup]

**Consequence:** New exports added to `src/engine/index.ts` (e.g., `SelectionMatcher`,
updated `TutorialGateAllowList`) and `src/testing/index.ts` are immediately importable from
checkers vitest without any `npm install` or rebuild step.

**What checkers imports from BoardSmith:**
- `import { ... } from 'boardsmith'` → `src/engine/index.ts` (engine types + GameElement etc.)
- `import { simulateTutorial, assertTutorialCompletes, TestGame } from 'boardsmith/testing'` →
  `src/testing/index.ts`

Both already export the tutorial DSL and all types needed for the checkers tutorial test.
[VERIFIED: engine/index.ts:249-262 exports tutorial types; testing/index.ts:82-93 exports tutorial DSL]

**The CONTEXT.md "rebuild + refresh" note is OVERLY CAUTIOUS for this symlink setup.** No action
needed between landing substrate in BoardSmith and running checkers tests. The planner should
note this to avoid unnecessary `npm install` tasks. However, if a `dist/` build ever becomes
required (not currently the case), a build step would be needed.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Gate matching for ElementRef | Custom deep-equals | `matchesRef`-style precedence already defined in `useBoardInteraction.ts` | Copy the same id>notation>name precedence into engine's `selectionMatchesValue` helper |
| Tutorial step advance tracking | Custom counter/timer | `autoAdvanceTutorial` + `afterTurns` / custom `advanceWhen` | Already in substrate from Phase 106 |
| Tutorial CI scenarios | Custom test harness | `simulateTutorial` + `assertTutorialCompletes` from `boardsmith/testing` | Already built in Phase 106; prove green→red |
| Snapshot mutation for start-tutorial | Stateful session detour | New stateless Op type in `stateless-ops.ts` | Engine state mutation = stateless; dev bridge gets it for free |
| Player state broadcast for hasTutorial | Custom broadcast path | `buildPlayerState` field addition | It's used by BOTH `GameSession.broadcast` and stateless-ops `buildPlayerState`; one place |

---

## Common Pitfalls

### Pitfall 1: CheckerPiece notation mismatch in gate

**What goes wrong:** Tutorial author writes `gate: { ..., selections: { piece: { notation: 'c3' } } }`. The gate checks `el.notation === 'c3'` on a `CheckerPiece`, which returns `undefined`. All pieces pass the gate.

**Why it happens:** Only `Square` has a `notation` getter. `CheckerPiece` has `.id`, `.name` but not `.notation`. The `boardRef` in the action definition emits `{ notation: square?.notation }` for UI purposes only — this does not set the piece element's own notation.

**How to avoid:** Gate piece elements by `{ id: pieceId }`. Derive `pieceId` from `testGame.game.getPlayerPieces(...)` in the CI test setup.

**Warning signs:** Every piece passes gate restriction (no piece is disabled); tutorial never enforces piece selection.

### Pitfall 2: `whenForced('move')` for mandatory capture

**What goes wrong:** Tutorial author writes `advanceWhen: { ...whenForced('move') }`. The step never advances because `move` is never the ONLY available action (when `hasMovedThisTurn` is true, `endTurn` is also available; the `move` condition-predicate check doesn't see this as "forced").

**Why it happens:** Checkers' mandatory capture restricts DESTINATION choices within `move`, not the action availability itself. `move` is always available at the action level.

**How to avoid:** Use custom `advanceWhen` with `game.playerHasCaptures(player)`.

**Warning signs:** `capture-tip` step never advances in CI test scenario.

### Pitfall 3: `endTurn` deadlock

**What goes wrong:** Tutorial step gates `{ action: 'move' }`. Learner executes a non-capture move. Now `endTurn` is needed to advance the flow, but the gate blocks it. Tutorial stalls.

**Why it happens:** `TutorialGateAllowList.action` specifies exactly ONE allowed action. After move, the flow loop continues with `actionStep(['move', 'endTurn'])`. The `move`-only gate blocks `endTurn`.

**How to avoid:** Either (a) design the tutorial preset so the FIRST teaching beat is a mandatory capture (no intro non-capture move), OR (b) include explicit `endTurn` tutorial steps following non-capture moves.

**Warning signs:** `simulateTutorial` throws on `endTurn` action: `Tutorial drift (gate): action 'endTurn' is disabled on step '...'`.

### Pitfall 4: `advanceWhen` fires before teaching beat is shown

**What goes wrong:** `advanceWhen` predicate is true at game start (e.g., `playerHasCaptures` is true from the first moment). The auto-advance pump in `simulateTutorial` runs before any actions and immediately advances past the `capture-tip` step.

**Why it happens:** `simulateTutorial` runs `autoAdvanceTutorial` once at start (lines 206-207), so predicates that are initially true skip the step.

**How to avoid:** Design the tutorial preset such that captures become forced AFTER the first teaching move — OR use a composite predicate that also requires `game.hasMovedThisTurn` to have been set first (meaning the learner took an action).

**Warning signs:** `stepsVisited` in the CI test result skips `capture-tip` entirely.

### Pitfall 5: Opponent seat-2 turns not included in CI scenario

**What goes wrong:** The CI scenario only includes seat-1 moves. `eachPlayer` in checkers flow requires seat-2 to take a turn before seat-1 can act again. After seat-1's turn, `playerIndex` becomes seat-2; seat-1's `doAction` fails with "Not Player 1's turn".

**Why it happens:** The flow is `loop → eachPlayer → playerTurn`. After seat-1 takes their turn (`endTurn`), the flow advances to seat-2's turn. Seat-1 cannot act again until seat-2 acts.

**How to avoid:** Include `{ seat: 2, action: 'move', args: {...} }` and `{ seat: 2, action: 'endTurn' }` in the scenario wherever the flow requires seat-2 to act.

**Warning signs:** `simulateTutorial` throws "Not Player 2's turn" or "Game is not awaiting input" on a seat-1 action.

### Pitfall 6: `filterBy` interaction with per-selection gate

**What goes wrong:** When the tutorial gates the `destination` selection (via `selections.destination`) AND the action defines `filterBy: { key: 'pieceId', selectionName: 'piece' }`, the `filterBy` runs FIRST (line 358-381) to narrow `destination` choices to only those for the selected piece. Then the tutorial gate runs on the filtered choices.

**Why this matters positively:** The gate's `{ toNotation: 'd4' }` only needs to match against the already-piece-filtered destinations — no spurious mismatches from other pieces' destinations. This is the correct behavior.

**Pitfall:** If the test provides `args.piece` as the element ID number (not the element object), the `filterBy` comparison at line 368-370 tries `prevObj['id']` → matches the numeric id correctly. This is fine. Just be consistent.

---

## Code Examples

### Example: Two-step move gate with per-selection restrictions

```typescript
// Source: Phase 109 — TutorialGateAllowList.selections design
const moveTeachStep: TutorialStep = {
  id: 'execute-capture',
  suppressAutoFill: true,     // prevent auto-fill of sole-valid piece
  gate: {
    action: 'move',
    selections: {
      piece: { id: TUTORIAL_PIECE_ID },           // only this piece
      destination: { toNotation: 'e5' },          // only this destination
    },
  },
  content: [
    {
      text: 'Select your piece at c3.',
      target: { kind: 'element', ref: { id: TUTORIAL_PIECE_ID } },
    },
    {
      text: 'Jump to e5 to capture!',
      target: { kind: 'element', ref: { notation: 'e5' } },
    },
  ],
  advanceWhen: {
    'capture executed': (ctx) => (ctx.game as CheckersGame).continuingPiece !== null,
  },
};
```

### Example: Mandatory-capture advanceWhen (CHK-02)

```typescript
// Source: Phase 109 — custom advanceWhen using game.playerHasCaptures
const captureTipStep: TutorialStep = {
  id: 'capture-tip',
  gate: { action: 'move' },
  content: [{
    text: 'A capture is available — and in checkers, you MUST take it!',
    placement: 'top',
  }],
  advanceWhen: {
    'first capture forced': (ctx): boolean => {
      const game = ctx.game as CheckersGame;
      const player = game.getPlayer(ctx.seat) as CheckersPlayer | undefined;
      if (!player) return false;
      return game.playerHasCaptures(player);
    },
  },
};
```

### Example: Multi-jump continuation gate (CHK-03)

```typescript
// Source: Phase 109 — continuingPiece detection
const multiJumpStep: TutorialStep = {
  id: 'multi-jump-continue',
  gate: {
    action: 'move',
    selections: {
      destination: { toNotation: KNOWN_SECOND_JUMP_SQUARE },
    },
  },
  content: [{
    text: "The turn continues! Jump again while more captures exist.",
    target: { kind: 'element', ref: { notation: KNOWN_SECOND_JUMP_SQUARE } },
  }],
  advanceWhen: {
    'multi-jump chain complete': (ctx): boolean => {
      return (ctx.game as CheckersGame).continuingPiece === null;
    },
  },
};
```

### Example: CI test doAction with full DestinationChoice

```typescript
// Source: Phase 109 — building doAction args from getValidMoves()
const learner = testGame.game.getPlayer(1) as CheckersPlayer;
const captureMoves = testGame.game.getValidMoves(learner).filter(m => m.captures.length > 0);
const move = captureMoves[0];

const destinationArg = {
  pieceId: move.piece.id,
  fromNotation: move.from.notation,
  toNotation: move.to.notation,
  isCapture: true,
  becomesKing: move.becomesKing,
  capturedNotations: move.captures.map(s => s.notation),
};

testGame.doAction(1, 'move', { piece: move.piece, destination: destinationArg });
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `TutorialGateAllowList.from`/`to: unknown` (reserved) | `TutorialGateAllowList.selections: Record<string, SelectionMatcher>` | Phase 109 | Named per-selection gating; old fields removed cleanly |
| No tutorial launch surface | `start-tutorial` stateless Op + bridge routing + ControlsMenu item | Phase 109 | Tutorial launchable from dev host and production |
| hint/heatmap/demo bridge ops not implemented (unknown op error) | Deferred to Phase 110 | Phase 109 (intentionally deferred) | Dev bridge shows hint/heatmap/demo in Phase 110 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Teaching the "two-step move" (CHK-01) is best done as a SINGLE tutorial step with per-selection gates on both piece + destination, rather than two steps that advance mid-action | Area 3 content design | If the substrate needs mid-action step advances for the CHK-01 beat, a new mechanism is required (not in scope) |
| A2 | The tutorial preset board position should start with captures ALREADY forced (seat-1 faces a mandatory capture immediately), bypassing any intro non-capture move | Area 3 preset design | If a non-capture intro move is needed, explicit `endTurn` steps must be authored and included in CI scenario |
| A3 | hint/heatmap/demo bridge ops are out of scope for Phase 109 and deferred to Phase 110 | Area 2 launch surface | If the user wants these working in `boardsmith dev` during Phase 109 testing, additional work is needed (these require stateful AI session layer, not simple stateless ops) |
| A4 | `tutorialSetup: boolean` is the right mechanism for the custom board position (rather than extending `gameDefinition.presets` with board-position data) | Area 3 preset design | If game option flow is restricted, an alternative seed-based deterministic position must be found |

---

## Open Questions

1. **Exact tutorial preset board position**
   - What we know: needs ≥1 seat-1 piece positioned to force a capture, plus the capture target in the jump path for a second jump
   - What's unclear: exact checkers notation squares that satisfy the two-jump requirement within the board coordinate system (row 0 = rank 8, col 0 = file a)
   - Recommendation: implementer calculates valid two-jump sequence from a minimal 2-3 piece position; commit as named constants in `game.ts`

2. **Should hint/heatmap/demo bridge ops be in Phase 109 scope?**
   - What we know: STATE.md records "bridge integration deferred to Phase 109"; CONTEXT.md Phase 109 only mentions `start-tutorial` explicitly
   - What's unclear: whether the user intends Phase 109 to also fix hint/heatmap/demo in `boardsmith dev`
   - Recommendation: defer to Phase 110 (DEMO-01 browser demo) where they'll be exercised and the gap is visible

3. **Tutorial step count and exact advanceWhen timing relative to endTurn**
   - What we know: capture moves do NOT require `endTurn` (multi-jump auto-continues); non-capture moves require `endTurn` before flow advances
   - What's unclear: whether the preset design fully avoids non-capture intro moves, or whether explicit `endTurn` steps are needed
   - Recommendation: design preset to start with captures forced (eliminate intro non-capture moves); re-evaluate if a non-capture intro is educationally necessary

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| boardsmith symlink in checkers | checkers CI test | ✓ | symlink → `../../../BoardSmith` | — |
| vitest in checkers | CI test | ✓ | `^2.0.0` (devDep) | — |
| boardsmith/testing exports | `simulateTutorial`, `assertTutorialCompletes` | ✓ | Already exported in `src/testing/index.ts:82-93` | — |
| `CheckersGame`, `CheckerPiece`, etc. | tutorial content | ✓ | Already in `src/rules/index.ts` | — |

**No missing dependencies.** All required packages and exports already exist.

---

## Validation Architecture

> `workflow.nyquist_validation` key absent from `.planning/config.json` → treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (BoardSmith: `^2.1.0`; checkers: `^2.0.0`) |
| Config file | BoardSmith: root `vitest.config.ts`; Checkers: `vitest.config.ts` |
| Quick run command (BoardSmith) | `npx vitest run src/engine/tutorial/ src/engine/action/tutorial-gate.test.ts` |
| Quick run command (checkers) | `cd ~/BoardSmithGames/checkers && npx vitest run tests/tutorial.test.ts` |
| Full suite command (BoardSmith) | `npx vitest run` |
| Full suite command (checkers) | `cd ~/BoardSmithGames/checkers && npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHK-01 | Per-selection gate restricts piece + destination within `move` | unit | `npx vitest run src/engine/tutorial/gate.test.ts src/engine/action/tutorial-gate.test.ts` | ✅ (gate.test.ts); ✅ (tutorial-gate.test.ts) — need new per-selection cases |
| CHK-02 | `advanceWhen: playerHasCaptures` fires when capture is available | integration (CI sim) | `cd ~/BoardSmithGames/checkers && npx vitest run tests/tutorial.test.ts` | ❌ Wave 0 |
| CHK-03 | Multi-jump gate + continuingPiece advanceWhen works end-to-end | integration (CI sim) | Same as CHK-02 | ❌ Wave 0 |
| CHK-04 | `start-tutorial` op routes through bridge; `hasTutorial` in PlayerGameState | unit | `npx vitest run src/session/stateless-ops.test.ts src/session/build-player-state.test.ts` | ✅ (files exist) — need new cases |
| LR-02 | Per-selection gating: piece c3 allowed, wrong square disabled | unit | `npx vitest run src/engine/action/tutorial-gate.test.ts` | ✅ — need new per-selection test cases |

### Sampling Rate

- **Per task commit:** `npx vitest run` (BoardSmith) or `npx vitest run tests/tutorial.test.ts` (checkers)
- **Per wave merge:** Full vitest suite in BOTH repos
- **Phase gate:** Both suites green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `~/BoardSmithGames/checkers/tests/tutorial.test.ts` — covers CHK-02, CHK-03 (CI tutorial scenario)
- [ ] New test cases in `src/engine/tutorial/gate.test.ts` — per-selection gating with `selectionName`
- [ ] New test cases in `src/engine/action/tutorial-gate.test.ts` — per-selection value gating in action pipeline
- [ ] New test cases in `src/session/stateless-ops.test.ts` — `startTutorial` Op execution
- [ ] New test cases in `src/session/build-player-state.test.ts` — `hasTutorial` field presence

---

## Security Domain

> This phase is all internal engine/session/UI code and game content authoring. No network endpoints, authentication, user input validation, or cryptography are introduced. ASVS categories V2–V6 do not apply to this phase. The `start-tutorial` op inherits the existing session auth model (seat-based) already enforced by `MultiplayerHost.handleServerRequest` (seat lookup required). No new security surface.

---

## Sources

### Primary (HIGH confidence)

All findings below were verified by directly reading source files:

- `src/engine/tutorial/types.ts` — `TutorialGateAllowList`, `SelectionMatcher` (reserved from/to fields), full type hierarchy
- `src/engine/tutorial/gate.ts` — `getGateReasonForValue` signature, `isAllowListGate`, `getActiveStep`
- `src/engine/tutorial/progress.ts` — `validateTutorialDefinition` (MR-03 already fixed), `initialProgress`
- `src/engine/tutorial/predicates.ts` — `whenForced`, `afterTurns`, `afterFirstTurn` semantics
- `src/engine/action/action.ts:370-465` — 3 call sites (lines 388, 440, 460); `selection.name` in scope at all 3
- `src/engine/action/types.ts` — `BaseSelection.name: string` confirmed
- `src/session/tutorial-controller.ts` — `start()` overwrites unconditionally (restart safe), `validateTutorialDefinition` called
- `src/session/game-session.ts:1842` — `startTutorial` delegates to `#tutorialController.start`
- `src/session/stateless-ops.ts` — `Op` union (lines 29-59), `READ_ONLY_OP_TYPES`, `executeOp` (line 651)
- `src/session/types.ts:78-101` — `GameDefinition.tutorial`, `PlayerGameState:401+`
- `src/session/utils.ts:345-465` — `buildPlayerState` full body; where `hasTutorial` would go
- `src/session/snapshot-session-host.ts` — `handleOp` routes stateless ops
- `src/cli/dev-host/bridge.ts` — `translateOp`, `shapeResult`, `WireOp`, `createDevSession` full body
- `src/cli/dev-host/multiplayer-host.ts:307-326` — `handleServerRequest` routing
- `src/cli/dev-host/DevHost.vue:209-219` — transparent WS forwarding of `server_request`
- `src/ui/components/GameShell.vue` — `platformRequest`, `handleTeachingAction`, `showHintProp`, `tutorialStep`, ControlsMenu usage
- `src/ui/components/ControlsMenu.vue` — props, emits, Teaching group gating, template structure
- `src/ui/composables/useBoardInteraction.ts:207-217` — `matchesRef` precedence (id > notation > name)
- `~/BoardSmithGames/checkers/src/rules/actions.ts` — selection names `'piece'` (element), `'destination'` (choice); `DestinationChoice` structure
- `~/BoardSmithGames/checkers/src/rules/game.ts` — `playerHasCaptures`, `continuingPiece`, `executeMove`, `getValidMoves`
- `~/BoardSmithGames/checkers/src/rules/flow.ts` — `endTurn` requirement after non-capture moves
- `~/BoardSmithGames/checkers/src/rules/index.ts` — `gameDefinition` shape (no `tutorial` yet)
- `~/BoardSmithGames/checkers/tests/game.test.ts` — existing test import pattern (`boardsmith/testing`)
- `~/BoardSmithGames/checkers/package.json` — `"boardsmith": "file:../../BoardSmith"` dep
- `~/BoardSmithGames/checkers/vitest.config.ts` — no aliases; plain vite setup
- `~/BoardSmithGames/checkers/node_modules/boardsmith` → symlink `../../../BoardSmith` confirmed
- `BoardSmith/package.json` exports — all entries point to `src/*.ts`, never `dist/`
- `src/testing/simulate-tutorial.ts` — `simulateTutorial` full implementation; `doAction` args pattern
- `src/testing/tutorial-ci-demo.test.ts` — green→red proof pattern; scenario structure
- `src/testing/test-game.ts` — `TestGame.create`, `doAction(seat, action, args)` passes to `runner.performAction`

### Secondary (MEDIUM confidence — derived from reading multiple consistent sources)

- `CheckerPiece` has no `.notation` property (derived from reading `elements.ts` + `game-element.ts:716-729`): only `Square` has a notation getter. High confidence given direct source reading but no explicit "CheckerPiece.notation = undefined" statement.

---

## Metadata

**Confidence breakdown:**

- Area 1 gate extension: HIGH — exact call sites, types, and surrounding scope verified in source
- Area 2 launch surface path: HIGH — full wire path traced through 5 files
- Area 3 checkers content: HIGH for action signatures, game predicates; MEDIUM for exact tutorial step sequence (depends on preset position design choices)
- Area 4 cross-repo build: HIGH — symlink confirmed, exports map verified

**Research date:** 2026-06-28
**Valid until:** 2026-07-28 (stable substrate; checkers rules haven't changed in this session)
