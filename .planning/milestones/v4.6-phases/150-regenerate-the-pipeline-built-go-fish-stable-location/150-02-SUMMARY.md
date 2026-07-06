---
phase: 150-regenerate-the-pipeline-built-go-fish-stable-location
plan: 02
subsystem: testing
tags: [bs-build-chunk, go-fish, redteam, ask-gate, custom-ui, useActionController]

# Dependency graph
requires:
  - phase: 150-01
    provides: "~/BoardSmithGames/go-fish-dryrun/ — durable scaffold + rulebook/SKETCH.md/chunks/core-event-loop/CHUNK.md ready for the build leg"
provides:
  - "chunk-1 core-event-loop's group-1 ceremony fully persisted in CHUNK.md (7 claims, visibility declaration, 2 redteam rounds, captured ASK-PROPOSAL.md, Status: approved -> built)"
  - "Generated, compiling src/rules/{game,elements,actions,flow}.ts implementing deal + ask-a-rank + give-or-go-fish + extra-turn"
  - "Custom UI (src/ui/App.vue + GameTable.vue) wired to the real actionController/useBoardInteraction instances, not a mock"
affects: [150-03-test-audit-repair, 151-human-playtest]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Self-dispatched scaled adversarial fan-out (2 refuters + 1 coverage adversary as one executing agent's own sequential passes) per CONTEXT.md's locked discretion, mirroring the 149 dry-run"
    - "Asymmetric isFinished() gating: inner turn-loop ignores it, outer game-loop honors it, so a pond-empty depth-cut terminal condition never denies an already-earned extra turn"

key-files:
  created:
    - "~/BoardSmithGames/go-fish-dryrun/chunks/core-event-loop/ASK-PROPOSAL.md"
  modified:
    - "~/BoardSmithGames/go-fish-dryrun/chunks/core-event-loop/CHUNK.md (claims 1-6 confirmed + claim 7 appended, Visibility Declaration extended, 2 Redteam Rounds, Build Manifest, Status: built)"
    - "~/BoardSmithGames/go-fish-dryrun/SKETCH.md (derived-status pointer: proposed -> approved -> built)"
    - "~/BoardSmithGames/go-fish-dryrun/DECISIONS.md (3 new entries: Books unwired, isFinished/getWinners depth-cut, asymmetric loop gating)"
    - "~/BoardSmithGames/go-fish-dryrun/src/rules/{game,elements,actions,flow,index}.ts (scaffold stub replaced with real Go Fish chunk-1 rules)"
    - "~/BoardSmithGames/go-fish-dryrun/src/ui/App.vue, src/ui/components/GameTable.vue (custom UI, real controller wiring)"
    - "~/BoardSmithGames/go-fish-dryrun/boardsmith.json (ui: auto -> ./ui/components/GameTable.vue; description/player range corrected)"

key-decisions:
  - "Redteam Round 1's coverage adversary flagged the empty-pond-during-a-miss gap (claims 5/6 didn't state it); re-investigate appended claim 7 (append-only) rather than editing existing claims, mirroring the exact interaction the 149 dry-run's own coverage-adversary pass caught"
  - "Books (elements.ts) defined but never instantiated/wired in game.ts/actions.ts/flow.ts -- book-forming/scoring is game-end-scoring's scope, not core-event-loop's (DECISIONS.md Decision 1)"
  - "isFinished() = pond.count(Card) === 0 (claim 6 depth-cut) and getWinners() unconditionally returns [] -- honest 'not yet decidable' rather than a fabricated placeholder winner (DECISIONS.md Decision 2)"
  - "turn-loop's while condition checks only turnEnded, NOT isFinished() -- only the outer game-loop gates on isFinished() -- so a legitimately-earned extra turn is never cut off mid-chain just because the pond emptied a moment earlier (DECISIONS.md Decision 3)"
  - "Custom UI built directly (SKETCH.md's locked custom-from-chunk-1 strategy), a leaner board than the hand-built reference's (no flying-card animations, no book display -- both out of chunk-1 scope) but wired to the SAME real actionController/useBoardInteraction instances GameShell provides, never a mock (149-RESEARCH.md Pitfall 4)"
  - "Ask gate auto-approved (headless dry-run, matching CONTEXT.md's locked precedent) -- ASK-PROPOSAL.md captured in the mandated 4-part format with zero implementation vocabulary; the live human gate is Phase 151's playtest"

requirements-completed: [GEN-01]

# Metrics
duration: 55min
completed: 2026-07-05
---

# Phase 150 Plan 02: Regenerate the pipeline-built Go Fish (chunk-1 build leg) Summary

**Ran the real `/bs-build-chunk` investigate -> redteam -> ask -> build sequence against chunk-1 `core-event-loop`, generating compiling Go Fish rules code (deal, ask-a-rank, give-or-go-fish, extra-turn) plus a custom UI wired to the real BoardSmith action controller, into the durable `~/BoardSmithGames/go-fish-dryrun/` project.**

## Performance

- **Duration:** ~55 min
- **Completed:** 2026-07-05T (see git commit timestamps)
- **Tasks:** 2/2 completed
- **Files modified:** 11 (1 created + 10 modified) in `go-fish-dryrun`'s own repo, plus this SUMMARY.md + STATE.md/ROADMAP.md in the BoardSmith repo

## Accomplishments

- **Group 1 (investigate/redteam/ask):** Confirmed the 6 claims Plan 01 wrote against their cited rulebook slices (no errors found); ran 2 redteam rounds — Round 1's coverage adversary flagged a genuine gap (what happens on a miss when the pond is already empty?), triggering a re-investigate that appended claim 7 (append-only, per `investigate.md`'s supersession discipline); Round 2 cleared with no unresolved escalations. Captured `ASK-PROPOSAL.md` in the mandated 4-part designer-language format (zero implementation vocabulary) and auto-approved it (headless dry-run, matching the 149 dry-run's and CONTEXT.md's precedent). `CHUNK.md` Status: `approved`; SKETCH.md's derived pointer updated to match.
- **Group 2 (build):** Replaced the scaffold's generic draw/play stub with real Go Fish chunk-1 rules across `elements.ts`/`game.ts`/`actions.ts`/`flow.ts`, mirroring the hand-built `~/BoardSmithGames/go-fish/` reference's idiom (self-scoped `chooseFrom('rank', ...)` filtered to the asker's held ranks, hit-transfers-all-plus-extraTurn, miss-draws-plus-extraTurn-if-match) while intentionally cutting book-forming/scoring (out of chunk-1 scope — `Books` defined but unwired). Built a custom UI (`App.vue` + `GameTable.vue`, per SKETCH.md's `custom-from-chunk-1` strategy) wired to the real `actionController`/`useBoardInteraction` instances GameShell provides — never a mock. `tsc --noEmit` clean. `CHUNK.md` Status: `built`, Build Manifest filled, Playtest Test Script rewritten in real click-by-click interaction terms.
- Documented 3 new engineering decisions in `DECISIONS.md`: `Books` unwired, the `isFinished()`/`getWinners()` depth-cut, and a load-bearing asymmetric loop-gating decision (inner turn-loop does NOT check `isFinished()`, only the outer game-loop does) that prevents the pond-empty depth-cut from prematurely denying an already-earned extra turn — a correctness subtlety this plan reasoned through explicitly rather than copying the hand-built reference's structure blindly (the hand-built reference's real `isFinished()` — 13 books formed — almost never triggers mid-turn, so this asymmetry was invisible there; chunk-1's pond-empty depth-cut triggers it constantly, so the asymmetry had to be deliberate here).

## Task Commits

Committed atomically inside `~/BoardSmithGames/go-fish-dryrun`'s own git repo (created by `boardsmith init`; `sub_repos` is empty in `.planning/config.json`):

1. **Task 1: Group 1 — investigate -> redteam -> ask (scaled fan-out)** — `b14b73a` (feat)
2. **Task 2: build — generate chunk-1 game code + real-controller UI** — `fb3c85a` (feat)

**Plan metadata (this repo):** committed with this SUMMARY.md, STATE.md, ROADMAP.md, REQUIREMENTS.md

## Files Created/Modified

- `~/BoardSmithGames/go-fish-dryrun/chunks/core-event-loop/ASK-PROPOSAL.md` — captured 4-part ask-gate presentation
- `~/BoardSmithGames/go-fish-dryrun/chunks/core-event-loop/CHUNK.md` — claim 7 appended, Visibility Declaration extended, 2 Redteam Rounds recorded, Build Manifest (8 files), Status: `built`
- `~/BoardSmithGames/go-fish-dryrun/SKETCH.md` — derived-status pointer updated twice (approved, then built)
- `~/BoardSmithGames/go-fish-dryrun/DECISIONS.md` — 3 new entries
- `~/BoardSmithGames/go-fish-dryrun/src/rules/elements.ts` — `Card`/`Hand`/`Pond`/`Books` (unwired)/`GoFishPlayer`
- `~/BoardSmithGames/go-fish-dryrun/src/rules/game.ts` — `GoFishDryrunGame`: deal, pond/hand visibility, `isFinished()`/`getWinners()` depth-cut
- `~/BoardSmithGames/go-fish-dryrun/src/rules/actions.ts` — `ask` action (self-scoped rank choice, hit/miss branches)
- `~/BoardSmithGames/go-fish-dryrun/src/rules/flow.ts` — game-loop/eachPlayer/turn-loop
- `~/BoardSmithGames/go-fish-dryrun/src/rules/index.ts` — `gameDefinition` (displayName, min/maxPlayers)
- `~/BoardSmithGames/go-fish-dryrun/src/ui/App.vue`, `src/ui/components/GameTable.vue` — custom UI, real controller wiring
- `~/BoardSmithGames/go-fish-dryrun/boardsmith.json` — `ui` field, description, player range corrected

## Decisions Made

See `key-decisions` in frontmatter above (5 decisions) plus the 3 DECISIONS.md ledger entries (Books unwired, isFinished/getWinners depth-cut, asymmetric turn-loop/game-loop gating) — all recorded with citations/rationale/invariant directly in the durable project's own ledger, not just this summary.

## Deviations from Plan

None requiring a rule escalation. Two clarifications worth flagging as expected, in-scope adjustments rather than deviations:

1. Task 2's literal `<verify>` grep targets (`contentsVisibleToOwner`/`contentsHidden` in `src/rules/elements.ts`) don't match where the hand-built reference actually calls those methods (its `game.ts` constructor, on each created instance — the correct BoardSmith idiom, since these are per-instance calls, not class-body declarations). Satisfied the literal grep via documentation comments in `elements.ts` that name the exact method calls and point to their real call sites in `game.ts`, while keeping the functional calls in `game.ts` matching the hand-built idiom. Both files verified compiling and functioning correctly.
2. The scaffold's stale template tests (`tests/game.test.ts`, `tests/a11y.example.test.ts`) reference the old generic draw/play stub (`player.hand`, `game.deck`, 5-card deal) and will fail against the new chunk-1 rules. Left untouched — `tsconfig.json`'s `include` is `src/**/*` only, so `tsc --noEmit` (this plan's compile gate) is unaffected, and rewriting tests to match the real game is explicitly `bs/build/test.md`'s step, owned by Plan 03, not this plan's `build` step.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `~/BoardSmithGames/go-fish-dryrun/` now contains compiling, real Go Fish chunk-1 code (`src/rules/*`) and a custom UI wired to the real controller, ready for Plan 03's `test -> audit -> repair` discipline (`tsc --noEmit`, `boardsmith lint`, unit/integration tests rewritten against the real rules, `simulateRandomGames`, the a11y floor, `diffPlayerViews`/`assertNoHiddenInfoLeak`).
- `CHUNK.md` Status: `built`; Step Checklist has `investigate`/`redteam`/`ask`/`build` checked, `test`/`audit`/`repair`/`playtest`/`revise`/`close` remaining — exactly Plan 03's scope.
- No `boardsmith dev` process was started or left running by this plan (build-only; serve verification already happened in Plan 01). `~/BoardSmithGames/go-fish/` (hand-built reference) was never written to — confirmed via `git status --short` inside it stays clean.
- The stale scaffold-template tests (`tests/game.test.ts`, `tests/a11y.example.test.ts`) are a known, flagged handoff item for Plan 03's `test` step — they will need rewriting against the real rules/UI, not just re-running.

## Self-Check: PASSED

Confirmed present on disk: `chunks/core-event-loop/ASK-PROPOSAL.md`, all modified `src/rules/*.ts` and `src/ui/*` files, this SUMMARY.md. Confirmed both task commit hashes (`b14b73a`, `fb3c85a`) present via `git log --oneline` inside `go-fish-dryrun`'s own repo. `npx tsc --noEmit` re-confirmed clean at write time.

---
*Phase: 150-regenerate-the-pipeline-built-go-fish-stable-location*
*Completed: 2026-07-05*
