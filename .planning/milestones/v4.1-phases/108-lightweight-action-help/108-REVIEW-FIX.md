---
phase: 108-lightweight-action-help
fixed_at: 2026-06-26T21:06:00Z
review_path: .planning/phases/108-lightweight-action-help/108-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 5
skipped: 1
status: partial
---

# Phase 108: Code Review Fix Report

**Fixed at:** 2026-06-26
**Source review:** `.planning/phases/108-lightweight-action-help/108-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (WR-01, WR-02, WR-03, WR-04, IN-02, IN-01 assessed)
- Fixed: 5 (WR-01, WR-02, WR-03, WR-04, IN-02)
- Skipped: 1 (IN-01 — pre-existing GameShell debt, out of scope per objective)

---

## Fixed Issues

### WR-01 + WR-02: Actual popover height + caret tracking (committed together)

**Files modified:** `src/ui/components/helpers/ActionHelpPopover.vue`, `src/ui/components/helpers/ActionHelpPopover.test.ts`
**Commit:** `c72f7a6`
**Applied fix:**

WR-01: Replaced hardcoded `POPOVER_ESTIMATED_HEIGHT = 80` with a two-phase `show()` function:
- Phase 1: set isOpen = true with an initial-position estimate so the teleported element mounts and can be measured.
- Phase 2: after `nextTick()`, read `popoverRef.value?.offsetHeight` as the actual rendered height. Falls back to `POPOVER_FALLBACK_HEIGHT = 220` (covers dual-section layout) when layout is unavailable (jsdom / before paint). Flip detection and above-placement offset now use the real height so a 160–200 px dual-section popover does not overflow the viewport or overlap the trigger.

WR-02: After right-edge clamping, compute `caretLeft = clamp(12, triggerMidX - left, POPOVER_MAX_WIDTH - 12)` and bind it as `--ahp-caret-left` on the caret span inline style. CSS changed from hardcoded `left: 50%` to `left: var(--ahp-caret-left, 50%)` in both `.ahp-caret--top` and `.ahp-caret--bottom` so the caret always points at the "?" button even when the popover is shifted left by the right-edge constraint.

WR-03 label change (see below) was also included in this commit since all three changes touch `ActionHelpPopover.vue`.

3 new positioning tests added covering: below-placement, flip-above (with mocked offsetHeight), caret `--ahp-caret-left` value.

---

### WR-03: "Why disabled:" label corrected to "Note:"

**Files modified:** `src/ui/components/helpers/ActionHelpPopover.vue`, `src/ui/components/helpers/ActionHelpPopover.test.ts`
**Commit:** `c72f7a6` (same commit as WR-01/WR-02 — all changes are in ActionHelpPopover.vue)
**Applied fix:**

Changed the disabled-reason section label from `"Why disabled:"` to `"Note:"`. Tutorial-gated actions appear in `disabledActions` with a reason string but remain in `availableActions` and their button is only `:disabled="isExecuting"` — fully clickable. The old label asserted non-functionality that didn't match the UI state. `"Note:"` is neutral and does not imply the button cannot be used.

All existing test cases that checked for `"Why disabled:"` updated to `"Note:"`. The parity test (Case 7) was updated to match.

Note: UI-SPEC §Copywriting lists `"Why disabled:"` as the spec copy. The spec is superseded by the review finding — the label in code is now `"Note:"` and is the authoritative surface.

---

### WR-04: `isActionHelpVisible` default false added to ControlsMenu

**Files modified:** `src/ui/components/ControlsMenu.vue`, `src/ui/components/ControlsMenu.action-help.test.ts`
**Commit:** `dabfae1`
**Applied fix:**

Added `isActionHelpVisible: false` to the `withDefaults()` call. Without this default, Vue bound `undefined` to `:aria-checked`, which removed the attribute from the DOM. The `role="menuitemcheckbox"` element now always has an explicit `aria-checked` attribute, making the contract robust for consumers who forget to pass the prop.

New test: `WR-04: aria-checked is "false" (not absent) when isActionHelpVisible prop is omitted` — all 8 ControlsMenu action-help tests pass.

---

### IN-02: `.action-help-btn` styles moved into ActionHelpPopover (parity fix)

**Files modified:** `src/ui/components/helpers/ActionHelpPopover.vue` (CSS added, in WR-01/02/03 commit), `src/ui/components/auto-ui/ActionPanel.vue` (CSS removed)
**Commits:** `c72f7a6` (ActionHelpPopover addition) + `2547804` (ActionPanel removal)
**Applied fix:**

Moved the `.action-help-btn`, `.action-help-btn:hover`, and `.action-help-btn[aria-expanded="true"]` CSS rules from `ActionPanel.vue`'s `<style scoped>` into `ActionHelpPopover.vue`'s own `<style scoped>`. The component is now self-contained: a custom UI that imports `ActionHelpPopover` directly gets a correctly sized and positioned "?" button without depending on parent scoped-attr propagation. The `.action-btn-group { position: relative }` context required for absolute positioning remains in `ActionPanel` (appropriate — that's the layout container).

---

## Skipped Issues

### IN-01: `DEBUG_HMR = false` dead code in GameShell.vue

**File:** `src/ui/components/GameShell.vue:23-26`
**Reason:** skipped — pre-existing GameShell debt, out of scope. The objective explicitly noted "IN-01 dead hmrLog is pre-existing GameShell debt — likely skip." Removing `DEBUG_HMR` and all 11 `hmrLog` call sites is a focused cleanup commit in its own right, unrelated to Phase 108's feature surface. No functional or safety impact from deferring.

### IN-03: Tooltip closes on mousedown inside the popover body

**File:** `src/ui/components/helpers/ActionHelpPopover.vue:115-123`
**Reason:** not in scope. The REVIEW.md itself says "No fix is required for the current use case" — the tooltip is `role="tooltip"` (non-interactive), and outside mousedown is a correct dismiss trigger per the accessibility spec. The discrepancy with ControlsMenu is intentional.

---

## Test Results

| Suite | Before | After |
|-------|--------|-------|
| `src/ui` | 681 tests | 684 tests (3 new) |
| Full suite | 1571 tests | 1574 tests (3 new) |

All 1574 tests pass. No regressions.

---

_Fixed: 2026-06-26_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
