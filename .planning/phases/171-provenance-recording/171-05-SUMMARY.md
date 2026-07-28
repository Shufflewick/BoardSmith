---
phase: 171-provenance-recording
plan: 05
subsystem: cli
tags: [provenance, chunk-provenance-status, three-states, drift-report, cli, read-only]

# Dependency graph
requires:
  - phase: 171-provenance-recording
    plan: 04
    provides: "chunkCheckCommand() + VERIFIED_AGAINST_HEADING/BEGIN/END/LABELS/EMPTY — the fenced block parseVerifiedAgainst() reads"
  - phase: 171-provenance-recording
    plan: 01
    provides: "normalizeEdition() / EDITION_UNKNOWN — the sentinel byEdition groups against at read time"
provides:
  - "parseVerifiedAgainst(chunkText) — pure parser distinguishing full / code-conformance-only / unknown, with blockMalformed distinguishing structural damage from a pre-existing project"
  - "chunkProvenanceStatusCommand(options) — the read-only PROV-03 aggregation, exported ChunkProvenanceStatusResult/ChunkProvenanceEntry types, PROVENANCE_UNKNOWN sentinel"
  - "boardsmith chunk-provenance-status registered in cli.ts (--project, --json)"
affects: ["171-06 (/bs-check-status formats this command's --json output)", "171-07 (asserts on this --json shape against both real reference games)", "PROV-03", "PROV-02"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "blockMalformed distinguishes WHY a chunk is unknown: no heading at all (verified before this phase existed, blockMalformed: false) vs. a heading present but a fence/label missing (structurally damaged, blockMalformed: true) — both report state: unknown, but the flag tells the two apart without conflating a project's age with damage to its records"
    - "Grouping keys (byEdition) are normalizeEdition()'d again at aggregation time, even though chunk-check already normalizes on write — a hand-edited or pre-F-1 block's raw free text is caught at read time too, per RESEARCH.md Pitfall 3"
    - "verifiedWithoutProvenance fires on Status.startsWith('verified') — covers both 'verified' and 'verified (user-waived)' as one prefix check, since a waived verification is still a claim"

key-files:
  created: []
  modified:
    - src/cli/commands/chunk-provenance.ts
    - src/cli/commands/chunk-provenance.test.ts
    - src/cli/cli.ts

key-decisions:
  - "unknown composes with verifiedWithoutProvenance by design, not as a defect to suppress: a chunk verified before this phase existed is unknown, and if its Status already says verified, it IS flagged. The flag does not ask 'is this project old?' — it asks 'does this chunk's Status claim a verification no record backs?' A project that never ran chunk-check shows every verified chunk both unknown AND flagged simultaneously; that is the phase's own stated ready-made proof target (all 29 chunks across both reference games), not a false alarm to filter out. Documented directly on the verifiedWithoutProvenance field's own doc comment so a future reader does not 'fix' this into a false negative."
  - "parseVerifiedAgainst() never returns a partially-parsed record. Any of: missing heading (never run), missing fence, missing a required label, an unrecognized Scope: value, or a code-conformance-only block missing a valid Reason: from SCOPE_REASONS all collapse to the same unparsed(true|false) return shape. The ONLY difference between 'never run' and 'damaged' is blockMalformed — everything else about a partial parse is treated identically to no data at all, never a half-trusted value."
  - "byEdition/bySkillsTreeHash/byBoardsmithVersion are populated per-chunk independent of state — an unknown chunk with no block contributes no skillsTreeHash/boardsmithVersion entry (both fields are undefined), but it DOES land in byEdition under normalizeEdition(undefined) = EDITION_UNKNOWN, since 'no edition recorded' is itself a real (if uninformative) edition classification, not an absence to skip."

requirements-completed: [PROV-03, PROV-02]

# Metrics
duration: ~35min
completed: 2026-07-28
---

# Phase 171 Plan 05: chunk-provenance-status — Three-State Aggregation Summary

**`boardsmith chunk-provenance-status --json` — a read-only aggregation that parses every chunk's fenced `## Verified Against` block into one of three states (`full`, `code-conformance-only`, `unknown`, never collapsing the third into the second), groups drift by normalised edition and skills-tree hash, and flags any `verified`/`verified (user-waived)` chunk carrying no valid block — the compensating control for a skipped `chunk-check` invocation.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-28T~13:20:00Z (approx)
- **Completed:** 2026-07-28T~13:55:00Z (approx)
- **Tasks:** 3 (Task 1 RED, Task 2 GREEN, Task 3 CLI registration)
- **Files modified:** 3 (chunk-provenance.ts, chunk-provenance.test.ts, cli.ts — all pre-existing)

## Task Commits

1. **Task 1: RED — the three states, the flag, and the grouping** — `ae6e5830` (test)
2. **Task 2: GREEN — parseVerifiedAgainst + chunkProvenanceStatusCommand** — `d96b0525` (feat)
3. **Task 3: Register chunk-provenance-status in cli.ts** — `e2b825d3` (feat)

## RED Observation (mandatory per 171-VALIDATION.md)

Command: `npx vitest run src/cli/commands/chunk-provenance.test.ts -t "chunk-provenance-status"` (before `chunkProvenanceStatusCommand` existed)

```
 Test Files  1 failed (1)
      Tests  14 failed | 32 skipped (46)
```

All 14 new `chunk-provenance-status` tests failed identically:

```
TypeError: chunkProvenanceStatusCommand is not a function
```

confirmed via:

```bash
$ npx vitest run src/cli/commands/chunk-provenance.test.ts -t "chunk-provenance-status" 2>&1 \
  | grep -E "TypeError|is not a function" | sort | uniq -c
  14      → chunkProvenanceStatusCommand is not a function
  14 TypeError: chunkProvenanceStatusCommand is not a function
```

The 32 chunk-check/scope/citation tests from plans 03/04 skipped (not failed), since `-t` filters
to the new describe block only; a subsequent unfiltered run confirmed they remained green
throughout, unaffected by this task.

## GREEN Result

Command: `npx vitest run src/cli/commands/chunk-provenance.test.ts`

```
 ✓ src/cli/commands/chunk-provenance.test.ts (46 tests) 182ms

 Test Files  1 passed (1)
      Tests  46 passed (46)
```

Full suite: `npm test` → **229 test files / 3390 tests passed** (baseline at plan-05 start was
229 files / 3376 tests, carried in from 171-04's SUMMARY; net **+14** from this plan's new
`chunk-provenance-status` cases, exact match, 0 regressed).

`npx tsc --noEmit` reports the same single pre-existing, out-of-scope error already logged in
`deferred-items.md` (`docs/seed-to-state.test.ts` rootDir mismatch, introduced in phase 168) —
confirmed unrelated to this plan's files (only one error, naming that file, not
`chunk-provenance.ts` or `cli.ts`).

`node bin/boardsmith.js chunk-provenance-status --help` → exit 0, lists exactly `--project` and
`--json`. `node bin/boardsmith.js --help` lists both `chunk-check` and `chunk-provenance-status`.
Running it in a directory with no `chunks/`:

```
No chunks/ directory in <dir>.
This command looks for chunks/<slug>/CHUNK.md files — run it from a BoardSmith game
project directory, or pass --project <dir>.
```
exits 1, no stack trace.

## The `--json` shape (plan 06/07 contract)

```json
{
  "chunks": [
    {
      "slug": "jab",
      "status": "verified",
      "state": "full",
      "edition": "First Printing 2020",
      "skillsTreeHash": "c78dbcde...",
      "boardsmithVersion": "0.0.1",
      "citedSliceCount": 1,
      "unresolvedCount": 0,
      "blockMalformed": false
    },
    {
      "slug": "legacy",
      "status": "verified",
      "state": "unknown",
      "citedSliceCount": 0,
      "unresolvedCount": 0,
      "blockMalformed": false
    }
  ],
  "counts": { "full": 1, "codeConformanceOnly": 0, "unknown": 1 },
  "byEdition": {
    "First Printing 2020": ["jab"],
    "not stated in the rulebook": ["legacy"]
  },
  "bySkillsTreeHash": { "c78dbcde...": ["jab"] },
  "byBoardsmithVersion": { "0.0.1": ["jab"] },
  "verifiedWithoutProvenance": ["legacy"]
}
```

Note `reason` is omitted (not `null`) on entries whose `state` is not `code-conformance-only` —
`edition`/`skillsTreeHash`/`boardsmithVersion` are similarly omitted on `unknown` entries with no
block at all, never a placeholder value (matches the project's no-dummy-data rule and 171-04's
`renderVerifiedAgainst` precedent).

## How `unknown` and `verifiedWithoutProvenance` compose (the plan's required answer)

**They are not mutually exclusive, and that is intentional, not a defect.** `unknown` answers "was
this chunk verified under this phase's contract?" — no, either because it predates the contract or
because its block is damaged. `verifiedWithoutProvenance` answers a different, independent
question: "does this chunk's `Status:` line currently CLAIM a verification?" A chunk can be both at
once: `Status: verified`, `state: unknown` — that chunk is flagged, and it should be. The flag is
not asking whether the project is old; it is asking whether a claim on disk (`Status: verified`) is
currently backed by a record (`## Verified Against`). Nothing about a project's age changes whether
that claim is backed.

Concretely, per plan 07's stated proof target: all 29 pre-existing chunks across `seven` and
`one-two-punch` are `unknown` (no block — verified before this phase existed) AND every single one
is already `Status: verified` or `verified (user-waived)`, so all 29 will appear in
`verifiedWithoutProvenance` too. That is not the flag crying wolf — it is the flag doing exactly
its documented job: naming every chunk whose disk-recorded claim of verification has nothing behind
it, regardless of why. The remedy is the same regardless of cause: run `boardsmith chunk-check
<slug>` to record real provenance now. The human-readable output's flagged-list heading says this
explicitly ("either a skipped `chunk-check` invocation, or a pre-existing project whose
verification predates this phase") so a reader is never told a 29-chunk flag list means 29 recent
skips.

`Status: built` is the one case genuinely excluded: it never claimed verification, so an `unknown`
`built` chunk is correctly absent from the flag list — pinned directly by a test.

## Files Created/Modified

- `src/cli/commands/chunk-provenance.ts` — added `PROVENANCE_UNKNOWN`, `ParsedVerifiedAgainst`,
  `parseVerifiedAgainst()`, `ChunkProvenanceEntry`, `ChunkProvenanceStatusResult`,
  `chunkProvenanceStatusCommand()`.
- `src/cli/commands/chunk-provenance.test.ts` — added `describe('chunk-provenance-status')`, 14
  tests, plus `makeStatusProject()`/`addChunk()`/`hashTree()` helpers.
- `src/cli/cli.ts` — imports and registers `chunk-provenance-status` (`--project`, `--json`)
  directly beneath `chunk-check`; `chunk-check`'s own registration is byte-identical to how
  171-04 left it.

## Decisions Made

- See `key-decisions` in frontmatter — the `unknown`/`verifiedWithoutProvenance` composition
  decision above is this plan's most consequential one and is documented both here and directly
  in `chunkProvenanceStatusCommand`'s own doc comment, so a future reader does not "fix" the
  29-chunk flag list into a false negative that would silently defeat T-171-18's mitigation.
- `blockMalformed` exists as a field distinct from `state` specifically so "verified before this
  phase existed" (no heading, `blockMalformed: false`) and "a block existed and got damaged"
  (heading present, fence or label missing, `blockMalformed: true`) are never conflated — both
  are `state: unknown`, but only one indicates active corruption of a machine-owned section.
- `byEdition` groups an `unknown` chunk (no block, no recorded edition at all) under
  `normalizeEdition(undefined)` = `EDITION_UNKNOWN`. This was a deliberate choice made during
  GREEN, not accidental: "no edition recorded" is itself a real classification a designer would
  want visible in the drift report (e.g. "12 chunks have no edition on record at all"), not a
  case to silently omit from grouping.

## Deviations from Plan

None — plan executed as written. The one bug found (a `logSpy.mockRestore()` called before
reading `logSpy.mock.calls` in the drift-report test, which cleared the captured calls) was in
this plan's own test code, discovered and fixed during the GREEN step before any commit — not a
deviation from the plan's design.

## Issues Encountered

None beyond the one self-caused test-ordering bug above, fixed inline during GREEN.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `chunkProvenanceStatusCommand()`, `ChunkProvenanceStatusResult`, `ChunkProvenanceEntry`, and
  `PROVENANCE_UNKNOWN` are all exported and ready for plan 06's `/bs-check-status` skill to invoke
  with `--json` and format, and for plan 07's real-reference-game proof to assert against
  (specifically: all 29 chunks classify `unknown`, not `code-conformance-only`, and
  `pre-provenance-project` never appears as a per-chunk `reason` because `unknown` chunks carry no
  `reason` field at all — `pre-provenance-project` is `computeVerificationScope`'s reason code,
  surfaced only once a chunk actually runs `chunk-check` and gets a `code-conformance-only` block).
- `~/BoardSmithGames/seven` confirmed unmodified before and after this plan's execution:
  `git status --porcelain` empty, HEAD still `a03f38d4792af9dfc7c798be69686fc3230f54dd`. This
  plan's only interaction with real reference-game data was reading real citation prose already
  embedded in the test file by 171-04 (unchanged) — no new fixture touched either reference game.
- No blockers for 171-06.

## Self-Check: PASSED

- `src/cli/commands/chunk-provenance.ts` — FOUND (`export async function chunkProvenanceStatusCommand` present; `grep -c "PROVENANCE_UNKNOWN"` → 7; single `writeFile` occurrence at line 443, inside `chunkCheckCommand` only)
- `src/cli/commands/chunk-provenance.test.ts` — FOUND (`describe('chunk-provenance-status')` present, 14 tests)
- `src/cli/cli.ts` — FOUND (`chunk-provenance-status` registered with `--project`/`--json`)
- Commit `ae6e5830` — FOUND (`git log --oneline` confirms)
- Commit `d96b0525` — FOUND (`git log --oneline` confirms)
- Commit `e2b825d3` — FOUND (`git log --oneline` confirms)

---
*Phase: 171-provenance-recording*
*Completed: 2026-07-28*
