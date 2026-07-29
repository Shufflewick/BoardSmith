# Phase 174: Verify Classifier - Research

**Researched:** 2026-07-29
**Domain:** Two-dimensional drift classification (LLM judgment + mechanical CLI) extending the
Phase 173 verify-run ledger; Claude-Code skill/subagent contract design; real-data validation
**Confidence:** MEDIUM-HIGH (mechanical CLI extension is HIGH confidence, directly measured against
real code and real reference-game data; the subagent-contract/lexicon judgment half is
MEDIUM — grounded in the repo's own precedent, not an external library)

## Summary

VERIFY-03 splits cleanly, and CONTEXT.md has already drawn the split correctly: everything except
the rule-delta label itself is mechanical CLI work extending `verify-run.ts`'s ledger family, and
the rule-delta label is exactly one isolated subagent judgment. The mechanical half is
straightforward to plan because `verify-run.ts` (959 lines) already establishes every pattern this
phase needs — atomic ledger writes, enumerated record kinds, range/manifest bookkeeping — but two
things must be corrected relative to CONTEXT.md's framing before planning proceeds:

1. **There is currently ZERO real pass-1-vs-pass-2 material anywhere on disk.** Neither
   `~/BoardSmithGames/one-two-punch` nor `~/BoardSmithGames/seven` has a `rulebook/.verify/`
   directory, an archived `rulebook/source/`, or a `Source hash:` line in `INDEX.md` — every
   scratch-copy proof artifact Phase 173 produced lived under `/tmp` and has since been cleaned up.
   Confirmed by direct `find`/`git status` against the real repos in this research session. Success
   Criteria 2 and 5 (validate against real pass-1-vs-pass-2 output) are **not free** — Phase 174
   must itself re-run the Phase 173 adoption-and-transcription pipeline (against fresh `cp -R`
   copies, per established discipline) to produce the pairs it then classifies. This is the
   single biggest planning-relevant fact this research surfaced; report it to the planner as a
   first-wave dependency, not an assumption.

2. **Both reference games' live slices predate the Phase 170 `Visual`/`Derived` split entirely.**
   `grep -rn '^Visual (p\.'` across both games' `rulebook/*.md` returns zero matches. Every
   diagram/art observation in the live slices is instead marked `Derived (p.N) — diagram
   description:` or `— art:` (5 of 12 Derived lines in one-two-punch, 0 of 10 in seven — measured
   directly). A pass-2 re-transcription run under the CURRENT `transcription-subagent.md` contract
   WILL emit real `Visual (p.N):` lines (Phase 173's live proof directly observed this: `seven`'s
   real staged `01-round.md` contains `Visual (p.1): The heading "Round"...`). This asymmetry —
   old-schema slices with no `Visual` prefix at all vs. new-schema slices that do have one — is a
   real classifier input, not an edge case: without handling it, the exclusion filter in decision 12
   ("Visual lines are excluded... Derived lines are compared") will silently treat the old side's
   diagram notes as rule-bearing `Derived` content, over-count consequence differences that are
   purely presentational, and directly threaten SC-2's 90% `cosmetic` bar.

**Primary recommendation:** Plan a first wave whose sole job is producing real pass-1-vs-pass-2
material (adopt + re-transcribe one reference game, exactly reusing Phase 173's proof mechanism),
before any classifier logic is built — this both retires the phase's highest-risk unknown first (as
SC-2's bar is meant to) and gives every subsequent wave real fixtures instead of synthetic ones.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Slice-pair enumeration (live↔staged) | CLI (backend/tooling) | — | Pure path/content computation; no judgment; CONTEXT.md decision 4 |
| Provenance dimension (hash compare) | CLI | — | `computeVerificationScope()`-style disk read + sha256; CONTEXT.md decision 2 |
| Rule-delta classification | Claude Code subagent (judgment tier) | — | The one genuinely judgment-shaped piece; isolated per CONTEXT.md decision 1 |
| Staleness derivation | CLI | — | Enumerated map, zero judgment (CONTEXT.md decision 3) |
| Verdict recording / resume | CLI (ledger) | — | Extends `verify-run.ts`'s atomic ledger — same tier as Phase 173 |
| Skill-text orchestration (dispatch, formatting) | Claude Code skill/orchestrator | CLI (`--json`) | Invokes commands + subagent, never computes a verdict itself |
| Human-readable report grouping | Skill text / CLI `--json` consumer | — | Discretion item; volume-management concern per 172's finding |

This map has no "Browser/Frontend/API" tiers because this phase, like 171-173, is entirely
CLI+skill-text; the only "judgment tier" boundary that matters here is orchestrator vs. subagent,
which is why it is called out explicitly as its own row.

## Standard Stack

This phase adds no new third-party dependency. It is Node/TypeScript CLI code extending
`src/cli/commands/verify-run.ts` plus Claude Code skill-text (`.md` contracts), following exactly
the pattern of Phases 171-173.

### Core (existing, reused)
| Asset | Location | Purpose | Why reused, not rebuilt |
|---|---|---|---|
| `RUN_ID_RE`, `RANGE_ID_RE` | `verify-run.ts:83,91` | Run/range id validation | Already exported; classification records are scoped to the same `--run-id` |
| `RUN_LEDGER_BEGIN/END`, `RUN_MANIFEST_BEGIN/END` | `verify-run.ts:97-105` | Machine-owned fence sentinels | Exported; a third record `kind` can live in the SAME ledger fence pair (see Architecture Patterns) |
| `LedgerRecord`, `RangeMarkerRecord` | `verify-run.ts:108-130` | Existing ledger record shapes | Exported; classification needs a THIRD shape, a sibling not a replacement |
| `stagingSlicesDir()` | `verify-run.ts:176` | Staging path computation | Exported; classification reads staged slices from here, never elsewhere |
| `computeVerificationScope()`, `resolveCitedSlices()` | `chunk-provenance.ts:95,165` | Current archive hash + citation resolution | Exported; provenance dimension's "current hash" side |
| `parseVerifiedAgainst()` | `chunk-provenance.ts:572` | Reads a chunk's previously-recorded `sourceHash` | Exported; provenance dimension's "prior hash" side |
| `FINDING_KINDS`, `Finding`, `FindingKind` | `build-manifest.ts` (imported by `trace-check.ts:19-27`) | Enumerated finding-kind pattern | Mirror this shape for classification's own enum, do not invent a second convention |

### Package Legitimacy Audit

Not applicable — this phase installs no new npm/PyPI/cargo package. All work is internal
TypeScript + Markdown contract files inside the existing repo.

## Architecture Patterns

### System Architecture Diagram

```
 /bs-verify-game (orchestrator, skill text)
        |
        | Step 2 (existing, Phase 173): verify-run-init/-status/-record
        |    -> stages pass-2 slices under rulebook/.verify/<runId>/slices/
        v
 [NEW] Step 4: Classification
        |
        | 4a. CLI: enumerate-pairs
        |     reads: recorded[] (staged units + their rangeId)      <- verify-run-status --json
        |            rulebook/*.md (live slices)                     <- filesystem
        |     computes: live<->staged pairing by PAGE overlap, not filename
        |     outputs: { pairId, liveSlice, stagedSlice, ... } | { kind:'unpaired-slice', side }
        v
 for each pair:
        |
        | 4b. CLI: provenance-check(pair)                            <- computeVerificationScope()
        |                                                                + parseVerifiedAgainst()
        |     outputs: 'source-changed' | 'source-unchanged'
        |
        | 4c. Task-tool dispatch: classification subagent
        |     reads: BOTH slice files directly (orchestrator never opens either)
        |     returns: { pairId, label, evidence, quotedPass1, quotedPass2 }
        |
        v
        | 4d. CLI: verify-classify-record --pair-id --provenance --rule-delta --evidence
        |     validates label against enum; non-enum/missing -> 'unclassified' (never thrown)
        |     derives: stale = map[ruleDelta]   (cosmetic->false, sharper/contradictory/unclassified->true)
        |     appends: one JSON line to the SAME RUN.md ledger (new record kind)
        v
 verify-classify-status --run-id --json
        |
        | reports which pairs still need classifying (resume) + summary counts
        v
 Step 3 (Close, existing) formats --json into human report
        |
        v
 Phase 175 consumes --json as its impact-map input (not built here)
```

### Recommended Project Structure

```
src/cli/commands/
├── verify-run.ts                 # UNCHANGED structurally; export any additional ledger
│                                  #   helpers classification needs (see Pitfall 1)
├── verify-classify.ts             # NEW — enumerate-pairs, provenance-check, record, status
├── verify-classify.test.ts        # NEW — colocated, mirrors verify-run.test.ts patterns
└── chunk-provenance.ts            # UNCHANGED; classification imports computeVerificationScope,
                                    #   parseVerifiedAgainst, resolveCitedSlices from here

src/cli/slash-command/bs/
├── verify-game.md                 # EDITED — rewrite the "no classification" statements (see
│                                  #   Common Pitfalls #2), add Step 4
└── verify/
    ├── source-resolution.md       # unchanged
    ├── staging-dispatch.md        # unchanged
    └── classification-dispatch.md # NEW — mirrors staging-dispatch.md's shape, the delegate for
                                   #   pairing + per-pair subagent dispatch + recording
```

### Pattern 1: Extending the ledger with a third record `kind`, not a second ledger

`verify-run.ts`'s `parseLedgerBody()` already discriminates on `rec.kind` (`'range-complete'` /
`'range-reset'` / undefined-or-`'unit'`). The natural, minimal-diff extension is a fourth
discriminant value, e.g. `kind: 'classification'`, added to the SAME union inside the SAME
`RUN.md` ledger (same fence pair, same `runId`, same atomic-write mechanism) — one run, one
ledger, exactly as CONTEXT.md decision 5 states. Concretely:

```typescript
// Source: pattern extrapolated from verify-run.ts:107-130 (existing LedgerRecord/RangeMarkerRecord)
export interface ClassificationRecord {
  kind: 'classification';
  pairId: string;
  unit: string;           // the staged unit id this pair's staged side came from
  liveSlice: string;      // path relative to rulebook/, or '' if unpaired-from-live
  stagedSlice: string;    // path relative to staging dir, or '' if unpaired-from-staged
  provenance: 'source-changed' | 'source-unchanged';
  ruleDelta: 'cosmetic' | 'sharper' | 'contradictory' | 'unclassified';
  stale: boolean;         // DERIVED, never supplied by the caller (CONTEXT.md decision 3/6)
  evidence: string;       // free prose; nothing parses this
  recordedAt: string;
}
```

**Reuse blocker to resolve during planning, not glossed over:** `atomicWriteFile`,
`appendLedgerLine`, `locateFences`, `parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`, and
`readLedgerOrThrow` are all **module-private** in `verify-run.ts` (no `export` keyword) — only
`RUN_ID_RE`, `RANGE_ID_RE`, the fence constants, `LedgerRecord`/`RangeMarkerRecord`, and
`stagingSlicesDir` are exported today. "Reuse the atomic ledger write" therefore requires ONE of:
(a) export these seven helpers from `verify-run.ts` so a sibling `verify-classify.ts` can call
them, extending `parseLedgerBody`'s discriminated union to include `ClassificationRecord` in the
same file that already owns the union; or (b) implement the new `verifyClassify*Command` functions
inside `verify-run.ts` itself, growing that file past 959 lines. (a) keeps file sizes bounded and
matches the one-file-per-command convention `171-VALIDATION.md`/`172-VALIDATION.md` established,
but requires `parseLedgerBody`'s `ParsedLine` union to be exported and widened — flag this as a
concrete task-boundary decision for the planner, not a settled fact.

### Pattern 2: Pairing by page overlap, NOT by filename or by `INDEX.md`'s Slices table

Measured directly against both real reference games:

- `seven`'s live `rulebook/` holds `00-visual-survey.md`, `01-definitions-and-components.md`,
  `01-overview-setup-and-play.md`, `02-solo-variant.md`. Its `INDEX.md` DOES carry a `## Slices`
  table with a `pages` column (`p.1-2`, `p.1`, `p.1`, `p.2`).
- `one-two-punch`'s live `rulebook/` holds `00-visual-survey.md`,
  `01-setup-and-round-structure.md`, `02-action-cards-and-resolution.md`. Its `INDEX.md` has **no**
  `## Slices` table at all — only a `Term → Slice` cross-reference with no page-range column.
- Phase 173's real live re-transcription of `seven`'s 2-page rulebook (one single dispatch, page
  range `1-2`) produced SIX staged files with DIFFERENT names and DIFFERENT section boundaries than
  the three live rule slices: `01-about-and-setup.md`, `01-definitions.md`,
  `01-distribution-of-cards.md`, `01-game-end-and-match.md`, `01-round.md`, `02-solo-variant.md`.

**Conclusion, directly measured, not assumed:** the `INDEX.md` Slices table is NOT a reliable
pairing key — it exists with page data in one reference game and is entirely absent in the other.
Filename matching is explicitly rejected by CONTEXT.md decision 4 and is empirically hopeless (0 of
6 staged names in the `seven` proof match any of the 3 live names). The one thing both sides
reliably carry is **page numbers**: every live slice's own `QUOTE` lines start with a `p.N,
Section:` citation prefix (verified: `p.1, Title block:`, `p.1, Contents:`, etc.), so a CLI parser
can derive a live slice's page-span directly from its own content by scanning for `^p\.(\d+),`
matches — no dependence on `INDEX.md` having (or not having) a Slices table. On the staged side,
every unit's ledger record already carries a `rangeId` (e.g. `"1-1"`) tying it to a manifest page
range. **Recommended pairing key: live-slice-page-span ∩ staged-unit-range, both derived
independently from primary content/ledger data, never from `INDEX.md`'s optional table.** A live
slice or staged unit whose page-span has no overlapping counterpart is the `unpaired-slice` finding
(CONTEXT.md decision 4).

### Pattern 3: Structured-return subagent contract, mirroring `transcription-subagent.md`

The classification subagent contract should follow the SAME shape as the existing, proven
`ingest/transcription-subagent.md`:

```
# Source: pattern from transcription-subagent.md:1-49, 185-186 (BS-DISPATCH-V2 handshake + structured return)
1. Validate a BS-DISPATCH-V2-style token in the dispatch prompt before doing anything (reject
   unread if missing — the same "you composed a prompt from memory instead of copying the pointer
   block" defense this contract exists to catch).
2. Read BOTH assigned slice files directly (pass-1 live path, pass-2 staged path) — this subagent
   is the ONE place in the whole pipeline permitted to open a slice; the orchestrator never does.
3. Apply the decision procedure (CONTEXT.md decisions 10-12): consequence-equivalence test,
   line-by-line rule-bearing comparison (excluding Visual-shaped lines on EITHER schema — see
   Pitfall 2), MAX-severity rollup.
4. RETURN exactly one structured object: { pairId, label, evidence, quotedPass1, quotedPass2 }.
   `sharper`/`contradictory` REQUIRE quotedPass1/quotedPass2 populated (CONTEXT.md decision 9).
   Never return prose outside this shape; never return the full slice bodies.
```

**Malformed-return detection, concretely:** since the CLI record command (`verify-classify-record
--label <value>`) is the only place a label becomes durable, it is the natural validation gate —
mirroring `assertValidRunId`/`assertValidRangeId`'s pattern in `verify-run.ts`, but INVERTED in
failure mode: those two throw on invalid input (a caller bug), while `--label` here must NEVER
throw on an out-of-enum value — CONTEXT.md decision 8 requires silent normalization to
`unclassified` (a subagent-fidelity failure, not a caller bug), with a stderr warning naming what
was received, exactly like `verify-run-status`'s existing tamper-warning pattern
(`verify-run.ts:910-916`).

### Anti-Patterns to Avoid

- **A CLI text-diff heuristic for the rule-delta label** — explicitly rejected in CONTEXT.md
  decision 1; wording drift is exactly what a textual diff cannot distinguish from a rules change.
- **Byte-identity short-circuit to `cosmetic`** — explicitly rejected (decision 1); two independent
  good-faith transcriptions are essentially never byte-identical, so this path would almost never
  fire while adding a second disagreement-capable code path.
- **Filename-glob pairing** — explicitly rejected (decision 4) and empirically hopeless (Pattern 2
  above).
- **Deriving staleness from BOTH dimensions** — `source-changed` + `cosmetic` must NOT be stale;
  the map (decision 3) is a single-input function of `ruleDelta` alone. A plan that threads
  `provenance` into the staleness computation at all (even as a secondary signal) violates SC-4.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ledger crash-safety | A second atomic-write helper | `atomicWriteFile` (export from `verify-run.ts`) | 173-08 hardened this against a real CR-01 defect; a second implementation is a second chance to lose recorded work |
| Machine-owned fence parsing | A new fence-locate function | `locateFences`/`parseLedgerBody`-style helpers (exported) | Same reasoning; also keeps one fence-parsing convention across the whole `RUN.md` file |
| Current archive hash | Re-implementing sha256-of-archive | `computeVerificationScope()` (`chunk-provenance.ts:95`) | Already handles the 5 precedence-ordered scope reasons; re-deriving risks disagreeing with the source-resolution step that already ran in Step 1 |
| Prior recorded hash | Re-parsing `## Verified Against` by hand | `parseVerifiedAgainst()` (`chunk-provenance.ts:572`) | Line-anchored parsing (not substring) — `f73153a3` is the exact bug class a hand-rolled second parser would repeat |
| Enumerated finding-kind pattern | A free-text or ad hoc status string | `FINDING_KINDS`-style const array + type, pinned by a test | F-1 (`170-PROOF-RUN-2.md`) — free text displaced a machine-checkable sentinel within one run |

**Key insight:** every mechanical piece of this phase already has a proven exemplar in `verify-run.ts`,
`chunk-provenance.ts`, or `trace-check.ts`/`drift-check.ts` from the immediately preceding three
phases. The discipline this research recommends is citing and extending those exemplars line-for-line,
not designing a fresh mechanism for a problem this milestone has already solved three times.

## Common Pitfalls

### Pitfall 1: Trusting CONTEXT.md's "reuse the atomic write" framing as already-exported
**What goes wrong:** A plan assumes `atomicWriteFile`/`appendLedgerLine`/`parseLedgerBody` are
importable from `verify-run.ts` today, discovers mid-implementation that they are module-private,
and either forks a duplicate atomic-write implementation (the exact anti-pattern CONTEXT.md warns
against) or has to redo the plan's task boundaries.
**Why it happens:** CONTEXT.md's code_context section lists these as "exported pieces" alongside
genuinely-exported items (`RUN_ID_RE`, `LedgerRecord`, `stagingSlicesDir`) without distinguishing
which ones actually carry the `export` keyword today.
**How to avoid:** Plan an explicit Task 0/Wave 1 step: export the needed helpers from
`verify-run.ts` (verified list above: `atomicWriteFile`, `appendLedgerLine`, `locateFences`,
`parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`, `readLedgerOrThrow`), widen
`ParsedLine`/the internal union to include `ClassificationRecord`, and write a pinning test that a
new `verify-classify.ts` can import them — BEFORE writing any classification logic.
**Warning signs:** `import { atomicWriteFile } from './verify-run.js'` failing to compile.

### Pitfall 2: The Visual/Derived schema asymmetry between pass-1 and pass-2 (see Summary #2)
**What goes wrong:** The classifier's "exclude Visual lines" rule (decision 12) is implemented as a
literal `^Visual (p\.` regex only. Pass-1 (old-schema) slices have zero such lines — their diagram
notes live under `Derived (p.N) — diagram description:` / `— art:`. The comparison then treats
pass-1's diagram notes as rule content to compare against pass-2's genuine `Derived` rule lines,
manufacturing spurious `sharper`/`contradictory` verdicts on pairs that are actually schema-clean.
**Why it happens:** Both reference games predate the Phase 170 split; nobody has re-transcribed them
under the new contract yet, so this asymmetry has never been exercised until Phase 174's own first
real pass-2 run does it.
**How to avoid:** Treat `Derived (p.N) — diagram description` / `— art` (case-insensitive, matching
the em-dash-qualifier shape measured live) as pass-1's presentational-exclusion equivalent to a
`Visual (p.N):` line, and exclude both forms from the rule-delta comparison. Document this exclusion
rule explicitly in the classification subagent contract with a worked example drawn from real data
(e.g. `one-two-punch`'s `Derived (p.1) — diagram description (Plan phase): Two boxer cards are
shown at top...` line).
**Warning signs:** SC-2's proof run showing more `sharper` verdicts than expected concentrated on
pairs whose pass-1 side has old-schema `— diagram description` annotations.

### Pitfall 3: Rewriting `verify-game.md`'s "no classification" statements incompletely
**What goes wrong:** A plan adds a new Step 4 without removing the file's existing assertions that
the pass performs no comparison/classification, leaving self-contradicting skill text that a live
session partially ignores (exactly the class of defect `173-PROOF.md` §Step 1 caught live).
**Exact locations to rewrite, enumerated:**
1. Lines 19-20: *"It never runs a build, never edits a chunk, never writes a staged slice over a
   live one, and never compares the staged output to what already exists. That comparison is a
   later phase's job; this skill's job ends the moment staging closes."* — must become "...and
   never writes a staged slice over a live one. Comparison happens in Step 4, below" or equivalent.
2. Lines 96-98 (Step 3): *"**The pass ends here.** There is no comparison of the staged output to
   what already exists, no classification, no verdict, and no promotion of a staged slice over a
   live one. Staging and recording is the entire scope of this skill."* — this entire paragraph must
   be replaced; the pass no longer ends at Step 3 once Step 4 exists.
3. `verify/staging-dispatch.md`'s own Close section (lines 158-164) also restates "there is no
   comparison, no classification, and no promotion... at this or any later point in this file" —
   this file's OWN scope-fence sentence is still true (staging-dispatch.md itself performs no
   classification — that's the new delegate's job), so it likely needs NO edit, but verify a plan
   doesn't accidentally touch it or accidentally leave verify-game.md's Step 3 paragraph
   unaddressed while editing this one.
4. The file's own YAML frontmatter `description:` (line 3) already says "staging the
   re-transcription non-destructively for later comparison" — consistent with adding Step 4, no
   edit needed there.
**How to avoid:** Enumerate every such statement (done above) before writing the plan, and assign
each one an explicit rewrite task rather than an "append around it" task.

### Pitfall 4: Assuming a stable, symmetric page-range vocabulary across dispatches
**What goes wrong:** Phase 173's own proof recorded that two clean, uninterrupted dispatches of
the SAME source (`seven`, twice, across plans 173-01 and 173-06) produced DIFFERENT section
boundaries both times. A pairing mechanism that expects two runs of pass-2 to produce the same
staged filenames, or that a live slice's page-span exactly bounds one-and-only-one staged unit,
will be wrong on real data — page ranges can overlap fractionally (a live slice spanning p.1 might
pair against TWO staged units that split p.1 into two topics).
**Why it happens:** LLM-driven transcription section-boundary choice is not deterministic between
independent dispatches, a fact Phase 173's own proof measured and documented (`173-PROOF.md` §4,
"Clean-run comparison" section) rather than assumed.
**How to avoid:** Design pairing as a MANY-to-MANY overlap join (a live slice can pair against
multiple staged units whose ranges overlap its page-span, and vice versa), not a 1:1 lookup; the
"pair" is really "this live slice's rule content vs. the union of staged content covering its
pages," and the classification subagent should be told which live slice AND which set of staged
units it is comparing, not assume a bijection.

### Pitfall 5: Determinism check (decision 16) has no existing reusable command
**What goes wrong:** A plan assumes there's a `verify-classify-diff` or similar existing tool to
compare two classification runs; none exists.
**Why it happens:** The closest precedent, Phase 173's "clean-run comparison" (`173-PROOF.md` §4),
was ad hoc proof-script work (`stat`/`shasum`/Python set-diff over two `verify-run-status --json`
outputs), never promoted to a reusable CLI command.
**How to avoid:** Plan the determinism check the same way — classify the same real pair set twice
(two separate `--run-id`s or two `verify-classify-record` passes over the same pairs), and diff the
two `verify-classify-status --json` outputs' verdict sets independently (not trusting either run's
own "matched" claim), following the exact discipline `173-PROOF.md` §5 already used for the
range-resume-determinism re-proof.

## Code Examples

### Real Derived-line data showing the schema asymmetry (Pitfall 2)
```
# Source: ~/BoardSmithGames/one-two-punch/rulebook/01-setup-and-round-structure.md (real, live data)
Derived (p.1): The box contains 2 Boxer Cards, 16 Action Cards, 6 Guard Cards, and 1 Rules Sheet.
Derived (p.1) — diagram description: A layout diagram of the ring showing three dashed-outline
areas in a row, labeled left-to-right with downward arrows: "blue corner", "center ring", "red
corner"...
```
```
# Source: 173-PROOF.md §3 (real staged slice, seven, produced by the CURRENT transcription contract)
Derived (p.1): Rounds are simultaneous — there is no turn order; ...
Visual (p.1): The heading "Round" is bold with the qualifier "(Simultaneous)" ...
```
The first `Derived (p.1) — diagram description` line above is the OLD schema's equivalent of the
second example's `Visual (p.1)` line — both describe layout, neither is rule-bearing, and a
classifier that only excludes the literal `Visual (p.` prefix will compare the first as rule content
against nothing on the pass-2 side (or against a genuinely different pass-2 `Visual` line), risking
a false `sharper`/`contradictory`.

### Real `verify-run-status --json` shape the classification pairing/status commands consume
```json
// Source: 173-PROOF.md §3, actual command output
{"runId":"2026-07-28T23-06-04Z","recorded":["01-about-and-setup","01-round","01-game-end-and-match","01-definitions","01-distribution-of-cards","02-solo-variant"],"count":6}
```
```json
// Source: 173-PROOF.md §5, real output including range bookkeeping (post-173-08)
{"recorded":["01-overview-and-setup","02-action-cards","02-punch-examples-discard-and-end-of-game"],
 "count":3,"rangesRecorded":["1-1","2-2"],"rangesPending":[]}
```
Classification's pairing step reads `recorded[]`/`rangesRecorded` from this exact JSON shape (via a
fresh `verify-run-status --json` call, or by importing `verifyRunStatusCommand` directly) — it does
NOT re-derive which units exist by scanning the staging directory itself, matching
`staging-dispatch.md`'s "the ledger, not the filesystem, is the only source of truth" discipline.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `fs.writeFile` truncate-rewrite ledger append | Atomic temp-file + `fsync` + `rename()` | 173-08 (CR-01) | Classification MUST build on the 173-08 mechanism, never the pre-173-08 one — the module's own doc comment now correctly describes the atomic guarantee |
| Range-level resume by re-dispatching whole range alongside stale partial output | Persisted dispatch-plan manifest + `range-complete`/`range-reset` tombstone markers | 173-08 (Finding 1 fix) | If classification ever needs its own "range" concept (it doesn't — it operates on already-completed staged units), this is the pattern to reuse, not invent |
| Instructing "never read a slice" in prose alone | Structural enforcement via subagent return contract + orchestrator transcript grep-for-absence | Phase 170 finding, applied in 173 (VERIFY-07) | The classification subagent is the ONE place a slice is legitimately read; everything else keeps the zero-read discipline |

**Deprecated/outdated:** None specific to this phase — it is greenfield code extending a
one-week-old mechanism (173-08 landed 2026-07-29, same day as this phase's context gathering).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The "one-file-per-command" convention should be followed for `verify-classify.ts` rather than growing `verify-run.ts` past 959 lines | Architecture Patterns, Pattern 1 | Low — either choice works; this is Claude's Discretion per CONTEXT.md, flagged as a decision point, not asserted as locked |
| A2 | Page-span-overlap pairing (derived from live slices' own `p.N,` citation lines and staged units' `rangeId`) is more robust than `INDEX.md`'s Slices table | Architecture Patterns, Pattern 2 | Medium — if the planner instead builds on the Slices table, it will work for `seven` but fail entirely for `one-two-punch` (no such table exists there); this is empirically measured, not a guess, but the RECOMMENDATION to use page-overlap instead is this researcher's synthesis, not a locked CONTEXT.md decision |
| A3 | `Derived (p.N) — diagram description` / `— art` (old-schema) should be excluded from rule-delta comparison identically to `Visual (p.N):` (new-schema) | Common Pitfalls #2 | High if wrong — SC-2's 90% cosmetic bar is directly threatened by NOT making this exclusion, since real data shows this pattern in 5/12 one-two-punch Derived lines |
| A4 | Determinism check (decision 16) has no reusable CLI command precedent and should be built as a proof-script harness, not a first-class command | Common Pitfalls #5 | Low — worst case a planner builds a small reusable command instead, which is strictly additive |

## Open Questions

1. **Which reference game should Wave 1's real pass-1-vs-pass-2 data come from?**
   - What we know: CONTEXT.md decision 13 nominates `one-two-punch` as primary (12 chunks, already
     has real staged slices from Phase 173's proof — but those staged slices no longer exist on
     disk, per this research's Summary finding #1) and `seven` as a secondary target if cheap.
   - What's unclear: whether re-running the FULL Phase 173 adoption+transcription pipeline against
     a fresh `cp -R` copy of `one-two-punch` is itself in scope for THIS phase's Wave 1, or whether
     it should be a distinct, explicitly-scoped preparatory task.
   - Recommendation: make it an explicit Wave 1 task with its own exit condition (N real staged
     files recorded, byte-identical originals confirmed before/after), exactly mirroring
     `173-06-PLAN.md`'s SC-2/SC-3 methodology, before any classifier code is written.

2. **What does "the provenance dimension" mean precisely for a FIRST-EVER verify pass on a
   pre-provenance project (both reference games' actual current state)?**
   - What we know: `computeVerificationScope()` gives the CURRENT archive hash post-adoption.
     `parseVerifiedAgainst()` gives a PRIOR recorded hash — but on a project where no chunk has ever
     been `chunk-check`-ed against a real archive (both reference games' actual live state today),
     there is no prior hash to compare against.
   - What's unclear: whether `source-changed`/`source-unchanged` degrades to a third implicit state
     ("no prior provenance recorded — comparison not applicable") on a project's first-ever verify
     pass, or whether it should be reported as `source-unchanged` by default (nothing to compare
     against, so nothing detected as changed).
   - Recommendation: treat this as a real design question for the plan, not resolved by this
     research — CONTEXT.md's decisions assume provenance is always computable, but the two real
     reference games are BOTH in the state where no prior hash exists yet.

3. **Module-boundary decision for the ledger helper exports (Pitfall 1)** — flagged as Claude's
   Discretion in CONTEXT.md; this research recommends exporting from `verify-run.ts` rather than
   growing that file, but does not resolve which specific helper names/signatures the export should
   take (e.g., whether `parseLedgerBody`'s `ParsedLine` union should itself become an open,
   extensible discriminated union that a sibling file can add a case to, or whether classification
   should maintain its own parallel parse of the SAME file's classification-only lines).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed: `npx vitest run src/cli/commands/verify-run.test.ts` cited live in `173-PROOF.md` §"How to re-run every proof") |
| Config file | repo-root `vitest.config.ts` (existing, unchanged by this phase) |
| Quick run command | `npx vitest run src/cli/commands/verify-classify.test.ts` |
| Full suite command | `npm test` (3611/3611 passing as of Phase 173's close, per `STATE.md`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VERIFY-03 (pairing) | Live/staged slice pairing by page overlap, unpaired sides reported | unit | `npx vitest run src/cli/commands/verify-classify.test.ts -t "pairing"` | ❌ Wave 0 |
| VERIFY-03 (provenance) | `source-changed`/`source-unchanged` computed via hash compare | unit | `npx vitest run src/cli/commands/verify-classify.test.ts -t "provenance"` | ❌ Wave 0 |
| VERIFY-03 (staleness map) | `cosmetic`->false, `sharper`/`contradictory`/`unclassified`->true, provenance never an input | unit | `npx vitest run src/cli/commands/verify-classify.test.ts -t "staleness"` | ❌ Wave 0 |
| VERIFY-03 (ledger record/resume) | Classification records append atomically, resume skips already-classified pairs | unit | `npx vitest run src/cli/commands/verify-classify.test.ts -t "ledger"` | ❌ Wave 0 |
| VERIFY-03 (SC-2 real-data bar) | ≥90% real pairs `cosmetic`, zero `contradictory` | integration/manual | real `cp -R` copy proof run, recorded in `174-PROOF.md` | ❌ Wave 0 (needs real pass-2 data, see Open Question 1) |
| VERIFY-03 (SC-3 real drift) | A genuine injected rules change classifies `sharper`/`contradictory` | integration/manual | real archived-source mutation + re-transcription dispatch, recorded in `174-PROOF.md` | ❌ Wave 0 |
| VERIFY-07 (classification half) | Zero slice-body-shaped lines in orchestrator transcript across a real classification dispatch | manual/live proof | grep the real transcript, mirroring `173-PROOF.md` §3's SC-3 method | ❌ Wave 0 |
| Determinism (decision 16) | Same pair set classified twice yields identical verdicts | integration | ad hoc harness, mirroring `173-PROOF.md` §5's clean-run comparison | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/commands/verify-classify.test.ts`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`; additionally, the SC-2 numeric bar
  (≥90% cosmetic, zero contradictory) must be recorded in `174-PROOF.md` BEFORE the phase is
  considered gate-passable — this is CONTEXT.md decision 14's explicit BLOCKER condition, not an
  optional nicety.

### Wave 0 Gaps
- [ ] `src/cli/commands/verify-classify.test.ts` — does not exist yet; covers all VERIFY-03 unit-level
  behavior above.
- [ ] Real pass-1-vs-pass-2 fixture data — does NOT exist anywhere on disk (Summary finding #1);
  Wave 1 must produce it via a real adoption+re-transcription run against a `cp -R` copy before any
  SC-2/SC-3/SC-5 proof can run.
- [ ] `src/cli/slash-command/bs/verify/classification-dispatch.md` — the new delegate file; does not
  exist yet.
- [ ] A classification subagent contract file (new, or a new section appended to a shared file) —
  does not exist yet; must be written with the Visual/Derived-schema-asymmetry exclusion rule
  (Pitfall 2) as an explicit worked example, since this is new ground no existing contract covers.

## Security Domain

Not applicable in the ASVS sense — this phase has no network-facing surface, no authentication,
no user input beyond local CLI args and file paths already validated by the existing
`RUN_ID_RE`/`RANGE_ID_RE`/staging-path-escape guards this phase reuses unchanged. The one
path-traversal-shaped risk (a `--slice`/pair path resolving outside the staging or rulebook
directory) is already guarded by the exact pattern `verify-run.ts:756-763` uses (`relative()` +
`startsWith('..')`/`isAbsolute()` check) — the new pairing/status commands must apply the identical
guard to any new path parameter they accept, rather than re-deriving a laxer check.

## Sources

### Primary (HIGH confidence — direct code/data inspection this session)
- `src/cli/commands/verify-run.ts` (full read, 959 lines) — ledger mechanism, export surface,
  atomic-write pattern.
- `src/cli/commands/chunk-provenance.ts` (grepped for `computeVerificationScope`,
  `parseVerifiedAgainst`, `resolveCitedSlices`, hash logic).
- `src/cli/commands/trace-check.ts` (partial read) — enumerated-finding-kind pattern.
- `src/cli/slash-command/bs/verify-game.md`, `verify/staging-dispatch.md`,
  `ingest/transcription-subagent.md` (full reads) — skill-text statements to rewrite, dispatch
  contract shape.
- `src/cli/commands/install-claude-command.ts` (partial read) — `SHARED_DIRS`/`SHARED_LEAF_PROBES`
  confirm `verify/classification-dispatch.md` installs automatically via the existing recursive
  `verify` directory copy; no installer code change needed (optionally add a leaf probe).
- `~/BoardSmithGames/one-two-punch` and `~/BoardSmithGames/seven` — direct `find`, `grep`, `git
  status`/`rev-parse` against the real repos (read-only), establishing: no `.verify` staging dirs
  exist, no `rulebook/source/` archives exist, zero `Visual (p.` lines exist, exact Derived-line
  counts and content per file, exact live filenames, `INDEX.md` structural difference between the
  two games.
- `.planning/phases/173-verify-pipeline-core/173-PROOF.md` (full read, 1375 lines) — real proof
  transcripts, exact JSON shapes, the six-staged-vs-three-live filename mismatch, the schema
  asymmetry evidence (`Visual (p.1):` appearing in a real staged file).
- `.planning/phases/173-verify-pipeline-core/173-CONTEXT.md`, `172-CONTEXT.md`,
  `174-CONTEXT.md`, `REQUIREMENTS.md`, `STATE.md` (Current Position + Accumulated Context) — full
  reads.

### Secondary (MEDIUM confidence)
- None — every claim in this document traces to a direct file read, grep, or shell command run in
  this research session, or to `174-CONTEXT.md`'s already-user-accepted locked decisions.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; every reused asset directly located and line-cited.
- Architecture: HIGH for the mechanical half (ledger extension, pairing mechanics — directly
  measured against real data); MEDIUM for the subagent-contract shape (grounded in a proven
  precedent, but the classification contract itself is new prose that has never been proven live).
- Pitfalls: HIGH — Pitfalls 1-3 are directly measured facts (unexported helpers, zero `Visual`
  lines in real data, exact line numbers of statements to rewrite); Pitfalls 4-5 are drawn directly
  from `173-PROOF.md`'s own documented findings, not speculation.

**Research date:** 2026-07-29
**Valid until:** 14 days (fast-moving — this phase's own Wave 1 work will change the state of the
reference-game repos this research measured; re-verify the "zero pass-1-vs-pass-2 material exists"
finding if planning is delayed past a scratch-copy proof run by another agent).
