---
phase: 108-lightweight-action-help
verified: 2026-06-27T21:09:00Z
status: human_needed
score: 3/3 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Open a game in the browser and hover over an action button that has .help() text — confirm the '?' affordance appears and clicking/hovering it reveals the help popover"
    expected: "Popover appears above/below the button with help text; caret points at the '?' button; popover dismisses on Escape/outside-click/mouse-leave"
    why_human: "Teleport-to-body positioning, caret tracking, and getBoundingClientRect-based layout cannot be verified under jsdom"
  - test: "Toggle 'Show action help' off in ControlsMenu, reload the page, confirm the affordance remains hidden; toggle it back on, confirm it reappears"
    expected: "localStorage key boardsmith_action_help persists the OFF state across reload; turning it ON restores all '?' affordances"
    why_human: "jsdom localStorage is cleared between tests; cross-reload persistence requires a real browser session"
  - test: "In a game with a touch device (or DevTools touch emulation), tap the '?' affordance — confirm the popover appears and tap-outside dismisses it"
    expected: "Touch tap toggles popover open; tapping elsewhere closes it; no long-press zoom conflict"
    why_human: "Touch event behaviour and potential conflict with useZoomPreview cannot be verified without a real touch session"
deferred: []
---

# Phase 108: Lightweight Action Help — Verification Report

**Phase Goal:** Authors can attach per-action help text that a player reveals on demand and toggles globally — building on the v2.8 disabled-reason "why-disabled" friction surface.
**Verified:** 2026-06-27T21:09:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A game author can call `.help(text)` on an action builder and it sets `ActionDefinition.help` | VERIFIED | `help(text: string): this` method at `action-builder.ts:105`; `help?: string` at `types.ts:460`; engine unit tests pass |
| 2 | Help text propagates verbatim into `ActionMetadata` for BOTH build paths (`buildActionMetadata` + `buildSingleActionMetadata`) | VERIFIED | `grep -c "help: actionDef.help" src/session/utils.ts` → 2; `session/types.ts:360` has `help?: string`; `useActionControllerTypes.ts:106` has `help?: string`; propagation integration tests pass |
| 3 | A player can reveal an action's help text on hover (pointer) or tap (touch) via a "?" affordance | VERIFIED (automated only) | `ActionHelpPopover.vue` exists (398 lines), contains `<Teleport to="body">` + `role="tooltip"` + `aria-expanded` toggle; wired into `ActionPanel.vue` with `v-if="isActionHelpVisible && (action.help \|\| disabledActions?.[action.name])"` at line 815; 22 component tests pass; HUMAN confirmation still needed for real pointer/touch behaviour |
| 4 | A player can toggle action help on/off globally; setting persists across actions and reloads | VERIFIED (automated only) | `GameShell.vue` has `getActionHelpEnabled()`/`setActionHelpEnabled()` helpers keyed `boardsmith_action_help` with try/catch + default true; `isActionHelpVisible` ref initialized from localStorage; 21 GameShell tests cover default-ON, stored-false, toggle-writes-localStorage; HUMAN confirmation still needed for cross-reload browser behaviour |
| 5 | `isActionHelpVisible` is threaded into BOTH AutoUI ActionPanel AND the `#game-board` custom-UI slot props (parity) | VERIFIED | `grep -c "is-action-help-visible" GameShell.vue` → 4 (ControlsMenu:1859, dev-switcher:1878, slot:1878, ActionPanel:1956); parity fixture test in `ActionHelpPopover.test.ts` (Case 7) asserts identical tooltip content in custom-UI-like div vs AutoUI-like td host; all pass |
| 6 | "Show action help" toggle visible in ControlsMenu Play group even without an AI player (`showHint` undefined) | VERIFIED | `ControlsMenu.vue:182-197` places the toggle before the `v-if="showHint !== undefined"` Teaching group; ControlsMenu action-help tests assert visibility with `showHint` undefined; `aria-checked` default `false` when prop omitted (WR-04 fix) |
| 7 | The previously-dead `disabledActions` reason is rendered via the same popover | VERIFIED | `ActionHelpPopover.vue` renders `disabledReason` under `"Note:"` label (WR-03 corrected from "Why disabled:"); `disabledActions` computed in `GameShell.vue:349` cast from broadcast state; threaded to `ActionPanel` at `GameShell.vue:1957` |

**Score:** 3/3 HELP must-haves verified (HELP-01: authoring + reveal surface; HELP-02: global toggle + persistence)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/engine/action/types.ts` | `help?: string` on ActionDefinition | VERIFIED | Line 460, display-only doc comment |
| `src/engine/action/action-builder.ts` | `.help(text: string): this` builder method | VERIFIED | Lines 101-107, mirrors `.prompt()` |
| `src/session/types.ts` | `help?: string` on ActionMetadata | VERIFIED | Line 360 |
| `src/session/utils.ts` | `help: actionDef.help` in both build functions | VERIFIED | 2 occurrences confirmed |
| `src/ui/composables/useActionControllerTypes.ts` | `help?: string` on UI ActionMetadata | VERIFIED | Line 106 |
| `src/session/action-help-propagation.test.ts` | Integration tests for both build paths | VERIFIED | Exists, covers both paths + undefined case |
| `src/ui/components/helpers/ActionHelpPopover.vue` | Teleport-to-body popover, min 80 lines | VERIFIED | 398 lines; Teleport + role=tooltip + no v-html |
| `src/ui/components/helpers/ActionHelpPopover.test.ts` | 22 tests including parity fixture | VERIFIED | 22 tests passing, Case 7 is parity test |
| `src/ui/components/auto-ui/ActionPanel.vue` | `.action-btn-group` + ActionHelpPopover wired | VERIFIED | `ActionHelpPopover` count=2 (import + usage); `action-btn-group` in template + CSS |
| `src/ui/components/ControlsMenu.vue` | `help-toggle` emit + `isActionHelpVisible` prop | VERIFIED | `help-toggle` in emit union; `isActionHelpVisible` prop at line 43; toggle in Play group |
| `src/ui/components/ControlsMenu.action-help.test.ts` | Toggle tests (non-AI, emit, aria-checked) | VERIFIED | 8 tests passing |
| `src/ui/components/GameShell.vue` | localStorage helpers + dual-path wiring | VERIFIED | `boardsmith_action_help` key; 4 occurrences of `is-action-help-visible` |
| `src/ui/components/GameShell.action-help.test.ts` | 21 tests for persistence + parity | VERIFIED | 21 tests passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `action-builder.ts` | `ActionDefinition.help` | `.help()` assigns `this.definition.help` | WIRED | Line 106: `this.definition.help = text` |
| `session/utils.ts` | `ActionDefinition.help` | `help: actionDef.help` in both build functions | WIRED | 2 occurrences confirmed |
| `ActionPanel.vue` | `ActionHelpPopover.vue` | import + render per action | WIRED | 2 `ActionHelpPopover` references in ActionPanel |
| `ControlsMenu.vue` | `GameShell handleTeachingAction` | emit `teaching-action` `'help-toggle'` | WIRED | `emit('teaching-action', 'help-toggle')` at line 188 |
| `GameShell.vue` | `localStorage` | `getActionHelpEnabled`/`setActionHelpEnabled` keyed `boardsmith_action_help` | WIRED | Lines 100-113 |
| `GameShell.vue` | ActionPanel + `#game-board` slot | `:is-action-help-visible` threaded to 4 binding sites | WIRED | Lines 1859, 1878, 1918, 1956 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ActionHelpPopover.vue` | `helpText`, `disabledReason` | Props from `ActionPanel`; data originates in `ActionDefinition.help` (engine) and `disabledActions` (session broadcast) | Yes — engine author string + server broadcast | FLOWING |
| `GameShell.vue` | `isActionHelpVisible` | `ref(getActionHelpEnabled())` reads `localStorage.getItem('boardsmith_action_help')` | Yes — real localStorage read with default | FLOWING |
| `GameShell.vue` | `disabledActions` | Computed from `(state.value?.state as any)?.disabledActions` | Yes — session broadcast state | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `.help()` builder sets field | `npx vitest run src/engine/action/action.test.ts` | 199 tests pass | PASS |
| Help propagates through both session build paths | `npx vitest run src/session/action-help-propagation.test.ts` | 199 tests pass (combined run) | PASS |
| ActionHelpPopover renders help + disabled-reason correctly | `npx vitest run src/ui/components/helpers/ActionHelpPopover.test.ts` | 22 tests pass | PASS |
| ActionPanel wires affordance with correct visibility gating | `npx vitest run src/ui/components/auto-ui/ActionPanel.test.ts` | 22 tests pass | PASS |
| ControlsMenu toggle visible in non-AI games, emits help-toggle | `npx vitest run src/ui/components/ControlsMenu.action-help.test.ts` | 8 tests pass | PASS |
| GameShell localStorage persistence + dual-path parity | `npx vitest run src/ui/components/GameShell.action-help.test.ts` | 21 tests pass | PASS |
| Full suite — no regressions | `npx vitest run` | 1574 tests, 120 files, 0 failures | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| HELP-01 | Plans 01 + 02 | Author attaches help text; player reveals on hover/tap | SATISFIED | `.help()` builder + ActionHelpPopover + ActionPanel wiring |
| HELP-02 | Plan 03 | Player toggles action help globally; persists | SATISFIED | ControlsMenu toggle + GameShell localStorage + dual-path slot threading |

No orphaned requirements: REQUIREMENTS.md maps HELP-01 and HELP-02 to Phase 108 only. Both are covered.

### Anti-Patterns Found

No `TBD`, `FIXME`, or `XXX` markers found in any file modified by this phase. No `v-html` in `ActionHelpPopover.vue` (count = 0). No stub return patterns in phase-delivered code.

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | — |

### Human Verification Required

Phase passes all automated checks (1574/1574). Three items require human confirmation in a real browser session:

#### 1. Pointer Hover + Touch Tap Reveal

**Test:** Open a game with an action that has `.help()` text. Hover the "?" affordance with a pointer; then on a touch device (or DevTools touch emulation) tap the "?" affordance.
**Expected:** Popover appears, caret points at the trigger button, text renders correctly. Popover dismisses on mouse-leave (pointer) and tap-outside (touch). No interference from `useZoomPreview` long-press.
**Why human:** `getBoundingClientRect` returns all zeros in jsdom. Touch event sequencing and the zoom-preview interaction cannot be verified without a real browser/device.

#### 2. Cross-Reload localStorage Persistence

**Test:** Toggle "Show action help" OFF in ControlsMenu. Reload the browser tab. Confirm affordances remain hidden. Toggle back ON, confirm they reappear.
**Expected:** The `boardsmith_action_help` key survives a full page reload; default-ON applies on first visit.
**Why human:** jsdom localStorage is per-test-instance and cleared in `beforeEach`. Actual cross-reload storage durability requires a live browser session.

#### 3. Popover Position Near Viewport Edge

**Test:** Open a game, scroll an action button to near the bottom of the viewport, then reveal the help popover.
**Expected:** Popover flips above the trigger (not below into the scroll-hidden area); caret tracks to point at the "?" button even when the popover is shifted left by the right-edge clamp.
**Why human:** The WR-01/WR-02 review fixes (actual offsetHeight measurement + caret CSS custom property) improved positioning logic. The jsdom `offsetHeight` always returns 0 (tests use the 220 px fallback). Visual correctness of the flip + caret position requires a real browser paint.

*Note from phase context:* The CONTEXT.md documents that pointer-vs-touch confirmation and cross-reload browser verification are explicitly deferred to Phase 110 (DEMO-01). These are known deferred items, not newly discovered gaps.

### Gaps Summary

No gaps. All must-haves are fully implemented and wired. The three human verification items above are browser-confirmation deferrals documented in the phase's CONTEXT.md and align with the Phase 110 (DEMO-01) milestone gate. There are no blockers to proceeding to Phase 109.

---

_Verified: 2026-06-27T21:09:00Z_
_Verifier: Claude (gsd-verifier)_
