---
phase: 167
slug: skills-autonomy-rewrite
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-21
---

# Phase 167 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Quick run** | `npx vitest run src/cli/slash-command/bs` |
| **Full suite** | `npm run test` |
| **Runtime** | ~60–120s full (~3053 baseline after Phase 166) |

## Sampling Rate
- After each task: run the changed drift-test suite.
- Phase gate: full suite green.

## Validation Architecture (Nyquist — per requirement)

The bs-skills are prose/spec files with git-tracked source at `src/cli/slash-command/bs/`; drift-test suites assert exact strings via `toContain` with named marker constants. Each requirement ships fail-pre/pass-post drift assertions (PROC-01):

- **SKILLAUTO-01 (milestone gates):** `build-chunk.test.ts` + `ingest.test.ts` assert the 3-milestone gate policy + explicit SKETCH milestone flag; assert the per-chunk unconditional human-playtest stop is gone. Fail pre-fix.
- **SKILLAUTO-02..05 (ask discipline / batch / run-while-away / auto-advance):** `build-chunk.test.ts` asserts the ask-criteria triple-gate, the batched-queue model, auto-advance-into-next-chunk, "never re-ask granted approval", "never playtest UI-less chunk", and that the resume-command is framed as crash-fallback not stop. Fail pre-fix.
- **SKILLAUTO-06 (context):** `build-chunk.test.ts` asserts the ≥50% floor + sub-agent offload of research/audits/reads/repairs. Fail pre-fix.
- **SKILLAUTO-07 (loud completion):** `build-chunk.test.ts` asserts the game-level completion banner + summary card (shipped/test-count/deferred). Fail pre-fix.
- **SKILLAUTO-08 (B.9):** `build-chunk.test.ts`/`status-tools.test.ts` assert close-time ledger reconciliation, RULINGS re-touch on fix, and the fail-loud "sim exercised this chunk" assertion. Fail pre-fix.
- **PROC-02:** `build-chunk.test.ts` asserts the explicit "autonomy = how-not-what" statement AND a describe block asserting each Part D rule text still present (regression guard against erosion).
- **PROC-01:** the above ARE the PROC-01 tests.

**Sampling justification:** Pure structural drift assertions on deterministic prose; one marker-constant assertion per rule change is exact coverage, and the PROC-02 "Part D survives" block is a regression net against the rewrite eroding provenance discipline. Full suite guards unrelated regressions.
