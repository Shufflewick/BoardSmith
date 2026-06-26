---
phase: 107
slug: ai-assisted-teaching
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-26
---

# Phase 107 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (existing) |
| **Quick run command** | `npx vitest run src/ai src/session src/ui` (scoped to changed dirs) |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~8 seconds (full suite ~1456 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` scoped to the changed dir(s)
- **After every plan wave:** Run `npx vitest run` (full suite)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 107-01-* | 01 | 1 | AI-01 (stats API) | — | N/A | unit | `npx vitest run src/ai` | ❌ W0 | ⬜ pending |
| 107-02-* | 02 | 2 | AI-01 (hint state + injection) | — | N/A | unit/integration | `npx vitest run src/session` | ❌ W0 | ⬜ pending |
| 107-03-* | 03 | 2 | AI-02 (narration hook + demo) | — | N/A | integration | `npx vitest run src/session` | ❌ W0 | ⬜ pending |
| 107-04-* | 04 | 2 | AI-03 (heatmap state) | — | N/A | unit/integration | `npx vitest run src/session` | ❌ W0 | ⬜ pending |
| 107-05-* | 05 | 3 | AI-01/03 (overlays, parity) | — | N/A | component | `npx vitest run src/ui` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Exact plan/task IDs finalized by the planner; this map is the validation contract the planner's tasks must satisfy (every AI-0x requirement has an automated verify).*

---

## Wave 0 Requirements

- Existing vitest infrastructure covers all phase requirements — no framework install needed.
- New test files (created during execution): `src/ai/mcts-stats.test.ts` (or extend existing), `src/session/*.test.ts` for hint/narration/heatmap state, `src/ui/components/*Overlay*.test.ts` for parity.
- The symlinked checkers bot (`~/BoardSmithGames/checkers`) is available via `node_modules/boardsmith` for integration exercise where a real MCTS game is needed; prefer a minimal in-repo test game where possible (per Phase 106 pattern) to keep tests deterministic.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Hint ring / heatmap chips / narration card render identically in browser custom UI + AutoUI | AI-01, AI-02, AI-03 | Visual parity + animation/reduced-motion are browser-observable | Deferred to Phase 110 demo gate — `npx boardsmith dev` in checkers, request hint, run demo, toggle heatmap in both UIs |

*Component-level parity (overlay mounts + targets resolve in both UI fixtures) IS automated via vitest; only the final visual confirmation is deferred to Phase 110.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
