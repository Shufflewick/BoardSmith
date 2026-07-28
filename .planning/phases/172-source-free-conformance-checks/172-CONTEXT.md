# Phase 172: Source-Free Conformance Checks - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Requirements:** CHECK-03, CHECK-05

<domain>
## Phase Boundary

The two checks that need neither the ingest changes nor re-transcription exist and are proven
immediately against real games, de-risking everything downstream.

In scope:
- CHECK-03 — traceability sweep: every `## Interpretation` claim has a citing test, every test
  traces to a live claim, every `RULINGS.md` ruling has a test. Zero source/rulebook access.
- CHECK-05 — code drift: each chunk's `## Build Manifest` files diffed against its
  `## Verified Commit Hash`; any chunk whose code moved since the human approved it is reported.
- Both proven end-to-end against at least one reference game, surfacing real findings.

Out of scope: `/bs-verify-game` itself (Phase 173) — this phase builds the checks it will later
call, and they must stand alone first. Re-transcription, the classifier, the impact map, repair
gating (174–176). CHECK-04 derived-line re-derivation (177). CHECK-06 worked examples (178).
Anything that reads the rulebook source: both checks here are source-free **by construction**,
not by configuration.
</domain>

<decisions>
## Implementation Decisions

### The sort: both requirements are MECHANICAL

Phase 170's central finding (`170-MECHANISMS.md`) requires each requirement to be sorted into
mechanical vs judgment before planning, because skill text conveys judgment reliably and mechanics
not at all — twelve instruction-shaped mechanisms were skipped on live runs.

| Req | Sort | Why |
|---|---|---|
| CHECK-03 | Mechanical | Parsing claim lists, ruling entries, and test-file citation comments, then set-differencing them. One correct output. |
| CHECK-05 | Mechanical | `git diff` between two commits, intersected with a parsed file list. One correct output. |

**Therefore: this phase is CLI work**, continuing Phase 171's shape. Skill text's only job is to
invoke a command and format its `--json`. Do not spend a plan rewording instructions.

### Scout findings that constrain the design (verified against both reference games, 29 chunks)

These were checked directly before deciding, not assumed:

- Tests cite claims as free-text comments: `claim 12`, `claims 3, 4, 5, 29`,
  `claim 28 / Ruling 9/15`. Claim numbers are **per-chunk**, so a bare `claim 12` is ambiguous
  across 12 (one-two-punch) or 17 (seven) chunks.
- Build Manifests **do** list test files (`| tests/punch.test.ts | written… |`), sometimes several
  comma-joined in a single first cell with prose in the second. This is a real chunk↔test mapping —
  but partial: 5/12 one-two-punch chunks and 8/17 seven chunks list zero test files.
- `seven`'s test files have **no** filename↔chunk correspondence (9 test files, 17 chunks) and cite
  Rulings heavily but claims sparsely. CHECK-03 will surface substantial real gaps there, satisfying
  success criterion 3 without contrivance.
- `## Interpretation` claims are `^N. **bold**` ordered-list items; counts range 0–77 per chunk.
- `RULINGS.md` entries are `### Ruling N` sections with Decision / Citation / Rationale fields;
  supersession is a later entry referencing an earlier one.

### Area 1 — Traceability resolution model (accepted by the user, 2026-07-28)

1. **The Build Manifest is the claim-numbering authority.** A bare `claim N` in a test resolves to
   the chunk whose Build Manifest lists that test file. The manifest is already the authoritative
   file↔chunk record and CHECK-05 parses it too — one parser, one authority, no second convention.

   Rejected: filename-slug match (`punch.test.ts` → `punch` chunk) — fails entirely on `seven`.
   Rejected: requiring a qualified `<slug> claim N` form — writes off every existing citation across
   both reference games and depends on a new skill-text instruction, the mechanism 170 disproved.

2. **A test file in no manifest is an `unassociated-test` finding**, and its `claim N` references are
   recorded as **unresolved** — never silently dropped, never guessed. Silent under-recording is the
   CHECK-03 analogue of the gap-dropping defect Phase 170 spent itself on (and the direct parallel of
   PROV-01 decision 8).

3. **A test file listed in MULTIPLE chunks' manifests resolves by DETERMINISTIC NARROWING, and is
   only ambiguous if narrowing fails.**

   **AMENDED 2026-07-28 after `172-RESEARCH.md` measured the real data — the original form of this
   decision was made on a false premise and is superseded.** The premise was that multi-owner test
   files are an edge case. They are not: *every* claim-bearing test file in both games is listed in
   3–11 chunks' manifests (`a11y.test.ts` in 8, `game.test.ts` in 6 and 11, and `scoring.test.ts` —
   which carries 46 of `seven`'s 48 claim citations — in 9). Under the original rule, ~115 of ~115
   citations report `ambiguous-claim-ref` and `claim-untested` approaches **all 377 claims across
   both games** — asserting that virtually every claim is untested when the claims demonstrably DO
   have citing tests. That is the same "reports a verdict where it is blind" failure the original
   decision was written to prevent, inverted from false-clean into false-broken. And a check that
   fires on correct work gets waived (the lexicon rationale).

   The resolution ladder, all three rungs deterministic — no proximity heuristics, no guessing:

   1. **Candidate set** = every chunk whose Build Manifest lists this test file.
   2. **Validity narrowing** — discard candidates that do not actually have a *live* claim with that
      number in their current `## Interpretation` list. Claim counts range 0–77 and numbering is
      non-contiguous in 4/17 `seven` chunks, so this discriminates hard.
   3. **Authorship narrowing** — if >1 candidate survives, keep only the **authoring** chunk: the one
      whose manifest row marks the file `NEW` or `written`, as opposed to `edited` / `extended` /
      `rewritten` / `tightened`. This status prose is present in real manifest rows
      (`tests/discard.test.ts | NEW (test step)` vs `tests/game.test.ts, tests/block.test.ts |
      edited (test step, Decision 55)`).

   Only if **more than one candidate survives all three rungs** is the citation reported as
   `ambiguous-claim-ref`, naming the survivors, and counting as coverage for none of them.

   Note the residual risk knowingly accepted at rung 3: a claim *added* by a later editing chunk
   attributes to the authoring chunk. Rung 2 removes most of that exposure — the later chunk's claim
   number usually does not exist in the author's list, so the author is discarded before rung 3 runs.
   The user chose this trade explicitly over leaving the check unusable.

   Still rejected: attributing to all candidates — inflates coverage, reports clean where blind.
   Still rejected: attributing to the most recent chunk, or to a filename-slug match — guesses
   wearing a result's clothing.
   Still rejected: requiring a new qualified citation form — the pre-existing `CHUNK.md claim N`
   form found in the data is *self*-referential ("this chunk's claim N"), names no slug, and so
   resolves nothing; treat it exactly as a bare `claim N`.

4. **Static parse only.** The sweep regexes test sources, `CHUNK.md`, and `RULINGS.md`. It never runs
   `npm test` and never touches the engine. This keeps CHECK-03 fast, offline, and source-free by
   construction rather than by flag. (CHECK-06 in Phase 178 is the check that executes things; it is
   deliberately a different phase.)

### Area 2 — Reporting, findings & exit codes (accepted by the user, 2026-07-28)

5. **Two commands, mirroring the ingest/chunk family:** `boardsmith trace-check [--json]` and
   `boardsmith drift-check [--json]`. Both project-root-relative, both strictly **read-only** — they
   write no file and repair nothing. This is the deliberate difference from `chunk-check`
   (repair-then-fail): there is nothing to repair, only findings to report.

6. **Findings exit 0.** Non-zero is reserved for *tool* failure — unparseable project, missing
   `INDEX.md`, not a bs- project, not a git repo. These are advisory sweeps a verify pipeline
   consumes, not gates: 29 existing chunks legitimately have gaps, and a check that fires on correct
   work gets waived (the lexicon rationale in `ingest-archive.ts`, and Phase 171's repeated finding).

   Note the contrast with `ingest-check`/`chunk-check`, which DO exit non-zero — those repair a
   machine-owned region and the non-zero exit forces the re-read that makes the repair stick. Nothing
   here is repaired, so nothing needs forcing.

6b. **`test-unlinked` fires only for a chunk-associated, rule-shaped test that cites nothing.**
   Decided 2026-07-28 alongside the decision-3 amendment; CONTEXT.md originally locked only the
   finding-kind NAME and left the trigger unspecified, which `172-RESEARCH.md` correctly flagged.

   Trigger: the test file **is** listed in ≥1 chunk's Build Manifest (so it is chunk-associated —
   an unassociated file is already covered by `unassociated-test`) **AND** it imports from
   `src/rules/` (so it is a rule test) **AND** it cites neither a claim nor a ruling.

   Measured justification: 8/13 one-two-punch and 6/9 `seven` test files cite zero claims, and they
   are legitimately varied — `a11y.test.ts`, `theme.test.ts`, `asset-reachability.test.ts`,
   `simulation.test.ts`/`random-sim.test.ts` are a11y, structural, and soak tests with no rule claim
   to cite. A bare "cites nothing ⇒ unlinked" rule fires on ~10 correct files per run across the two
   games. Excluding them by *construction* (does it import the rules layer?) rather than by a
   filename blocklist keeps the rule principled and keeps the check from training waiving.

   The second, distinct sense of "every test traces to a **live** claim" is retained and is not
   affected by this trigger: a test citing `claim 40` where the chunk's live list stops at 35 is a
   stale citation and is always a finding.

7. **Finding kinds are an ENUMERATED CODE set, not free text.** F-1 from `170-PROOF-RUN-2.md` showed
   free text displacing a machine-checkable sentinel within one run. Records are
   `{ kind, chunk, subject, detail }` where `kind` ∈:
   `claim-untested`, `ruling-untested`, `test-unlinked`, `unassociated-test`, `ambiguous-claim-ref`,
   `unresolved-claim-ref`, `manifest-file-missing`, `chunk-code-drifted`, `drift-unknown`.
   Human-readable prose goes in `detail`, which nothing parses.

8. **CLI computes, skill formats.** `--json` is the contract; `/bs-check-status` and later
   `/bs-verify-game` format it and never parse prose. This is PROV-03's established split, held.

### Area 3 — Code-drift mechanics (accepted by the user, 2026-07-28)

9. **Diff base is the recorded `## Verified Commit Hash`.** `git diff --name-only <hash> HEAD`
   intersected with that chunk's Build Manifest file list. Works retroactively on all 29 existing
   chunks with no close-time write.

   Rejected: content-hashing each manifest file at close — needs a new close-time write, so it
   reports nothing for any chunk closed before this phase, i.e. every chunk that exists.

10. **A chunk with no recorded hash reports `drift-unknown` — a third state.** Never collapsed into
    "drifted" (which would report every pre-provenance chunk as damaged) nor "clean" (which would
    claim knowledge the tool does not have). Directly parallel to PROV-03's `unknown` decision in
    `171-CONTEXT.md` specifics.

11. **Manifest row parsing extracts EVERY path-shaped token in the first cell** — rows genuinely
    carry several comma-joined paths (`tests/game.test.ts, tests/block.test.ts, tests/punch.test.ts,
    tests/rest.test.ts, tests/a11y.test.ts` is one real row). A row yielding zero paths is itself a
    `manifest-file-missing` finding rather than a silently empty set.

12. **A manifest file absent from disk is drift.** A deleted verified file is the strongest possible
    drift signal, not an absence to skip.

### Claude's Discretion

- Exact regex/parser structure, module boundaries, and file placement within `src/cli/`.
- Report text formatting for the non-`--json` human output.
- Test-file organisation, provided the shared-constant pinning rule below is honoured.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/chunk-provenance.ts` (864 lines, Phase 171) is the closest analog and already
  parses `CHUNK.md` sections, resolves rulebook citations against `INDEX.md`'s Slices table, and
  emits `--json`. Its section-locating helpers are the thing to reuse rather than re-derive —
  note `f73153a3` fixed "locate Verified Against by line, not first substring", a bug this phase's
  parsers can repeat verbatim if they match on substrings.
- `src/cli/commands/ingest-archive.ts` holds the enumerated-code + machine-owned-region pattern and
  the `process.exitCode = 1` idiom (throwing surfaces a stack trace — `program.parse()` does not
  await actions).
- `src/cli/lib/skills-tree-hash.ts`, `src/cli/lib/boardsmith-version.ts` — Phase 171's version
  plumbing; `drift-check` reports alongside these, it does not duplicate them.

### Established Patterns
- Commands register in `src/cli/cli.ts` (`.command('chunk-check <slug>')`,
  `.command('chunk-provenance-status')` at lines ~168–182) and live one-file-per-command in
  `src/cli/commands/` with a colocated `*.test.ts`.
- **Checker/command lexicon duplication is a known trap.** `PRESENTATION_LEXICON` exists in both
  `ingest-archive.ts` and `check.mjs` with a test pinning them equal. Any constant this phase shares
  across the `src/` ↔ `scripts/` boundary — the finding-kind enum especially — must be pinned the
  same way.

### Integration Points
- `/bs-check-status` (`src/cli/slash-command/bs/check-status.md`) already reports verification drift
  as item 8 (commit `0d0ceccd`). CHECK-03/05 findings are the natural next items there — but the
  skill formats `--json`, it does not compute.
- `src/cli/slash-command/bs/templates/CHUNK.template.md` defines the `## Interpretation`,
  `## Build Manifest`, `## Verified Commit Hash` and (Phase 171) `## Verified Against` sections these
  parsers read.
- Phase 173's `/bs-verify-game` will call both commands; design their `--json` as that pipeline's
  input, not only as a human report.

### Cross-repo proof targets
- `~/BoardSmithGames/seven` — **READ-ONLY**, the Phase 170/171 proof target, must stay clean at
  `a03f38d4792af9dfc7c798be69686fc3230f54dd`. 17 chunks, 9 test files, no filename↔chunk
  correspondence — the harder and more revealing target for CHECK-03.
- `~/BoardSmithGames/one-two-punch` — 12 chunks, richer `claim N` citations, has pre-existing
  unrelated dirty state; Phase 171 proved against a COPY and confirmed byte-identical before/after.
  **Use the same copy-based proof discipline here.**
</code_context>

<specifics>
## Specific Ideas

- Success criterion 3 demands a non-no-op run. The scout already establishes this will hold:
  `seven` cites claims sparsely across 17 chunks with 9 unmapped test files, so `trace-check` will
  report real `claim-untested` / `unassociated-test` findings on its first run. The proof should
  record actual counts, not "ran clean".
- Phase 171's PROC-01 record (`171-07-PLAN.md`) is the template for this phase's proof artifact:
  run against COPIES of both reference games, confirm the originals byte-identical before and after.
- The `test-unlinked` open question flagged here was **closed by decision 6b** after measurement.
- "Live claim" in CHECK-03 means a claim that still exists in the current `## Interpretation` list —
  a test citing `claim 40` where the chunk has 35 claims is a real finding (stale citation), distinct
  from a claim with no test.
- Supersession matters for the ruling half: `RULINGS.md` entries are append-only and a superseded
  ruling should not be demanded to have a live test. **`172-RESEARCH.md` measured this: only ~3 of
  62 rulings across both games state supersession in parseable form ("supersedes"/"superseded"), and
  one of those is direction-reversed (`SUPERSEDED BY RULING 9` sits on Ruling 3's own entry).** The
  other cross-reference verbs found in the data — "reconciles", "extends", "UPHOLDS", "resolves
  OQ-N" — are NOT supersession and must not be read as such; treating them as chains would
  manufacture false positives. So: parse only the explicit supersede verbs, handle both directions,
  and treat everything else as a plain cross-reference. Where a chain cannot be parsed, report it
  rather than assume it.
- **Report volume is the real risk, not emptiness.** Both checks produce substantial genuine findings
  on run one; `drift-check` alone shows 10/12 one-two-punch chunks drifted. Human-readable output
  must summarise and group so the signal is not buried — this is the "report text formatting" item
  under Claude's Discretion, and it matters more than it looks.
- **A confirmed real drift finding to use as the proof exhibit:** `one-two-punch`'s `jab` chunk
  manifest lists `src/ui/components/GuardCardView.vue`, which `git log --diff-filter=D` confirms was
  deleted in a later commit and never recreated — decision 12's case, present in live data.

</specifics>

<deferred>
## Deferred / Carried In

Carried in from Phase 171:
- **F-3** (from `170-PROOF-RUN-2.md`) — ownership of `boardsmith.json`'s stub `description`/`playtime`
  after `init` is unstated; two runs made opposite calls. Still not this phase's work; still a todo.
- **Unproven and still unproven:** `/bs-build-chunk` Step 0's `ingest-check` call has never been
  exercised by a live session. This phase adds no new skill-text→command invocation on the build
  path, so it does not deepen that risk — but it does not discharge it either.

Deferred out of this phase:
- Wiring CHECK-03/05 into `/bs-verify-game` — Phase 173 owns the pipeline.
- CHECK-04 (derived-line re-derivation, Phase 177) and CHECK-06 (worked-example replay, Phase 178),
  the other two source-free-capable checks. Phase 179 assembles the source-free MODE from all of them;
  this phase must not invent a mode flag.
- Backfilling or repairing the findings these checks surface on the reference games. The checks
  report; nothing in this phase fixes reference-game content.

Standing policy from 170 (recorded in STATE.md): **the ingest harness may inform, and must never
again gate whether a manual pass is run.** It certified a broken contract twice.
</deferred>
