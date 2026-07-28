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

3. **A test file listed in MULTIPLE chunks' manifests makes its bare refs ambiguous.** Real case:
   `game.test.ts` and `a11y.test.ts` appear in several one-two-punch manifests. An ambiguous bare
   `claim N` is reported as `ambiguous-claim-ref` naming the candidate chunks and counts as coverage
   for **none** of them. Only an explicitly qualified reference resolves.

   Rejected: attributing to all candidates — inflates coverage, so the check reports clean where it
   is blind. A check that reports clean on unknown data is worse than no check.
   Rejected: attributing to the most recent chunk — a guess wearing a result's clothing.

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
- The `test-unlinked` direction ("every test traces to a live claim") is the one most likely to be
  noisy — helper files, a11y tests, and simulation soaks legitimately cite no claim. Consider whether
  a test file with **zero** claim references is `test-unlinked` or simply out of the check's subject
  set; decide it explicitly rather than letting the regex decide by accident.
- "Live claim" in CHECK-03 means a claim that still exists in the current `## Interpretation` list —
  a test citing `claim 40` where the chunk has 35 claims is a real finding (stale citation), distinct
  from a claim with no test.
- Supersession matters for the ruling half: `RULINGS.md` entries are append-only and a superseded
  ruling should not be demanded to have a live test. The supersession chain is stated in prose
  ("supersedes Ruling N") — parse it, and where it cannot be parsed, report rather than assume.

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
