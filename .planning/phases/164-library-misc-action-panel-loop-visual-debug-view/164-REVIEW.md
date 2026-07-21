---
phase: 164-library-misc-action-panel-loop-visual-debug-view
reviewed: 2026-07-21T20:21:17Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - src/engine/flow/builders.ts
  - src/engine/flow/engine.ts
  - src/engine/flow/types.ts
  - src/ui/utils/color-contrast.ts
  - src/engine/action/action-builder.ts
  - src/engine/action/types.ts
  - src/engine/element/action-metadata.ts
  - src/session/types.ts
  - src/ui/components/auto-ui/ActionPanel.vue
  - src/ui/components/GameShell.vue
  - src/ui/composables/useBoardActionBridge.ts
  - src/ui/components/PlayerToken.vue
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: resolved
---

> **Fix status (2026-07-21):** CR-01, CR-02, WR-01, WR-02, WR-03, and IN-02 are
> fixed and committed (see `164-REVIEW-FIX.md` for the per-finding commit
> list). IN-01 was intentionally left unfixed per its own "optional cleanup,
> not worth a dedicated change" framing (inert stale name in a pre-existing
> test harness, out of scope).

# Phase 164: Code Review Report

**Reviewed:** 2026-07-21T20:21:17Z
**Depth:** deep
**Files Reviewed:** 12
**Status:** findings

## Summary

Reviewed the LIBX-02 loop-valve, LIBX-03 contrast helper, LIBX-01 dock-suppression
metadata channel, and LIBX-04 time-travel commit guards. The loop-valve
(`unbounded: true`) is correctly implemented: it bypasses the per-loop cap while
the whole-flow tripwire (reset per `run()` invocation, i.e. per synchronous burst
between player inputs) still fires — no process-hang path found, and the docs
accurately describe this nuance.

The most serious finding is that **LIBX-04's "never commit to the live engine
while viewing history" guarantee is incomplete**: it is enforced only on the four
board-click mutators in `useBoardActionBridge.ts`, but the auto-UI `ActionPanel`
drives selections and auto-execution through a completely separate,
unguarded path (`actionController.fill()` / the controller's internal
`watch(isReady, ...)` auto-execute watcher / `executeCurrentAction()`), none of
which check `isViewingHistory`. A pick started (or continued) while the debug
panel is time-traveling can still commit to the live engine. This directly
contradicts the invariant documented in `useBoardActionBridge.ts` itself
("Board clicks must never commit to the live engine while this is true") and in
the LIBX-04 test suite's own framing of the problem — the test suite covers only
the board-click substrate, not the ActionPanel/auto-execute substrate, so the gap
shipped untested.

A second correctness gap: LIBX-03's `contrastInk()` intentionally throws on any
color string that isn't `#rgb`/`#rrggbb`/`rgb()`/`rgba()` — a deliberate,
well-documented Pit-of-Success choice for `contrastInk()` itself — but
`PlayerToken.vue` calls it unguarded (no try/catch) with `props.color`, which is
a plain `string` at the public `createColorOption()` API boundary. Any custom
game that supplies a CSS named color (`'crimson'`), `hsl()`, or any other valid
CSS color string that isn't hex/`rgb()` will crash `PlayerToken`'s render
(an uncaught throw inside a Vue `computed`), not just fail to compute contrast.

Also flagged: an accessibility regression in the LIBX-01 dock-suppression logic
(the ActionPanel's keyboard/SR "operable button list" safety net is fully
unmounted, not just the dock button, when every available action is
`suppressFromDock` — including during an in-progress pick on such an action) and
a `displayedState` shape gap where `flowState` still reflects live data during
time-travel.

## Critical Issues

### CR-01: LIBX-04 time-travel commit guard does not cover the ActionPanel / auto-execute path

**File:** `src/ui/components/auto-ui/ActionPanel.vue:690-728` (setSelectionValue),
`src/ui/components/auto-ui/ActionPanel.vue:638-664` (startAction),
`src/ui/composables/useActionController.ts:873-892` (auto-execute watch),
`src/ui/composables/useActionController.ts:997-1050` (executeCurrentAction)

**Issue:** `useBoardActionBridge.ts` was correctly updated (LIBX-04/D31) to guard
its four mutators (`startAction`, `executeAction`, `setSelectionValue`,
`toggleMultiSelectValue`) with `if (isViewingHistory.value) return;`. But that
composable only feeds the **board substrate**. `ActionPanel.vue` talks to
`actionController` directly through its own `startAction`/`setSelectionValue`/
`toggleMultiSelectValue`/`cancelAction` functions, none of which receive or
check `isViewingHistory` — only `executeAction()` (ActionPanel.vue:730) checks
`props.isMyTurn`, which GameShell does correctly wire as `isMyTurn &&
!isViewingHistory`.

However, `actionController.fill()` (called from `setSelectionValue`) can make
`isReady` become true, which fires the controller's own internal
`watch(isReady, ...)` (`useActionController.ts:873`). That watcher calls
`executeCurrentAction()` (`useActionController.ts:997`) directly — a completely
separate commit path from ActionPanel's `executeAction()`/`props.isMyTurn`
check, and from `useBoardActionBridge`'s guards. `executeCurrentAction()` has no
`isMyTurn`/`isViewingHistory` awareness at all; it sends the action straight to
the server.

Reproduction path:
1. Player starts a multi-selection action (dock button or board click) —
   `currentAction`/`currentPick` become populated on the shared
   `actionController` (a singleton, independent of `GameShell`'s
   `isViewingHistory`-derived props).
2. Player opens the debug panel and time-travels to a past action index (nothing
   in `DebugPanel.vue` blocks entering time-travel while a pick is in progress).
3. `GameShell` now passes `:available-actions="isViewingHistory ? [] : ..."` and
   `:action-metadata="isViewingHistory ? {} : ..."` to `ActionPanel`, but
   `ActionPanel`'s `currentActionMeta`/`currentPick` computeds
   (`ActionPanel.vue:172-188`) deliberately bypass those emptied props and read
   `actionController.actionSnapshot`/`currentPick` directly — by design, to
   support follow-up actions not present in `availableActions`. The
   in-progress pick's choice buttons remain rendered and clickable.
4. Clicking a remaining choice calls `setSelectionValue` →
   `actionController.fill()` (unguarded). If that fill completes the last
   selection, `isReady` flips true and the controller's own watcher calls
   `executeCurrentAction()` — committing the action to the live engine while
   the board is showing historical state.

This is only reachable behind `isDevBuild` (DebugPanel is gated
`v-if="debugMode && platformMode && isDevBuild"`), so it is not a production
data-integrity risk for end players, but it is exactly the developer-facing
debugging scenario LIBX-04 exists to protect — a developer inspecting history
mid-pick can silently corrupt the live session they're debugging, with no
error, no warning, and no indication the commit happened against live rather
than historical state.

**Fix:** Thread `isViewingHistory` into `ActionPanel` (or, better, have
`useActionController` itself accept/consume an `isViewingHistory` ref and gate
`fill()`, `toggleMultiSelect()`, `start()`, and the auto-execute watch —
`options.isViewingHistory` alongside the existing `options.pickStep` pattern)
so the guarantee lives at the one shared chokepoint every commit path already
funnels through, instead of being re-implemented per caller:

```typescript
// useActionController.ts
watch(isReady, async (ready) => {
  if (ready && getAutoExecute() && currentAction.value && !isExecuting.value
      && !pendingOnServer.value && !isViewingHistory?.value) {
    ...
    executeCurrentAction();
  }
});

async function fill(selectionName: string, rawValue: unknown): Promise<ValidationResult> {
  if (isViewingHistory?.value) {
    const error = 'Cannot select while viewing historical state.';
    setError(error);
    return { valid: false, error };
  }
  ...
```

Also consider disabling entry into time-travel (or auto-cancelling the
in-progress pick) from `DebugPanel.vue` while `currentAction` is set, as a
second layer of defense.

---

### CR-02: `contrastInk()` crashes `PlayerToken` render for any non-hex/rgb color string, which the public API allows

**File:** `src/ui/utils/color-contrast.ts:97-108`, `src/ui/components/PlayerToken.vue:63`

**Issue:** `contrastInk()` is deliberately fail-loud for unparseable input (good
— see its own docstring: "fails loud (throws) on anything else rather than
silently guessing wrong contrast"). But its caller, `PlayerToken.vue:63`
(`computed(() => (props.color ? contrastInk(props.color) : DEFAULT_INK))`),
only special-cases the *absent* color (falls back to `DEFAULT_INK`) — it does
not guard against a *present-but-unsupported-format* color. `props.color` is
typed as a plain `string` (`PlayerToken.vue:35`), and the public
`createColorOption()` API (`src/session/colors.ts`) accepts any
`{ value: string; label: string }[]` for a game's custom player-color palette
with no format validation and no documentation restricting values to hex.
Any custom game author who supplies a CSS named color (`'crimson'`,
`'tomato'`), `hsl()`/`hwb()`/`lab()`, or any other legal CSS color string that
isn't `#rgb`/`#rrggbb`/`rgb()`/`rgba()` will trigger an uncaught throw inside a
Vue `computed` on every `PlayerToken` render for that player — crashing the
players panel / rail / turn indicator, not just degrading contrast.

This is a real regression risk introduced by this phase: before LIBX-03,
`PlayerToken` always rendered white ink unconditionally: an unsupported color
degraded silently to slightly-poor contrast; now it can crash the surrounding
component tree. Only the "absent color" case is covered by
`PlayerToken.contrast.test.ts` — no test exercises a non-hex/rgb `color` prop.

**Fix:** Either validate/normalize at the `createColorOption()` boundary
(reject non-hex custom color values with an actionable error at game-definition
time — matches this phase's own "fail fast at construction, not deep in a
render" philosophy used for the loop valve), or make `PlayerToken` degrade to
`DEFAULT_INK` on a `contrastInk()` throw instead of letting it propagate:

```typescript
const ink = computed(() => {
  if (!props.color) return DEFAULT_INK;
  try {
    return contrastInk(props.color);
  } catch {
    return DEFAULT_INK;
  }
});
```
Prefer the construction-time validation — silently swallowing the throw inside
`PlayerToken` reintroduces exactly the "silently guessing wrong contrast"
failure mode `contrastInk()`'s own docstring says it was designed to avoid.

## Warnings

### WR-01: `allDockActionsSuppressed` removes ActionPanel's keyboard/SR fallback, contradicting the A11Y C-2 guarantee documented three lines above it

**File:** `src/ui/components/GameShell.vue:438-448`, `src/ui/components/GameShell.vue:2464-2471`

**Issue:** The template comment directly above the `ActionPanel` mount gate
states: "That focusable list is the keyboard/SR safety net (A11Y C-2): the
panel is never fully removed while a pick has choices, so custom UIs whose
board isn't keyboard-operable still expose an operable control." The very next
line gates `ActionPanel` on `!props.platformActionPanelEscapeHatch &&
!allDockActionsSuppressed`. `allDockActionsSuppressed` is true whenever *every
currently available action* has `suppressFromDock: true` — which, per
`action-builder.ts`'s own docstring, is exactly the case for "actions the game
exposes exclusively through a custom board interaction (e.g. drag-drop,
click-to-select)". If a player starts (or is mid-way through) exactly such an
action, `ActionPanel` — including its anchored-choices operable button list —
is now fully unmounted, and only a static text prompt (`<span class="turn">`)
remains. A keyboard-only or screen-reader user has no operable control to
finish a `suppressFromDock` action if the underlying board widget (e.g.
drag-drop) isn't itself keyboard-operable — precisely the scenario the removed
safety net existed for.

This is a tested/intentional tradeoff (see
`GameShell.action-panel-suppression.test.ts`), not an oversight, but it
silently drops an accessibility guarantee that's explicitly documented
elsewhere in the same file as load-bearing.

**Fix:** Keep `ActionPanel` mounted (rendering just its anchored-choices/`Done`
fallback, no dock buttons) whenever a pick is actively in progress
(`actionController.currentAction` is set), even if that action's own metadata
is `suppressFromDock`, and only collapse to the turn-strip-only rendering when
there is no in-progress pick. Alternatively, explicitly document (in
`.suppressFromDock()`'s own docstring, not just inferred from a template
comment written for a different code path) that authors are responsible for
providing a keyboard-accessible alternative to any suppressed action's custom
board widget.

---

### WR-02: `displayedState` leaves `flowState` pointing at live data during time-travel

**File:** `src/ui/components/GameShell.vue:497-509`

**Issue:** `displayedState` re-wraps the historical `PlayerGameState` as
`{ ...state.value, state: timeTravelState.value }` — this replaces only the
`.state` field; `flowState`, `playerSeat`, and `isSpectator` all remain from
the **live** `state.value`. `GameState.flowState` (per
`src/client/types.ts:174`) carries "turn info, available actions" — i.e.
exactly the fields most likely to be read by a custom UI's own board component
for "whose turn"/"what can I do" rendering. Any custom UI that reads
`props.state.flowState` directly (rather than the separately-passed, correctly
`isViewingHistory`-gated `availableActions`/`isMyTurn` props GameShell already
computes for the auto-UI `ActionPanel`) will render live turn/availability
info superimposed on a historical board — an inconsistent, confusing
combination for exactly the debugging workflow LIBX-04 targets.

This is a real gap, though a hard constraint: `DebugPanel.vue`'s own
historical-state fetch only returns a raw `PlayerGameState` with no
accompanying historical `flowState` (`DebugPanel.vue:1330-1334` — its own
internal state view null's out `flowState` for this exact reason:
`{ state: historicalState.value, flowState: null }`), so there's no historical
flow data to substitute. But `displayedState`'s doc comment doesn't call out
this residual staleness at all, and null'ing it out (matching `DebugPanel`'s
own precedent one file over) would at least make the gap loud/absent instead
of silently wrong.

**Fix:** Null out (or otherwise clearly mark stale) `flowState` in
`displayedState` during time-travel, consistent with `DebugPanel.vue`'s own
`{ state: historicalState.value, flowState: null }` precedent, and document
the limitation explicitly in the comment above `displayedState`.

---

### WR-03: `parseColor`'s `rgb()`/`rgba()` regex accepts out-of-gamut channel values with no range validation

**File:** `src/ui/utils/color-contrast.ts:31, 54-61`

**Issue:** `RGB_FN = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)$/i` matches any digit sequence per channel with no `0-255` bound — `rgb(999, 999, 999)` parses successfully (`Number('999')`) instead of throwing per the function's own "fails loud on anything else" contract. This produces `channel / 255 > 1` in `srgbChannelToLinear`, an out-of-spec linear value fed into the WCAG luminance formula. In practice this still resolves to *some* ink choice (extreme luminance saturates toward one end), so it's unlikely to silently produce a *wrong* answer for realistic accidental typos (e.g. `rgb(2555,0,0)`), but it is a real gap in the "fail loud on anything else" guarantee the function's own docstring promises, and out-of-range CSS color values are a plausible authoring typo (e.g. an extra digit).

**Fix:** Clamp-reject out-of-range channels explicitly:
```typescript
const [r, g, b] = [rgbFn[1], rgbFn[2], rgbFn[3]].map(Number);
if ([r, g, b].some(c => c > 255)) {
  throw new Error(`contrastInk: rgb()/rgba() channel out of range (0-255) in "${input}".`);
}
```

## Info

### IN-01: Stale `suppressActionPanel` name survives in an untouched pre-existing test harness

**File:** `src/ui/components/GameShell.ia.test.ts:35,45,58`

**Issue:** These are the 2 stray non-test-file-scope matches of the removed
`suppressActionPanel` prop name. Both are inert: one
(`GameShell.action-panel-suppression.test.ts:155`) is an intentional negative
assertion (`expect(gameShellSource.includes('suppressActionPanel')).toBe(false)`)
verifying the rename landed — not a defect. The other
(`GameShell.ia.test.ts`) is a self-contained mock harness component (its own
local `defineComponent` with its own `suppressActionPanel` prop, default
`false`, never toggled true in that file) that doesn't reference the real,
renamed `GameShell.vue` prop at all — functionally inert, not a silent no-op
of real behavior. It's pre-existing (not touched by this phase's diff) and
will read as confusingly stale to a future maintainer scanning for the old
name, but is not a real defect.

**Fix:** Optional cleanup — rename the harness's local prop to
`platformActionPanelEscapeHatch` for consistency next time that file is
touched; not worth a dedicated change on its own.

---

### IN-02: `unbounded: true` + an explicit `maxIterations` silently prefers `maxIterations` with no warning

**File:** `src/engine/flow/builders.ts:96-99`, `src/engine/flow/engine.ts:1274`

**Issue:** `loop({ unbounded: true, maxIterations: 50, ... })` is accepted by
the construction-time guard (`config.maxIterations === undefined &&
!config.unbounded` — false, since `maxIterations` is defined) and silently
resolves to the bounded behavior (`config.maxIterations ?? ...` takes the
`50`), with `unbounded: true` becoming a silent no-op. This isn't unsafe — the
cap still fires as expected — but it's a confusing combination a game author
could write by mistake (e.g. leftover `maxIterations` from before adding
`unbounded: true`) with no diagnostic telling them the two options conflict.

**Fix:** Either throw at construction time when both are set
(`config.unbounded && config.maxIterations !== undefined`), or emit a
`devWarn` noting `maxIterations` takes precedence and `unbounded` is a no-op.

---

_Reviewed: 2026-07-21T20:21:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
