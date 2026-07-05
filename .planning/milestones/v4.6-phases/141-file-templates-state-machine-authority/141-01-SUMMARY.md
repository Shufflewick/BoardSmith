---
phase: 141-file-templates-state-machine-authority
plan: 01
subsystem: cli
tags: [markdown, cli-slash-command, state-machine, vitest, drift-protection]

# Dependency graph
requires: []
provides:
  - "src/cli/slash-command/bs/state-machine.md — shared authority-rules doc every bs- skill cites (TMPL-02/TMPL-03)"
  - "src/cli/slash-command/bs/templates.test.ts — drift-protection vitest scaffold with state-machine.md invariants, extension points for Plans 02/03"
affects: [141-02, 141-03, 142, 143, 144, 145, 146, 147]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared reference doc pattern: state-machine.md mirrors aspects/index.md's bold-lead-in rules-list style; standalone full content, not a thin `{{BOARDSMITH_ROOT}}` pointer"
    - "Disk-read content-assertion drift test: readFileSync + join(__dirname, ...) + toContain, mirroring src/cli/commands/init.test.ts — no markdown parser, no new dependency"

key-files:
  created:
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/templates.test.ts
  modified: []

key-decisions:
  - "state-machine.md is standalone full content (not a thin pointer) per CONTEXT.md's locked decision — every bs- skill cites it rather than duplicating rules"
  - "templates.test.ts describe blocks are named by requirement ID (TMPL-03, TMPL-02) so `-t \"TMPL-03\"` selectors work, per the RESEARCH.md test-map convention"
  - "No markdown parser or schema validator added — plain string/regex assertions suffice for the deliberately simple Status: line grammar"

patterns-established:
  - "TODO comment markers reserve Plan 02 (CHUNK/SKETCH) and Plan 03 (ledger templates) extension points in templates.test.ts without restructuring the file"

requirements-completed: [TMPL-03, TMPL-02]

# Metrics
duration: 12min
completed: 2026-07-04
---

# Phase 141 Plan 01: File Templates & State-Machine Authority — Foundational Docs Summary

**Wrote the standalone state-machine.md authority-rules reference (exact status enum, 10-step full-ceremony + 3-step light-path names, CHUNK-wins/write-order/cold-resume/consistency/git/repair/escalation/handoff rules) and a green drift-protection vitest scaffold asserting every invariant against it, verbatim-transcribed from bs-skills-plan.md with no reinterpretation.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-04
- **Tasks:** 2/2 completed
- **Files modified:** 2 created, 0 modified

## Accomplishments
- `state-machine.md` transcribes the full authority/write-order/cold-resume/consistency-check/rulings/restyle-cutover/session-lock/git-protocol/repair-loop-bound/redteam-escalation/session-handoff rule set verbatim from `.planning/bs-skills-plan.md`, matching `aspects/index.md`'s bold-lead-in registry style
- `templates.test.ts` scaffolded with the project's standard `readFileSync`/`__dirname` disk-read content-assertion pattern (mirroring `init.test.ts`), green on first run, with TODO markers reserving Plan 02/03 extension points
- Every exact string required by the plan's interfaces block (status enum tokens, em-dash stale marker, both step-name lists, authority/write-order/parse-contract sentences) is present and test-asserted

## Task Commits

Each task was committed atomically:

1. **Task 1: Write state-machine.md authority-rules doc** - `e0081296` (feat)
2. **Task 2: Scaffold templates.test.ts with state-machine.md drift assertions** - `44376d05` (test)

_No TDD gate applies — plan type is `execute`, not `tdd`._

## Files Created/Modified
- `src/cli/slash-command/bs/state-machine.md` - Standalone shared authority-rules doc: status enum, step names, authority (CHUNK.md wins), write order, cold-resume parse contract, consistency check, rulings-outrank-rulebook, restyle/cutover, session lock, git protocol, repair loop bound, redteam escalation, session handoff seams
- `src/cli/slash-command/bs/templates.test.ts` - Drift-protection vitest: describe blocks `TMPL-03 — authority & write order`, `TMPL-02 — parse contract`, `TMPL-01/02/03 — shared enum & step-name invariants`; 9 tests, all green

## Verification

- `npx vitest run src/cli/slash-command/bs/templates.test.ts` — 9/9 tests passed
- `grep -c "state-machine.md" src/cli/slash-command/bs/state-machine.md` — returns `0`, confirming the file is standalone (self-title only, no self-referential thin-pointer text)
- Manual grep confirmed all three plan-mandated acceptance strings present: `CHUNK.md wins`, `stale — re-derive before build` (em-dash), and the exact 10-word step-name list

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria were met without needing any Rule 1-4 auto-fixes; this phase ships zero runtime code (per its own threat model, disposition `accept` — no attack surface).

## Known Stubs

None. Both files are complete, final content for this plan's scope — no placeholder/TODO markers except the explicitly plan-sanctioned "extension point" TODOs in `templates.test.ts` documenting where Plans 02/03 will add assertions (not stubbed functionality).

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or schema changes at trust boundaries were introduced — consistent with the plan's own threat model disposition (`accept`, no attack surface: static markdown + content-assertion test only).

## Self-Check: PASSED

- FOUND: src/cli/slash-command/bs/state-machine.md
- FOUND: src/cli/slash-command/bs/templates.test.ts
- FOUND commit e0081296 in git log
- FOUND commit 44376d05 in git log
