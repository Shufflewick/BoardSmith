---
phase: 104
slug: tutorial-lifecycle-action-gating
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-25
---

# Phase 104 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 104-RESEARCH.md "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (repo standard; colocated `*.test.ts`) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run src/engine/action src/session` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~10–20s · full ~1245 tests (must stay green vs v4.0 baseline) |

**Reuse (no new deps):** `TestGame.create(GameClass, { playerCount, seed })` (`src/testing/test-game.ts:68-93`, `.performAction()` :189), `assertActionAvailable`/`assertActionNotAvailable` (`src/testing/assertions.ts:180,216`), `assertFlowState` (`:64`). Use an in-test `Game` subclass with one two-step action + a registered tutorial — do NOT depend on external game packages (project memory: external-rules tests are excluded from Vitest).

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/engine/action src/session/<tutorial files>`
- **After every plan wave:** `npm test` (full suite green — v4.0 baseline)
- **Before `/gsd:verify-work`:** Full suite green + ≥1 cross-layer integration test (engine progress → session lifecycle → client projection)
- **Max feedback latency:** ~20s (quick)

---

## Per-Task Verification Map

| Req | Behavior | Test Type | Automated Command | File | Status |
|-----|----------|-----------|-------------------|------|--------|
| TUT-02 | Gated out-of-step action surfaces a reason (not silent) | unit | `npx vitest run src/engine/action/tutorial-gate.test.ts` | ❌ W0 | ⬜ pending |
| TUT-02 | Target gating: only allowed element/choice enabled, others disabled-with-reason | unit | same | ❌ W0 | ⬜ pending |
| TUT-02 | `hasValidSelectionPath` keeps action available when ≥1 target allowed | unit | same | ❌ W0 | ⬜ pending |
| TUT-02 | Auto-fill resolves the single allowed target (no break); suppressible for taught selection | unit (UI) | `npx vitest run src/ui/composables/useActionController.test.ts` | extend | ⬜ pending |
| TUT-05 | Progress round-trips snapshot → restore **identically** (the load-bearing guard) | unit | `npx vitest run src/session/tutorial-serialization.test.ts` | ❌ W0 | ⬜ pending |
| TUT-05 | Undo a move rewinds the tutorial step in lockstep | unit | same / `src/session/restore-snapshot-authoritative.test.ts` | extend | ⬜ pending |
| TUT-05 | MCTS clone carries progress attribute safely | unit | `npx vitest run src/ai/*restore*.test.ts` | ❌ W0 | ⬜ pending |
| TUT-05 | start/advance/skip/exit transitions + broadcast | unit | `npx vitest run src/session/tutorial-controller.test.ts` | ❌ W0 | ⬜ pending |
| TUT-05 | `buildPlayerState` + `createPlayerView` both surface active step (parity) | unit | `npx vitest run src/session/build-player-state.test.ts` | extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/session/tutorial-controller.test.ts` — lifecycle transitions + broadcast
- [ ] `src/engine/action/tutorial-gate.test.ts` — target + action gating, reason surfacing, auto-fill interplay
- [ ] `src/session/tutorial-serialization.test.ts` — round-trip (snapshot → restore identical), undo rewind, MCTS clone
- [ ] Extend `src/session/build-player-state.test.ts` for active-step projection parity

---

## Critical Round-Trip Test (highest-risk guard)

A single test proving the **serialized-attribute discipline**: set progress → `runner.getSnapshot()` → restore → assert progress is byte-identical. This MUST fail if progress is stored anywhere but a plain public field (catches the `#private`/getter → silent data-loss trap flagged in RESEARCH.md finding #1). Use a `Map<number, TutorialProgress>` (`__map` lossless numeric-key encoding), not a `Record` (stringifies keys).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none for 104) | — | Substrate is engine/session — fully unit-testable. Browser verification of the live tutorial is deferred to Phase 110. | — |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 20s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
