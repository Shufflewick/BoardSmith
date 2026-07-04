---
phase: 141
slug: file-templates-state-machine-authority
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 141 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^2.1.0 (already configured) |
| **Config file** | `vitest.config.ts` (no changes needed — `src/**/*.test.ts` glob covers the new file) |
| **Quick run command** | `npx vitest run src/cli/slash-command/bs/templates.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/cli/slash-command/bs/templates.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 141-01-* | 01 | 1 | TMPL-01 | — | N/A | unit (content assertion) | `npx vitest run src/cli/slash-command/bs/templates.test.ts -t "TMPL-01"` | ❌ W0 | ⬜ pending |
| 141-01-* | 01 | 1 | TMPL-02 | — | N/A | unit (parse-contract content assertion) | `npx vitest run src/cli/slash-command/bs/templates.test.ts -t "TMPL-02"` | ❌ W0 | ⬜ pending |
| 141-01-* | 01 | 1 | TMPL-03 | — | N/A | unit (content assertion) | `npx vitest run src/cli/slash-command/bs/templates.test.ts -t "TMPL-03"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/cli/slash-command/bs/templates.test.ts` — drift test covering TMPL-01, TMPL-02 (structural half), TMPL-03
- [ ] No shared fixtures — test reads shipped template files directly from disk
- [ ] No framework install — vitest already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resumed session stops and asks on parse failure | TMPL-02 | No skill-instruction code exists yet to execute a resume; behavioral proof is Phase 149's dry-run | Phase 149 end-to-end dry-run includes a corrupted-state-file resume scenario |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
