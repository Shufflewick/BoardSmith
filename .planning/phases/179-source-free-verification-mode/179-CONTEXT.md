# Phase 179: Source-Free Verification Mode - Context

**Gathered:** 2026-08-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 3 areas, 12 questions, all accepted as recommended

<domain>
## Phase Boundary

A project whose source rulebook is unavailable still gets a verification pass — an honest,
reduced one. Never a failure, and never a silent full-scope claim.

This is the milestone's CAPSTONE: it assembles a mode from checks earlier phases already built
source-free by construction. It adds almost no new checking; it adds honest degradation.

**In scope:** entering source-free mode automatically, selecting which steps run, deriving and
reporting the unchecked defect classes, recording reduced scope in provenance, and proving it on
a real project in a real source-free state.

**Out of scope:** making any currently source-dependent check work without source (that would be
a new capability, not honest degradation); backfilling source into projects that lack it; a
`--source-free` flag (see decision 1).

</domain>

<measured_reality>
## Measured directly before deciding (2026-08-01)

1. **Today the skill STOPS.** `verify/source-resolution.md:81` — "Negative case — no candidate
   anywhere: STOP." A project with no archived source and no root candidate ends the session.
   **That single behavior is what VERIFY-09 replaces.** The phase is smaller than it looks: the
   detection point already exists and is already correct; only its consequence changes.

2. **PROV-02's machinery exists — but `/bs-verify-game` CANNOT REACH IT. (CORRECTED 2026-08-01
   after the plan-checker BLOCKED on this; the original wording below was WRONG.)**
   `src/cli/commands/chunk-provenance.ts` exports `SCOPE_CODE_ONLY = 'code-conformance-only'`
   (:27), `computeVerificationScope()` (:107), and a renderer field documented as "Omitted unless
   `scope` is `code-conformance-only`" (:330). All real.

   **But the durable `## Verified Against` block is written by exactly ONE function** —
   `chunkCheckCommand` (`chunk-provenance.ts:432`), registered as `boardsmith chunk-check <slug>`
   (`cli.ts:198`) — **and every call site is in the BUILD pipeline**: `build/close.md`,
   `check-status.md`, `state-machine.md`. Verified by grep: `verify-game.md` and every file under
   `verify/` contain ZERO `chunk-check` dispatches. `source-resolution.md:52-55` even documents
   the distinction explicitly ("only a later, separate `chunk-check` invocation changes it").
   `verify-classify.ts:446`'s `computeVerificationScope()` call is READ-ONLY.

   **My original claim — "nothing new is needed to RECORD reduced scope, only to reach that
   path" — was FALSE. There is no path.** A `/bs-verify-game` run never writes provenance for
   anything, source-free or not.

   **Wider consequence, surfaced by this phase:** PROV-02 ("a verification that could not re-read
   source records its scope as code-conformance-only") is CLOSED (Phase 171) on the BUILD path
   only. The mechanism is unreachable from the pipeline its own text describes. This is the third
   instance in this milestone of a requirement closed against evidence produced by something other
   than the path a user takes (cf. Phase 177.1's CHECK-04; Phase 178's SC-3 translation half,
   caught pre-execution).

   **User decision 2026-08-01: WIRE IT.** `/bs-verify-game`'s Close — and source-free mode's
   Close — must dispatch `chunk-check` (or an equivalent write) for every chunk the run touched.
   This is a deliberate behavioural change to a shipped skill: verify runs now write to
   `CHUNK.md`. SC-3 and PROV-02 are delivered as written rather than downgraded.

3. **Four checks are already source-free BY CONSTRUCTION** (not by flag, per the standing
   milestone discipline): CHECK-03 (`trace-check`) and CHECK-05 (`drift-check`) from Phase 172;
   CHECK-04 (`verify-derive-check`) per 177 decisions 4/14; CHECK-06 (`verify-example-replay`)
   from Phase 178, which degrades via `QuoteVerifiedProvenance` rather than requiring source.

4. **Steps 2-6 structurally cannot run.** Re-transcription (2), classification (3), impact map
   and adjudication (4), ruling re-check (5), and repair dispatch (6) all consume a fresh
   transcription of the source. With no source there is no fresh transcription, so these are not
   "skipped for convenience" — they have no input.

5. **Neither reference game can exercise this path as-is.** PROJECT.md records deliberately:
   "both reference games retain `rules.pdf`, so the source-based path still runs on them." The
   source-unavailable state must be STAGED (decision 9).

</measured_reality>

<decisions>
## Implementation Decisions

### Area 1 — What source-free mode runs (accepted 2026-08-01)

1. **Entered AUTOMATICALLY from `source-resolution.md`'s existing negative case — no flag, no
   config.** Replace the STOP at `source-resolution.md:81` with "enter source-free mode."

   **A `--source-free` flag is explicitly rejected.** It would let someone claim reduced scope on
   a project that HAS source — a way to skip verification while still looking verified. The mode
   must be a consequence of the project's actual state, never a choice. This is the same
   "source-free by construction, not by configuration" discipline Phase 172 set and Phases 177
   and 178 both held.

2. **Steps 2-6 do not run** — they have no input (measured reality #4), not merely no appetite.
   **CHECK-03, CHECK-05, CHECK-04 (Step 7) and CHECK-06 (Step 8) DO run**, unchanged, because all
   four are source-free by construction.

3. **CHECK-06 runs, with every finding recorded `quote-unverified`.** Phase 178 wave 4 already
   built precisely this degradation: `QuoteVerifiedProvenance.obtain()` returns no coverage, the
   provenance field downgrades, **the verdict itself is never rewritten**, and the report buckets
   the finding as "a question about the quote, not an accusation against the code." Reuse it; add
   nothing.

4. **The pass SUCCEEDS — exit 0 — with honestly reduced scope.** Never a failure (the phase goal
   says so explicitly) and never a silent full-scope claim. The Close records `code-conformance-only`
   with the unavailable-source reason through the existing `SCOPE_CODE_ONLY` path.

### Area 2 — Naming what went unchecked (accepted 2026-08-01)

5. **The unchecked list is MECHANICALLY DERIVED from which steps were skipped** — computed in the
   CLI, formatted by the skill. Never a hand-authored prose list. A hardcoded list goes stale the
   moment a step is added or a check changes scope, and nothing would catch it — the same
   drift-by-duplication failure this milestone has now hit repeatedly.

6. **Granularity is the defect CLASS, in the designer's own terms, each naming the check that
   would have caught it** — e.g. "rulebook fidelity drift (no fresh re-transcription to compare
   pass-1 against)", "ruling re-validation against current source". **Not step numbers**, which
   mean nothing to a designer reading a report, and not requirement IDs.

7. **A test must FAIL when a pipeline step exists with no unchecked-class mapping.** This is this
   phase's version of the trap Phase 178 hit seven times: a report that silently omits a defect
   class is textually indistinguishable from one where nothing was missed. Without this test,
   SC-2 is true on the day it ships and quietly false afterward.

8. **Recorded in BOTH the run report AND the durable provenance block** (PROV-02's
   `code-conformance-only` + reason), so a later reader of `## Verified Against` sees the reduced
   scope without needing the original session transcript.

### Area 3 — Proving it (accepted 2026-08-01)

9. **Stage by `cp -R`ing a reference game and REMOVING `rulebook/source/` from the copy** — a real
   project in a real source-free state, not a synthetic minimal fixture. Originals proven
   byte-identical afterward.

10. **The baseline check is WHOLE-TREE** (`git status --short` on each original, or a full-tree
    hash) — **not an enumerated subset.** Phase 178's proof §10 recorded this exact failure: a
    scoped sha256 reported "825/825 OK" while two tracked files were being deleted, because the
    check enumerated where a change was *anticipated* rather than where one was *possible*. The
    instrument could not observe its own miss. Do not inherit that harness.

11. **The proof must show FOUR things:**
    (a) the run COMPLETES rather than failing;
    (b) the unchecked list names real defect classes;
    (c) the provenance block records `code-conformance-only` with the unavailable-source reason;
    (d) **the checks that DID run produced real findings.**

    (d) is the one that matters most. A mode that runs nothing and reports honestly about running
    nothing is not a verification pass — it is a banner. Source-free mode has to still catch
    things.

12. **Pre-register the expectation, committed ALONE before the run, with the satisfiability audit
    applied to every criterion** — could a correct implementation fail this for reasons outside
    its control? Same discipline as 177.1 and 178. Phase 178's audit earned its cost immediately:
    it caught two ROADMAP success criteria that were unsatisfiable as literally written, and one
    criterion that would have passed VACUOUSLY if extraction found nothing.

### Claude's Discretion

- Module placement and whether the unchecked-class derivation lives in a new module or an
  existing one, provided there is exactly ONE definition of the step→defect-class mapping.
- The unchecked-class wording, provided it is designer-facing and names the responsible check.
- Report grouping and `--json` shape, provided the skill formats and never computes.
- Which reference game is staged for the proof.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/chunk-provenance.ts` — `SCOPE_CODE_ONLY:27`, `computeVerificationScope():107`,
  and the provenance renderer's existing reduced-scope field (:330). Decision 4 and 8's machinery,
  already built and tested.
- `QuoteVerifiedProvenance` (`verify-enumerate.ts:994`) + Phase 178's two-bucket reporting —
  decision 3's degradation, already built.
- `verify-example-replay`, `verify-derive-check`, `trace-check`, `drift-check` — the four
  source-free commands, all registered and reachable.

### Established Patterns
- "Source-free BY CONSTRUCTION, not by configuration" — Phase 172 decision, held by 177 and 178.
  Decision 1 is its direct application at the mode level.
- `verify-game.md` steps DISPATCH and FORMAT; they never compute. Every number in a report comes
  from a command's `--json`.
- Advisory checks exit 0; non-zero is reserved for tool failure.
- Every skill-prose change needs a regression pin (PROC-01/PROC-02).
- Pre-register before measuring; audit every criterion for satisfiability BEFORE committing it.

### Integration Points
- `src/cli/slash-command/bs/verify/source-resolution.md:81` — the negative case whose consequence
  changes (decision 1). The DETECTION is already correct; only what follows it changes.
- `src/cli/slash-command/bs/verify-game.md` — Steps 1-9; source-free mode changes which run.
- `src/cli/commands/chunk-provenance.ts` — the scope recording path.
- `.planning/REQUIREMENTS.md` — VERIFY-09, the milestone's last open requirement.

</code_context>

<specifics>
## Specific Ideas

- This phase is smaller than its position suggests: the detection point exists, the scope-recording
  machinery exists, and all four checks that run are already source-free. The genuinely new work
  is the step→defect-class mapping (decisions 5-7) and the proof (9-12).
- Decision 7's test is the phase's most durable artifact — it is what keeps SC-2 honest after the
  pipeline grows.
- Carried from Phase 178's proof §10: whole-tree baselines, never enumerated subsets.
- Carried from Phase 178's review: a guarantee stated in a doc comment is not a guarantee. Three
  criticals there were true in prose and false in the data flow.

</specifics>

<deferred>
## Deferred Ideas

- Making any source-dependent check work without source — a new capability, not honest degradation.
- Cross-game source-free battery — already a recorded Future Requirement.
- WR-01 from Phase 178 (splitting the 1,236-line `verify-example-replay.ts`) — deferred tech debt
  with its own reasoning, not this phase's work.

</deferred>
</content>
