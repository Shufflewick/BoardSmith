---
phase: 155
slug: undo-rewind-family-correctness
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-20
---

# Phase 155 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing, pre-wired) |
| **Config file** | `vitest.config.ts` (repo root, pre-existing) |
| **Quick run command** | `npx vitest run <file>` (single test: `npx vitest run <file> -t "<name>"`) |
| **Full suite command** | `npm test` (`vitest run`) |
| **Estimated runtime** | quick run: seconds; full suite: minutes |

No framework install is needed. `src/ai/mcts-bot.test.ts` remains excluded from vitest (external
dependency) — unchanged by this phase.

---

## Sampling Rate

- **After every task commit:** `npx vitest run <the task's specific test file>`
- **After every plan wave:** `npm test`
- **Before `/gsd:verify-work`:** full suite green, with every changed expectation justified
- **Hard gate:** `parity-contract.test.ts` green — it is the locked drift detector for the
  "stateless and stateful executors must not drift" decision (CONTEXT D-01/D-09)

Note: "still green" is NOT sufficient evidence for this phase. Plan 03 deliberately changes the
contract of two existing suites (CONTEXT D-06); the pass-count delta against the pre-phase baseline
must be accounted for item by item.

---

## PROC-01: RED-before-GREEN mechanic

No `git stash` is required. Current HEAD *is* pre-fix code for all four defects, so the proof is
plain task sequencing (RESEARCH.md §D):

1. **RED task** — author the regression test only, run it, capture the verbatim failure output into
   the commit message. Commit test-only. A deliberately red commit is an accepted pattern in this
   repo's history.
2. **GREEN task** — implement the fix, re-run the SAME invocation, capture the pass.
3. **Adversarial task** — actively attempt to defeat the fix (raw `{type:'undo'}` op built by hand,
   direct `undoToTurnStart()` / `rewindToAction()` calls, repeated rewind cycles) and confirm the
   attempt fails.

Both the RED and GREEN outputs go into the plan's SUMMARY. A defect is not closed without all three.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 155-01-01 | 01 | 1 | UNDO-01, UNDO-02, PROC-01 | T-155-01/03 | Undo of a `.notUndoable()` action is refused server-side with a leak-free message | integration (RED) | `npx vitest run src/session/testing/notundoable-enforcement.test.ts src/session/testing/finished-phase-undo.test.ts` | ❌ W0 | ⬜ pending |
| 155-01-02 | 01 | 1 | UNDO-01, UNDO-02 | T-155-01/02/04 | Shared guard throws; all four entry points surface the refusal | integration (GREEN) | same as above | ❌ W0 | ⬜ pending |
| 155-01-03 | 01 | 1 | UNDO-01, PROC-01 | T-155-01/02 | Raw op + direct call cannot bypass the guard; executors agree | integration (adversarial) | `npx vitest run src/session/testing/parity-contract.test.ts && npm test` | ✅ extend | ⬜ pending |
| 155-04-01 | 04 | 1 | UNDO-04, PROC-01 | T-155-09 | Beats emitted after rewind survive the client's monotonic dedupe | integration (RED) | `npx vitest run src/session/testing/rewind-animation-watermark.test.ts` | ❌ W0 | ⬜ pending |
| 155-04-02 | 04 | 1 | UNDO-04 | T-155-09/10 | Checkpoint restore never lowers the live sequence; restored events re-stamped | integration (GREEN) | `npx vitest run src/session/testing/rewind-animation-watermark.test.ts src/engine/element/animation-events.test.ts` | ❌ W0 | ⬜ pending |
| 155-04-03 | 04 | 1 | UNDO-04, PROC-01 | T-155-10 | Full session restore unchanged; repeated rewinds cannot regress the seq | integration (adversarial) | `npx vitest run src/session/testing/rewind-animation-watermark.test.ts && npm test` | ❌ W0 | ⬜ pending |
| 155-02-01 | 02 | 2 | UNDO-02, PROC-01 | T-155-05/06/07 | Undo across a completed `execute()` refused, incl. after a snapshot round-trip | integration (RED) | `npx vitest run src/session/testing/execute-barrier-undo.test.ts` | ❌ W0 | ⬜ pending |
| 155-02-02 | 02 | 2 | UNDO-02 | T-155-07 | `executeBarrierIndex` persists through getSnapshot/fromSnapshot/fromCheckpoint | unit + integration (GREEN) | `npx vitest run src/runtime src/engine/flow` | ✅ exists | ⬜ pending |
| 155-02-03 | 02 | 2 | UNDO-02, PROC-01 | T-155-05/08 | Barrier check in the shared guard; rewind twins fenced; bypass attempts fail | integration (adversarial) | `npx vitest run src/session/testing/execute-barrier-undo.test.ts src/session/testing/parity-contract.test.ts && npm test` | ❌ W0 / ✅ | ⬜ pending |
| 155-03-01 | 03 | 3 | UNDO-03, PROC-01 | T-155-12/13 | Solo undo rewinds one action; never wipes history to empty | integration (RED) | `npx vitest run src/session/testing/solo-undo-authoritative.test.ts` | ❌ W0 | ⬜ pending |
| 155-03-02 | 03 | 3 | UNDO-03 | T-155-12/14 | `moveCount` always published; fallback deleted; missing ⇒ `canUndo:false` (fail-closed) | integration (GREEN) | `npx vitest run src/session/testing/solo-undo-authoritative.test.ts src/session/build-player-state.test.ts` | ❌ W0 / ✅ | ⬜ pending |
| 155-03-03 | 03 | 3 | UNDO-03, PROC-01 | T-155-13/15 | New "one undo = one action-step" contract asserted; pending-mutation preservation retained | integration (contract rewrite) | `npx vitest run src/session/testing/undo-authoritative.test.ts src/session/testing/stateful-undo-authoritative.test.ts src/session/testing/parity-contract.test.ts && npm test` | ✅ MODIFY | ⬜ pending |
| 155-05-01 | 05 | 4 | UNDO-04 | T-155-16 | `actionCount` published to every seat incl. spectators; content-free | integration | `npx vitest run src/session/build-player-state.test.ts` | ✅ extend | ⬜ pending |
| 155-05-02 | 05 | 4 | UNDO-04, PROC-01 | T-155-17/18 | Watermark resets on detected rewind; forward dedupe unchanged; absent signal is inert | unit (RED→GREEN) | `npx vitest run src/ui/composables/useAnimationEvents.test.ts` | ✅ extend | ⬜ pending |
| 155-05-03 | 05 | 4 | UNDO-04, PROC-01 | T-155-17 | Both `createAnimationEvents` call sites wired; phase PROC-01 evidence assembled | integration | `npm test` | ✅ exists | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Sampling continuity check: every task above carries an `<automated>` command. No three consecutive
tasks lack automated verification.

---

## Wave 0 Requirements

Net-new test files created by the RED task of their own plan (each is the first task in its plan, so
no task depends on a test file that does not yet exist):

- [ ] `src/session/testing/fixtures/undo-fence-fixture.ts` — `.notUndoable()` action + reachable `finish()`
- [ ] `src/session/testing/notundoable-enforcement.test.ts` — UNDO-01 (zero prior coverage in repo)
- [ ] `src/session/testing/finished-phase-undo.test.ts` — UNDO-02 finished-phase fence
- [ ] `src/session/testing/fixtures/execute-barrier-fixture.ts` — `sequence(actionStep, execute, actionStep)`
- [ ] `src/session/testing/execute-barrier-undo.test.ts` — UNDO-02 durable barrier
- [ ] `src/session/testing/solo-undo-authoritative.test.ts` — UNDO-03 solo wipe
- [ ] `src/session/testing/rewind-animation-watermark.test.ts` — UNDO-04 beats-delivered
- [ ] MODIFY `src/session/testing/undo-authoritative.test.ts` + `stateful-undo-authoritative.test.ts`
      — required contract rewrite (CONTEXT D-06), not optional cleanup
- [ ] No framework install needed

---

## Blast-Radius Watch List

Files RESEARCH.md §E flags as at risk. Each must be checked before the phase closes, and any change
classified as *intentional contract change* or *genuine regression* in the owning plan's SUMMARY.

| File | Risk | Owning plan |
|------|------|-------------|
| `src/session/testing/undo-authoritative.test.ts` | HIGH — will break as written | 03 |
| `src/session/testing/stateful-undo-authoritative.test.ts` | HIGH — stateful twin | 03 |
| `src/session/testing/stateful-timetravel-authoritative.test.ts` | MEDIUM — rewind targets may now be refused; animation ids shift | 02 + 04 |
| `src/session/testing/parity-contract.test.ts` | MEDIUM — enforcement point, extended not broken | 01, 02 |
| `src/session/build-player-state.test.ts` | LOW-MED — `canUndo` changes once branch C is deleted | 03, 05 |
| `src/session/pending-action-manager.test.ts` | LOW — skim for fallback reliance | 03 |
| `src/engine/command/undo.test.ts`, `src/engine/element/animation-events.test.ts` | LOW — verify no raw `animationEventSeq` assertions | 03, 04 |

---

## Manual-Only Verifications

All phase behaviors have automated verification. The locked strategy (CONTEXT D-08) is the
session-level harness (`createHeadlessSession` + typed `Op` objects, and `GameSession` for the
stateful twin); engine-level `TestGame` is used only where a defect is genuinely engine-local.

Optional, non-gating: RESEARCH.md §F notes `~/BoardSmithGames/seven` uses both `.notUndoable()` and
`doUndo`, and `doom-machine` is the solo game from the D5 report — either is cheap smoke-test
insurance. Neither is a requirement of this phase, and no sibling-repo work is in scope (Phase 169
owns the de-workaround sweep). Do not leave a dev server running if one is started.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`vitest run`, never `vitest` bare)
- [x] Feedback latency acceptable (per-task runs are single-file)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-20
