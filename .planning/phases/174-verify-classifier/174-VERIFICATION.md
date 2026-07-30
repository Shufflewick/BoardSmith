---
phase: 174-verify-classifier
verified: 2026-07-30T22:10:00Z
status: passed
status_history:
  - status: gaps_found
    at: 2026-07-30T22:10:00Z
    by: gsd-verifier
    note: >
      Original independent verdict, against the measurements available at the time (pre-gap-closure:
      14/16 and 11/11 citing chunks stale). Retained verbatim below — not rewritten.
  - status: passed
    at: 2026-07-30
    by: orchestrator, on explicit user decision at the post-gap-closure gate
    note: >
      Plan 174-08 implemented decision 19's per-citation attribution ladder and re-measured on both
      real games: `seven` 6/16 (37.5%), `one-two-punch` 6/11 (54.5%) — down from 14/16 and 11/11.
      The ROADMAP goal's literal wording ("does not flag EVERY chunk as stale") is satisfied by those
      figures. The stricter "small, explainable subset" bar that 174-08's own verdict measured against
      was introduced by the orchestrator AT THE REOPEN, not in the original specification, and the user
      ruled the ROADMAP wording governs. Residual stale chunks genuinely quote or cite the changed
      rule (attributed via the quoted-fragment/cited-page rungs), so their staleness is correct
      behavior; the remaining density is diagnosed as an anchor-density property of two short,
      heavily cross-referenced rulebooks. Evidence: `174-PROOF.md` §7 (resolution rate) and §8
      (re-measurement, which itself names the two-bar discrepancy explicitly).
      Carried forward to Phase 175/176: anchor density as a known property of the staleness set
      they consume.
score: 5/5 roadmap Success Criteria verified PASS on real data; phase goal MET under the ROADMAP's literal bar after 174-08's gap closure
overrides_applied: 0
gaps_resolved_by: 174-08-PLAN.md (per-citation attribution ladder)
gaps:
  - truth: "A second run of the skill does not flag every chunk as stale (the phase goal, verbatim)"
    status: resolved_by_gap_closure
    original_status: failed
    reason: >
      Measured directly on both real reference games via the real chunkVerdicts[] output
      (174-PROOF.md §6): one-two-punch marks 11/11 (100%) of its citing chunks stale from a
      single real `contradictory` finding; `seven` marks 14/16 (87.5%) stale from a single real
      `sharper` finding. The phase's own added measurement states this in its own words: "the
      phase goal is NOT MET on these two real reference games." This is not a defect in SC-1
      through SC-5 (all measured PASS) and not a defect in decision 18's slice-level narrowing
      (independently proven to do real, non-trivial work — a 2-chunk carve-out on `seven` that a
      naive group-level rollup would not have produced) — but it is a direct failure of the
      phase's own literal success condition, on the only two reference games available.
    artifacts:
      - path: "src/cli/commands/verify-classify.ts (computeChunkVerdicts, lines ~933-1060)"
        issue: >
          Attribution narrows only to the live SLICE containing the recorded quote (decision 18),
          not to the specific citation a chunk names (decision 19, recorded 2026-07-30 but not
          implemented in this phase's plans 01-07). Both reference games concentrate almost all
          rulebook content into 2-3 live slices that most chunks cross-cite for general context, so
          slice-level narrowing is not fine-grained enough to keep most chunks clean.
    missing:
      - "Per-citation attribution (decision 19) — matching a delta to the specific citation/claim a chunk names, not merely the live slice it sits in. Recorded as a locked decision in 174-CONTEXT.md but explicitly deferred to a gap-closure plan; not built in 174-01..07."
      - "A demonstrated re-measurement, after decision 19 is implemented, showing a materially smaller stale fraction on both seven and one-two-punch (or an honest argument for why 100%/87.5% is an acceptable residual given rulebook size, made explicit rather than left as an open risk)."
deferred: []
human_verification: []
---

# Phase 174: Verify Classifier Verification Report

**Phase Goal:** "The highest-risk single item in the milestone — a classifier that distinguishes
real drift from independent re-wording — works well enough that a second run of the skill does not
flag every chunk as stale."

**Verified:** 2026-07-30
**Status:** gaps_found
**Re-verification:** No — initial verification (no prior VERIFICATION.md existed; the phase's own
final plan self-certified completion without one, which is why this record exists now, after the
fact and after a reopen).

## Summary Judgment

This is an unusually well-documented phase: `174-PROOF.md` is a live-proof artifact that already
contains an honest self-report of the central failure, and `174-CONTEXT.md`/`ROADMAP.md` already
record the reopen and the gap-closure decision (19). This verification confirms that self-report
against the underlying evidence (git history, test suite, and the classifier source itself) rather
than taking it at face value, and finds it to be **accurate, not overstated and not understated**.

**Bottom line: the phase's five roadmap Success Criteria (SC-1..SC-5) are genuinely, individually
proven on real data. The phase GOAL — the actual outcome the roadmap promises — is measurably NOT
achieved on either of the two reference games available.** The roadmap itself already reflects this
(the Phase 174 entry is marked REOPENED with the same finding), so this VERIFICATION.md is
confirming, not discovering, the gap — but it is the missing gate artifact that should have existed
before the phase was marked complete, and it records the gap in the structured form a gap-closure
plan needs.

## Goal Achievement

### Observable Truths (Roadmap Success Criteria, independently checked)

| # | Truth (Success Criterion) | Status | Evidence |
|---|------|--------|----------|
| 1 | Every slice pair classified on BOTH dimensions independently (provenance + rule delta) | ✓ VERIFIED | `174-PROOF.md` §2 "SC-1 measurement": real cross-tab shows `unknown`+`cosmetic` (one-two-punch) and `unknown`+`sharper` (seven) — same provenance value, opposite rule-delta outcome, on real data. `src/cli/commands/verify-classify.ts` `deriveStale(ruleDelta)` takes exactly one parameter (confirmed by reading lines 153-162) — structurally cannot consult provenance. |
| 2 | Two independent good-faith transcriptions of the same page classify overwhelmingly `cosmetic` (SC-2, ≥90% bar) | ✓ VERIFIED (narrow pass) | `174-PROOF.md` §2: pooled rule-bearing line-level findings across both games = 11 (10 cosmetic, 1 sharper, 0 contradictory) = 90.9%. Bar (≥90%) cleared by a 0.9-point margin on a genuinely small sample (11 comparisons). The line-level denominator (decision 14b) was committed in `fc030f17` strictly BEFORE the measurement commit `ab70f535` (confirmed via `git log --oneline`), so the amendment predates the result and is not a retrofit. The amendment itself is substantively justified: both real reference games pair into exactly one rule-bearing GROUP each (a genuine property of 2-page rulebooks joined by cross-page prose, not a pairing bug), making a group-level 90% bar mathematically unsatisfiable except at 100%. Accepting the amendment as legitimate. |
| 3 | A genuine rules change (pass 1→2) correctly classifies `sharper` or `contradictory` (SC-3) | ✓ VERIFIED | `174-PROOF.md` §5: a real edit to the archived source PDF (rasterize + Ghostscript font composite reversing "lower"→"higher" timing precedence in one-two-punch's FIGHT rule) run through the real pipeline (real re-transcription dispatch via `claude -p`, real classification dispatch) returned `contradictory`, `stale:true`. The re-transcription subagent caught the internal contradiction unprompted, without being told a mutation had occurred. |
| 4 | Staleness keys off rule delta ALONE; `source-changed` is provenance only, never itself a staleness verdict | ✓ VERIFIED (structurally + partially on real data) | `STALE_BY_RULE_DELTA` enumerated map and `deriveStale`'s one-argument signature (verified directly in source, line 161) make this true by construction — provenance cannot be an input even in principle. On real data: SC-1's cross-tab (unknown+cosmetic=not stale, unknown+sharper=stale) plus SC-3's mutation (source-changed+contradictory=stale) together show provenance varying independently of the stale outcome across two different runs of related pairs. The literal `source-changed`+`cosmetic`+not-stale 4-tuple was NOT exhibited live in this phase — both real reference games have exactly one rule-bearing group each, and that group is the one SC-3 mutated, so no untouched real pair existed to carry the combination. This is disclosed honestly in `174-PROOF.md` §5 rather than hidden, and is closed by the unit test `provenance-3` plus `deriveStale`'s arity rather than a real 4-tuple. Treating this as verified-but-with-a-named, honestly-disclosed real-data gap, consistent with the phase's own framing. |
| 5 | Validated against real pass-1-vs-pass-2 output from at least one reference game, not synthetic examples alone | ✓ VERIFIED | Both `seven` and `one-two-punch` — two different reference games, both real `cp -R` copies, real skill installs, real `claude -p` transcription and classification dispatches (`174-PROOF.md` §1-§6). Plus a 7/7 lexicon regression suite as a supplementary synthetic check, correctly kept secondary to the real runs. |
| **GOAL** | **A second run of the skill does not flag every chunk as stale** | ✗ **FAILED** | `174-PROOF.md` §6, "the ADDED measurement": real `chunkVerdicts[]` on both real games — `one-two-punch` 11/11 (100%) citing chunks stale; `seven` 14/16 (87.5%) citing chunks stale — both from a single real finding each. The phase's own text states this is "NOT MET" verbatim. Independently confirmed by reading `computeChunkVerdicts` in `src/cli/commands/verify-classify.ts`: attribution narrows only to the live SLICE containing a quote (decision 18), and decision 19 (per-citation narrowing, needed to go further) is recorded as a decision but was never implemented in plans 174-01 through 174-07. |

**Score:** 5/5 roadmap Success Criteria individually verified as PASS on real data. 0/1 phase GOAL
achieved. Per the verification methodology, the phase goal — not the SC checklist — is the actual
deliverable being verified, and it fails.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/commands/verify-classify.ts` | Pairing, provenance, rule-delta staleness map, presentation filter, ledger record/resume, per-chunk verdict roll-up | ✓ VERIFIED, substantive, wired | 1208 lines; exports `isPresentationLine`, `ruleBearingLines`, `deriveStale`, `livePageSpan`, `pairSlices`, and internal `computeChunkVerdicts`. Read directly — not a stub. `deriveStale` genuinely takes one argument. |
| `src/cli/commands/verify-classify.test.ts` | Unit coverage for every mechanical piece | ✓ VERIFIED | Ran directly: `npx vitest run src/cli/commands/verify-classify.test.ts` → 54/54 passed, including a real CLI-registration subprocess check (not just in-process unit calls). |
| `src/cli/slash-command/bs/verify/classification-dispatch.md` + `classification-subagent.md` | Subagent contract for rule-delta judgment | ✓ VERIFIED (per proof, not independently re-read line-by-line here) | Confirmed present and exercised via `174-PROOF.md`'s `test -f` assertions on installed copies and real dispatch transcripts quoting from them. |
| Chunk-level attribution narrowing to the specific citation (decision 19) | Needed to actually close the phase goal | ✗ MISSING | Confirmed absent by reading `computeChunkVerdicts`: narrowing stops at the live-slice level (decision 18's `pair.liveSlices... text.includes(quote)` check), never descends to a chunk's individual `## Interpretation` citation. Decision 19 exists only as a CONTEXT.md decision (commit `df6ccab8`), not as code. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| Classification subagent return (`ruleDelta`, `quotedPass1`) | `computeChunkVerdicts` | `record.quotedPass1` string match against live slice text | WIRED | Confirmed in source: the quote is matched verbatim against each live slice's text; unreadable/unmatched cases broaden conservatively and emit a warning rather than silently passing (lines ~1035-1052). This is real, working code — the gap is granularity, not wiring. |
| `deriveStale` | `computeChunkVerdicts` chunk-level `stale` output | direct call, one-argument | WIRED, and correctly ISOLATED from provenance | Confirmed structurally — provenance is never threaded into this path. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| VERIFY-03 | 174-01..07 | Two-dimension classification + staleness-from-rule-delta-alone | ✓ SATISFIED — closure is legitimate | Requirement text is narrower than the phase goal (it specifies the mechanism: two dimensions, staleness keyed to rule delta). That mechanism is genuinely built and proven (SC-1..SC-5 above). The requirement text does NOT itself promise a specific stale-chunk RATE — that promise lives only in the phase goal's prose ("does not flag every chunk as stale"), not in VERIFY-03's requirement text. Closing VERIFY-03 while the phase goal remains open is a defensible, correctly-scoped reading, and REQUIREMENTS.md says so explicitly with the caveat carried forward rather than hidden. |
| VERIFY-01 | Phase 173 (verdict half closed 174-07) | Per-chunk verdict without rebuilding | ✓ SATISFIED as literally worded, with an honest carried caveat | The requirement text asks for "a per-chunk verdict without rebuilding" — proven (real `chunkVerdicts[]`, no-build confirmed by whole-tree sha256 diff). REQUIREMENTS.md's own citation already discloses the high stale rate as a caveat "not blocking this requirement's own text." Agreed: the requirement text is about verdict PRODUCTION mechanics, not verdict ACCURACY-AT-SCALE, so this closure is legitimate provided the caveat stays visible (it does, in both REQUIREMENTS.md and ROADMAP.md). |
| VERIFY-07 | Phase 173/174 | Orchestrator never reads a full slice; classification runs in a subagent | ✓ SATISFIED, with one disclosed real exception | Confirmed via the same grep methodology 173-PROOF.md used. One honest miss beyond the plan's own stated exception: 2 matches inside a free-prose `evidence` field describe schema prefixes generically rather than quoting rule content — reported plainly in `174-PROOF.md` §3 rather than absorbed into the exception silently. This is a genuinely minor, disclosed gap and does not undermine the requirement's substance (no rule-bearing quote is read outside the documented `quotedPass1`/`quotedPass2` channel). |

**No orphaned requirements found** — REQUIREMENTS.md's Phase 174 mapping (VERIFY-01, VERIFY-03,
VERIFY-07) matches what 174-CONTEXT.md declares in scope.

### Anti-Patterns Found

None found in `src/cli/commands/verify-classify.ts` on inspection — no TODO/FIXME/TBD/HACK/
placeholder markers, no stub returns. The file's honesty is unusual in the other direction: comments
explicitly document WHY certain design choices were made (e.g., the `deriveStale` one-argument arity
comment, the `null`-vs-`''` cache distinction for unreadable slices) rather than hiding shortcuts.

### Data-Flow Trace

Not applicable in the UI sense — this is a CLI/data-pipeline phase. The relevant trace is the
attribution chain: subagent `quotedPass1` → `computeChunkVerdicts`'s literal string match against
live slice text → chunk `stale` field. Traced directly in source; confirmed real (not hardcoded) —
the function actually reads live slice files from disk (`fs.readFile`) and does a genuine substring
match, with an explicit conservative-broaden path on read failure or unattributable quote.

### Behavioral Spot-Checks

Ran the unit suite directly rather than re-executing the live `claude -p` proof (which is
non-idempotent and costly, and whose evidence is already extensively documented with raw
command/output pairs in `174-PROOF.md`):

| Behavior | Command | Result | Status |
|---|---|---|---|
| Classifier unit suite green | `npx vitest run src/cli/commands/verify-classify.test.ts` | 54/54 passed, incl. a real CLI-subprocess `--help`/`--json` check | ✓ PASS |
| `deriveStale` has one parameter (provenance cannot be an input) | `Read` on lines 153-162 of `verify-classify.ts` | Confirmed: `function deriveStale(ruleDelta: RuleDelta): boolean` | ✓ PASS |
| Decision-14b amendment predates the SC-2 measurement | `git log --oneline -- 174-PROOF.md` | `fc030f17` (declare bar, amendment) appears BEFORE `ab70f535` (measure bar) in the file's own commit history | ✓ PASS — the ordering claim in `174-PROOF.md` is independently confirmed, not merely asserted |
| Decision 19 (per-citation attribution) is undecided-but-unbuilt, not silently shipped | `Read` on `computeChunkVerdicts` | Confirmed: narrowing stops at slice level; no per-citation logic exists anywhere in the function | ✓ PASS (confirms the gap is real, not closed quietly) |

### Probe Execution

No `scripts/*/tests/probe-*.sh` files apply to this phase; the phase's own live-proof mechanism
(`claude -p` subprocess dispatch, documented exhaustively in `174-PROOF.md`) is the closest analog
and was not re-run here (non-idempotent, already extensively evidenced with raw transcripts). Not
re-executed; treated as sufficiently evidenced by the existing artifact rather than re-run blind.

### Human Verification Required

None. Every claim in this report was checkable against committed artifacts (source code, test runs,
git history) without needing a live human judgment call. The phase's own open risk (chunk-level
staleness rate) is not a "needs human eyes" item — it is a measured, unambiguous number that fails a
measured, unambiguous bar.

## Honesty Audit (per the verification brief's focus area 5)

Checked specifically for claims stated as proven that rest on structural/unit tests rather than the
real runs the requirement text demands, and for numbers described more comfortably than they
measure. Findings:

- **SC-2's 90.9% is reported exactly, not rounded up** ("cleared... not comfortably cleared" — the
  phase's own text says this, and it is accurate: 10/11 is a one-finding margin).
- **SC-4's `source-changed`+`cosmetic`+not-stale combination is explicitly flagged as
  structurally-proven-only**, not claimed as a real 4-tuple. This is exactly the kind of thing that
  went wrong in earlier phases of this milestone (per MEMORY.md's own history of caught premature
  completions) and here it is disclosed correctly.
- **VERIFY-07's free-prose `evidence` field exception is reported as a genuine miss beyond the
  planned exception**, not folded silently into the documented exception.
- **The chunk-level staleness failure is the headline finding, not buried** — it appears in
  `174-PROOF.md`'s own "What is still unproven" list at position 1, in ROADMAP.md's Phase 174 Result
  paragraph, and in REQUIREMENTS.md's VERIFY-01 citation. No inconsistency found between these three
  restatements of the same number (100%/87.5%, 11/11 and 14/16) — cross-checked and they agree
  exactly.
- **No place found where a measured number is softened.** If anything the reporting is
  self-critical to a fault (e.g., explicitly computing what a slightly-worse measurement would have
  looked like in §2, "a single additional sharper finding... would drop the pooled percentage to
  90.0%... or to 83.3%").

This phase's documentation practice is a positive outlier relative to the adversarial stance this
verification is required to take — the self-report already correctly identifies its own central
failure. The gap this VERIFICATION.md adds is not a NEW discovery; it is (a) independent
confirmation via source-reading and git-history-checking rather than trusting the prose, and (b) the
missing structured gap record that should have gated the phase before it was marked complete, so a
gap-closure plan (decision 19's implementation) has a formal target.

## What Is Genuinely Achieved vs. Structural-Only vs. Not Achieved

**Genuinely achieved and proven on real data:**
- Two-dimension classification (provenance + rule delta) — SC-1, real cross-tab.
- The ≥90% cosmetic / 0% contradictory bar — SC-2, real pooled line-level measurement (narrow
  margin, honestly reported).
- Real rules-change detection — SC-3, a real PDF mutation through the real pipeline.
- Cross-game validation — SC-5, two distinct real reference games.
- Determinism — identical `(pairId, ruleDelta, stale)` triples across independent dispatches.
- Orchestrator never reads rule content directly (VERIFY-07's core promise) — real grep evidence
  across three artifact types, with one small, disclosed exception.
- Per-chunk verdict production mechanics (VERIFY-01's literal text) — real, no-build-required.

**Achieved but proven only structurally (not on real, naturally-occurring data):**
- SC-4's literal `source-changed`+`cosmetic`+not-stale 4-tuple (proven by `deriveStale`'s
  one-argument arity + a unit test, not by a real occurrence — correctly disclosed as such).
- VERIFY-01 assertion (d), the `unpaired-slice`-only chunk reading `unclassified` — proven only by
  `verify-classify.test.ts`'s `chunk-2` test; neither real game ever produced an `unpaired-slice`
  group.
- True native Task/Agent-tool dispatch (every real dispatch in this milestone used a `claude -p`
  OS-subprocess as a documented stand-in) — carried as an open item across multiple phases, not
  specific to 174, and not treated as a blocker here since it mirrors 173's own resolved precedent.

**Not achieved:**
- **The phase goal itself.** A second run of the skill flags 100% (one-two-punch) and 87.5%
  (seven) of citing chunks as stale from one real finding each — this is precisely the failure mode
  the goal's own wording names ("does not flag every chunk as stale"). Root cause (live-slice
  granularity too coarse for 2-3-slice rulebooks) is correctly diagnosed and the fix (decision 19,
  per-citation attribution) is correctly identified but not built in this phase's plans.
- **An automated re-adoption path for a changed archived source** (SC-3's provenance flip required
  a manual `INDEX.md` hash edit because `ingest-archive` deliberately refuses to clobber) — a real
  gap, correctly flagged, not assigned to any current phase.

## Gaps Summary

One material gap blocks the phase goal: **chunk-level staleness attribution is one granularity
level too coarse.** Decision 18 (slice-level narrowing) is real, correct, and independently proven
to do non-trivial work, but is not fine-grained enough for rulebooks that concentrate content into
2-3 live slices most chunks cross-cite. Decision 19 (per-citation attribution) is the identified fix,
already recorded as a locked decision in `174-CONTEXT.md`, but it exists only as a decision — no
plan in 174-01 through 174-07 implements it, and `computeChunkVerdicts` in
`src/cli/commands/verify-classify.ts` confirms this by inspection (narrowing logic stops at the live
slice, never descends further).

This finding was already surfaced honestly by the phase's own final plan and the ROADMAP.md reopen
note — this verification independently confirms it against the underlying code and git history
rather than accepting the narrative, and finds no daylight between the self-report and the evidence.
The five roadmap Success Criteria are real passes on real data and should not be re-litigated by a
gap-closure plan; the gap-closure plan's job is squarely decision 19's implementation plus a
re-measurement of chunk-level staleness on both `seven` and `one-two-punch` (and ideally a
larger/multi-group reference game, to also close the SC-4 structural-only gap and the
`unpaired-slice` VERIFY-01 assertion (d) structural-only gap as a byproduct, though neither of those
two is a phase-goal blocker on its own).

---

_Verified: 2026-07-30_
_Verifier: Claude (gsd-verifier)_
