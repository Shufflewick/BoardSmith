---
phase: 150-regenerate-the-pipeline-built-go-fish-stable-location
plan: 01
subsystem: testing
tags: [bs-ingest-rules, go-fish, interview-fallback, sketch-derivation, boardsmith-init]

# Dependency graph
requires:
  - phase: 149-end-to-end-dry-run-validation
    provides: the ingest-leg + chunk-1 build-leg dry-run report, HUMAN-UAT script, and standard Go Fish ruleset used as interview input
provides:
  - "~/BoardSmithGames/go-fish-dryrun/ — a durable, git-initialized, compiling, serve-verified Go Fish scaffold outside /tmp"
  - "rulebook/ ingest slices (01-07) + INDEX.md + ASSETS.md + 00-visual-survey.md via the interview-fallback path"
  - "SKETCH.md (core-event-loop detailed, mandated tail sketch-level) + chunks/core-event-loop/CHUNK.md + empty RULINGS.md/DECISIONS.md ledgers"
affects: [150-02-chunk-1-build-leg, 151-human-playtest]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ingest-leg execution against a durable sibling-of-~/BoardSmithGames project directory, not a /tmp scratch dir"
    - "Interview-fallback citation format \"designer statement, ingest session, Q{n}\" mirrored across 7 rulebook slices"

key-files:
  created:
    - "~/BoardSmithGames/go-fish-dryrun/rulebook/01-vision.md through 07-game-end.md"
    - "~/BoardSmithGames/go-fish-dryrun/rulebook/INDEX.md"
    - "~/BoardSmithGames/go-fish-dryrun/rulebook/00-visual-survey.md"
    - "~/BoardSmithGames/go-fish-dryrun/ASSETS.md"
    - "~/BoardSmithGames/go-fish-dryrun/SKETCH.md"
    - "~/BoardSmithGames/go-fish-dryrun/chunks/core-event-loop/CHUNK.md"
    - "~/BoardSmithGames/go-fish-dryrun/RULINGS.md"
    - "~/BoardSmithGames/go-fish-dryrun/DECISIONS.md"
  modified:
    - "~/BoardSmithGames/go-fish-dryrun/boardsmith.json (displayName correction: \"Go Fish Dryrun\" -> \"Go Fish\", the designer's original answer)"

key-decisions:
  - "boardsmith.json displayName corrected to the designer's original \"Go Fish\" (not the lossy kebab-case round-trip \"Go Fish Dryrun\"), per scaffold.md's Display Name correction rule — the project directory name (go-fish-dryrun) stays distinct from the in-game display name by design"
  - "Chunk-1's terminal condition for future testing purposes is scoped to \"pond empty\" (book-forming/scoring is out of chunk-1 scope) — recorded as CHUNK.md Interpretation claim 6, matching the 149 dry-run's proven depth-cut pattern, ahead of Plan 02's build leg"
  - "Task commits landed inside go-fish-dryrun's own git repo (created by boardsmith init), not the BoardSmith repo — sub_repos is empty in config.json, so BoardSmith-repo commits are limited to this SUMMARY + STATE/ROADMAP metadata"

requirements-completed: [GEN-01]

# Metrics
duration: 35min
completed: 2026-07-05
---

# Phase 150 Plan 01: Regenerate the pipeline-built Go Fish (ingest leg) Summary

**Ran the real `bs-ingest-rules` skill (scaffold → interview-fallback → sketch-derivation) against standard Go Fish rules into a durable `~/BoardSmithGames/go-fish-dryrun/` project — not `/tmp` — leaving it compiling, git-initialized, and ready for Plan 02's chunk-1 build leg.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-05T23:47:57Z
- **Tasks:** 3/3 completed
- **Files modified:** 13 (12 created + 1 modified) across the go-fish-dryrun project

## Accomplishments
- `~/BoardSmithGames/go-fish-dryrun/` scaffolded via real `npx boardsmith init`, verified `tsc --noEmit` clean and `npx boardsmith dev --no-open` reachable (curl 200), server killed — no D1/D2 workarounds needed (both fixed at source in Phase 149).
- Full interview-fallback ingest run: 8-question structured interview against the canonical standard Go Fish ruleset, covering all four known ambiguity points explicitly (must-hold-rank-to-ask, matching-draw extra turn, empty-pond end-trigger behavior, 5-vs-7 deal by player count), producing 7 cited rulebook slices + INDEX.md + ASSETS.md + a (deliberately thin, interview-path-appropriate) visual survey.
- Sketch derivation complete: `SKETCH.md` with `core-event-loop` fully detailed (`ui: major`) and the mandated tail (`game-end-scoring`, `final-acceptance`) at sketch-level using the exact byte-identical marker; `chunks/core-event-loop/CHUNK.md` created with 6 cited interpretation claims and the full 10-step ceremony checklist; `RULINGS.md`/`DECISIONS.md` seeded as empty ledgers; no `DESIGN.md` (correctly deferred to the first UI chunk's `ask` step).

## Task Commits

Each task was committed atomically inside `~/BoardSmithGames/go-fish-dryrun`'s own git repo (created by `boardsmith init`; `sub_repos` is empty in `.planning/config.json`, so this plan's deliverable commits are not BoardSmith-repo commits):

1. **Task 1: Scaffold + verify the durable project** - `5bd1f61` (chore) — includes the initial `boardsmith init` scaffold commit `55b7053`
2. **Task 2: Interview-fallback ingest + Step-3 synthesis** - `8c5f316` (feat)
3. **Task 3: Sketch derivation + Step-7 write files** - `d675d0e` (feat)

**Plan metadata (this repo):** committed with this SUMMARY.md, STATE.md, ROADMAP.md, REQUIREMENTS.md

## Files Created/Modified
- `~/BoardSmithGames/go-fish-dryrun/` — entire scaffolded project (boardsmith init output, `boardsmith` dep resolves to `file:/Users/jtsmith/BoardSmith`, `.git/` initialized)
- `~/BoardSmithGames/go-fish-dryrun/boardsmith.json` — displayName corrected to "Go Fish"
- `~/BoardSmithGames/go-fish-dryrun/rulebook/01-vision.md` … `07-game-end.md` — cited interview-fallback slices
- `~/BoardSmithGames/go-fish-dryrun/rulebook/INDEX.md` — term → slice cross-reference
- `~/BoardSmithGames/go-fish-dryrun/rulebook/00-visual-survey.md` — thin interview-path visual evidence
- `~/BoardSmithGames/go-fish-dryrun/ASSETS.md` — component ledger (card face/back placeholders)
- `~/BoardSmithGames/go-fish-dryrun/SKETCH.md` — ordered chunk list, UI Strategy, player counts, mandated tail
- `~/BoardSmithGames/go-fish-dryrun/chunks/core-event-loop/CHUNK.md` — chunk-1 detail, ready for Plan 02's build leg
- `~/BoardSmithGames/go-fish-dryrun/RULINGS.md`, `~/BoardSmithGames/go-fish-dryrun/DECISIONS.md` — empty ledgers

## Decisions Made
- Corrected `boardsmith.json`'s `displayName` to the designer's original "Go Fish" answer rather than leaving the lossy kebab-case round-trip "Go Fish Dryrun" — per `scaffold.md`'s explicit Display Name correction rule. The project/directory name stays `go-fish-dryrun` (visibly distinct from the hand-built `go-fish` reference) by design; only the user-facing display name was corrected.
- Task-level git commits were made inside `go-fish-dryrun`'s own repository (created by `boardsmith init` per the D2 fix), not the BoardSmith repo, since the plan's entire file surface lives outside BoardSmith and `sub_repos` is unconfigured (empty array) — this SUMMARY + STATE/ROADMAP/REQUIREMENTS updates are the only BoardSmith-repo-side commit for this plan.
- Chunk-1's CHUNK.md Interpretation claim 6 pre-documents the "pond empty" terminal-condition depth-cut (mirroring the exact fix the 149 dry-run's build leg had to make reactively after `simulateRandomGames` caught a 100%-timeout bug) so Plan 02's build leg starts from an already-correct interpretation rather than rediscovering the same bug.

## Deviations from Plan

None — plan executed exactly as written. All three tasks' acceptance criteria and automated `<verify>` commands passed without modification to the plan's scope.

## Issues Encountered

None. The 149-dry-run's D1 (tsconfig `vite/client` types) and D2 (`git init` on scaffold) fixes, both already merged at source, meant the fresh scaffold compiled clean and was git-initialized on the first attempt with no workaround needed — confirmed directly rather than assumed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `~/BoardSmithGames/go-fish-dryrun/` is a durable, compiling, git-initialized project ready for Plan 02 to run the real `/bs-build-chunk` machine steps against `chunks/core-event-loop/CHUNK.md`.
- No `boardsmith dev` process was left running (killed and confirmed via `pgrep`); `~/BoardSmithGames/go-fish/` (hand-built reference) was never written to — confirmed clean (`git status --short` empty) at the end of this plan.
- SKETCH.md/CHUNK.md byte-match their templates' PARSE CONTRACT headings in order — Plan 02 can cold-resume from this state without ambiguity.

## Self-Check: PASSED

All created files confirmed present on disk (go-fish-dryrun project files + this SUMMARY.md); all task commit hashes (`55b7053`, `5bd1f61`, `8c5f316`, `d675d0e` in go-fish-dryrun's repo; `62f426a2` in the BoardSmith repo) confirmed present via `git log`.

---
*Phase: 150-regenerate-the-pipeline-built-go-fish-stable-location*
*Completed: 2026-07-05*
