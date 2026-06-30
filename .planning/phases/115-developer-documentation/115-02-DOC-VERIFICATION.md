---
phase: 115-developer-documentation
plan: "02"
subsystem: docs
tags: [verification, tutorial, teaching, doc-accuracy]
---

# Phase 115 Plan 02: Doc Verification — teaching-and-tutorials.md

**Verified:** 2026-06-30  
**Doc:** `docs/teaching-and-tutorials.md`  
**Verifier method:** filesystem-only; every claim checked against live source

---

## Verdict

## MISMATCHES FOUND

Two verifiable inaccuracies. All other claims pass. Coverage is complete (DOC-01..04 all addressed; README linked). Both mismatches are confined to prose descriptions and inline code comments — no API name, type shape, method signature, or lockout message is wrong. However both mismatches will mislead readers.

---

## Per-Claim Results

### Section 1 — Authoring a Tutorial

| Claim | Source file | Result | Note |
|---|---|---|---|
| `TutorialDefinition { steps: TutorialStep[]; setup?: (game: Game) => void }` | `src/engine/tutorial/types.ts` | **PASS** | Exact shape confirmed |
| `TutorialStep { id, gate, content?, advanceWhen?, suppressAutoFill?, suppressAutoFillFor? }` | `src/engine/tutorial/types.ts` | **PASS** | All six fields present with correct types |
| `TutorialGateAllowList { action: string; selections?: Record<string, SelectionMatcher> }` | `src/engine/tutorial/types.ts` | **PASS** | Exact match |
| `TutorialGateCondition = Record<string, (ctx: TutorialGateContext) => boolean>` | `src/engine/tutorial/types.ts` | **PASS** | Exact type alias |
| `TutorialGateContext { game: Game; seat: number }` (no `lastActionResult`) | `src/engine/tutorial/types.ts` | **PASS** | Two fields only, confirmed |
| `AnnotationTarget` discriminated union (`element`, `action`, `panel`) | `src/engine/tutorial/types.ts` | **PASS** | Three variants match exactly |
| `selectionMatchesValue` precedence: id > notation > name for elements | `src/engine/tutorial/gate.ts` | **PASS** | Code: `if ('id'…) if ('notation'…) if ('name'…)` |
| `{ value: primitiveValue }` form for primitive string/number choices | `src/engine/tutorial/gate.ts` | **PASS** | First branch of selectionMatchesValue: `typeof value !== 'object'` → `matcher['value'] === value` |
| `CHECKERS_TUTORIAL: TutorialDefinition` with `setup: (game) => (game as CheckersGame).resetToTutorialPreset()` | `~/BoardSmithGames/checkers/src/rules/tutorial.ts` | **PASS** | Exact |
| `GO_FISH_TUTORIAL: TutorialDefinition` with same pattern | `~/BoardSmithGames/go-fish/src/rules/tutorial.ts` | **PASS** | Exact |
| Checkers gate: `piece: { name: TUTORIAL_PIECE_NAME }` | `checkers/src/rules/tutorial.ts` | **PASS** | Confirmed line 114 |
| Go Fish gate: `target: { value: 2 }` — **comment in Section 1.3 says "{ value, display } choice object"** | `go-fish/src/rules/tutorial.ts` | **PASS** | Matcher correct; Section 1.3 comment is accurate |
| Go Fish gate: `rank: { value: '7' }` — primitive string | `go-fish/src/rules/tutorial.ts` | **PASS** | Confirmed line 78 |
| `session.startTutorial(seat)` / `advanceTutorial(seat)` / `skipTutorial(seat)` / `exitTutorial(seat)` | `src/session/game-session.ts` | **PASS** | All four methods exist at lines 1915, 1929, 1940, 1951 |
| `TutorialProgress.status: 'running' | 'completed' | 'exited'` | `src/engine/tutorial/types.ts` | **PASS** | Exact |
| ControlsMenu shows "Start tutorial" when `gameDefinition.tutorial` exists | Behavioral claim | UNVERIFIABLE (runtime) | Not directly falsified by source |

#### MISMATCH 1 — Section 7 comment on `target: { value: 2 }`

**Location:** Section 7, "Axis 1: Tutorial definition", go-fish code block (doc line ~562)

**Doc claim:**
```typescript
target: { value: 2 },   // opponent (primitive number wrapped in { value })
```

**What the source shows:**

`selectionMatchesValue` in `src/engine/tutorial/gate.ts`:
```typescript
// Primitive support: { value: primitiveValue } matches a primitive string/number choice.
if (typeof value !== 'object' || value === null) {
  return 'value' in matcher && matcher['value'] === value;
}
// ... (object path below)
// General field equality for choice objects (DestinationChoice, etc.).
return Object.entries(matcher).every(([k, v]) => val[k] === v);
```

The player `target` selection value is a choice **object** `{ value: 2, display: 'Player 2' }`, not a primitive number. Because `typeof value !== 'object'` is **false** for that object, the primitive branch is skipped. The match is achieved via the **general field equality** path (`value.value === 2`).

The correct description is in **Section 1.3** (doc line ~107), which accurately says `// opponent at seat 2; { value, display } choice object`. The comment in Section 7 contradicts it.

**Correct comment:** `// opponent at seat 2; { value, display } choice object — matched via field equality`

---

### Section 2 — Predicate Triggers

| Claim | Source file | Result | Note |
|---|---|---|---|
| `afterFirstTurn()`, `afterTurns(n)`, `whenForced(actionName)` in `src/engine/tutorial/predicates.ts` | `src/engine/tutorial/predicates.ts` | **PASS** | All three functions present |
| `import { afterFirstTurn, afterTurns, whenForced } from 'boardsmith'` | `src/engine/index.ts` (main package export) | **PASS** | Line 246: `export { afterFirstTurn, afterTurns, whenForced } from './tutorial/predicates.js'` |
| `afterTurns(n)` reads `game.getFlowState().position` (`iterations` + `playerIndex`) | `src/engine/tutorial/predicates.ts` | **PASS** | Confirmed lines 99-113 |
| `whenForced(actionName)` fires when `game.getAvailableActions(player)` returns exactly one action matching `actionName` | `src/engine/tutorial/predicates.ts` | **PASS** | Lines 143-146 |
| Checkers `advanceWhen`: `(ctx.game as CheckersGame).continuingPiece !== null` | `checkers/src/rules/tutorial.ts` | **PASS** | Line 130 |
| Go Fish `advanceWhen`: `game.getPlayerHand(learner).count(Card) > 3` | `go-fish/src/rules/tutorial.ts` | **PASS** | Line 91 |

---

### Section 3 — CI-Verifiable Tutorial Tests

| Claim | Source file | Result | Note |
|---|---|---|---|
| `simulateTutorial`, `assertTutorialCompletes`, `assertTutorialStep`, `TutorialScenarioMove` exported from `boardsmith/testing` | `src/testing/index.ts` | **PASS** | Lines 84-92 confirm all four |
| `TestGame.create(MyGame, { playerCount, seed, tutorialSetup: true })` | `src/testing/test-game.ts` | **PASS** | `tutorialSetup` option confirmed line 34 |
| Three drift dimensions: gate, predicate, non-completion | `src/testing/simulate-tutorial.ts` | **PASS** | Confirmed in file |
| Checkers RED: `playerHasCaptures = () => false` → `.toThrow(/Tutorial drift/)` | `checkers/tests/tutorial.test.ts` | **PASS** | Lines 266-273 — exact pattern confirmed |
| Go Fish RED: `checkForBooks = () => []` → `assertTutorialCompletes` throws `/Tutorial/` | `go-fish/tests/tutorial.test.ts` | **PASS** | Lines 134-154 — exact pattern confirmed |
| go-fish-tip does NOT appear in `stepsVisited` (pump advances immediately) | `go-fish/tests/tutorial.test.ts` | **PASS** | Lines 64-101 confirm; `stepsVisited` asserts only ask-for-rank, turn-continuation, book-formed |

---

### Section 4 — AI Teaching

| Claim | Source file | Result | Note |
|---|---|---|---|
| `async requestHint(seat: number): Promise<void>` | `src/session/game-session.ts` | **PASS** | Lines 972-974 |
| `hintTargetFromMove` hook in `GameDefinition.ai` returns `ElementRef` or `undefined` | `checkers/src/rules/index.ts`, `go-fish/src/rules/index.ts` | **PASS** | Both wired; checkers line 25, go-fish line 25 |
| Checkers `hintTargetFromMove`: `dest?.toNotation ? { notation: dest.toNotation } : undefined` | `checkers/src/rules/index.ts` | **PASS** | Lines 25-28 exact |
| `getGoFishHintTarget(move): { name: string } | undefined` with `{ name: String(rank) }` | `go-fish/src/rules/ai.ts` | **PASS** | Lines 471-474 exact |
| `startDemo(options?: { narrator?, delay? }): void` with `delay` default 1200 | `src/session/game-session.ts` | **PASS** | Lines 1170-1173, 1184 |
| `stopDemo(): void` | `src/session/game-session.ts` | **PASS** | Line 1239 |
| `async setHeatmapVisible(seat: number, visible: boolean): Promise<void>` | `src/session/game-session.ts` | **PASS** | Lines 1064-1066 |
| Heatmap is BOARD-ONLY — stated explicitly | Doc section 4 | **PASS** | Coverage confirmed |

#### MISMATCH 2 — Default narrator described as using "JSON formatting"

**Location:** Section 4, paragraph after `startDemo` signature (doc line ~400)

**Doc claim:**
> Supply a custom `narrator` for games with rich arg types (objects, nested references) where the **default JSON formatting reads poorly**.

**What the source shows:**

`src/session/game-session.ts` lines 1211-1217:
```typescript
// Default: "PlayerName: actionName c5 → a3 (capture)". Formats a readable
// destination from destination-like args only (never raw element ids), so
// the narration reads as prose instead of dumping JSON.
const dest = describeMoveDestination(args);
text = dest ? `${name}: ${action} ${dest}` : `${name}: ${action}`;
```

The default narrator uses `describeMoveDestination(args)` — a custom function that extracts destination-like fields and formats them as human-readable strings. It explicitly avoids JSON dumping. The comment says "instead of dumping JSON", meaning JSON was the bad alternative, not the default.

The doc saying "default JSON formatting" is the opposite of what the code does. Custom narrators are needed because `describeMoveDestination` can't extract a meaningful destination from rich arg shapes (e.g., move objects, nested references) — not because of JSON.

**Correct description:** "Supply a custom `narrator` for games with rich arg types where the default destination-extraction heuristic (`describeMoveDestination`) cannot produce a readable move description."

---

### Section 5 — Action Help

| Claim | Source file | Result | Note |
|---|---|---|---|
| `.help(text: string): this` builder sets `this.definition.help = text` | `src/engine/action/action-builder.ts` | **PASS** | Lines 105-107 |
| `ActionDefinition.help` declared in `src/engine/action/types.ts` | `src/engine/action/types.ts` | **PASS** | Line 460: `help?: string` |
| Propagates through `buildActionMetadata` → `ActionMetadata.help` | `src/session/utils.ts` | **PASS** | Lines 76 and 115: `help: actionDef.help` |
| Action help is NOT gated by `teachingDisabled` | `src/session/game-session.ts` | **PASS** | Only requestHint/setHeatmapVisible/startDemo/startTutorial throw on teachingDisabled (lines 973, 1065, 1174, 1916); help is never checked |

---

### Section 6 — Host Teaching Lockout

| Claim | Source file | Result | Note |
|---|---|---|---|
| `teachingDisabled?: boolean` in `GameSessionOptions` | `src/session/game-session.ts` | **PASS** | Line 116 |
| Exact lockout message: `"Teaching features are disabled for this session."` | `src/session/game-session.ts` | **PASS** | Lines 974, 1066, 1175, 1917 — identical in all four call sites |
| Four gated methods: `requestHint`, `setHeatmapVisible`, `startDemo`, `startTutorial` | `src/session/game-session.ts` | **PASS** | Confirmed at each site |
| `exitTutorial` and `.help()` never gated | `src/session/game-session.ts` | **PASS** | `exitTutorial` (line 1951) has no teachingDisabled check |
| `--lock-teaching` flag → `lockTeaching?: boolean` in `DevOptions` → `teachingDisabled: true` | `src/cli/commands/dev.ts` | **PASS** | Lines 49 and 363 |
| Console message: `"Teaching lockout active (--lock-teaching): hint, heatmap, demo, and tutorial are disabled."` | `src/cli/commands/dev.ts` | **PASS** | Line 675 — exact text confirmed (wrapped in chalk.yellow) |

---

### Section 7 — Parity: Checkers vs Go Fish

| Claim | Source file | Result | Note |
|---|---|---|---|
| `anchorAttrs(ref: ElementRef): Record<string, string>` in `src/ui/composables/useBoardInteraction.ts` | `src/ui/composables/useBoardInteraction.ts` | **PASS** | Line 408 — exact signature |
| Sets `data-bs-el-id`, `data-bs-el-notation`, `data-bs-el-name` | `src/ui/composables/useBoardInteraction.ts` | **PASS** | Lines 410-412 |
| `buildSelector` in `src/ui/components/helpers/overlay-utils.ts`: id > notation > name precedence | `src/ui/components/helpers/overlay-utils.ts` | **PASS** | Lines 44-53 |
| GameTable.vue imports `anchorAttrs` from `boardsmith/ui` | `go-fish/src/ui/components/GameTable.vue` | **PASS** | Line 5 in multi-import block |
| GameTable.vue: rank group `v-bind="anchorAttrs({ name: rank })"` | `go-fish/src/ui/components/GameTable.vue` | **PASS** | Line 521 |
| GameTable.vue: individual card `v-bind="anchorAttrs({ id: card.id, name: \`${card.rank}${card.suit}\` })"` | `go-fish/src/ui/components/GameTable.vue` | **PASS** | Line 528 |
| Checkers uses GridBoardRenderer (AutoUI) — notation automatic | Behavioral/architecture claim | UNVERIFIABLE from this review (no GridBoardRenderer file read) | Not falsified |
| `~/BoardSmithGames/checkers/tests/tutorial.test.ts` exists | filesystem | **PASS** |  |
| `~/BoardSmithGames/go-fish/tests/tutorial.test.ts` exists | filesystem | **PASS** |  |
| `go-fish/tests/tutorial.test.ts` walks ask-for-rank → turn-continuation → book-formed | `go-fish/tests/tutorial.test.ts` | **PASS** | Lines 78-104 |
| Section 7 code comment on `target: { value: 2 }` — see MISMATCH 1 above | `src/engine/tutorial/gate.ts` | **MISMATCH** | Comment says "primitive number wrapped in { value }"; actual matching is field equality on a choice object |

---

### docs/README.md Link Check

| Claim | Source file | Result |
|---|---|---|
| README.md links `Teaching & Tutorials` to `./teaching-and-tutorials.md` | `docs/README.md` | **PASS** — line 16 |

---

## Coverage Summary (DOC-01..04)

| Requirement | Covered? | Sections |
|---|---|---|
| **DOC-01** — TutorialDefinition + start/advance/skip/exit lifecycle + action gating + annotation overlay targets (cell/piece/card/panel/action) | Yes | Sections 1 (all subsections) |
| **DOC-02** — predicate triggers + simulateTutorial/assertTutorialCompletes CI + green→red demonstration | Yes | Sections 2 and 3 |
| **DOC-03** — move hint + narrated demo + heatmap (board-only explicitly noted) + teachingDisabled lockout + .help() action help | Yes | Sections 4, 5, 6 |
| **DOC-04** — checkers + go-fish worked examples side-by-side + anchorAttrs parity path (board-square notation vs card name; custom UI must emit anchorAttrs; AutoUI automatic) | Yes | Section 7 |

---

## Mismatch Summary (Actionable Fix List)

### MISMATCH 1 — Section 7, go-fish gate code comment (doc line ~562)

**File to fix:** `docs/teaching-and-tutorials.md`

**Current:**
```typescript
target: { value: 2 },   // opponent (primitive number wrapped in { value })
```

**Correct:**
```typescript
target: { value: 2 },   // opponent at seat 2; { value, display } choice object — matched via field equality
```

**Why:** `target` is a choice object `{ value: 2, display: 'Player 2' }`, not a primitive. The `{ value: 2 }` matcher matches it via the general field-equality branch of `selectionMatchesValue`, not via the primitive `{ value }` branch. Section 1.3 of the same doc has the correct description. Section 7 contradicts it.

---

### MISMATCH 2 — Section 4, startDemo narrator description (doc line ~400)

**File to fix:** `docs/teaching-and-tutorials.md`

**Current:**
> Supply a custom `narrator` for games with rich arg types (objects, nested references) where the **default JSON formatting reads poorly**.

**Correct:**
> Supply a custom `narrator` for games with rich arg types (objects, nested references) where the default destination-extraction heuristic cannot produce a readable move description.

**Why:** The default narrator uses `describeMoveDestination(args)`, which explicitly avoids JSON and formats human-readable destination strings. The source code comment says "instead of dumping JSON" — meaning JSON was the *bad alternative being avoided*, not the default behavior. The doc inverts this.

---

## Files Verified

| File | Verified |
|---|---|
| `docs/teaching-and-tutorials.md` | Subject of verification |
| `docs/README.md` | Link confirmed |
| `src/engine/tutorial/types.ts` | All types verified |
| `src/engine/tutorial/gate.ts` | selectionMatchesValue, getGateReasonForValue |
| `src/engine/tutorial/predicates.ts` | afterFirstTurn, afterTurns, whenForced |
| `src/engine/index.ts` | Export of predicate helpers confirmed |
| `src/ui/composables/useBoardInteraction.ts` | anchorAttrs, matchesRef |
| `src/ui/components/helpers/overlay-utils.ts` | buildSelector |
| `src/session/game-session.ts` | All lifecycle/teaching methods, lockout message |
| `src/session/utils.ts` | buildActionMetadata help propagation |
| `src/engine/action/action-builder.ts` | .help() builder |
| `src/engine/action/types.ts` | ActionDefinition.help |
| `src/cli/commands/dev.ts` | --lock-teaching / lockTeaching / console message |
| `src/testing/index.ts` | simulateTutorial, assertTutorialCompletes, assertTutorialStep |
| `src/testing/test-game.ts` | tutorialSetup option |
| `~/BoardSmithGames/checkers/src/rules/tutorial.ts` | CHECKERS_TUTORIAL |
| `~/BoardSmithGames/checkers/src/rules/index.ts` | hintTargetFromMove |
| `~/BoardSmithGames/checkers/tests/tutorial.test.ts` | Green+red tests |
| `~/BoardSmithGames/go-fish/src/rules/tutorial.ts` | GO_FISH_TUTORIAL |
| `~/BoardSmithGames/go-fish/src/rules/ai.ts` | getGoFishHintTarget |
| `~/BoardSmithGames/go-fish/src/rules/index.ts` | hintTargetFromMove wiring |
| `~/BoardSmithGames/go-fish/src/ui/components/GameTable.vue` | anchorAttrs usage |
| `~/BoardSmithGames/go-fish/tests/tutorial.test.ts` | Green+red tests |
