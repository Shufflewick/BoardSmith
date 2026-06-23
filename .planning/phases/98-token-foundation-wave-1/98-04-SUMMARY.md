---
phase: 98-token-foundation-wave-1
plan: "04"
subsystem: ui/theme
tags: [tokens, css-custom-properties, token-rename, gameshell, theme-engine, tdd]
dependency_graph:
  requires: [98-01]
  provides: [legacy-namespace-purge, gameshell-theme-receiver]
  affects:
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/WaitingRoom.vue
    - src/ui/components/GameShell.vue
    - src/ui/components/GameShellInit.ts
    - src/ui/components/GameShell.theme.test.ts
tech_stack:
  added: []
  patterns: [css-custom-properties, postmessage-theme-receiver, tdd-red-green, pure-helper-extraction]
key_files:
  created:
    - src/ui/components/GameShellInit.ts
    - src/ui/components/GameShell.theme.test.ts
  modified:
    - src/ui/components/auto-ui/ActionPanel.vue
    - src/ui/components/WaitingRoom.vue
    - src/ui/components/GameShell.vue
decisions:
  - "consumeInitMessage extracted as a pure helper (GameShellInit.ts) so TOKEN-05 receiver is testable without mounting the full GameShell Vue component"
  - "applyTheme() called in onMounted unconditionally (before the platformMode early-return) so the Slate base stylesheet is always installed regardless of mode"
  - "consumeInitMessage delegates key allowlist enforcement to applyTheme's /^--bsg-[a-z0-9-]+$/ guard (T-98-04) — no duplicate validation in the receiver"
  - "bg+text renamed together in the ActionPanel pending/skip block in one pass to avoid the invisible-text trap"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-23"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
---

# Phase 98 Plan 04: TOKEN-01 Namespace Collapse + TOKEN-05 Receiver Summary

**One-liner:** Purged the last `--bg-*/--text-*/--border-*` custom properties from ActionPanel and WaitingRoom, and wired the GameShell iframe init receiver to install the Slate token base via `applyTheme()` on mount and apply host theme overrides on init, proven by 4 new integration tests.

## What Was Built

### Task 1: Namespace collapse (TOKEN-01)

ActionPanel.vue pending/skip block — five CSS custom properties renamed to `--bsg-*` tokens, all hex fallbacks dropped (theme.ts supplies Slate defaults):

| Old | New |
|-----|-----|
| `var(--bg-secondary, #f5f5f5)` | `var(--bsg-surface-2)` |
| `var(--text-secondary, #666)` | `var(--bsg-ink-2)` |
| `var(--border-color, #ccc)` | `var(--bsg-line)` |
| `var(--bg-primary, #fff)` | `var(--bsg-surface)` |
| `var(--bg-hover, #eee)` | `var(--bsg-surface-3)` |

Background and text renamed together in a single pass (invisible-text trap guard: `--bsg-surface-2` dark bg + `--bsg-ink-2` light ink remain readable).

WaitingRoom.vue — one rename: `var(--bg-color, #1a1a2e)` → `var(--bsg-bg)` with `#1a1a2e` hex fallback dropped.

**Result:** `grep -rnE -- '--(bg|text|border)-' src/ui | grep -v -- '--bsg-'` returns nothing across all of `src/ui`.

### Task 2: GameShell TOKEN-05 receiver (TDD)

**`src/ui/components/GameShellInit.ts`** — New pure helper `consumeInitMessage(data, { applyTheme })`:
- Always calls `applyTheme()` to idempotently install the Slate base token stylesheet
- If `data.theme` is a non-null object, passes it as the override map
- If `data.scheme` is present (`'light'|'dark'|'auto'`), forwards it as the scheme option
- Delegates all key allowlist enforcement to `applyTheme`'s `--bsg-*` regex guard (T-98-04)

**`src/ui/components/GameShell.vue`** — Two wiring changes:
1. `onMounted`: calls `applyTheme()` unconditionally (before the `platformMode` early-return) to install the Slate base stylesheet on every mount
2. `init` postMessage branch: calls `consumeInitMessage(data, { applyTheme })` after the existing `playerSeat`/`currentScreen` assignments

**`src/ui/components/GameShell.theme.test.ts`** — 4 integration tests (jsdom):
- Slate base `<style id="bsg-tokens">` is present after `consumeInitMessage` call
- `init.theme: { '--bsg-accent': '#abc' }` → `documentElement.style.getPropertyValue('--bsg-accent') === '#abc'`
- Init message without `theme` field does not throw
- `init.scheme: 'light'` → `data-theme="light"` on `documentElement`

## Threat Mitigations Applied

| ID | Mitigation |
|----|-----------|
| T-98-04 | `consumeInitMessage` passes `data.theme` directly to `applyTheme`; the existing `--bsg-*` key regex guard in `applyTheme` prevents arbitrary CSS property injection from a malicious host page. The `data.source !== 'shufflewick'` guard in GameShell's postMessage listener already filters foreign messages before `consumeInitMessage` is reached. |

## Deviations from Plan

None — plan executed exactly as written. The `consumeInitMessage` extraction was the plan-suggested approach for testability, not a deviation.

## Known Stubs

None. This plan is token plumbing — no UI data flows.

## Verification Results

- `grep -rnE -- '--(bg|text|border)-' src/ui | grep -v -- '--bsg-'` → no matches (TOKEN-01 complete)
- `npx vitest run src/ui/components/GameShell.theme.test.ts` → 4/4 pass
- `npx vitest run` (full suite) → 963/963 pass (4 new tests added)

## Self-Check: PASSED

- src/ui/components/GameShellInit.ts — exists, exports `consumeInitMessage`
- src/ui/components/GameShell.theme.test.ts — exists, 4 tests
- src/ui/components/GameShell.vue — imports `applyTheme` + `consumeInitMessage`, calls both
- src/ui/components/auto-ui/ActionPanel.vue — no legacy `--bg-*/--text-*/--border-*` vars
- src/ui/components/WaitingRoom.vue — no legacy `--bg-color` var
- Commits: `3ed945a` (feat: namespace collapse), `647dbe1` (test: RED), `005365f` (feat: GREEN implementation)
