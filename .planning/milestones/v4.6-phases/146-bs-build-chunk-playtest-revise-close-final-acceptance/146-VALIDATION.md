---
phase: 146
slug: bs-build-chunk-playtest-revise-close-final-acceptance
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-04
---

# Phase 146 — Validation Strategy

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
| 146-* | * | * | BUILD-09 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-09"` | ❌ W0 (extend) | ⬜ pending |
| 146-* | * | * | BUILD-10 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-10"` | ❌ W0 (extend) | ⬜ pending |
| 146-* | * | * | BUILD-11 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-11"` | ❌ W0 (extend) | ⬜ pending |
| 146-* | * | * | BUILD-13 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "BUILD-13"` | ❌ W0 (extend) | ⬜ pending |
| 146-* | * | * | UIQ-05 | — | N/A | structural content assertion | `npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "UIQ-05"` | ❌ W0 (extend) | ⬜ pending |

Pins: numbered click-by-click script (seat counts, affordances-taught-once, hard-reload build-stamp check, regression line, item-by-item verified checklist), `verified (user-waived)` recordable; 4-way triage (this-chunk/future-scope/not-built-yet/ruling) + disposition report + targeted re-test; close records verified commit hash + sketch-tail delta gate; git protocol `chunk-<slug>/step-<name>` + lock note (cite state-machine.md); final-acceptance 6-check design-QA (SR/zoom/touch/colorblind/both-themes/mobile); REFERENCED_PATHS gains playtest/revise/close/final-acceptance.md; **assert ZERO "authored in Phase" markers remain in build-chunk.md** (skill complete).

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extend `src/cli/slash-command/bs/build-chunk.test.ts` (BUILD-09/10/11/13, UIQ-05 describes; path array; invert forward-ref-marker assertions to zero-remain)
- [ ] No new fixtures or framework installs

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Full playtest/revise/close/final-acceptance run on a real chunk | BUILD-09/10/11/13, UIQ-05 | LLM-executed skill + human-driven browser gate + VoiceOver | Phase 149 end-to-end dry-run |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-04
