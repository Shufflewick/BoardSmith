---
phase: 166
slug: skills-defects-session-lock-ui-library-boundary
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-21
---

# Phase 166 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config** | vitest.config.ts (existing) |
| **Quick run** | `npx vitest run src/cli/slash-command/bs` |
| **Full suite** | `npm run test` |
| **Runtime** | ~60–120s full |

## Sampling Rate
- After each task: run the changed drift-test file.
- Phase gate: full suite green (~3032 baseline after Phase 164).

## Validation Architecture (Nyquist — per requirement)

The bs-skills are prose/spec files with git-tracked source at `src/cli/slash-command/bs/`; the existing drift-test suites (`build-chunk.test.ts`, `templates.test.ts`) assert exact strings via `toContain`. Each fix ships a fail-on-pre-fix / pass-after assertion (PROC-01):

- **SKILLDEF-01 (session-lock):** `build-chunk.test.ts` asserts `close.md` contains the terminal lock-release step; `templates.test.ts` asserts `SKETCH.template.md` contains the explicit `date -u` clock-read + session-identity marker; `state-machine.md` asserts the append-only terminal write sequence. All assertions fail against pre-fix source.
- **SKILLDEF-02 (boundary):** `build-chunk.test.ts` asserts `build.md` contains the "## Boundaries" prose (board-only, `node_modules/boardsmith` read-only symlink, FILE gaps not patch, never-suppress-built-in-UI) and `investigate.md`/`final-acceptance.md` contain their pointers. Fail pre-fix (zero current hits).
- **SKILLDEF-03 (escape hatch):** `build-chunk.test.ts` asserts `build.md` names `platformActionPanelEscapeHatch` (never without client) and `.suppressFromDock()` as the sanctioned mechanism. Fail pre-fix.
- **PROC-01:** the above ARE the PROC-01 tests; run `npx vitest run src/cli/slash-command/bs` per task, full suite at the gate.

**Sampling justification:** These are pure structural drift assertions on deterministic text; one marker-constant assertion per prose insertion is exact coverage. The full suite guards against unrelated regressions.
