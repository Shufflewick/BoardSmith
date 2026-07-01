---
phase: 120
slug: authoring-pit-of-success-guards
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 120 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 120-RESEARCH.md "## Validation Architecture". All PIT guards are pure engine/lint logic — 100% automated coverage, no manual verification required.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (node env) + `@typescript-eslint/rule-tester` RuleTester (new to repo) |
| **Config file** | `vitest.config.ts` (existing); eslint rules unit-tested with RuleTester (no config needed) |
| **Quick run command** | `npx vitest run src/engine/flow src/engine/element src/eslint-plugin` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~30–60 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick command scoped to the touched module.
- **After every plan wave:** Run `npm test` (full suite).
- **Before `/gsd:verify-work`:** Full suite must be green (including the 6 PIT-01 test call-site fixes).
- **Max feedback latency:** ~60 seconds.

---

## Per-Task Verification Map

| Task | Requirement | Secure/Correct Behavior | Test Type | Automated Command | Status |
|------|-------------|-------------------------|-----------|-------------------|--------|
| PIT-01 guard | PIT-01 | `loop({})` without `maxIterations` throws at construction with actionable message; `devWarn('loop-max-iterations')` path removed | unit | `npx vitest run src/engine/flow/builders` | ⬜ pending |
| PIT-01 callsite fixes | PIT-01 | 6 existing `loop({})` sites (dev-state.test.ts:76; engine.test.ts:50,174,196,1030,1465) given explicit `maxIterations`; suite green | unit | `npx vitest run src/engine/flow src/engine/utils` | ⬜ pending |
| PIT-02 guard | PIT-02 | First `engine.start()` pass throws naming an unregistered element class queried via `ElementCollection._finder()`; correct game still starts | unit | `npx vitest run src/engine/element` | ⬜ pending |
| PIT-03 guard | PIT-03 | `startFlow()` throws on `actionStep`-referenced unregistered action (static walk of `_flowDefinition.root`); registered-but-unreferenced action → devWarn not throw; function-valued `actions` documented as blind spot | unit | `npx vitest run src/engine/element` | ⬜ pending |
| PIT-04 rule 1 | PIT-04 | `no-element-identity-comparison` RuleTester: invalid `a===b`/`a!==b`/`arr.includes(el)`; valid `a.id===b.id`; auto-fix `a===b`→`a.id===b.id` asserted | unit | `npx vitest run src/eslint-plugin` | ⬜ pending |
| PIT-04 rule 2 | PIT-04 | `no-element-array-state` RuleTester: invalid `GameElement[]` field / `game.all()` stored to prop; valid point-of-use accessor; not auto-fixable | unit | `npx vitest run src/eslint-plugin` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] RuleTester harness wiring for `src/eslint-plugin` (first RuleTester coverage in the repo — no local precedent; use `@typescript-eslint/rule-tester` with the flat-config-compatible setup).
- [ ] Confirm vitest picks up `src/eslint-plugin/**/*.test.ts` (add to include glob if needed).

*Otherwise existing vitest infrastructure covers engine guard tests.*

---

## Manual-Only Verifications

*None — all Phase 120 behaviors (construction throws, startFlow throws, lint rule violations/fixes) have automated verification. Real-world lint firing against games is exercised in Phase 121 migration, not here.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify (no Wave 0 blockers beyond RuleTester wiring)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers RuleTester harness wiring
- [ ] No watch-mode flags (use `vitest run`, not `vitest`)
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set once plans encode these automated verifies

**Approval:** pending
</content>
