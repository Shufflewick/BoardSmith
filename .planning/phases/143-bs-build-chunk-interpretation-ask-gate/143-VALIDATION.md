---
phase: 143
slug: bs-build-chunk-interpretation-ask-gate
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 143 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (already configured) |
| **Config file** | `vitest.config.ts` (no changes — `src/**/*.test.ts` glob covers new file) |
| **Quick run command** | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` (plus templates/ingest suites if touched)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 143-* | * | * | BUILD-01 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-01"` | ❌ W0 | ⬜ pending |
| 143-* | * | * | BUILD-02 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-02"` | ❌ W0 | ⬜ pending |
| 143-* | * | * | BUILD-03 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-03"` | ❌ W0 | ⬜ pending |
| 143-* | * | * | BUILD-04 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-04"` | ❌ W0 | ⬜ pending |
| 143-* | * | * | BUILD-12 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-12"` | ❌ W0 | ⬜ pending |

Plus: byte-identical step-name/enum pins vs state-machine.md; subagent return-shape field pins; referenced-file existence scoped to current-phase files; pending files (steps 4–10 references) asserted to carry the "authored in Phase 144/145/146" marker.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/slash-command/bs/build-chunk.test.ts` — structural drift test covering BUILD-01..04, BUILD-12 + consistency
- [ ] No new fixtures or framework installs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Actual resume/investigate/redteam/ask run | BUILD-01..04, 12 | LLM-executed skill; no CI harness | Phase 149 end-to-end dry-run |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
