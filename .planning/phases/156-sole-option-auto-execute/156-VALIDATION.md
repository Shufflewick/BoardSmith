---
phase: 156
slug: sole-option-auto-execute
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-20
---

# Phase 156 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run src/ui/composables/useBoardActionBridge.test.ts src/session/build-player-state.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~90 seconds (full suite); quick run < 15s |

---

## Sampling Rate

- **After every task commit:** Run the quick run command (both target test files)
- **After every plan wave:** Run the full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 156-01-01 | 01 | 1 | AUTOEXEC-01, PROC-01 | T-156-01 / — | A sole no-selection action carrying `manual:true` in metadata is surfaced, never auto-executed (beat preserved) — proven RED first on unfixed bridge | unit | `npx vitest run src/ui/composables/useBoardActionBridge.test.ts` | ❌ W0 (net-new cases) | ⬜ pending |
| 156-01-02 | 01 | 1 | AUTOEXEC-01 | — | `!action.manual` gate suppresses BOTH the primary and `actionCompletedTick` auto-execute routes; sole non-manual action still auto-executes with a one-time dev warning | unit | `npx vitest run src/ui/composables/useBoardActionBridge.test.ts` | ✅ (from 01) | ⬜ pending |
| 156-01-03 | 01 | 1 | AUTOEXEC-01, PROC-01 | — | `manual` propagates through BOTH metadata builders; Custom-UI + Action-Panel parity; end-turn coalescing route cannot defeat `manual()`; dev warning fires once and dev-mode only | unit | `npx vitest run src/session/build-player-state.test.ts src/ui/composables/useBoardActionBridge.test.ts` | ❌ W0 (net-new cases) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/ui/composables/useBoardActionBridge.test.ts` — net-new cases: sole no-selection `manual` action is NOT auto-executed via the primary watcher path AND the `actionCompletedTick` path; sole non-manual action still auto-executes and emits a one-time dev warning. (Existing anchor cases at :204, :229, :261-291 stay green.)
- [ ] `src/session/build-player-state.test.ts` — net-new cases: `manual` propagates into `actionMetadata` via `buildActionMetadata` AND `buildSingleActionMetadata` (followUp path); serialized only when `true`.

*Existing vitest infrastructure covers all phase requirements — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | All phase behaviors have automated verification. |

*The observable "draw beat is surfaced not silently played" is asserted at the bridge layer (executeAction NOT called for a `manual` sole option) — no browser step required.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 156s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
