---
phase: 112-go-fish-tutorial-content
reviewed: 2026-06-30T00:00:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - /Users/jtsmith/BoardSmith/src/engine/tutorial/gate.ts
  - /Users/jtsmith/BoardSmith/src/engine/tutorial/gate.test.ts
  - /Users/jtsmith/BoardSmith/src/engine/tutorial/types.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/game.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/tutorial.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/src/rules/index.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/src/ui/components/GameTable.vue
  - /Users/jtsmith/BoardSmithGames/go-fish/tests/tutorial-preset.test.ts
  - /Users/jtsmith/BoardSmithGames/go-fish/tests/tutorial.test.ts
findings:
  critical: 0
  warning: 4
  info: 1
  total: 5
status: issues_found
---

# Phase 112: Code Review Report

**Reviewed:** 2026-06-30T00:00:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 112 delivers the Go Fish tutorial content: the `{value}` primitive-matcher fix in `gate.ts`, four tutorial steps in `tutorial.ts`, the deterministic `resetToTutorialPreset` path in `game.ts`, `anchorAttrs` on hand cards in `GameTable.vue`, and test coverage in two new test files. The engine logic and tutorial flow are sound. All four teaching beats are reachable and the preset is correctly established.

Four issues surface on closer inspection. One is a dead-code function in `gate.ts` that was never wired up. One is a test calling `getGateReasonForValue` with the wrong number of arguments — a TypeScript compile error masked by an early return. Two are in `GameTable.vue`: the `Player` interface mis-declares the player seat field, and the opponent-hand `selected` class comparison compares a full choice object against a seat number and is therefore always false, silently breaking the selection highlight.

No security vulnerabilities or data-loss risks were found. Tests are green because none of the failing paths are exercised by the test suite's direct-action pathway.

## Warnings

### WR-01: `gateValuesEqual` is dead code — defined but never called

**File:** `/Users/jtsmith/BoardSmith/src/engine/tutorial/gate.ts:35`
**Issue:** `gateValuesEqual` is a 13-line helper that performs structural equality with a JSON fallback. It is defined at module scope but is never called anywhere — not in this file and not in any other source file in the project. `selectionMatchesValue` (the only function that could reasonably use it) instead uses direct `===` comparisons. The function adds dead weight, risks future confusion about whether it is intended to be a replacement for the inline comparisons, and may have been scaffolded for a code path that was later simplified.
**Fix:** Delete lines 34–47. If structural-equality semantics are ever needed for nested matcher values, introduce the helper at that point with a call site.

---

### WR-02: `getGateReasonForValue` called with 3 arguments in test — missing required `selectionName`

**File:** `/Users/jtsmith/BoardSmith/src/engine/tutorial/gate.test.ts:168`
**Issue:** The test `'does not apply per-value gating for labeled-condition gates'` calls:
```ts
const reason = getGateReasonForValue(step, 'move', 'a');
```
The function signature requires four arguments: `(step, actionName, value, selectionName)`. The fourth argument `selectionName: string` is omitted. TypeScript would reject this at compile time (`tsc` is not run as a gate for this project, so the error is not caught). The call still returns `null` at runtime only because the labeled-predicate branch fires the early-return at line 162 before `selectionName` is ever read. The test therefore passes vacuously rather than actually exercising the `selectionName` code path it claims to test.
**Fix:**
```ts
const reason = getGateReasonForValue(step, 'move', 'a', 'dest');
```
Any non-empty string works for `selectionName` here because the gate is a labeled-predicate (not an allow-list), so the function returns `null` regardless of the name. Supplying the argument makes the call type-correct and removes the latent compile error.

---

### WR-03: `currentArgs.target === opponent.seat` always false — opponent "selected" highlight never shows

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/src/ui/components/GameTable.vue:582`
**Issue:** When the learner clicks an opponent's hand, `handleOpponentClick` (line 330–341) calls:
```ts
await props.actionController.fill('target', playerChoice.value);
```
`playerChoice.value` is the full player-choice object — e.g. `{ value: 2, display: 'Bob' }` — not the seat number alone. `currentArgs.target` is therefore set to that object. The template then checks:
```vue
:class="{ 'selected': currentArgs.target === opponent.seat }"
```
`opponent.seat` is a number (e.g. `2`). `{ value: 2, display: 'Bob' } === 2` is always false. The `selected` CSS class is never applied, so the learner receives no visual confirmation that they have chosen an opponent. The functional `fill` call still executes correctly; only the visual feedback is broken. The tutorial test bypasses UI click handlers entirely (`simulateTutorial` uses `args` directly), so this is not caught by the green test suite.

Compare to the rank path (line 344–357): `fill('rank', rank)` correctly passes the raw string, and `currentArgs.rank === rank` correctly detects the selected state.

**Fix:** Use the nested `.value` field for the comparison, mirroring how `isOpponentHandSelectable` already extracts it:
```vue
:class="{ 'selectable': isOpponentHandSelectable(opponent.seat), 'selected': (currentArgs.target as any)?.value === opponent.seat }"
```
Or, symmetrically, pass only the seat number to `fill` and update `isOpponentHandSelectable` accordingly:
```ts
// In handleOpponentClick:
await props.actionController.fill('target', playerChoice.value);
// remains — but extract the seat for comparison:
```
```vue
:class="{ 'selected': (currentArgs.target as any)?.value === opponent.seat }"
```

---

### WR-04: `Player` interface declares `position` but code exclusively uses `seat`

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/src/ui/components/GameTable.vue:51`
**Issue:** The locally defined `Player` interface is:
```ts
interface Player {
  position: number;
  name: string;
}
```
The field `position` is never read anywhere in the component. Every access to the seat number on a player goes through an `(p: any)` cast to reach `p.seat` (line 122, 582) or uses a numeric literal index. The actual runtime `players` prop carries `seat`, not `position`. The interface therefore misleads: it describes a property that does not exist on the runtime value while hiding the property that does. Any developer adding code that reads `player.position` via the typed interface will silently get `undefined`.
**Fix:**
```ts
interface Player {
  seat: number;
  name: string;
}
```
Then remove the `(p: any)` casts and use `p.seat` directly. The filter on line 122 becomes:
```ts
return allPlayers.value.filter(p => p.seat !== props.playerSeat);
```

## Info

### IN-01: Gate on `go-fish-tip` step is unreachable — step auto-advances before any action

**File:** `/Users/jtsmith/BoardSmithGames/go-fish/src/rules/tutorial.ts:130`
**Issue:** Step `go-fish-tip` declares `gate: { action: 'ask' }`. However, the step's `advanceWhen` predicate (`pond.count < TUTORIAL_PRESET_POND_SIZE`) is already `true` at the moment the pump enters this step (step 2's `advanceWhen` required the same condition to be true before advancing). The pump therefore immediately advances through step 3 to step 4 without the learner taking any action. The `gate` declaration on step 3 is never enforced by the engine. This is documented in the step's inline comment ("Fires immediately via pump"), but the gate declaration is still present and will mislead future authors who read the step and assume it governs an interaction.
**Fix:** Add a comment making explicit that the gate is a placeholder (not enforced) because the step auto-advances, or replace it with a predicate gate that is vacuously true:
```ts
{
  id: 'go-fish-tip',
  // NOTE: this step auto-advances immediately via the post-action pump (advanceWhen
  // fires on entry). The gate is never enforced; it exists as a structural placeholder.
  gate: { action: 'ask' },
  ...
}
```

---

_Reviewed: 2026-06-30T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Resolution (2026-06-30)

- **WR-01 (dead `gateValuesEqual`)** — FIXED: removed the unused helper from `gate.ts` (pre-existing from Phase 109). BoardSmith 1708/1708 green.
- **WR-02 (vacuous gate test)** — FIXED: supplied the required 4th arg `selectionName: 'piece'` at `gate.test.ts:168` so the labeled-condition test exercises the real signature. gate suite 15/15 green.
- **WR-03 (opponent "selected" never applied)** — FIXED: `GameTable.vue` now compares `(currentArgs.target as any)?.value === opponent.seat` (the choice object's seat), so the selected-opponent highlight applies during an ask. go-fish 48/48 green.
- **WR-04 (Player interface `position` drift)** — NOTED, not fixed: pre-existing interface/`any`-cast drift unrelated to this phase; fixing would cascade through cast sites for marginal benefit. Candidate for a future go-fish cleanup pass.
- **IN-01 (dead gate on `go-fish-tip`)** — NOTED: the `gate: { action: 'ask' }` is never enforced because the step auto-advances (the known instant-auto-advance DSL characteristic, also tracked in R-05). Left in place with its explanatory comment; removing risks the CI walkthrough for no behavioral gain.
