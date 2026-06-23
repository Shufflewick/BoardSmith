---
phase: 99-theming-swap-wave-2
plan: "08"
subsystem: ui/components
tags: [theming, slate, tokenization, surface-sweep]
dependency_graph:
  requires: ["99-01"]
  provides: ["tokenized-GameHistory", "tokenized-GameLobby"]
  affects: ["GameHistory.vue", "GameLobby.vue"]
tech_stack:
  added: []
  patterns: ["var(--bsg-surface)", "var(--bsg-ink)", "var(--bsg-accent)", "var(--bsg-line)", "color-mix(in srgb, var(--bsg-*))"]
key_files:
  modified:
    - src/ui/components/GameHistory.vue
    - src/ui/components/GameLobby.vue
decisions:
  - "Mapped #2ecc71 (copied-success green) to var(--bsg-ok) — Slate's positive-state token"
  - "Mapped #e74c3c (error red) to var(--bsg-danger) — already present in theme.ts DARK/LIGHT blocks"
  - "Mapped #f39c12 (system-message orange) to var(--bsg-warn) — amber warning token"
  - "GameLobby h1 gradient clip-text deleted; replaced with solid var(--bsg-accent) per CONTEXT.md decision"
  - "btn.resume hover uses color-mix(in srgb, var(--bsg-accent) 22%, transparent) since --bsg-selectable (14%) was visually lighter than the original 25% neon"
  - ".stylelintrc.cjs ignoreFiles removal deferred to orchestrator merge — file is untracked in git and lives only in the main-repo working tree, outside this worktree's boundary"
metrics:
  duration: "~6 minutes"
  completed: "2026-06-23T06:41:00Z"
  tasks_completed: 2
  files_changed: 2
---

# Phase 99 Plan 08: GameHistory + GameLobby Slate Sweep Summary

**One-liner:** Replaced all 18 + 15 neon hex/rgba literals in GameHistory.vue and GameLobby.vue with `--bsg-surface`, `--bsg-ink`, `--bsg-accent`, `--bsg-line`, `--bsg-danger`, `--bsg-ok`, and `--bsg-warn` tokens; deleted the gradient clip-text block from the lobby title.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Sweep GameHistory.vue (sidebar log) | 993cf08 | src/ui/components/GameHistory.vue |
| 2 | Sweep GameLobby.vue (in-repo lobby) | 72d5512 | src/ui/components/GameLobby.vue |

## What Was Done

### Task 1 — GameHistory.vue

Swept all 18 hex literals and all rgba glass values:

- **Surface:** `rgba(0,0,0,.4)` → `var(--bsg-surface)`; border → `var(--bsg-line)`
- **Header:** `rgba(0,217,255,.1)` glass → `var(--bsg-surface-2)` (elevated surface, not neon tint); border-bottom → `var(--bsg-line)`
- **Accent (you/badge):** all `#00d9ff` → `var(--bsg-accent)`; badge background `rgba(0,217,255,.2)` → `color-mix(in srgb, var(--bsg-accent) 20%, transparent)`
- **Ink:** `#fff` → `var(--bsg-ink)`; `#ccc` → `var(--bsg-ink-2)`; `#888` → `var(--bsg-ink-2)`; `#666` → `var(--bsg-ink-3)`
- **Status tokens:** `#2ecc71` copied → `var(--bsg-ok)`; `#e74c3c` danger → `var(--bsg-danger)`; `#f39c12` system → `var(--bsg-warn)`
- **Error bg:** `rgba(231,76,60,.1)` → `color-mix(in srgb, var(--bsg-danger) 10%, transparent)`
- **Scrollbar:** rgba glass → `var(--bsg-bg)` / `var(--bsg-line-2)`
- **Field/message bg:** `rgba(255,255,255,.03)` → `var(--bsg-field)`
- **Button border:** `rgba(255,255,255,.2)` → `var(--bsg-line-2)`

### Task 2 — GameLobby.vue

Swept all 15 hex literals and all rgba glass values:

- **Title:** deleted `linear-gradient(90deg, #00d9ff, #00ff88)` / `-webkit-background-clip` / `-webkit-text-fill-color` / `background-clip` block → `color: var(--bsg-accent)` (solid, per CONTEXT.md "delete the two gradient clip-text blocks")
- **action-box surface:** `rgba(255,255,255,.05)` → `var(--bsg-surface-2)` (with `var(--bsg-ink)` and `var(--bsg-ink-2)` for h3/p text — bg+ink atomic)
- **Input:** border → `var(--bsg-line-2)`; bg → `var(--bsg-field)`; color → `var(--bsg-ink)`; focus → `var(--bsg-accent)`; placeholder → `var(--bsg-ink-3)`
- **btn.primary:** neon gradient → `var(--bsg-accent)` solid; `#1a1a2e` → `var(--bsg-accent-ink)`; neon glow box-shadow → `var(--bsg-shadow-sm)`
- **btn.secondary:** rgba → `var(--bsg-field)` / `var(--bsg-line-2)` / `var(--bsg-ink)`
- **btn.resume:** rgba neon tint → `var(--bsg-selectable)`; color → `var(--bsg-accent)`; border → `var(--bsg-line)`; hover bg → `color-mix(in srgb, var(--bsg-accent) 22%, transparent)`
- **resume-box:** neon border → `var(--bsg-line)`

## Verification

- `npx stylelint GameHistory.vue --config {color-no-hex:true}` → PASS
- `npx stylelint GameLobby.vue --config {color-no-hex:true}` → PASS
- `npx vitest run src/ui/components` → 85/85 tests pass
- Zero hex literals in either file (confirmed via grep)

## Deviations from Plan

### Note: .stylelintrc.cjs ignoreFiles not updated in this commit

**Found during:** Task 1 setup
**Issue:** `.stylelintrc.cjs` is an untracked file in the main repo working tree. It does not exist inside this git worktree's boundary. Modifying it would require writing to `/Users/jtsmith/BoardSmith/.stylelintrc.cjs` (outside the worktree), violating worktree isolation per the execution protocol.
**Effect:** The ignoreFiles entries for `GameHistory.vue` and `GameLobby.vue` remain until the orchestrator or merge step removes them. Both files now pass the inline `color-no-hex` verification independently.
**Resolution:** The orchestrator merge step should remove these two entries from `.stylelintrc.cjs` after merging this worktree's branch.

## Known Stubs

None — both components are fully tokenized. No placeholder text or hardcoded empty values were introduced.

## Threat Flags

None — this plan contains only CSS token substitutions. No new network surface, auth paths, or schema changes were introduced.

## Self-Check: PASSED

- `src/ui/components/GameHistory.vue` exists and contains only `var(--bsg-*)` color references
- `src/ui/components/GameLobby.vue` exists and contains only `var(--bsg-*)` color references
- Commit 993cf08 exists (GameHistory)
- Commit 72d5512 exists (GameLobby)
