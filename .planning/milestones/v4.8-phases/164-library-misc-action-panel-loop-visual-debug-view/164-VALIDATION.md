---
phase: 164
slug: library-misc-action-panel-loop-visual-debug-view
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-21
---

# Phase 164 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (+ @vue/test-utils for component tests) |
| **Config file** | vitest.config.ts (existing) |
| **Quick run command** | `npm run test -- <changed test file>` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | ~60–120s full suite (~2923 baseline) |

---

## Sampling Rate

- **After every task commit:** Run the changed test file(s).
- **After every plan wave:** Run `npm run test` for the touched module(s).
- **Before verification:** Full suite must be green (~2923 baseline).
- **Max feedback latency:** ~120 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 164-01 loop valve | 164-01 | 1 | LIBX-02 | engine unit | `npm run test -- src/engine/flow` | draft |
| 164-01 PROC-01 | 164-01 | 1 | PROC-01 | engine unit (fail-pre/pass-post) | `npm run test -- src/engine/flow` | draft |
| 164-02 contrastInk | 164-02 | 1 | LIBX-03 | pure unit (no DOM) | `npm run test -- <ink helper test>` | draft |
| 164-02 PlayerToken | 164-02 | 1 | LIBX-03/PROC-01 | component render | `npm run test -- src/ui/components/PlayerToken` | draft |
| 164-03 suppressFromDock | 164-03 | 1 | LIBX-01 | engine unit (metadata channel) | `npm run test -- src/engine/action` | draft |
| 164-03 ActionPanel filter | 164-03 | 1 | LIBX-01/PROC-01 | component (visibleActions) | `npm run test -- src/ui/components/ActionPanel` | draft |
| 164-04 displayedState | 164-04 | 2 | LIBX-04 | component (historical shape) | `npm run test -- src/ui/components/GameShell` | draft |
| 164-04 bridge guard | 164-04 | 2 | LIBX-04/PROC-01 | component (no-commit-in-history) | `npm run test -- useBoardActionBridge` | draft |

---

## Validation Architecture (Nyquist — per fix)

Each fix ships a **fail-on-pre-fix / pass-after** test (PROC-01) at the layer where the defect lives:

- **LIBX-01 (per-action dock suppression):** engine unit test proves `suppressFromDock` rides the metadata channel (mirrors `manual`); vue-test-utils test proves ActionPanel's `visibleActions` hides exactly the suppressed action and the all-suppressed case falls back to the turn-prompt strip; suppressed action still executable via bridge.
- **LIBX-02 (unbounded loop):** engine unit test — an `unbounded: true` loop runs past the old default cap and terminates when `while` goes false; a bounded loop that exceeds `maxIterations` still throws the loud safety error; whole-flow tripwire still applies.
- **LIBX-03 (glyph ink):** pure vitest unit test on `contrastInk()` — returns dark ink on a light seat color and light ink on a dark seat color (WCAG relative luminance); PlayerToken component render asserts the computed ink is applied (not hardcoded white).
- **LIBX-04 (time-travel desync):** vue-test-utils test — a board click while `isViewingHistory` produces NO engine commit (bridge guards fire on all four mutators); `displayedState` returns the historical (normalized) shape at all three `:state` sites; exiting history restores the live state.

**Sampling justification:** The four defects are independent and each has a single deterministic assertion boundary; one targeted test per fix at its native layer is sufficient Nyquist coverage. Full-suite green at the phase gate guards against cross-module regressions.
