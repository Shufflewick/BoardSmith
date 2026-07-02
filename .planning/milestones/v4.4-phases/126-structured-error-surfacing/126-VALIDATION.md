---
phase: 126
slug: structured-error-surfacing
status: planned
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-01
---

# Phase 126 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~95 seconds (full suite, ~1956 tests) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test files>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 126-01 T1 | 126-01 | 1 | ERR-02 | T-126-01 | Runner error messages sanitized (no `error.stack`); ENGINE_ERROR/ACTION_EXECUTION_ERROR set at source | unit | `npx vitest run src/runtime/runner.test.ts` | ✅ src/runtime/runner.test.ts | ⬜ pending |
| 126-01 T2 | 126-01 | 1 | ERR-02 | T-126-02 | errorCode threaded through OpResult, never re-inferred/fabricated | unit | `npx vitest run src/session/stateless-ops.test.ts` | ✅ src/session/stateless-ops.test.ts | ⬜ pending |
| 126-02 T1 | 126-02 | 1 | ERR-03 | T-126-03,04,05,06 | #persistSafely never rethrows; lastPersistenceError sanitized; persistenceHealthy flips at 3; AI misclassification fixed | unit | `npx vitest run src/session/game-session.test.ts src/session/ai-circuit-breaker.test.ts` | ✅ both exist (extend) | ⬜ pending |
| 126-02 T2 | 126-02 | 1 | ERR-03 | T-126-05 | Symmetric persist guard on SnapshotSessionHost; persistenceHealthy flip/recovery; no-op when persist undefined | unit | `npx vitest run src/session/snapshot-session-host.test.ts` | ✅ src/session/snapshot-session-host.test.ts | ⬜ pending |
| 126-03 T1 | 126-03 | 2 | ERR-01 | T-126-07,08 | boardRefs/display/boardRef warnings sanitized; soft-fail never flips success:false; getChoices hard-fail unchanged | unit | `npx vitest run src/session/pick-handler.test.ts` | ⚠️ Wave 0 create if absent (`find src/session -iname "pick-handler.test.ts"`) | ⬜ pending |
| 126-03 T2 | 126-03 | 2 | ERR-01 | T-126-09 | warnings survive OpResult + bridge shapeResult allowlist (action + selection_step + resolve_choices) | unit | `npx vitest run src/session/stateless-ops.test.ts src/cli/dev-host/bridge.test.ts` | ✅ stateless-ops.test.ts; ⚠️ bridge.test.ts create if absent | ⬜ pending |
| 126-04 T1 | 126-04 | 3 | ERR-04 | T-126-10,11 | log-capture confined to cli/dev-host (no session reverse import); FIFO cap; persistence errors health-escalated; OpResult warnings + bridge:325 errors captured; no error.stack | unit | `npx vitest run src/cli/dev-host/log-capture.test.ts src/cli/dev-host/bridge.test.ts` | ⚠️ Wave 0 create log-capture.test.ts; bridge.test.ts extend | ⬜ pending |
| 126-04 T2 | 126-04 | 3 | ERR-04 | T-126-12,13 | debug:logs is a host-lifecycle op (never in executeOp/READ_ONLY_OP_TYPES); entries round-trip through translateOp/shapeResult | unit | `npx vitest run src/cli/dev-host/bridge.test.ts` | ⚠️ bridge.test.ts extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

No new test-runner deps. Tests colocate with modified modules. Before executing, confirm these files (create as the FIRST step of the owning task if absent — Nyquist scaffold):

- `src/session/pick-handler.test.ts` (126-03 T1) — `find src/session -iname "pick-handler.test.ts"`; create if missing.
- `src/cli/dev-host/bridge.test.ts` (126-03 T2 / 126-04) — `find src/cli/dev-host -iname "bridge.test.ts"`; create if missing.
- `src/cli/dev-host/log-capture.test.ts` (126-04 T1) — new module + test created within the task.
- Persistence-failure fixture (rejecting `StorageAdapter` / `persist` adapter) — shared inline helper in game-session.test.ts and snapshot-session-host.test.ts (126-02).

All other referenced test files already exist and are extended, not created.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `debug:logs` op live in dev host (agent polls captured errors) | ERR-04 | Browser/WS path | Optional live smoke: `boardsmith dev` in go-fish, trigger a warning, poll debug:logs via devtools/DebugPanel Logs tab; kill server after. Unit coverage of the host lifecycle + bridge chain makes this optional. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned
