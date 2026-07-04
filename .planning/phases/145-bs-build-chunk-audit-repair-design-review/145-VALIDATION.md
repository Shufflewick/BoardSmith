---
phase: 145
slug: bs-build-chunk-audit-repair-design-review
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 145 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (already configured) |
| **Config file** | `vitest.config.ts` (no changes) |
| **Quick run command** | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 145-* | * | * | BUILD-07 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-07"` | ❌ W0 (extend) | ⬜ pending |
| 145-* | * | * | BUILD-08 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-08"` | ❌ W0 (extend) | ⬜ pending |
| 145-* | * | * | UIQ-04 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-04"` | ❌ W0 (extend) | ⬜ pending |

Pins: 3 audit lenses named; never-reads-interpretation rule; cited APIs `diffPlayerViews`/`assertNoHiddenInfoLeak` (verified in src/testing); max-3-round + only-new-findings + refute-with-citation; screenshot path `chunks/<slug>/shots/`; 3×2 breakpoint (`compact:640, medium:1024, wide:1440`) × theme grid; server-kill instruction; REFERENCED_PATHS updated for audit.md/repair.md/design-review.md; 146 forward-reference markers retained.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `src/cli/slash-command/bs/build-chunk.test.ts` (BUILD-07/08, UIQ-04 describes + path/marker arrays)
- [ ] No new fixtures or framework installs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full audit/repair loop + design-review run on a real chunk | BUILD-07/08, UIQ-04 | LLM-executed skill + live browser | Phase 149 end-to-end dry-run |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
