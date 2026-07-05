---
phase: 147
slug: bs-check-status-insert-chunk
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 147 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (already configured) |
| **Config file** | `vitest.config.ts` (no changes) |
| **Quick run command** | `npx vitest run src/cli/slash-command/bs/status-tools.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/cli/slash-command/bs/status-tools.test.ts` (+ build-chunk.test.ts if build-chunk.md touched)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 147-* | * | * | STAT-01 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/status-tools.test.ts -t "STAT-01"` | ❌ W0 | ⬜ pending |
| 147-* | * | * | STAT-02 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/status-tools.test.ts -t "STAT-02"` | ❌ W0 | ⬜ pending |

Pins: both files exist as non-thin-pointer full content; STAT-01's 7 report items enumerated + read-only assertion; STAT-02's 4 ops + citation-dep revalidation + closed-chunk citation-overlap diff + `stale — re-derive before build` (byte-exact) + version-stamp bump + Mandated-Chunks-invariant guard; both cite the CORRECT state-machine.md headings (`## Consistency Check`, `## Session Lock`, `## Write Order` — NOT a nonexistent "Sketch Version" section; version stamp cited from SKETCH.template.md); referenced files all exist (no dangling pointers); build-chunk.md's two stale "Phase 147 / until it lands" forward-references (lines ~63, ~65) updated to reflect the skills now exist.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/slash-command/bs/status-tools.test.ts` — drift suite covering STAT-01/02 + cross-file consistency
- [ ] No new fixtures or framework installs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Actual status report / insert operation on a real project | STAT-01/02 | LLM-executed skill | Phase 149 end-to-end dry-run |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
