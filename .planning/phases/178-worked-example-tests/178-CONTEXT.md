# Phase 178: Worked-Example Tests - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — 4 areas, 16 questions, all accepted as recommended

<domain>
## Phase Boundary

Worked examples printed in a rulebook stop being a one-time seed for hand-written tests and
become an accumulating, automatically-derived executable test suite on BOTH sides of the bs
pipeline: `build/test.md` generates them for a newly-built chunk (TEST-01), and
`/bs-verify-game` replays them against the real engine and reports mismatches (CHECK-06). One
shared derivation path serves both.

**In scope:** example identification, the shared slice→spec→runnable-test derivation, the
build-side generation step, the verify-side replay step, a new `Example (p.N):` ingest marker,
and the proof against all three reference games.

**Out of scope:** re-transcribing any reference game to add examples; a source-free MODE (Phase
179 assembles that); backfilling generated example tests into already-built chunks of existing
games.

</domain>

<measured_reality>
## Measured directly before deciding (2026-07-31)

These were checked against real files, not assumed. Two of them contradict the ROADMAP.

1. **The ROADMAP's stated dependency is FALSE.** Phase 178's `Depends on` reads "Phase 170 (the
   split determines which lines are examples vs. presentation)." Phase 170's annotation family is
   exactly `{Derived, Visual, Named-but-undefined}` — pinned in three places
   (`verify-enumerate.ts:116,154`, `verify-derive-recheck.ts:423,426`,
   `verify-classify.ts:102`). **Nothing in the 170 split identifies a worked example.** Phase 178
   must therefore create the identification mechanism, not consume one. Planning must not assume
   otherwise.

2. **Zero worked examples carry any structural marker** in any of the three reference games. They
   appear as ad-hoc, per-game prose:
   - `seven/rulebook/01-definitions-and-components.md:6,12` — `"example: 5, 5, 5"` /
     `"example: 5, 6, 7"`, inside quote lines
   - `one-two-punch/rulebook/02-action-cards-and-resolution.md:84-91` — a `## Punch Examples`
     heading with `p.2, Punch Examples (italic):` citation headers
   - `doom-machine/rulebook/01-destroying-a-machine-part.md:13` —
     `Worked example content (p.1, panel -7-, verbatim from card art):`
   - `doom-machine/rulebook/02-machine-phase.md:15` — the SOUL HARVESTER example, present only as
     a `Diagram description` line

3. **The population is TINY and heterogeneous: ~5-6 examples across all three games (~2 each).**
   An order of magnitude smaller than CHECK-04's 32-line corpus. They are not the same kind of
   thing:
   - `one-two-punch`'s Punch Examples are genuine state→action→state transitions (3 Guards
     READY/EXHAUSTED/EXHAUSTED → punched → READY/EXHAUSTED). Directly executable.
   - `seven`'s are *definition illustrations* — `isSet([5,5,5])`, `isRun([5,6,7])`. Executable
     only at predicate level, not as a game action.
   - `doom-machine`'s is image-derived and may not be executable at all.

4. **`seven`'s Run example is DEFECTIVE IN THE SOURCE.** The printed text reads "5, 6, 7" while
   the accompanying card images show 1, 2, 3 — already logged as `seven/rulebook/INDEX.md:63`
   open gap #4. A naive generator would silently encode this contradiction as a passing test.
   This case is the phase's single best adversarial fixture; it must be exercised, not avoided.

5. **`build/test.md` runs in the GENERATED game project**, not BoardSmith's repo, so generated
   tests must target that game's own API. And SC-2 requires replay on the three reference games,
   which were built before this phase and have NO generated tests — so verify cannot simply run
   what build produced. Both sides need the full slice→spec→runnable path. This is what makes
   SC-3 load-bearing rather than decorative.

</measured_reality>

<decisions>
## Implementation Decisions

### Area 1 — Identifying worked examples (accepted 2026-07-31)

1. **Identification is JUDGMENT (subagent), enumeration and recording are MECHANICAL (CLI).** The
   same split Phase 177 decision 2 established. No mechanical rule identifies a worked example:
   measured reality #2 shows the phrasing is ad-hoc and per-game, so a keyword/heading heuristic
   would work on the lines someone looked at and silently misjudge the rest — the same defect
   class as an absence-phrase list (Phase 176 decision 4).

2. **Add an `Example (p.N):` marker to the ingest transcription contract — but the check must NOT
   depend on it.** New games accumulate the marker free; the check still works marker-free so all
   three reference games are in scope today. A marker-dependent check would have zero coverage on
   every existing game.

   **Concrete cost to plan for:** the annotation family is enumerated in lockstep across
   `verify-enumerate.ts` (`ANY_ANNOTATION_LINE_RE:116`, `ANNOTATION_VOCABULARY_RE:154`),
   `verify-derive-recheck.ts` (`ANY_ANNOTATION_LINE_RE:426`, `quoteLinesOnly`), and
   `verify-classify.ts`. Adding a 4th kind means widening all of them together — and
   `quoteLinesOnly` must be re-examined deliberately: CHECK-04's blind payload strips annotation
   lines, and an `Example` line is arguably quote-bearing content rather than an annotation.
   Getting this wrong silently changes CHECK-04's payloads. WR-07 (inverting `quoteLinesOnly`'s
   deny-list to an allow-list, deliberately deferred in 177) is directly adjacent — consider
   closing it here rather than widening a deny-list a fourth time.

3. **Examples are TYPED: `transition` | `predicate`.** Both are in scope. Restricting to
   state→action→state transitions would give `seven` zero examples and leave the check unexercised
   on one of three reference games.

4. **An example that contradicts its own source is NEVER turned into a test.** It is emitted as an
   `example-inconsistent` finding routed to the designer / `## Open Rules Gaps`. Never pick a
   side, never invent. Direct application of CHECK-04's closure criterion — *never a confident
   false accusation*. `seven`'s Run example is the live fixture for this path.

### Area 2 — Example → executable test derivation (accepted 2026-07-31)

5. **Extraction returns a structured `WorkedExample` spec, never test code.** Fields: id, slice
   ref, page citation, `kind` (`transition`/`predicate`), the verbatim source text, setup, action,
   expected outcome. Recorded through ONE atomic write path — the CHECK-04 ledger shape.

6. **Two steps, not one: extract, then translate.** A second shared subagent contract turns a
   `WorkedExample` spec into runnable test code, invoked identically by build and verify. Mirrors
   CHECK-04's blind-derive-then-compare split (177 decision 7): one combined pass invites the
   model to work backward from code it can already see, producing agreement rather than a test.

7. **`unexecutable` is a first-class verdict with a NAMED reason** — an example the chunk or game
   cannot express yet is never a failing test and never silently dropped. This milestone's 7th
   application of the same honest-blindness principle (`underivable`, `drift-unknown`,
   `unclassified`, `unknown-drift`, `undetermined`, `absence-unverifiable`, and now this).

8. **Build-generated tests are ONE FILE PER CHUNK**, committed with the chunk, in the generated
   project's test directory. Re-running build for a chunk regenerates only that chunk's file,
   idempotently, never touching another chunk's — the upsert-append discipline CR-06 established
   for the CHECK-04 ledger.

### Area 3 — Shared logic placement and pipeline wiring (accepted 2026-07-31)

9. **Mirror CHECK-04's module/CLI pairing exactly.** `verify-example-replay.ts` is the single
   shared module (`--json` read/enumerate/report); `verify-example-record` is the ONLY atomic
   write surface. That pairing was built, code-reviewed, and hardened across 177-09/177-10
   (fence-injection rejection, read-path revalidation, upsert-append) — reuse its shape rather
   than inventing a third.

10. **`build/test.md`: a new step between existing steps 3 and 4, and a mismatch IS
    build-blocking** — it routes the chunk back to `repair` like every other step in that ordered
    sequence. Rationale: in build, the chunk was *just written* to satisfy those exact slices, so
    a mismatch is precisely the drift the step exists to catch. Chunks with zero examples skip it
    and **name the exemption explicitly** in the test file's comment — the SKILLAUTO-08 exemption
    pattern already in that file, never a silent omission.

11. **`verify-game.md`: a new Step 8 (CHECK-06); Close renumbers to Step 9. It REPORTS, exit 0,
    and never gates the Close.** Deliberately asymmetric with decision 10, and consistent with
    177 decision 15 and CHECK-03/CHECK-05: "these are advisory sweeps a verify pipeline consumes,
    not gates." Project-wide, independent of staleness, source-free by construction — the same
    shape as Step 7.

12. **A replay mismatch does NOT by itself mean the code is wrong — gate it on quote provenance.**
    This is the milestone's hardest-won lesson: 177's `seven:11` correction proved that judging
    an inference against an UNVERIFIED quote cannot separate "the code is wrong" from "the quote
    is wrong," and that the resulting confident false accusation is worse than an honest shrug.
    Reuse `QuoteVerifiedProvenance` (built 177-16, scope-fixed 177-19) to check the example's
    supporting quote lines against the archived source before reporting. When the source is
    unavailable, downgrade to an explicitly lower-confidence finding rather than accusing the
    code. Anchor on the existing provenance machinery (source archive + hashes,
    `chunk-provenance.ts`) — do not build a second one.

### Area 4 — Proof discipline and acceptance bar (accepted 2026-07-31)

13. **Pre-register the expected extraction before any dispatch** — which examples exist in each of
    the three games, by slice + line — committed first, so git ordering proves the expectation was
    not retrofitted. The discipline that worked in 174-06, 176-05, and 177-12.

14. **NEW GATE, distilled from 177's cost: every proposed criterion is checked against "could this
    ever pass?" BEFORE it is committed.** CHECK-04 spent four full definitive measurement runs
    failing a single criterion that was unsatisfiable by construction. A criterion that no
    possible correct implementation could satisfy is a defect in the criterion, and it must be
    caught at pre-registration time, not after the fourth run.

15. **Do NOT re-import the retired determinism gate.** Stability is measured on the EXECUTABLE
    OUTCOME — the generated test's pass/fail result — not on byte-identical spec text. This is
    exactly redefinition option (a) that `177-22` named and never got to try: "stability of the
    underlying grounded-fact set rather than the final classification label." Two independent
    extractions phrasing the same example differently while producing tests that agree on pass/fail
    is a SUCCESS, not a flip.

16. **Report raw counts and a per-game breakdown — never a percentage.** At n≈6 a percentage is
    actively misleading. 177's own closure note is the precedent: three games is "real
    generalization evidence, not a general result." If the corpus is too small to distinguish the
    mechanism working from luck, say so plainly rather than manufacture a score.

17. **A reference game with zero extractable examples is a REAL FINDING about the ingest
    contract**, reported as such — examples were not transcribed, which is substantive feedback
    about `/bs-ingest-rules`. It is never a tuning signal and never a reason to loosen extraction.
    Direct reuse of 177 decision 11: relaxing the mechanism until something is found would destroy
    the check's only real guarantee to manufacture a pleasant number.

18. **Proof runs on `cp -R` copies with sha256 baselines; originals proven byte-identical after.**
    The staging discipline 177 held across 200+ live dispatches in both proof runs.

### Claude's Discretion

- Module boundaries and file placement within `src/cli/commands/` and
  `src/cli/slash-command/bs/`, and the exact subagent contract filenames/handshake tokens
  (following the `BS-*-V1` convention).
- The `WorkedExample` record's exact field shape, provided verdicts are a test-pinned enumerated
  set and it reuses the single atomic ledger write path.
- Human-readable report grouping and the generated test file's naming convention.
- Whether to close WR-07 (`quoteLinesOnly` deny-list → allow-list) as part of decision 2's family
  widening, or widen the deny-list once more and leave WR-07 open — decide on the evidence at
  plan time, but make the choice explicitly rather than by default.
- Dispatch batching, provided decisions 6 and 12 hold.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/verify-derive-recheck.ts` (+ `verify-derive-record` CLI in `cli.ts:423-445`)
  — the read-command / single-atomic-write-surface pairing to mirror, including fence-injection
  rejection, read-path revalidation, and upsert-append (CR-02/CR-04/CR-06).
- `src/cli/commands/verify-enumerate.ts` — dual enumeration + reconciliation + `validateGrounding`;
  the deterministic `findMatch` fix (564f1a42) and the decoration-tolerant
  `ANNOTATION_VOCABULARY_RE` live here.
- `QuoteVerifiedProvenance` (177-16, multi-source scope fix 177-19) + `chunk-provenance.ts` —
  decision 12's machinery, already fails closed.
- `PRESENTATION_EXCLUSION_MARKERS` + `isPresentationLine` (`verify-classify.ts:102-114`) — the
  single shared presentation definition.
- `simulateRandomGames` (`src/testing/random-simulation.ts`) and the `boardsmith lint` /
  `sandbox-scan.ts` / `scanAssetReachability` pattern in `build/test.md` — the "cite the real
  command, never restate it in prose" discipline every new test step must follow.

### Established Patterns
- Skill prose lives in `src/cli/slash-command/bs/{build,verify,ingest}/*.md`; heavyweight
  step-scoped contracts are delegated by reference from the orchestrator, never inlined
  (`verify-game.md` "Reference Files", and its Context-Economics Hard Rule).
- Subagent contracts carry a `BS-*-V1` handshake token and are pinned by installer leaf probes +
  drift tests (`verify.test.ts`, `templates.test.ts`).
- Every skill-text change is demonstrated against a real run and locked by a regression test —
  the PROC-01/PROC-02 pattern established in Phase 170, held by every phase since.

### Integration Points
- `src/cli/cli.ts` — command registration (see the CHECK-04 block at 396-445 for the exact shape).
- `src/cli/slash-command/bs/build/test.md` — the ordered, non-reorderable, stop-on-failure
  sequence (decision 10 inserts between items 3 and 4).
- `src/cli/slash-command/bs/verify-game.md` — Steps 0-8 + Reference Files (decision 11 adds
  Step 8, renumbers Close to 9, and adds two reference-file entries).
- `src/cli/slash-command/bs/ingest/transcription-subagent.md` — decision 2's `Example (p.N):`
  marker joins the line-kind contract; §"Worked examples are transcription-critical" (line 142)
  already states the requirement in prose and is the natural anchor.

</code_context>

<specifics>
## Specific Ideas

- `seven`'s Run example (text "5, 6, 7" vs. images 1, 2, 3 — `INDEX.md:63` gap #4) is the
  designated adversarial fixture for decision 4's `example-inconsistent` path. Exercise it
  explicitly; do not route around it.
- `one-two-punch`'s two Punch Examples are the cleanest `transition` fixtures in the corpus and
  the most likely to prove SC-2 end-to-end.
- The ROADMAP's `Depends on` line for this phase should be corrected as part of the work
  (measured reality #1) rather than silently left wrong.

</specifics>

<deferred>
## Deferred Ideas

- Backfilling generated example tests into already-built chunks of existing games — no migration
  phase, consistent with the milestone's stated Out of Scope.
- Re-transcribing any reference game to add `Example (p.N):` markers; the check is marker-free by
  decision 2 precisely so this is unnecessary.
- Cross-game example-replay battery as a single regression sweep — already recorded as a Future
  Requirement in `REQUIREMENTS.md`.

</deferred>
</content>
</invoke>
