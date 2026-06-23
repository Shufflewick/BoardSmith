---
phase: 97-quick-wins-wave-0
plan: 01
subsystem: ui
tags: [a11y, error-ux, mobile-viewport, dead-code, toast, aria]
dependency_graph:
  requires: []
  provides: [QUICK-01, QUICK-02, QUICK-03, QUICK-04, QUICK-05]
  affects: [GameShell.vue, ActionPanel.vue, HamburgerMenu.vue, GameHeader.vue]
tech_stack:
  added: []
  patterns:
    - toast.error(result.error || fallback) for player-facing errors
    - aria-label + :aria-expanded + aria-controls on hamburger toggle
    - aria-hidden span wrapping decorative Unicode glyphs
    - 100vh fallback immediately before 100dvh (CSS cascade)
    - max(Npx, env(safe-area-inset-*)) for sticky/topmost chrome edges
    - viewport-fit=cover in HTML viewport meta
key_files:
  created:
    - src/ui/components/HamburgerMenu.test.ts
  modified:
    - src/ui/components/GameShell.vue
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/HamburgerMenu.vue
    - src/ui/components/GameHeader.vue
    - src/cli/dev-host/host.html
    - src/cli/lib/project-scaffold.ts
    - src/ui/components/auto-ui/ActionPanel.test.ts
decisions:
  - Inlined toast.error calls in GameShell (already has toast in scope) and ActionPanel (added import); skipped notifyError.ts helper since each call site has unique message and context making inline clearer
  - Added isExecuting=false verification from useActionController source — confirmed finally blocks at lines 850, 908, 982 reset isExecuting on all execute() paths; no manual reset needed in ActionPanel
  - Used vi.hoisted() pattern for useToast mock in ActionPanel.test.ts to ensure mock factory runs before module imports
metrics:
  duration: ~15 minutes
  completed: 2026-06-23
  tasks_completed: 5
  tasks_total: 5
  files_changed: 7
  files_created: 1
---

# Phase 97 Plan 01: Quick Wins Wave 0 Summary

**One-liner:** Five surgical Wave-0 fixes: toast.error replaces alert()/silent swallows, ARIA names added to all icon-only controls, dead Settings/Help items and BS branding removed, 100dvh fallbacks added to all 4 shell heights, safe-area-inset paddings applied to sticky action bar and topmost header with viewport-fit=cover in both engine HTML files.

## What Was Built

### QUICK-01 — Visible error feedback (GameShell.vue + ActionPanel.vue)

Replaced all 5 `alert()` calls in GameShell.vue with `toast.error()` carrying actionable messages (`err.message` from catch blocks, `result.error` where available, or a descriptive fallback string). Added `toast.error()` alongside 5 existing `console.error` calls at player-facing undo, setReady, and restartGame paths.

Added `import { useToast } from '../../composables/useToast'` and `const toast = useToast()` to ActionPanel.vue. Added `toast.error()` alongside the 3 player-facing `console.error` calls in `setSelectionValue` (fill rejection), `executeAction` success-false branch, and `executeAction` catch block.

All existing `console.error` calls preserved for diagnostics. Out-of-scope infrastructure `console.error` sites (lines 365, 383, 410, 549, 803, 956, 1003-1105, 1116) left unchanged per plan.

**Prove Before Fix:** Verified useActionController.ts lines 850, 908, 982 all reset `isExecuting = false` in `finally` blocks on every execute() code path, including the wizard-meta branch. No manual reset needed in ActionPanel after toast.

### QUICK-02 — Accessible names on icon-only controls (HamburgerMenu.vue + ActionPanel.vue)

HamburgerMenu hamburger button: added `aria-label="Open menu"`, `:aria-expanded="isOpen"`, `aria-controls="hamburger-menu-drawer"`. The `.bar` spans are CSS-drawn shapes (no text content), left without `aria-hidden` per spec.

Menu drawer element: added `id="hamburger-menu-drawer"` to exactly match `aria-controls`.

Close button: added `aria-label="Close menu"` and wrapped `X` character in `<span aria-hidden="true">`.

ActionPanel cancel button: added `aria-label="Cancel action"` and wrapped `✕` glyph in `<span aria-hidden="true">`.

ActionPanel clear-selection button: added `:aria-label="\`Clear ${key}\`"` (dynamic with selection name) and wrapped `✕` glyph in `<span aria-hidden="true">`.

No GameHeader.vue changes (zoom-reset button at line 58 shows `99%`-style text, not icon-only).

### QUICK-03 — Remove dead menu items and engine branding (HamburgerMenu.vue)

Reduced `defaultItems` from 6 entries to 2: removed `divider-1`, `settings`, `help`, `divider-2` together (removing settings/help alone would orphan both dividers).

Removed `<span class="logo-icon">BS</span>` from the logo block. Removed the now-dead `.logo-icon` CSS block (12 lines).

Removed the entire `<div class="drawer-footer">` block ("BoardSmith Dev Mode" version line). Removed the now-dead `.drawer-footer` and `.version` CSS blocks (9 lines).

### QUICK-04 + QUICK-05 — 100dvh fallbacks and safe-area insets (4 Vue SFCs + 2 HTML files)

Added 100dvh with 100vh fallback (100vh BEFORE 100dvh per cascade rule) to all 4 occurrences:
- GameShell.vue `.game-shell` min-height
- GameShell.vue `.game-shell--platform` height
- GameShell.vue `.game-shell__game` min-height
- HamburgerMenu.vue `.menu-drawer` height

Replaced `padding: 12px 15px` shorthand in `.game-shell__action-bar` with per-axis declarations using `max(Npx, env(safe-area-inset-*))` for bottom/left/right (top stays `12px` — bar doesn't touch top edge). Applied same to 768px desktop override.

Replaced `padding: 10px 12px` shorthand in `.game-header` with per-axis `max()` declarations for top/left/right. Applied same to 768px desktop override.

Appended `, viewport-fit=cover` to viewport meta `content` in both engine-controlled HTML files: `src/cli/dev-host/host.html` (line 5) and `src/cli/lib/project-scaffold.ts` generateIndexHtml() template (line 200).

### Task 5 — Component tests

Created `src/ui/components/HamburgerMenu.test.ts` (52 lines) with 4 jsdom component tests:
- Hamburger button aria-label + aria-expanded=false + aria-controls when closed
- aria-expanded=true after click
- Drawer id matches aria-controls when open
- Close button has aria-label

Extended `src/ui/components/auto-ui/ActionPanel.test.ts` with 3 new component tests:
- `fill()` rejection surfaces `toast.error` with the controller's error string
- `execute()` rejection surfaces `toast.error` with the controller's error string
- Cancel button has `aria-label="Cancel action"`

Used `vi.hoisted(() => vi.fn())` pattern for `useToast` mock to ensure factory runs before module imports. Existing `filterAnchoredChoices` (D-03) pure function tests unchanged.

## Commits

| Hash | Message |
|------|---------|
| 17c93e3 | feat(97-01): QUICK-01 visible error feedback via toast.error |
| 03fbc78 | feat(97-01): QUICK-02 accessible names on icon-only controls |
| 00c2ef9 | feat(97-01): QUICK-03 remove dead menu items and engine branding |
| 1f17b32 | feat(97-01): QUICK-04+05 100dvh fallbacks and safe-area insets |
| 8b99a11 | test(97-01): QUICK-01+02 a11y and toast.error component coverage |

## Verification

All plan acceptance criteria met:

| Criterion | Status |
|-----------|--------|
| `grep -rn "alert(" src/ui/components/GameShell.vue` returns nothing | PASS |
| ActionPanel.vue contains `import { useToast }` and `const toast = useToast()` | PASS |
| ActionPanel setSelectionValue, executeAction each call toast.error | PASS |
| Out-of-scope console.error sites remain console.error-only | PASS |
| HamburgerMenu hamburger has aria-label, aria-expanded, aria-controls | PASS |
| menu-drawer has id="hamburger-menu-drawer" | PASS |
| Close button has aria-label="Close menu" with X in aria-hidden span | PASS |
| Cancel button has aria-label="Cancel action" | PASS |
| defaultItems has only new-game and leave | PASS |
| No logo-icon/BoardSmith Dev Mode/drawer-footer in HamburgerMenu | PASS |
| 3 x 100vh immediately followed by 100dvh in GameShell | PASS |
| HamburgerMenu 100vh immediately followed by 100dvh | PASS |
| action-bar uses max()+env(safe-area-inset-*) for bottom/left/right | PASS |
| game-header uses max()+env(safe-area-inset-*) for top/left/right | PASS |
| viewport-fit=cover in host.html | PASS |
| viewport-fit=cover in project-scaffold.ts | PASS |
| `npx vitest run src/ui` passes (262 tests, 19 files) | PASS |

## Deviations from Plan

### Auto-decided: skip notifyError.ts helper

The plan listed `src/ui/utils/notifyError.ts` as optional ("Claude's Discretion — helper preferred") with "Inlining is acceptable only if it reads cleaner."

Each of the 13 call sites has a unique message string and different context (result object vs. caught Error vs. validation string), making a shared helper that takes a toast instance + different argument shapes more verbose than direct `toast.error()` calls. Inlining was chosen since it reads cleaner and produces no dead code.

## Known Stubs

None — all changes are complete implementations, not stubs.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes introduced. Error strings flowing to toast.error originate from engine result objects that are already player-facing. This is confirmed by the threat model (T-97-01: accepted, result.error strings are already player-facing).

## Self-Check: PASSED

Files verified to exist:
- src/ui/components/HamburgerMenu.test.ts ✓
- src/ui/components/GameShell.vue (modified) ✓
- src/ui/components/auto-ui/ActionPanel.vue (modified) ✓
- src/ui/components/HamburgerMenu.vue (modified) ✓
- src/ui/components/GameHeader.vue (modified) ✓
- src/cli/dev-host/host.html (modified) ✓
- src/cli/lib/project-scaffold.ts (modified) ✓

Commits verified to exist in git log:
- 17c93e3, 03fbc78, 00c2ef9, 1f17b32, 8b99a11 ✓
