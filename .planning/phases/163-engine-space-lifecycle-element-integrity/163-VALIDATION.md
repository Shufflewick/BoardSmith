---
phase: 163
slug: engine-space-lifecycle-element-integrity
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-21
---

# Phase 163 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run <changed test file>` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~90s full suite; per-file <10s |

---

## Sampling Rate

- **After every task commit:** Run the plan's changed test file(s) via `npx vitest run <file>`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 163-01-01 | 01 | 1 | SPACE-01/02, PROC-01 | T-163-01 | RED proves sealed removal wrongly succeeds + Space reparent absent | unit (RED) | `npx vitest run src/engine/element/space.test.ts` | ❌ W0 (net-new cases) | ⬜ pending |
| 163-01-02 | 01 | 1 | SPACE-01 | T-163-01/02/03 | Sealed removal throws before splice; adds allowed; survives restore | unit | `npx vitest run src/engine/element/space.test.ts` | ✅ | ⬜ pending |
| 163-01-03 | 01 | 1 | SPACE-02 | — | Space reparent fires own onExit; children ride along | unit | `npx vitest run src/engine/element/space.test.ts` | ✅ | ⬜ pending |
| 163-02-01 | 02 | 1 | SPACE-03, PROC-01 | T-163-24 | RED proves hidden leaks childCount today | unit (RED) | `npx vitest run src/engine/element/deck-hand-visibility.test.ts` | ❌ W0 (net-new cases) | ⬜ pending |
| 163-02-02 | 02 | 1 | SPACE-03 | T-163-24/25 | hidden emits no count/placeholders; count-only + Phase-159 redaction intact | unit | `npx vitest run src/engine/element/deck-hand-visibility.test.ts src/engine/element/zone-visibility-restore.test.ts src/engine/element/image-leak.test.ts` | ✅ | ⬜ pending |
| 163-03-01 | 03 | 2 | SPACE-04, PROC-01 | T-163-26 | RED proves silent clobber (no throw) today | unit (RED) | `npx vitest run src/engine/element/game.test.ts` | ❌ W0 (net-new cases) | ⬜ pending |
| 163-03-02 | 03 | 2 | SPACE-04 | T-163-26/27 | Collision throws in dev; same-ctor + builtin-override + minified no-throw | unit | `npx vitest run src/engine/element/game.test.ts` | ✅ | ⬜ pending |
| 163-04-01 | 04 | 1 | SPACE-05, PROC-01 | T-163-28 | RED proves availableActions superset of actionMetadata today | unit (RED) | `npx vitest run src/engine/element/action-metadata.test.ts` | ❌ W0 (net-new cases) | ⬜ pending |
| 163-04-02 | 04 | 1 | SPACE-05 | T-163-28/29 | availableActions === keys(actionMetadata); UI no-metadata no-op | unit | `npx vitest run src/engine/element/action-metadata.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All test FILES already exist; each RED task adds NET-NEW CASES to an existing file (no new framework, no
new file scaffolding needed):
- [ ] `src/engine/element/space.test.ts` — add sealed-removal + reparent + sealed-survives-restore cases (SPACE-01/02)
- [ ] `src/engine/element/deck-hand-visibility.test.ts` + `zone-visibility-restore.test.ts` — add hidden-count-suppression cases (SPACE-03)
- [ ] `src/engine/element/game.test.ts` — add class-name-collision cases (SPACE-04)
- [ ] `src/engine/element/action-metadata.test.ts` — add availableActions/actionMetadata divergence cases (SPACE-05)

Each RED case must be observed failing on pre-fix source and captured verbatim in its commit body (PROC-01).

---

## Manual-Only Verifications

*None. All five defects (SPACE-01..05) have automated engine/session-level verification. D26's UI no-op
is covered at the controller/session boundary; no browser-only behavior is in scope.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (all net-new cases in existing files)
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-21
