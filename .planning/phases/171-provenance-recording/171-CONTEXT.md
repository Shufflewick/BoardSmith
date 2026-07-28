# Phase 171: Provenance Recording - Context

**Gathered:** 2026-07-28
**Status:** Ready for planning
**Requirements:** PROV-01, PROV-02, PROV-03

<domain>
## Phase Boundary

The build pipeline and status reporting both know, honestly, what was verified against what.

In scope:
- PROV-01 — `close` records a `## Verified Against` block in CHUNK.md: slice paths and hashes,
  rulebook edition, BoardSmith version, skills version, verification scope.
- PROV-02 — a verification that could not re-read source records `code-conformance-only` scope
  with its reason, never silently reading as a full verification.
- PROV-03 — `/bs-check-status` reports verification drift: which edition and skills version each
  chunk was last verified against, and which chunks are code-conformance-only.
- F-1 from `170-PROOF-RUN-2.md` (see Deferred/Carried below) — belongs here, not later.

Out of scope: `/bs-verify-game` itself (Phase 173), the conformance checks (172, 177), anything
that re-reads the rulebook. This phase records provenance; it does not verify anything.
</domain>

<decisions>
## Implementation Decisions

### The sort: all three requirements are MECHANICAL

Phase 170's central finding (`170-MECHANISMS.md`) requires each requirement to be sorted into
mechanical vs judgment before planning, because skill text conveys judgment reliably and mechanics
not at all — twelve instruction-shaped mechanisms were skipped on live runs.

| Req | Sort | Why |
|---|---|---|
| PROV-01 | Mechanical | Hashing files, reading two version strings, emitting an exact block. One correct output. |
| PROV-02 | Mechanical | Whether source was re-readable is a file-existence + hash comparison, not a judgment. |
| PROV-03 | Mechanical | Reading and aggregating blocks across chunks. |

**Therefore: this phase is CLI work.** Skill text's only job is to invoke a command. Do not spend
a plan rewording instructions — 170 spent twelve mechanisms proving that does not work.

### Decided without asking (each follows from 170's evidence)

1. **Scope is COMPUTED, never declared.** `full` when the archived source exists at the path
   `INDEX.md` records AND its SHA-256 matches `INDEX.md`'s `Source hash:`; otherwise
   `code-conformance-only`. A session asked to declare its own scope is exactly how PROV-02 fails
   silently — and the whole point of PROV-02 is that a partial verification must not be able to
   present as a full one.

2. **The reduced-scope reason is an ENUMERATED CODE, not free text.** Finding F-1 showed a
   free-text edition paraphrase displacing a machine-checkable sentinel within one run. Codes:
   `source-missing`, `source-hash-mismatch`, `index-missing`, `no-rulebook-project`. Any human
   note goes in a separate adjacent field that nothing parses.

3. **The `## Verified Against` block is FENCED MACHINE-OWNED**, matching the
   `<!-- boardsmith:gaps:begin/end -->` pattern from 170. That fence is the only mechanism in this
   pipeline's history with a proven behavioural effect: Run 2's session had a real motive to edit
   the fenced gaps section, recognised it, and declined *because it was marked machine-owned*.
   Use the same shape; do not invent a second convention.

4. **Slice hashes cover the slices the chunk CITES, not every slice.** "Verified against" means
   what it says. Hashing all slices would flag a chunk stale when an unrelated slice changed, and
   a check that fires on correct work gets waived (the lexicon rationale in `ingest-archive.ts`).
   Record `INDEX.md`'s own `Source hash:` alongside as the edition anchor.

5. **F-1 is fixed in this phase.** `--edition` currently lets free text (`none stated in
   rulebook`) displace `EDITION_UNKNOWN` (`not stated in the rulebook`). PROV-01 records the
   edition and PROV-03 groups chunks by it, so the sentinel must be machine-checkable before
   anything reads it. Normalise recognisably-empty edition strings to `EDITION_UNKNOWN`, or refuse
   them and tell the caller to omit the flag.

### Decided by the user (2026-07-28)

6. **Enforcement mirrors `ingest-check`.** `close` runs `boardsmith chunk-check <slug>`, which
   writes or repairs the block and exits non-zero if it had to. Repair-then-fail is the shape that
   just worked: the non-zero exit forces a re-read, the retry passes, and it cannot wedge a
   project. Additionally `/bs-check-status` flags any chunk marked `verified` that has no valid
   block, so a skipped invocation still surfaces rather than passing silently.

   Rejected: a pre-commit hook refusing the commit — contradicts the hook's documented never-fatal
   design (`src/cli/lib/ingest-hook.ts`: a project must not become uncommittable) and would fight
   the build protocol mid-chunk.

7. **Skills version = boardsmith package version + a content hash of the installed bs- skills
   tree.** Version alone is insufficient and this is not hypothetical: Phase 170 ran almost
   entirely on `--local` working-tree installs where the package version never changed while the
   skill text changed on nearly every run. Recording version alone would have stamped fourteen
   materially different contracts as identical.

   Rejected: git SHA — undefined for a designer using an installed npm package with no git repo,
   which is the case this field exists to serve.

### Decided after research (2026-07-28), post-`171-RESEARCH.md`

8. **Cited slices are EXTRACTED from existing CHUNK.md prose, then recorded structurally.**

   Research reported the citation format as "unparseable prose". That is overstated, and it was
   checked directly before deciding: across `one-two-punch`'s 12 chunks, `cites rulebook/<slice>.md`
   appears 74 times with full filenames and **11 of 12 chunks reference a rulebook slice**. What is
   genuinely messy is (a) a shorthand variant — `cites rulebook/02 p.4`, 41 occurrences — which must
   be resolved against `INDEX.md`'s `## Slices` table, and (b) citations to non-slice targets
   (`DESIGN.md`, `RULINGS.md`, `DECISIONS.md`, `SKETCH.md`, source paths, screenshots) which must be
   filtered out. That is a parsing task with a known shape.

   The command therefore: scans CHUNK.md for `rulebook/…` references → resolves shorthand against
   the INDEX Slices table → filters non-slice targets → writes the **resolved set** into the
   machine-owned block. The block then becomes the structured record going forward, so this both
   works retroactively on 29 existing chunks across the two reference games AND removes the need
   for a new skill-text instruction to populate a separate field.

   Rejected: a new `## Cited Slices` section populated by build-chunk — it writes off every existing
   chunk and depends on a new skill-text instruction, the exact mechanism Phase 170 disproved.
   Rejected: hashing every slice — flags a chunk stale on unrelated changes, and a check that fires
   on correct work gets waived.

   **Unresolvable citations are their own outcome.** A chunk whose citations cannot be resolved is
   NOT silently treated as citing nothing — it records the unresolved reference verbatim so the
   failure is visible. Silent under-recording is the PROV-01 analogue of the gap-dropping defect
   Phase 170 spent itself on.

9. **`cli.ts` must read the real version from `package.json`.** `src/cli/cli.ts:27` hardcodes
   `.version('0.0.1')` and `package.json` has never been bumped off `0.0.1` — verified via full
   `git log -p`. So the version half of decision 7 currently carries zero signal and
   `boardsmith --version` lies. Fix the hardcode here (it is a real bug in the field this phase
   records); record version alongside the skills-tree hash; but key PROV-03's drift detection on
   **the content hash**, which is what actually distinguishes two installs.

   Out of scope, explicitly: establishing a release-versioning convention or bumping the version
   to something meaningful. That is a milestone-level decision, not PROV-01's to make.

10. **A fifth scope reason code: `pre-provenance-project`.** Both reference games predate Phase
    170's `INDEX.md` contract — no `rulebook/source/` directory (their `rules.pdf` sits at project
    root) and no `Source hash:` line at all. This is materially different from `source-missing`,
    which means a project that HAD provenance and lost it. Conflating them would report every
    pre-170 project as damaged rather than simply older. Both games also carry non-canonical
    `Edition:` free text, so F-1 (decision 5) is live in real project data.
</decisions>

<code_context>
## Existing Code Insights

- **Where the block goes.** `templates/CHUNK.template.md` already has `## Verified Commit Hash`
  (line ~185) and `## Verified Checklist`. `## Verified Against` is a new sibling section.
- **Where close writes.** `build/close.md` "Bookkeeping Sequence" is a five-item numbered list;
  item 2 already does `git rev-parse HEAD` and writes the hash. The light path
  (`build/playtest.md`) runs this same five-item sequence on the chunk's behalf — **any new
  bookkeeping must work on both paths**, and the sequence is explicitly reused by name rather than
  duplicated.
- **Precedent to copy, not reinvent.** `src/cli/commands/ingest-archive.ts` holds the whole
  pattern: fenced machine-owned region (`GAPS_BEGIN`/`GAPS_END`), a write that refuses when the
  fences are gone, `ingestCheckCommand`'s repair-then-`process.exitCode = 1` (throwing would
  surface a stack trace, since `program.parse()` does not await actions).
- **Checker/command lexicon duplication is a known trap.** `PRESENTATION_LEXICON` exists in both
  `ingest-archive.ts` and `check.mjs` with a test pinning them equal. If this phase adds any
  shared constant across the `src/` and `scripts/` boundary, pin it the same way.
- **`/bs-check-status`** is `src/cli/slash-command/bs/check-status.md` — read-only reporting. PROV-03
  should back it with a CLI command that emits the aggregation, so the skill formats rather than
  computes.
- **Cross-repo reference games** for proving this end-to-end: `~/BoardSmithGames/seven` (READ-ONLY
  — the Phase 170 proof target, must stay clean at `a03f38d4…`) and `~/BoardSmithGames/one-two-punch`.
</code_context>

<specifics>
## Specific Ideas

- One command family, mirroring ingest: `boardsmith chunk-provenance <slug>` (write) and
  `boardsmith chunk-check <slug>` (repair-then-fail). Consider folding write into check, the way
  `ingest-gaps` folded in `ingest-relabel` after a live run skipped the second command — "reducing
  synthesis to a single command removes the thing that gets forgotten."
- PROV-03's aggregation wants `--json` so `/bs-check-status` formats rather than parses prose.
- A chunk verified before this phase existed has no block. That is not drift and must not report as
  code-conformance-only — it is *unknown*, a third state. Do not collapse it into either.
</specifics>

<deferred>
## Deferred / Carried In

From `170-PROOF-RUN-2.md`:
- **F-1 — IN SCOPE HERE** (decision 5 above).
- **F-2** — relabel lexicon misses *negative* visual claims. Deferred to Phase 177 (CHECK-04),
  which classifies on content rather than vocabulary. Not this phase.
- **F-3** — two runs made opposite scope calls on `boardsmith.json`'s stub `description`/`playtime`;
  ownership after `init` is unstated. Not PROV work; file as a todo.

Unproven from 170, do not treat as settled:
- `/bs-build-chunk` Step 0's `ingest-check` call has never been exercised by a live session. This
  phase adds a second skill-text→command invocation (in `close`), which carries the SAME risk. Plan
  a proof for it rather than assuming it runs.

Standing policy from 170 (recorded in STATE.md): **the ingest harness may inform, and must never
again gate whether a manual pass is run.** It certified a broken contract twice.
</deferred>
