---
phase: 142
slug: bs-ingest-rules
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 142 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (already configured) |
| **Config file** | `vitest.config.ts` (no changes — `src/**/*.test.ts` glob covers new file) |
| **Quick run command** | `npx vitest run src/cli/slash-command/bs/ingest.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/cli/slash-command/bs/ingest.test.ts` (plus `bs/templates.test.ts` if touched)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 142-* | * | * | INGEST-01 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-01"` | ❌ W0 | ⬜ pending |
| 142-* | * | * | INGEST-02 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-02"` | ❌ W0 | ⬜ pending |
| 142-* | * | * | INGEST-03 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-03"` | ❌ W0 | ⬜ pending |
| 142-* | * | * | INGEST-04 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-04"` | ❌ W0 | ⬜ pending |
| 142-* | * | * | INGEST-05 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-05"` | ❌ W0 | ⬜ pending |
| 142-* | * | * | INGEST-06 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-06"` | ❌ W0 | ⬜ pending |
| 142-* | * | * | INGEST-07 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/ingest.test.ts -t "INGEST-07"` | ❌ W0 | ⬜ pending |

Cross-file consistency: every path `ingest-rules.md` and `bs/ingest/*.md` reference must exist on disk (templates, state-machine.md, aspects, reference files).

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/slash-command/bs/ingest.test.ts` — structural drift test covering INGEST-01..07 + cross-file consistency
- [ ] No new fixtures or framework installs — vitest + readFileSync pattern from templates.test.ts

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full ingest run (rulebook → approved sketch → compiling scaffold) | INGEST-01..07 | Skill is LLM-executed; no harness exists to run it in CI | Phase 149 end-to-end dry-run against a reference rulebook |
| `boardsmith dev` ready-state string accuracy | INGEST-04 | Requires running the dev server once | Executor runs `npx boardsmith init` + dev once during execution to capture the exact string; kills the server after |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
