---
phase: 149
slug: end-to-end-dry-run-validation
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-05
---

# Phase 149 — Validation Strategy

> Per-phase validation contract. This is a DRY-RUN/validation phase — most of its
> "verification" is the dry-run itself producing working artifacts + the pipeline
> defect fixes staying green; the human browser-playtest is inherently manual.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x (BoardSmith bs/ drift suites); the dry-run's generated Go Fish chunk-1 runs its OWN generated vitest + BoardSmith testing primitives (simulateRandomGames, diffPlayerViews, assertNoHiddenInfoLeak) |
| **Config file** | `vitest.config.ts` (BoardSmith); the scratch project has its own |
| **Quick run command** | `npx vitest run src/cli/slash-command/bs/` (drift suites — must stay green after any pipeline-defect skill fixes) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~60s BoardSmith suite; the dry-run itself is a multi-subagent run |

---

## Sampling Rate

- **After any bs- skill-file fix (pipeline defect):** Run `npx vitest run src/cli/slash-command/bs/` — the drift suites must stay green
- **After the dry-run's chunk-1 build:** the generated code must compile (`tsc --noEmit`) and pass its automated test step (unit/integration + random-sim + a11y floor if UI)
- **Before phase close:** BoardSmith `npm test` full suite green (no regression from skill fixes)
- **Max feedback latency:** 90 seconds for the BoardSmith suite

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 149-* | * | * | VAL-01 | — | hidden-hand redaction proven via diffPlayerViews/assertNoHiddenInfoLeak on generated code | dry-run + automated checks on generated code | (dry-run harness; generated `npm test` in scratch dir) | ❌ produced by dry-run | ⬜ pending |
| 149-* | * | * | VAL-01 | — | N/A | drift-suite regression after skill fixes | `npx vitest run src/cli/slash-command/bs/` | ✅ | ⬜ pending |

The dry-run's own success is evidenced by: ingest produces a template-parseable SKETCH.md + rulebook slices + a compiling scaffold; chunk-1 build produces code that compiles and passes its automated test step; the audit's two-seat leak diff confirms opponent hands are redacted; the comparison-vs-hand-built table is documented; every surfaced pipeline defect is fixed with bs/ drift suites staying green.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Scratch workspace for the dry-run (throwaway dir; go-fish hand-built repo READ-ONLY, never modified)
- [ ] `file:` dep on this BoardSmith repo for the scaffold (mirrors sibling-game setup)
- [ ] No new BoardSmith deps; any pipeline-defect fixes are to bs- skill markdown (+ drift-test updates in lockstep)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Human browser-playtest of the dry-run's chunk-1 (the playtest GATE) | VAL-01 | The playtest gate is human-verification-by-design; can't finish headless | The dry-run captures the playtest script as a HUMAN-UAT item; the user runs `npx boardsmith dev` on the scratch project (or the hand-built go-fish) and walks the numbered script when back. This is the ONE deferred gate the milestone ships with outstanding |
| Live end-to-end run inside a real Claude Code session with the installed skills | VAL-01 | Requires a live Claude Code + human designer | Deferred; the source-run dry-run is the autonomous proxy |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies OR a documented manual-only entry
- [x] Sampling continuity: the bs/ drift suite is the continuous automated signal
- [x] Wave 0 covers the scratch-workspace + read-only-baseline setup
- [x] No watch-mode flags
- [x] Feedback latency < 90s for the BoardSmith suite
- [x] `nyquist_compliant: true` set in frontmatter (manual playtest gate is inherent to VAL-01, documented)

**Approval:** approved 2026-07-05
