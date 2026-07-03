---
phase: 135
slug: cli-dev-experience
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-03
---

# Phase 135 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/cli --reporter=dot` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~120 seconds (full suite, 2230+ tests baseline) |

---

## Sampling Rate

- **After every task commit:** `npx vitest run src/cli --reporter=dot`
- **After every plan wave:** `npm test` (full suite)
- **Before `/gsd:verify-work`:** full suite green
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | CLIX-01 | F9 | scaffold has no playerCount; build.ts derives manifest playerCount from gameDefinition; validate errors on leftover key | unit | `npx vitest run src/cli/lib/project-scaffold.test.ts src/cli/commands/build.test.ts src/cli/commands/validate.test.ts` | ❌ W0 (build/validate tests new) | ⬜ pending |
| TBD | TBD | TBD | CLIX-02 | F22 | validate rejects unknown keys + did-you-mean; dev warns | unit | `npx vitest run src/cli/commands/validate.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLIX-03 | F21 | exported shared constant = 50MB (matches server); comment agrees | unit | `npx vitest run src/cli/commands/validate.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLIX-04 | F32 | default host 127.0.0.1; --lan/--host explicit; loud banner on non-localhost; help text accurate (no real socket binds in tests) | unit | `npx vitest run src/cli/commands/dev.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CLIX-05 | F33 | --template gone from cli.ts + InitOptions | unit | `npx vitest run src/cli/commands/init.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | CLIX-06 | F34 | non-numeric flags error; out-of-range --players errors; --ai vs effective count (post-move validation) | unit | `npx vitest run src/cli/commands/dev.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-01 | all | Verdict per finding before fix | process | `135-FINDINGS-VERIFICATION.md` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | PROC-02 | all | Red-then-green per fix | process | SUMMARY documentation | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/commands/dev.test.ts` — new (CLIX-04/06; extract pure-function arg validation or mock createViteServer/WebSocketServer — no real sockets)
- [ ] `src/cli/commands/validate.test.ts` — new (CLIX-02/03; bundle constant exported from an importable module)
- [ ] `src/cli/commands/build.test.ts` — new (CLIX-01 manifest derivation; build.ts currently has zero coverage)
- [ ] `135-FINDINGS-VERIFICATION.md` — PROC-01 verdicts BEFORE fixes

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PROC-01 verdict quality | PROC-01 | Judgment call | Review `135-FINDINGS-VERIFICATION.md` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 150s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
