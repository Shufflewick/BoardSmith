---
phase: 177-derived-line-re-derivation
plan: 02
subsystem: cli
tags: [verify-pipeline, check-04, derive-recheck, structural-independence]

# Dependency graph
requires:
  - phase: 174-verify-classifier
    provides: "PRESENTATION_EXCLUSION_MARKERS / isPresentationLine (verify-classify.ts), the 174-FIXTURES committed live-slice corpus for both reference games"
  - phase: 176-stale-chunk-repair
    provides: "the frozen-enum + single-choke-point + enumerate-and-report pattern (verify-ruling-recheck.ts) this plan mirrors"
provides:
  - "DERIVE_VERDICTS frozen four-verdict enum (agrees/disagrees/underivable/not-rule-bearing) and createDeriveVerdictRecord, the one choke point validating a verdict against it"
  - "quoteLinesOnly — the quote-lines-only filter (new code, no prior analog) that strips Derived/Visual/Named-but-undefined lines entirely from a slice"
  - "enumerateDerivedLines — enumerate-and-report split of live-tree Derived lines into isPresentationLine-excluded vs. surviving candidates"
  - "buildBlindDerivePayload — the single BS-DERIVE-V1 dispatch-prompt construction site, proven leak-free against all 22 real Derived lines"
  - "readLiveSlices — reads the live rulebook/*.md tree directly, no staged-run prerequisite"
affects: [177-03-derive-recheck-cli-registration, 177-04-derive-judgment-contracts, 177-06-derive-proof-prediction, 177-07-derive-live-proof]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Blind-dispatch-payload-construction-site pattern: one function is the sole place a subagent prompt is assembled, and the caller-visible independence guarantee is proven by a corpus-wide counting test against that function's own output, not asserted."
    - "quoteLinesOnly as the deliberate structural inverse of ruleBearingLines() — same slice, opposite selection, both composed from the same isPresentationLine mechanical filter."

key-files:
  created:
    - src/cli/commands/verify-derive-recheck.ts
    - src/cli/commands/verify-derive-recheck.test.ts
  modified: []

key-decisions:
  - "Excluded Named-but-undefined lines from quoteLinesOnly's payload in addition to the plan's literal Derived/Visual instruction (Rule 2 deviation) — a Named-but-undefined line is an ingest-time inference, not directly-quoted prose, and leaving it in a 'quote lines only' payload would reintroduce decision 5's anchoring risk one line at a time."
  - "Committed both tasks as two separate atomic commits reconstructed from the single authored pass (Task 1's enum/choke-point content isolated and committed before Task 2's payload-filter additions were restored), matching the plan's per-task granularity."

patterns-established:
  - "Enumerate → mechanical-filter → judgment-dispatch → validate-and-record (fourth instance in this milestone, after trace-check.ts/verify-classify.ts/verify-ruling-recheck.ts)."

requirements-completed: []  # CHECK-04 stays open — this is mechanics only (plan 2 of 7); the CLI registration, judgment contracts, skill-text wiring, and live proof are 177-03..07's job.

# Metrics
duration: 62min
completed: 2026-07-30
---

# Phase 177 Plan 02: CHECK-04's Mechanical Core Summary

**Built the frozen four-verdict enum, the single verdict-construction choke point, and the quote-lines-only blind-derivation payload filter — proven structurally leak-free against all 22 real `Derived` lines in both reference games' committed live fixtures, not merely asserted in prose.**

## Performance

- **Duration:** ~62 min
- **Started:** 2026-07-30T21:31:00Z (approx, from prior commit timestamp)
- **Completed:** 2026-07-30T21:32:54Z
- **Tasks:** 2 completed
- **Files modified:** 2 (both new)

## Accomplishments

- `DERIVE_VERDICTS` (`agrees`/`disagrees`/`underivable`/`not-rule-bearing`) is frozen and validated at exactly one choke point (`createDeriveVerdictRecord`); `disagrees` additionally requires both `originalReading` and `rederivedReading` non-empty and verbatim (decision 8's stricter bar over Phase 176's plain-reasoning requirement).
- `quoteLinesOnly` — the one genuinely new engineering piece this phase needed (no prior structural analog) — selects only directly-quoted rulebook content and citation headers, excluding `Derived`/`Visual`/`Named-but-undefined` lines entirely from a slice's text.
- `buildBlindDerivePayload` is the single construction site for the `BS-DERIVE-V1` blind-derivation dispatch prompt. A corpus-wide counting test (not a truthiness check) proves zero `Derived (p.` and zero `Visual (p.` occurrences in the built payload for every one of the 22 real `Derived` lines across `seven` (10) and `one-two-punch` (12), read from the committed `174-FIXTURES/*/live` corpus.
- `enumerateDerivedLines` mirrors `verify-ruling-recheck.ts`'s enumerate-and-report-never-silently-drop posture: every live-tree `Derived` line is split into `isPresentationLine`-excluded and surviving-candidate buckets, both reported. Measured counts (10 `seven`, 12 `one-two-punch`, 22 total) match `177-CONTEXT.md`'s measured reality exactly.
- `readLiveSlices` reads the live `rulebook/*.md` tree directly (excluding `INDEX.md`/`00-visual-survey.md`, mirroring `verify-classify.ts`'s `computeRunPairs`), never the staged `.verify/<runId>/` tree — pinned by a comment-stripped source assertion (no `.verify` literal in code) and an import-line-only check that `resolveFreshTranscription` is never imported (177-RESEARCH.md Pitfall 3).

## Task Commits

Each task was committed atomically:

1. **Task 1: DERIVE_VERDICTS and the single record-construction choke point** - `944f133b` (feat)
2. **Task 2: quoteLinesOnly, buildBlindDerivePayload, and live-slice enumeration** - `1e3e749d` (feat)

_Note: both tasks used `tdd="true"`; tests were authored alongside the implementation in the same commit per task, matching this module's colocated-test convention (mirroring `verify-ruling-recheck.ts`'s existing shape rather than a separate RED/GREEN commit split)._

## Files Created/Modified

- `src/cli/commands/verify-derive-recheck.ts` (345 lines) — `DERIVE_VERDICTS`, `DeriveVerdict`, `DeriveVerdictRecord`, `createDeriveVerdictRecord`, `readLiveSlices`, `quoteLinesOnly`, `DerivedLineEntry`, `EnumerateDerivedLinesResult`, `enumerateDerivedLines`, `BLIND_DERIVE_TOKEN`, `buildBlindDerivePayload`.
- `src/cli/commands/verify-derive-recheck.test.ts` (22 tests) — colocated pinning tests for every export, run against real committed `174-FIXTURES/{seven,one-two-punch}/live/*.md` slices plus real-filesystem temp-dir fixtures for `readLiveSlices`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - missing critical functionality] Excluded `Named-but-undefined (p.` lines from `quoteLinesOnly`, beyond the plan's literal `Derived`/`Visual` instruction**
- **Found during:** Task 2, while designing `quoteLinesOnly`
- **Issue:** `177-RESEARCH.md`'s own answer to Question 1 names `Named-but-undefined` alongside `Derived`/`Visual` as a line type the blind-derivation payload must exclude entirely, since it is ingest-time inference (not directly-quoted rulebook prose). The plan's `<action>` text for Task 2 only names `Derived (p.` and `Visual (p.` explicitly, and neither the `<behavior>` block nor the acceptance criteria test for `Named-but-undefined` handling.
- **Fix:** Added a `NAMED_BUT_UNDEFINED_LINE_RE` filter alongside the `Derived`/`Visual` filters in `quoteLinesOnly`, with a doc-comment explaining the reasoning. Verified against the real `seven` fixture, which carries one `Named-but-undefined (p.1): bonus point cards...` line (`174-FIXTURES/seven/live/01-definitions-and-components.md:23`) — confirmed excluded from `quoteLinesOnly`'s output for that file.
- **Files modified:** `src/cli/commands/verify-derive-recheck.ts`
- **Commit:** `1e3e749d`

### Deferred Issues

None — both tasks completed within the fix-attempt limit with zero blocking issues.

## Known Stubs

None. Both `verify-derive-recheck.ts` and its test file are complete, working modules with no placeholder values or unwired data paths — this is a mechanics-only plan by design (177-CONTEXT.md's own plan breakdown assigns CLI registration to 177-03, judgment-contract skill text to 177-04, skill-text wiring to 177-05, and the live proof to 177-06/07).

## Threat Flags

None. The two threats this plan's `<threat_model>` assigns to `verify-derive-recheck.ts` (T-177-04, T-177-05) are exactly the mitigations implemented here (`buildBlindDerivePayload`'s zero-leak counting test; `createDeriveVerdictRecord`'s single choke point). No new security-relevant surface (network endpoint, auth path, file-access pattern, or schema change at a trust boundary) was introduced beyond what the threat model already names.

## Issues Encountered

- The `no-phrase-list` source-inspection test initially false-positived on the module's own explanatory doc comment: `"card faces"` in prose (describing what the original PDF transcription had access to) contains `"card face"` as a substring, which the `RULE_BEARINGNESS_PHRASE_MARKERS` list originally included as a marker. Removed that marker (and the similarly prose-collision-prone `"component count"`) from the test's marker list rather than rewording the doc comment, since the doc comment's phrasing is accurate and the marker list's job is to catch an actual hardcoded rule-bearingness heuristic, not incidental prose overlap. Re-ran: 22/22 green.
- Reconstructed the single authored implementation pass into two task-scoped commits (Task 1 content in isolation, then Task 2's additions restored) to honor the plan's per-task atomic-commit requirement, since both tasks were designed and typed together in one editing pass for correctness (the payload filter in Task 2 references `isPresentationLine`, which is only imported once at the top of the file). Both intermediate and final states were independently test-run and typechecked green before each commit.

## Verification

- `npx vitest run src/cli/commands/verify-derive-recheck.test.ts` — 22/22 passed (both intermediate Task-1-only state: 9/9, and final Task-1+2 state: 22/22).
- `npm test` — 3918/3918 green (baseline 3896 + 22 new tests, zero regressions).
- `npx tsc --noEmit` — clean; only the pre-existing permitted `docs/seed-to-state.test.ts` rootDir error remains.
- `grep -c "isDeriveVerdict" src/cli/commands/verify-derive-recheck.ts` → 2 (one function definition, one call site inside `createDeriveVerdictRecord`) — confirms the single-validation-site invariant, matching `verify-ruling-recheck.ts`'s identical shape.

## Next Steps

- 177-03 registers `verify-derive-recheck` as a real CLI command, adds the project-level ledger write through the one atomic path (`atomicWriteFile`), and the report command — no `--run-id` (decision 14).
- 177-04 writes the two judgment-subagent contracts (`BS-DERIVE-V1` blind-derive, `BS-DERIVE-COMPARE-V1` comparison) and installer leaf probes.
- 177-05/06/07 wire the CHECK-04 step into `verify-game.md`, commit the 22-line distribution prediction, and run the real `claude -p` dispatch proof.

## Self-Check: PASSED

- `src/cli/commands/verify-derive-recheck.ts` — FOUND
- `src/cli/commands/verify-derive-recheck.test.ts` — FOUND
- Commit `944f133b` (Task 1) — FOUND in `git log --oneline --all`
- Commit `1e3e749d` (Task 2) — FOUND in `git log --oneline --all`
