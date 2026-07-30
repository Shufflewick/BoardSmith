---
phase: 175-impact-map-repair-gating
plan: 03
subsystem: cli
tags: [verify, rulings, adjudication, gate, ledger, contradiction]

requires:
  - phase: 174-verify-classifier
    provides: "ClassificationRecord/ChunkVerdict/verifyClassifyStatusCommand — the recorded contradictory verdicts and per-chunk pairIds this plan reads, never re-classifies"
  - phase: 175-impact-map-repair-gating
    plan: 02
    provides: "ImpactRecord/AdjudicationRecord ledger kinds and the widened resolveLedgerState/parseLedgerBody this plan's gate/adjudicate commands read and write against"
provides:
  - "collectContradictions/formatBothReadings — VERIFY-04's read side: one Contradiction per finding, both readings verbatim, every affected chunk slug uncapped"
  - "verifyImpactGateCommand — read-only gate report, exit 0 always, no bypass option/env anywhere"
  - "nextRulingNumber/renderRuling/appendRuling — the first machine write into RULINGS.md, built on parseRulings as the single ruling-number authority"
  - "verifyImpactAdjudicateCommand — records a resolved Ruling N or an honest UNADJUDICATED, RULINGS.md written before the ledger record"
affects: [176-repair-gating-close]

tech-stack:
  added: []
  patterns:
    - "Reuse parseRulings (build-manifest.ts) as the single ### Ruling (\\d+) authority — never a second regex"
    - "Append-only proven by startsWith, never by trusting the write path's own logic"
    - "Structural no-bypass: the options interface itself carries no force/skip/yes/assumeResolved/bypass/autoAdjudicate field, and the module reads no process.env"
    - "Write RULINGS.md before the ledger record so a crash between them leaves the pair re-runnable, never a resolution with no ruling behind it"

key-files:
  created: []
  modified:
    - src/cli/commands/verify-impact.ts
    - src/cli/commands/verify-impact.test.ts

key-decisions:
  - "collectContradictions returns one Contradiction per PAIR (finding), never per chunk (decision 14) — affectedSlugs carries every chunk one finding touches, derived from ChunkVerdict.pairIds membership"
  - "A missing quotedPass1/quotedPass2 renders as the explicit '(no verbatim reading recorded)' string — never dropped, never silently synthesized"
  - "Contradiction.adjudication has three states (pending/resolved/UNADJUDICATED); the caller-facing 'pending' set in VerifyImpactGateResult is everything NOT 'resolved' — an UNADJUDICATED deferral stays pending on a later run (decision 8), never treated as closed"
  - "appendRuling embeds both verbatim readings into the Citation field's prose (matching the real corpus's own convention of quoting interpreted rulebook text there, e.g. one-two-punch Ruling 22), leaving the Decision field as the human's own words untouched"
  - "verifyImpactAdjudicateCommand is idempotent per pairId: a second 'resolved' call for an already-resolved pair reuses the existing rulingNumber and appends no second RULINGS.md entry, but still appends a second ledger AdjudicationRecord (last-write-wins, matching 175-02's append-only ledger discipline)"
  - "verifyImpactGateCommand/verifyImpactAdjudicateCommand both resolve runId and read classification verdicts through verifyClassifyStatusCommand (called with json:true to get a structured result) rather than re-deriving run resolution or re-classifying"

patterns-established:
  - "The Gate-Before-Write shape (build/ask.md's) applied to a CLI command pair: a read-only report command plus a mutating command that requires explicit human-authored fields before any durable write"

requirements-completed: [VERIFY-04]

duration: ~70min
completed: 2026-07-30
---

# Phase 175 Plan 03: Contradiction Gate — Collection, Both-Readings Format, RULINGS.md Append, UNADJUDICATED Summary

**The first machine write ever made into `RULINGS.md` landed as a structurally bypass-free append: `verifyImpactGateCommand` surfaces every contradictory finding at once with both readings verbatim, and `verifyImpactAdjudicateCommand` either appends a real `### Ruling N` entry in the corpus's own three-field shape or records an honest `UNADJUDICATED` deferral — never both, never neither, never a silent third option.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-07-30 (read step)
- **Completed:** 2026-07-30
- **Tasks:** 2 completed
- **Files modified:** 2 (0 created, 2 modified)

## Accomplishments

- Built `collectContradictions`/`formatBothReadings`: one `Contradiction` entry per contradictory FINDING (never per affected chunk, per decision 14), with both `quotedPass1`/`quotedPass2` readings rendered verbatim and every affected chunk slug listed uncapped (decision 15)
- Built `verifyImpactGateCommand`: a read-only report composing `verifyClassifyStatusCommand` (for chunk verdicts and the resolved run id) with the shared ledger-read authority (`readLedgerOrThrow`/`parseLedgerBody`/`resolveLedgerState`) for adjudications — never sets `process.exitCode`, proven read-only by a whole-project sha256-map equality test
- Built `nextRulingNumber`/`renderRuling`/`appendRuling`: the first machine write into `RULINGS.md`, numbering derived exclusively from `parseRulings` (`build-manifest.ts`) — no second `### Ruling (\d+)` regex exists anywhere in the module (grep-asserted) — and proven append-only via a byte-for-byte `startsWith` assertion against a real 26-entry corpus
- Built `verifyImpactAdjudicateCommand`: `outcome: 'resolved'` requires non-empty `decision`/`citation`/`rationale` (throws an actionable error naming the missing field otherwise); `outcome: 'UNADJUDICATED'` writes no `RULINGS.md` entry and leaves the pair pending for a later run; idempotent per `pairId` (a second `resolved` call reuses the existing ruling number rather than appending a duplicate entry); `RULINGS.md` write lands before the ledger record so a crash between them never orphans a resolution with no ruling behind it
- Structurally eliminated any bypass: the options interfaces on both commands carry exactly the fields the plan specifies, and no `process.env` read exists anywhere in the module (grep-asserted on non-comment lines)

## Task Commits

Each task was committed atomically:

1. **Task 1: Contradiction collection and both-readings formatting (the gate's read side)** - `66572587` (feat)
2. **Task 2: The RULINGS.md append and the UNADJUDICATED record (the gate's write side)** - `69550cd9` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `src/cli/commands/verify-impact.ts` - `Contradiction`, `collectContradictions`, `formatBothReadings`, `VerifyImpactGateResult`, `verifyImpactGateCommand`, `nextRulingNumber`, `renderRuling`, `appendRuling`, `VerifyImpactAdjudicateResult`, `verifyImpactAdjudicateCommand`
- `src/cli/commands/verify-impact.test.ts` - 19 new tests (7 Task 1, 12 Task 2), carrying the tokens `contradictory`, `unadjudicated`, and `no-bypass` per the plan's `-t` selection convention; the real 174-07 contradictory `ClassificationRecord` is read directly from the committed fixture `RUN.md` rather than hand-written

## Decisions Made

- `collectContradictions` marks a pair `'resolved'` in the returned array (rather than excluding it entirely) so a full-history report can still show a resolved finding's outcome; the derived `pending` list in `VerifyImpactGateResult` is what a caller checks to know what's still open — this reading matched both the plan's behavior spec and its acceptance criteria without ambiguity.
- Chose to embed both verbatim readings into the appended ruling's `Citation interpreted or overridden:` field rather than the `Decision:` field, because that is where the real corpus already quotes interpreted rulebook text (e.g. one-two-punch Ruling 22's Citation field embeds the exact printed sentence) — this keeps the `Decision:` field as pure, unadorned human prose.
- `verifyImpactGateCommand`/`verifyImpactAdjudicateCommand` both resolve `runId` by calling `verifyClassifyStatusCommand({ ..., json: true })` rather than re-implementing "most recent run" resolution locally — `resolveRunId` in `verify-classify.ts` is not exported, and duplicating its small lookup would still be a second resolution path for the same fact; composing the existing exported command avoids that without inventing a private duplicate.
- Test fixtures for the RULINGS.md corpus prefer the real `~/BoardSmithGames/one-two-punch/RULINGS.md` (26 entries) when reachable and fall back to a hand-built 26-entry stand-in with an explicit test-name note otherwise, matching the plan's own stated fallback — this repo's own conventions (`ingest-archive.test.ts`, `verify-classify.test.ts`) already read live from that sibling repo in tests.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria (real-fixture assertions, grep gates, append-only proof, idempotency) pass without needing a Rule 1-4 deviation.

## Issues Encountered

- An early draft of `verifyImpactAdjudicateCommand`'s outcome-validation error message contained the literal substring "bypass", which tripped Task 1's own `no-bypass` grep acceptance criterion (`grep -v '^ *[*/]' ... | grep -ciE "...|bypass|..."` == 0) once Task 2's code was added to the same file. Reworded the message to avoid the substring while keeping it equally actionable — caught before either task's suite was finalized, not a plan deviation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `verifyImpactGateCommand`/`verifyImpactAdjudicateCommand` are ready for `verify-game.md`'s new adjudication-gate step and for `cli.ts` command registration — neither is wired into the CLI's `program.command(...)` surface yet; that registration, along with `verify-impact-gate`/`verify-impact-adjudicate` flag plumbing, remains later-plan scope per the roadmap (mirroring how 175-02 explicitly deferred `cli.ts`'s `--reverified-no-code-change` flag to keep `cli.ts` in one plan's `files_modified`).
- Phase 176 (repair gating close) can call `collectContradictions`/`verifyImpactGateCommand` to know which pairs are still pending adjudication before any staleness write proceeds, and `verifyImpactAdjudicateCommand` to record the human's answer — completing decision 6's "classify everything, then one hard gate before any staleness write" sequencing from this plan's read/write halves.
- No blockers identified for the remaining Phase 175 plans (04-08).

---
*Phase: 175-impact-map-repair-gating*
*Completed: 2026-07-30*

## Self-Check: PASSED

Both modified files confirmed present on disk; both task commit hashes (`66572587`, `69550cd9`) confirmed in `git log`. Full suite 3788/3788 green (3769 baseline + 19 new tests); `npx tsc --noEmit` clean (only the pre-existing, unrelated `docs/seed-to-state.test.ts` rootDir warning remains). `trace-check.test.ts` (35/35) re-confirmed green, proving its existing `RULINGS.md` reader still parses a corpus this plan's tests append to.
