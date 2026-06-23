---
phase: 101-accessibility-wcag-wave-4
plan: "08"
subsystem: ui
tags: [accessibility, wcag, focus-trap, aria-modal, dialog, keyboard-nav]
dependency_graph:
  requires: [101-01]
  provides: [A11Y-07, A11Y-09]
  affects: [HamburgerMenu, ControlsMenu, GameOverCard]
tech_stack:
  added: []
  patterns: [useFocusTrap composable, inert-based focus isolation, Tab-cycle trapping]
key_files:
  created: []
  modified:
    - src/ui/components/HamburgerMenu.vue
    - src/ui/components/HamburgerMenu.test.ts
    - src/ui/components/ControlsMenu.vue
    - src/ui/components/GameOverCard.vue
    - src/ui/components/GameOverCard.test.ts
decisions:
  - "GameOverCard uses onMounted/onUnmounted to open/close the trap since the component is always visible when mounted"
  - "closeTrap() is called before isOpen.value=false in all close paths so the trap can capture the parentElement before DOM removal"
  - "openTrap() is called via nextTick after isOpen.value=true so the v-if renders before the trap tries to focus"
  - "ControlsMenu drops document-level Escape listener in favour of trap's @keydown binding; outside-click listener retained"
  - "HamburgerMenu button uses align-items:center + fixed bar width so bars stay visually centred at 44px hit target"
metrics:
  duration: "~20 minutes"
  completed: "2026-06-23"
  tasks: 3
  files_changed: 5
---

# Phase 101 Plan 08: Dialog Focus Trap + aria-modal Summary

All three shell dialogs now share the `useFocusTrap` composable for identical focus lifecycle behaviour: focus moves in on open, Tab cycles within, Escape closes (except GameOverCard), and focus restores on close.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | HamburgerMenu dialog semantics + focus trap + 44px button | b8d0f79 | HamburgerMenu.vue, HamburgerMenu.test.ts |
| 2 | ControlsMenu focus trap + Escape + 44px trigger | 941a874 | ControlsMenu.vue |
| 3 | GameOverCard aria-modal=true + focus trap (Escape disabled) | 7230303 | GameOverCard.vue, GameOverCard.test.ts |

## What Was Built

**A11Y-07 — Dialog focus lifecycle for all three dialogs:**

- **HamburgerMenu drawer:** `role="dialog" aria-modal="true" aria-label="Game menu"` added. `useFocusTrap` wired — `openMenu()` sets `isOpen.value=true` then calls `openTrap()` in nextTick; `closeMenu()` calls `closeTrap()` before setting `isOpen.value=false` (ensuring the ref is still live for inert cleanup and focus restore). `@keydown="handleKeydown"` on the drawer for Tab-trap + Escape-to-close.

- **ControlsMenu popover:** `role="menu"` retained. `menuRef` added on the popover div; `useFocusTrap` wired with same open/close lifecycle. Document-level Escape listener removed (trap handles it); outside-click listener kept. `@keydown="trapKeydown"` bound on the menu div. Deferral comment removed.

- **GameOverCard:** `aria-modal="false"` flipped to `aria-modal="true"`. `cardRef` on `.game-over-card`; `useFocusTrap(cardRef, { escapeToClose: false })` — Tab traps, Escape does nothing. `openTrap()` called in `onMounted`, `closeTrap()` in `onUnmounted` for lifecycle cleanup. Deferral comment removed.

**A11Y-09 — 44px touch targets:**

- `.hamburger-btn`: `min-width: 44px; min-height: 44px` added; `align-items: center` + fixed `width: 28px` on `.bar` keeps visual appearance centred within the expanded hit target.
- `.menubtn` (ControlsMenu trigger): `min-height: 44px; min-width: 44px` added.

## Verification

- `npx vitest run src/ui/components/HamburgerMenu.test.ts src/ui/components/GameOverCard.test.ts` — **21/21 tests pass**
- `npm run lint:css` — **exit 0**, all tokens use `var(--bsg-*)`
- All three dialogs import `useFocusTrap` exactly once each

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree behind main — merged 101-01 dependencies**
- **Found during:** Pre-execution check
- **Issue:** Worktree branch `worktree-agent-ad96b4f0d659ac33e` was branched before the 101-01 commits (useFocusTrap.ts, ControlsMenu.vue, GameOverCard.vue, etc. were missing).
- **Fix:** `git merge main` to bring in the 101-01 wave work before proceeding.
- **Commit:** merge commit (pre-task setup)

No other deviations — plan executed as specified.

## Known Stubs

None. All three dialogs are fully wired with live composable behaviour.

## Threat Flags

None. These changes are UI keyboard-focus only — no new network endpoints, auth paths, or data boundaries introduced.

## Self-Check: PASSED

- HamburgerMenu.vue exists and contains `role="dialog"`, `aria-modal="true"`, `useFocusTrap`
- ControlsMenu.vue exists and contains `useFocusTrap`, `role="menu"`, `min-height: 44px`
- GameOverCard.vue exists and contains `aria-modal="true"`, `escapeToClose: false`
- HamburgerMenu.test.ts: 8 tests pass
- GameOverCard.test.ts: 13 tests pass
- lint:css: exit 0
- Commits b8d0f79, 941a874, 7230303 all present
