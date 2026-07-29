# Phase 174: Verify Classifier - Context

**Gathered:** 2026-07-29
**Status:** Ready for planning
**Requirements:** VERIFY-03 (and closes the classification halves of VERIFY-01 / VERIFY-07 that
Phase 173 deliberately left open)
**Mode:** Smart discuss (autonomous) — all four grey areas presented in batch, all accepted by the
user 2026-07-29 with no overrides.

<domain>
## Phase Boundary

A classifier that distinguishes real rules drift from independent re-wording, well enough that a
second run of `/bs-verify-game` does not flag every chunk as stale.

In scope:
- VERIFY-03 — two independent dimensions per slice pair: **provenance** (`source-changed` /
  `source-unchanged`, from the archived source hash) and **rule delta** (`cosmetic` / `sharper` /
  `contradictory`, from semantic comparison of the pass-1 live slice against the pass-2 staged
  slice).
- Staleness derived from the rule delta ALONE — `sharper`/`contradictory` mark stale regardless of
  whether the source bytes moved; `cosmetic` never marks stale even when they did. `source-changed`
  is reported provenance, never a staleness verdict.
- Pairing live↔staged slices, and reporting the unpaired ones rather than skipping them.
- Real validation against pass-1-vs-pass-2 output from a reference game, not synthetic pairs alone.
- Closing the classification halves of VERIFY-01 ("per-chunk verdict") and VERIFY-07
  ("classification runs in a subagent") that `173-CONTEXT.md` explicitly assigned here.

Out of scope:
- **The consequence of a verdict.** Human adjudication of `contradictory` (VERIFY-04), the staleness
  markers in CHUNK.md/SKETCH.md (VERIFY-05), and repair scoping (VERIFY-06) are all Phase 175. This
  phase produces and records verdicts; it flips no marker and opens no repair loop.
- **Repairing** any stale chunk — Phase 176.
- **Independent re-derivation** of `Derived` lines — Phase 177. This phase *compares* Derived lines
  (they are rule-bearing) but never re-derives one.
- **Worked-example execution** — Phase 178.
- **A source-free mode flag** — Phase 179 assembles that; this phase must not invent one.
- Re-transcription, staging, run allocation, resume — all Phase 173, reused unchanged.
</domain>

<decisions>
## Implementation Decisions

### The sort: VERIFY-03 is a SPLIT requirement — and the split is the design

Phase 170's finding (`170-MECHANISMS.md`) requires each requirement sorted mechanical vs judgment
before planning, because skill text conveys judgment reliably and mechanics not at all. VERIFY-03 is
the first requirement in this milestone that is genuinely BOTH, and the boundary is drawn as:

| Sub-part | Sort | Owner |
|---|---|---|
| Rule delta (semantic comparison) | **Judgment** | Classification subagent contract |
| Provenance dimension (hash compare) | **Mechanical** | CLI |
| Staleness derivation from the delta | **Mechanical** | CLI |
| Slice-pair enumeration | **Mechanical** | CLI |
| Verdict recording / resume | **Mechanical** | CLI (verify-run ledger family) |

Everything mechanical is CLI. Exactly one thing is judgment, and it is isolated in a subagent
contract. Skill text's only jobs are to invoke commands, dispatch the subagent, and format `--json`.

### Area 1 — Classification architecture (accepted 2026-07-29)

1. **The rule-delta label comes from a per-pair classification SUBAGENT** that reads both slices and
   RETURNs a structured `{label, evidence}` only. The orchestrator never opens a slice, staged or
   live. This is the same structural discipline `verify/staging-dispatch.md` already enforces for
   re-transcription, extended to comparison — and it is what closes VERIFY-07's classification half,
   which `173-PROOF.md` §3/§4 could not prove because no classification subagent existed. The same
   observable applies: this skill's transcript must contain zero slice-body-shaped lines (no quoted
   rule line, no `Derived (p.`, no `Visual (p.`).

   Rejected: a CLI text-diff heuristic — wording drift is exactly what a textual diff cannot tell
   apart from a rules change, which is the whole risk this phase exists to retire.
   Rejected: a hybrid where the CLI short-circuits byte-identical pairs to `cosmetic` — two
   independent good-faith transcriptions are essentially never byte-identical, so the fast path would
   almost never fire while adding a second code path that can disagree with the subagent.

2. **The provenance dimension is mechanical CLI** — the source hash recorded in `## Verified Against`
   (PROV-01) compared against the current archived source's hash. It is never the subagent's opinion.
   The subagent has no access to, and no say in, provenance.

2b. **Provenance has a THIRD state, `unknown`, for a first-ever verify pass.** Decided 2026-07-29;
   `174-RESEARCH.md` raised this as an open question after measuring that NEITHER reference game
   currently has a recorded `Source hash:` line — so on the very first verify pass of any
   pre-provenance project there is no prior hash to compare against, and both `source-changed` and
   `source-unchanged` would be claims the tool cannot support.

   `unknown` is never collapsed into either populated state. This is the same call 172 decision 10
   made for `drift-unknown` and PROV-03 made for its `unknown` — reporting a verdict where the tool is
   blind is the failure mode this milestone keeps catching. And per decision 3 it changes nothing about
   staleness: provenance is not an input to the staleness map, so `unknown` provenance with a
   `cosmetic` delta is NOT stale, exactly like `source-changed` with a `cosmetic` delta. It is reported
   to the human as provenance and nothing more. The enum is therefore
   `source-changed` | `source-unchanged` | `unknown`.

3. **Staleness is derived by the CLI, mechanically, from the rule delta ALONE**, through an
   enumerated map: `cosmetic` → not stale, `sharper` → stale, `contradictory` → stale,
   `unclassified` → stale. Provenance is not an input to that map — `source-changed` with a
   `cosmetic` delta is NOT stale, and `source-unchanged` with a `sharper` delta IS stale. The
   subagent never emits a staleness verdict and skill prose never derives one; SC-4 is enforced in
   one place, in code, with a test.

4. **The CLI pairs live↔staged slices** by **PAGE-SPAN OVERLAP**, derived independently from each
   side's own content — `p.N` citation lines on the live side, the ledger's `rangeId` tag on the
   staged side. A slice present on only one side is an enumerated
   `unpaired-slice` finding naming which side it is missing from — never silently skipped. Silent
   under-recording is the defect class Phase 170 spent itself on (and the direct parallel of 172
   decision 2 and PROV-01 decision 8).

   **AMENDED 2026-07-29 after `174-RESEARCH.md` measured the real data — the original form of this
   decision named `INDEX.md`'s Slices table as the live-side key and was made on a false premise.**
   That table exists (with page data) in `seven` but is **entirely absent** in `one-two-punch`, so an
   INDEX-keyed pairing is blind on one of the two reference games. Filenames do not work either: a
   real Phase 173 re-transcription of `seven` produced **6** differently-named and differently-bounded
   staged files against **3** live rule slices, so the two sides do not correspond 1:1 by name or by
   count. Page-span overlap is the only key both sides carry independently.

   A consequence to plan for, not paper over: because the split is m:n, the pair unit is a
   page-overlapping GROUP, and a group where the two sides carry different numbers of files is normal,
   not a finding. Only a page span present on exactly one side is `unpaired-slice`.

   Rejected: letting the subagent infer pairing — pairing is mechanical and a subagent that guesses
   it can silently drop a pair.
   Rejected: filename-glob matching in skill prose — an instruction-shaped mechanism, the exact
   thing 170 disproved.
   Rejected (superseded): `INDEX.md`'s Slices table as the live-side key — absent in `one-two-punch`.

### Area 2 — Command surface & data contract (accepted 2026-07-29)

5. **Extend the `verify-run` family rather than adding a standalone check:**
   `boardsmith verify-classify-status` (which pairs still need classifying — the resume decision) and
   `boardsmith verify-classify-record` (append one verdict). Both `--run-id`-scoped, both writing
   through the SAME append-only, atomic temp-file + `fsync` + `rename()` ledger mechanism 173-08
   hardened after `173-REVIEW.md` CR-01. Classification inherits crash-safety and resumability rather
   than re-earning them, and one run has one ledger.

   Rejected: a standalone `classify-check` outside the run — it would need its own resume story and
   its own durability story, both already solved run-scoped.

6. **Verdict records are enumerated codes, pinned by a test** (172 decision 7; F-1 in
   `170-PROOF-RUN-2.md` showed free text displacing a machine-checkable sentinel within one run).
   Record shape: `{ pairId, unit, liveSlice, stagedSlice, provenance, ruleDelta, stale, evidence }`
   where `provenance` ∈ `source-changed` | `source-unchanged`, `ruleDelta` ∈ `cosmetic` | `sharper` |
   `contradictory` | `unclassified`, and `stale` is derived (decision 3), never supplied. Prose is
   confined to `evidence`, which nothing parses.

7. **Findings exit 0.** Non-zero is reserved for tool failure — unparseable project, missing run,
   missing archive, not a bs- project. Held from 172 decision 6: these are advisory inputs a pipeline
   consumes, and a check that fires on correct work gets waived.

8. **A pair the subagent cannot classify records enumerated `unclassified`, which is treated as
   stale and surfaced to the human.** A malformed or refused subagent return is never silently
   `cosmetic`. Fail loud and conservative: the worst outcome for this milestone is a verify pass that
   reports clean where it was blind.

### Area 3 — The label lexicon (accepted 2026-07-29)

9. **The subagent contract states an explicit decision procedure plus worked examples**, not bare
   definitions. `sharper` and `contradictory` REQUIRE both readings quoted verbatim in `evidence` —
   this is the raw material VERIFY-04's side-by-side human adjudication needs in Phase 175, so it is
   captured here at the moment of judgment rather than reconstructed later.

10. **The `cosmetic` vs `sharper` boundary is equivalence of CONSEQUENCE, not similarity of
    WORDING.** A pair is `cosmetic` only if the two readings produce identical outcomes in every game
    situation; otherwise `sharper` (pass 2 constrains something pass 1 left vague or absent, and the
    two are compatible) or `contradictory` (the two cannot both be true). This is the principled test
    that serves SC-2 and SC-3 simultaneously, rather than trading one against the other with a thumb
    on the scale.

    Rejected: biasing toward `cosmetic` to protect SC-2 — that is how a genuine edition change gets
    missed.
    Rejected: biasing toward `sharper` to protect SC-3 — that is the flag-everything failure this
    phase exists to prevent.

11. **Comparison is rule-bearing line by line, with line-level evidence retained and the pair
    verdict rolled up as MAX severity** (`contradictory` > `sharper` > `cosmetic`). Phase 175's
    impact map needs the line detail to scope repair to what actually changed; a single holistic
    whole-file verdict throws that away and makes VERIFY-06's "only chunks whose code changed"
    scoping impossible to do honestly.

12. **`Derived` lines are rule-bearing and ARE compared. `Visual` lines are excluded from the rule
    delta entirely.** This is precisely what Phase 170's `Derived`/`Visual` split bought — the
    presentation notes that would otherwise dominate a textual comparison are structurally out of the
    way. Independent re-derivation of `Derived` lines remains Phase 177's separate check; this phase
    only compares them.

12b. **The exclusion filter must recognise the PRE-170 form of a presentation note, not just
    `Visual (p.N):`.** Measured in `174-RESEARCH.md`: **zero** `Visual (p.` lines exist in either
    reference game's live slices — both games' live slices predate the Phase 170 split entirely, and
    every diagram/art observation there is written as `Derived (p.N) — diagram description:` or
    `Derived (p.N) — art:` (5 of 12 `Derived` lines in `one-two-punch`). A pass-2 re-transcription run
    under the CURRENT contract DOES emit real `Visual (p.N):` lines (observed live in
    `173-PROOF.md` — `seven`'s staged `01-round.md` carries `Visual (p.1): The heading "Round"…`).

    So the two sides of every real pair are on DIFFERENT SCHEMAS, and a filter that only knows the new
    prefix would read the old side's diagram notes as rule-bearing content, count purely
    presentational differences as consequence differences, and manufacture `sharper` verdicts from
    schema drift alone. That failure lands directly on SC-2's 90%-`cosmetic` bar — it would look like
    classifier over-flagging when it is really a filter bug.

    Therefore: presentation-note detection excludes BOTH `Visual (p.N):` AND the legacy
    `Derived (p.N) — diagram description:` / `— art:` forms. **This exclusion set is a test-pinned
    enumerated constant**, measured against the real slices, not a regex invented from the template.
    A `Derived` line NOT carrying a presentation marker stays rule-bearing and is compared.

### Area 4 — Validation (accepted 2026-07-29)

13. **Proof target: `cp -R` copies of the reference games — but the pass-1-vs-pass-2 material does
    NOT exist yet and PRODUCING IT IS IN SCOPE FOR THIS PHASE.**

    **AMENDED 2026-07-29 — the original form of this decision rested on a false premise.**
    `174-RESEARCH.md` checked the real repos directly: neither `one-two-punch` nor `seven` has a
    `rulebook/.verify/` staging directory, an archived `rulebook/source/`, or a `Source hash:` line.
    Every artifact Phase 173's proof produced lived in `/tmp` scratch copies that have since been
    cleaned up. There is no free real data anywhere on disk.

    Consequences, both load-bearing for planning:

    - **The FIRST wave's only job is producing real pass-1-vs-pass-2 material** — adopt the source and
      re-run the Phase 173 re-transcription pipeline against a fresh `cp -R` copy, reusing that
      mechanism exactly rather than reimplementing it. No classifier logic is built until real pairs
      exist. This also front-loads the phase's highest-risk unknown, which is what SC-2's bar is for.
    - **Anchor game: a copy of `seven`.** It carries the `INDEX.md` page data the page-overlap pairing
      (decision 4) needs on the live side, and Phase 173 already measured a real re-transcription of
      it (6 staged files vs. 3 live rule slices), so the m:n grouping case is present rather than
      hypothetical. A copy of `one-two-punch` is the SECOND target, and it is not optional-if-cheap:
      it is the game carrying the legacy `Derived — diagram description:` presentation form
      (decision 12b) and the game with NO `INDEX.md` Slices table, so it is the only place decision 4's
      and 12b's amended forms actually get exercised.

    `seven` stays READ-ONLY at `a03f38d4792af9dfc7c798be69686fc3230f54dd`; all work is on copies, with
    the 171/172/173 discipline of confirming the originals byte-identical before and after.

14. **SC-2's bar is pre-declared and numeric, recorded in `174-PROOF.md`: ≥90% of paired slices
    classify `cosmetic`, with zero `contradictory`.** Missing the bar is a phase BLOCKER, not a note
    — the whole milestone rests on a second run not flagging everything. Declare the bar before
    measuring, then record actual counts, never "ran clean".

15. **SC-3 mutates the REAL archived source and runs a real re-transcription dispatch.** Hand-editing
    a staged slice tests only the comparator; the requirement is that the *pipeline* catches a
    genuine rules change. Hand-built pairs are still written, but as lexicon REGRESSION tests
    alongside the real proof — "not synthetic examples alone" (SC-5) means the real run is the
    primary evidence.

16. **Determinism is measured, not assumed:** classify the same pair set twice and require identical
    verdicts, recording the comparison. A classifier whose verdicts move between runs cannot support
    a staleness marker anything downstream trusts.

17. **The SC-2 bar is measured on RULE-BEARING content only** — a corollary of 12b, stated explicitly
    because it is the difference between a meaningful bar and a meaningless one. Presentation notes
    excluded per 12b never contribute to a delta, so they can neither inflate nor deflate the
    `cosmetic` percentage. If the bar is missed, the first thing to check is whether the exclusion
    filter is complete, before concluding the classifier over-flags.

### Claude's Discretion

- Module boundaries and file placement within `src/cli/commands/` and `src/cli/slash-command/bs/`.
- Whether the classification ledger records live in the existing `RUN.md` ledger fence as a third
  record `kind` or in a sibling file — provided the atomic write path is the SAME one (research found
  `atomicWriteFile`, `appendLedgerLine`, `locateFences`, `parseLedgerBody`, `resolveLedgerState`,
  `ledgerFilePath`, `readLedgerOrThrow` are module-private in `verify-run.ts` today, so genuine reuse
  means EXPORTING them, never copying them).
- Exact ledger line format for classification records, provided it reuses the existing append-only
  atomic-write mechanism and its enumerated codes are test-pinned.
- Human-readable (non-`--json`) report formatting and grouping. Note 172's finding that report
  VOLUME, not emptiness, is the real risk.
- Pair-id derivation scheme, provided it is stable across runs (decision 16 depends on it).
- Test-file organisation, honouring the shared-constant pinning rule.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/commands/verify-run.ts` (959 lines, Phase 173) is the direct host/analog. It already
  exports the pieces this phase extends: `RUN_ID_RE`, `RANGE_ID_RE`, the `RUN_LEDGER_BEGIN/END` and
  `RUN_MANIFEST_BEGIN/END` sentinels, `LedgerRecord` / `RangeMarkerRecord`, `stagingSlicesDir()`, and
  the `verifyRunInit/Record/StatusCommand` trio with their `*Result` interfaces. **The atomic
  temp-file + `fsync` + `rename()` ledger write (173-08, after `173-REVIEW.md` CR-01 showed
  `fs.writeFile`'s default flag truncates the whole file) must be REUSED, not re-implemented** — a
  second write path is a second chance to lose recorded work.
- `src/cli/commands/chunk-provenance.ts` (Phase 171) parses `## Verified Against` and holds the
  source-hash plumbing decision 2 needs. Note `f73153a3`: locate sections BY LINE, not by first
  substring match — a bug re-derived parsers repeat verbatim.
- `src/cli/commands/trace-check.ts` / `drift-check.ts` (Phase 172) are the enumerated-finding-kind +
  read-only + exit-0 pattern to mirror for the reporting surface.
- `src/cli/slash-command/bs/ingest/transcription-subagent.md` is the contract shape for decision 1's
  new classification subagent contract — including the `BS-DISPATCH-V2`-style token discipline that
  proves the dispatcher copied the pointer block rather than composing one from memory.

### Established Patterns
- Commands register in `src/cli/cli.ts` (`verify-run-init` ~210, `verify-run-record` ~240,
  `verify-run-status` ~259, `trace-check` ~193, `drift-check` ~200), one file per command in
  `src/cli/commands/` with a colocated `*.test.ts`.
- `process.exitCode = 1` rather than throwing — `program.parse()` does not await actions, so a throw
  surfaces a stack trace.
- Enumerated constants shared across the `src/` ↔ `scripts/` boundary must be pinned equal by a test
  (the `PRESENTATION_LEXICON` precedent).

### Integration Points
- `src/cli/slash-command/bs/verify-game.md` is a lean router; its Step 3 currently states in several
  places that the pass performs NO comparison and NO classification. **Those statements are Phase
  173's true boundary and this phase must rewrite them, not append around them** — leaving
  "there is no classification" prose in place beside a new classification step is exactly the kind of
  self-contradicting skill text that gets one half ignored on a live run.
- A new `verify/classification-dispatch.md` delegate alongside `verify/source-resolution.md` and
  `verify/staging-dispatch.md` is the natural home for the heavyweight prose; the installer
  (`src/cli/commands/install-claude-command.ts`) must carry it under the `bs-shared/verify/` root.
- Phase 175 consumes this phase's `--json` verdicts as its impact-map input. Design the record for
  that consumer, not only for a human report.
- `/bs-check-status` already reports verification drift; classification verdicts are a natural
  addition there, formatted from `--json`, never computed.

### Cross-repo proof targets
- `~/BoardSmithGames/one-two-punch` — 12 chunks, has pre-existing unrelated dirty state, 173's
  staging proof target. Work against a `cp -R` copy.
- `~/BoardSmithGames/seven` — READ-ONLY, pinned at `a03f38d4792af9dfc7c798be69686fc3230f54dd`.
</code_context>

<specifics>
## Specific Ideas

- This phase is where VERIFY-01 and VERIFY-07 finally close. Both were left deliberately OPEN by
  Phase 173 with the reason recorded in `REQUIREMENTS.md` ("Marking this complete now would be the
  third premature completion mark this phase has had to catch"). Closing them requires the same
  standard 173 held itself to: a real run, real evidence, and the transcript observable checked
  rather than asserted.
- The transcript observable for VERIFY-07's classification half is the same one 173 used for
  re-transcription: **zero slice-body-shaped lines** across the orchestrator transcript, the raw
  dispatch prompt, and the raw subagent return. Grep for it against the real run; do not assert it.
- SC-2 is the risk that sinks the milestone if it fails, so it is measured first, not last: get real
  pass-1-vs-pass-2 pairs classified and count them before building anything downstream of the
  verdict.
- The classifier is the one place in this milestone where an LLM judgment is load-bearing for a
  machine-consumed verdict. That is why decisions 3, 6, and 8 all push in the same direction: the
  subagent supplies exactly one enumerated label plus evidence, and every consequence of that label
  is computed in code.
- 172's warning applies directly: report volume, not emptiness, is the risk. A 12-chunk game with
  9+ staged slices per pass produces a lot of pairs; group and summarise.

</specifics>

<deferred>
## Deferred / Carried In

Carried in and still open:
- **F-3** (`170-PROOF-RUN-2.md`) — ownership of `boardsmith.json`'s stub `description`/`playtime`
  after `init`. Not this phase's work.
- `/bs-build-chunk` Step 0's `ingest-check` call has still never been exercised by a live session.
  This phase adds no build-path invocation, so it neither deepens nor discharges that risk.

Deferred out of this phase:
- Human adjudication of `contradictory` and the `RULINGS.md` write (VERIFY-04) — Phase 175.
- Staleness markers in CHUNK.md/SKETCH.md and repair scoping (VERIFY-05, VERIFY-06) — Phase 175.
- Stale-chunk repair through the audit lenses (CHECK-02) — Phase 176.
- Independent `Derived`-line re-derivation (CHECK-04) — Phase 177.
- Worked-example replay (CHECK-06) — Phase 178.
- Source-free MODE assembly (VERIFY-09) — Phase 179. No mode flag here.
- Repairing findings this classifier surfaces on the reference games.
- **Surfacing classification verdicts in `/bs-check-status`** — raised as an Integration Points note
  above, deliberately NOT planned into this phase (decided 2026-07-29 at the planning gate). It was
  never a locked decision, and `check-status` is not run-scoped: surfacing verdicts in project status
  needs a cross-run verdict source this phase's boundary excludes, and the marker/reporting surface is
  exactly what VERIFY-05 owns in Phase 175. Revisit there, not here.

Standing policy from 170 (recorded in STATE.md): **the ingest harness may inform, and must never
again gate whether a manual pass is run.**
</deferred>
