---
phase: 176-stale-chunk-repair
plan: 01
subsystem: cli
tags: [ruling-parser, verdict-enum, ledger, atomic-write, verify-pipeline]

# Dependency graph
requires:
  - phase: 175-impact-map-repair-gating
    provides: verify-run.ts's atomicWriteFile/stagingSlicesDir/RUN_ID_RE, verify-classify.ts's enumerate-and-record split precedent
provides:
  - "ParsedRuling.body — parseRulings additively widened with per-ruling Decision/Citation/Rationale text"
  - "RULING_VERDICTS frozen four-value enum (still-needed/resolved-by-source/contradicted/undetermined)"
  - "enumerateRulingsForRecheck — supersession skip/report split (both directions, unparseable chains reported not assumed)"
  - "resolveFreshTranscription — scope-limited detection, never a live rulebook/ slice fallback"
  - "createRulingVerdictRecord — enum + non-empty-reasoning validation"
  - "verifyRulingRecheckCommand + recordRulingVerdicts — read-only report / atomic-write-only record"
affects: [176-03-ruling-recheck-skill-text, 176-04-verify-game-routing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive parser widening: new field populated from an already-computed local, never a second regex/scan"
    - "Frozen-array + derived-type + pinning test for every enumerated verdict set"
    - "Enumerate-and-record split: CLI enumerates and validates, subagent judges, exactly one atomic write path"
    - "Discriminated scope-limited result instead of throw, mirroring PROV-02's honest-partial-report pattern"

key-files:
  created:
    - src/cli/commands/verify-ruling-recheck.ts
    - src/cli/commands/verify-ruling-recheck.test.ts
  modified:
    - src/cli/commands/build-manifest.ts
    - src/cli/commands/build-manifest.test.ts

key-decisions:
  - "resolveFreshTranscription never throws — it always returns a discriminated { scopeLimited: true/false } result, even for a malformed --run-id or an empty staged-slices directory, so a caller can never be surprised by an exception where the plan calls for an honest scope-limited report."
  - "The 'never a live rulebook/ slice path' guarantee is enforced structurally: every path this module can return is rooted at stagingSlicesDir's dot-prefixed rulebook/.verify/<runId>/ tree, which can never collide with a bare rulebook/<file>.md live slice reference."
  - "CHECK-01 is NOT marked complete in REQUIREMENTS.md by this plan — ROADMAP.md's own plan breakdown shows CHECK-01 also needs 176-03's judgment-subagent skill text and 176-04's live-proof/routing before the requirement is genuinely closed. Marking it complete now would misrepresent a mechanics-only plan as a finished requirement."

patterns-established:
  - "Additive interface widening (ParsedRuling.body): extend a shared parser's return shape by reusing a local it already computes, never forking the function or adding a second parse pass."
  - "Verdict-set discretion, subagent judges: a CLI module can validate an externally-supplied enum value and require non-empty reasoning without itself containing any judgment heuristic — enforced here by a grep-style source assertion."

requirements-completed: []  # CHECK-01's mechanics only — see key-decisions; full closure is 176-03/176-04.

# Metrics
duration: ~35min
completed: 2026-07-30
---

# Phase 176 Plan 01: CHECK-01 Mechanics Summary

**`parseRulings` widened with per-ruling body text, a frozen four-value `RULING_VERDICTS` enum, a supersession skip/report split handling both directions, scope-limited fresh-transcription detection, and atomic-write-only verdict recording — all with zero absence-detection heuristics in code.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3/3 completed
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `ParsedRuling` gains a `body: string` field, populated from the `body` local `parseRulings` already computes internally — zero new regex, zero second scan pass, and a grep-gate test proves exactly one `### Ruling (\d+)` heading regex declaration exists under `src/cli/`.
- `RULING_VERDICTS` — `['still-needed', 'resolved-by-source', 'contradicted', 'undetermined']` — frozen, derived-typed, pinning-tested; `undetermined` is reachable and never collapsed.
- `enumerateRulingsForRecheck` skips superseded rulings in both directions (proven against `seven`'s real direction-reversed `⚠ RATIONALE SUPERSEDED BY RULING 9` shape) and reports — never assumes — unparseable supersede sentences, which still enumerate for re-check.
- `resolveFreshTranscription` reports `scopeLimited: true` (never throws, never falls back to a live `rulebook/` slice) for: no staged run, a malformed `--run-id`, or an empty staged-slices directory. Otherwise resolves the staged run's `.md` slice paths.
- `verifyRulingRecheckCommand` reports one row per enumerated ruling (verdict-or-`pending`, reasoning), uncapped, plus `verdictCounts`; is read-only against `RULINGS.md` (pinned by a whole-directory sha256 test); throws an actionable `--project`-naming message with no stack/path leak on a missing project.
- `recordRulingVerdicts` persists through `atomicWriteFile` only — a source-guard test proves no hand-rolled `fs.writeFile`/`writeFileSync` exists in the module.
- A source assertion proves no absence-phrase list (`never reproduces`, `entirely silent`, `absent from`, etc.) exists anywhere in `verify-ruling-recheck.ts` — the absence-of-source judgment (`seven`'s Ruling 1) stays entirely in the subagent's hands.

## Task Commits

Each task was committed atomically:

1. **Task 1: Widen parseRulings additively with per-ruling body text** - `7bc6a3d5` (feat)
2. **Task 2: RULING_VERDICTS enum, ruling enumeration, and scope-limited detection** - `9b6f0d32` (feat)
3. **Task 3: verifyRulingRecheckCommand — recording verdicts through the one atomic write path** - `5a2ec394` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/cli/commands/build-manifest.ts` - `ParsedRuling.body` added, populated from the already-computed `body` local
- `src/cli/commands/build-manifest.test.ts` - body-text, reversed-direction-marker, end-of-file, and grep-gate tests added
- `src/cli/commands/verify-ruling-recheck.ts` - new module: `RULING_VERDICTS`, `createRulingVerdictRecord`, `enumerateRulingsForRecheck`, `resolveFreshTranscription`, `verifyRulingRecheckCommand`, `recordRulingVerdicts`
- `src/cli/commands/verify-ruling-recheck.test.ts` - 21 tests covering every behavior above

## Decisions Made
- `resolveFreshTranscription` never throws (see key-decisions above) — a deliberate, deviation-free choice consistent with the plan's "report scope-limited, never silently fall back" requirement, even though the two closest existing precedents (`verify-classify.ts`'s `resolveRunId`, `verify-run.ts`'s `verifyRunStatusCommand`) both throw on an unresolvable run. This is not a deviation from either precedent's *contract* — neither is imported or reused here — it is a new function built to this plan's own explicit report-don't-throw requirement.
- The "no live `rulebook/` slice path" guarantee is enforced structurally (every returned path is rooted at the dot-prefixed `.verify/` staging tree) rather than via a runtime assertion, and is tested with a regex (`/(^|\/)rulebook\/[^.]/`) matching any live, non-dot-prefixed `rulebook/` path.
- CHECK-01 was intentionally NOT marked complete in `REQUIREMENTS.md` — the phase's own `ROADMAP.md` plan breakdown assigns CHECK-01 to three plans (176-01 mechanics, 176-03 skill text, 176-04 live proof/routing); this plan is 176-01 only.

## Deviations from Plan

None - plan executed exactly as written. All three tasks' `must_haves`/`acceptance_criteria` are met by the code and tests as designed; no bug fixes, missing-functionality additions, or blocking-issue fixes were required beyond the plan's own specified behavior.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `parseRulings`'s `body` field, `RULING_VERDICTS`, `enumerateRulingsForRecheck`, and `resolveFreshTranscription` are all ready for 176-03's `verify/ruling-recheck.md` judgment-subagent dispatch skill text to consume directly — no further mechanics are needed on the CHECK-01 side before that skill text can be written.
- `verifyRulingRecheckCommand`/`recordRulingVerdicts` are ready for CLI registration in `cli.ts` (deferred to 176-03 per `176-PATTERNS.md`'s file classification) and for the live SC-3 proof against `seven`'s Ruling 1 (176-04).
- `npm test`: 3851/3851 green (baseline 3826 + 25 new tests, zero regressions). `npx tsc --noEmit`: only the pre-existing permitted `docs/seed-to-state.test.ts` rootDir error.

---
*Phase: 176-stale-chunk-repair*
*Completed: 2026-07-30*

## Self-Check: PASSED

All created files and all four commit hashes verified present on disk / in `git log --oneline --all`.
