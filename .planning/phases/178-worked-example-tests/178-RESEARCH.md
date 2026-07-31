# Phase 178: Worked-Example Tests - Research

**Researched:** 2026-07-31
**Domain:** BoardSmith `bs-` skill pipeline — worked-example extraction/translation, CLI ledger commands, build/verify wiring
**Confidence:** HIGH (all findings from direct file reads of the real, current codebase; no external libraries involved)

## Summary

This phase adds a new example-to-test derivation path shared by `build/test.md` (TEST-01) and
`/bs-verify-game` (CHECK-06). Everything it needs to mirror already exists in the repo, built and
hardened across Phase 177: `verify-derive-recheck.ts`'s ledger/CLI pairing (atomic upsert-append,
fence rejection, read-path revalidation, `--json`, findings-exit-0) is the correct skeleton to copy
for `verify-example-replay.ts` / `verify-example-record`. The annotation family that decision 2
widens is enumerated in exactly the four places CONTEXT names, plus a fifth (`verify-enumerate.ts`'s
independently-duplicated `ANY_ANNOTATION_LINE_RE`/`ANNOTATION_VOCABULARY_RE`) that CONTEXT did not
name and this research surfaces as a real gap. `QuoteVerifiedProvenance` is a `class` with a private
constructor, obtained via `.obtain(projectDir)`, and its `.covers(slicePath)` method is the exact
API decision 12 needs — already scope-fixed for multi-source projects (177-19).

**The single highest-leverage finding: CHECK-04's actual *live* pipeline wiring in `verify-game.md`
Step 7 was never updated to the dual-enumeration design that is what actually closed CHECK-04.**
Step 7 still dispatches the *retired* blind-derivation contracts (`derive-recheck.md` /
`derive-compare.md`, `verify-derive-recheck.ts`). The replacement mechanism
(`verify-enumerate.ts` + `enumerate-facts.md` + `reconcile-facts.md`) has **no CLI command and no
skill-text wiring at all** — it is pure computation, explicitly deferred ("later work, tracked
outside this plan," `verify-enumerate.ts:18`). CONTEXT decision 9 says "mirror CHECK-04's
module/CLI pairing exactly," citing `verify-derive-recheck.ts` + `verify-derive-record` — that
citation is correct as a **shape to copy** (the ledger/CLI plumbing pattern), but the planner must
not confuse it with "the mechanism CHECK-06 should reuse." This phase should copy the OLD design's
CLI/ledger *plumbing pattern*, not its blind-derivation *judgment mechanism* — worked-example
extraction is a different problem (spec extraction, not fact re-derivation) and CONTEXT's own
decisions 5-8 already specify the right two-step shape (extract → translate) independent of either
CHECK-04 design.

**Primary recommendation:** Build `verify-example-replay.ts` as a NEW module, copying
`verify-derive-recheck.ts`'s structural pattern verbatim (frozen verdict enum incl. `unexecutable`,
one choke-point constructor, project-level ledger at `rulebook/.example-replay/EXAMPLE-VERDICTS.md`,
`recordX`/`readX`/`replaceX` upsert-append triad, `verify-example-record` as the sole write CLI).
Build the shared extract→translate logic as a THIRD new module (not literally inside
`verify-example-replay.ts`) so `build/test.md`'s generation path and CHECK-06's replay path both
call it — this is what SC-3 requires and what neither CHECK-04 design's structure provides off the
shelf, since CHECK-04 has no "generate code" step at all.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Example identification (judgment: is this text a worked example?) | Subagent (extract contract) | — | Ad-hoc prose per game (measured reality #2); no mechanical rule reliably identifies one (decision 1) |
| `WorkedExample` spec extraction (slice→structured spec) | Subagent (extract contract) | CLI (payload construction, validation) | CLI builds/validates the quote-only payload and the returned spec shape; subagent supplies judgment |
| Spec→runnable-test translation | Subagent (translate contract) | CLI (payload construction) | Same split; a second, separately-dispatched subagent per decision 6 |
| Ledger recording (one atomic write path) | CLI (`verify-example-record`) | — | Mirrors `verify-derive-record`; only mechanical write surface |
| Build-side test generation into game project | CLI/skill (`build/test.md` new step) | Generated-project filesystem | Runs INSIDE the generated game repo, targets that game's own API/tests dir |
| Verify-side replay execution | CLI/skill (`verify-game.md` new Step 8) | Real BoardSmith engine (via generated project's own test runner) | Executes the translated test against the real engine in the reference game's own environment |
| Quote provenance gating (decision 12) | CLI (`QuoteVerifiedProvenance`) | — | Reused unmodified from `chunk-provenance.ts`/`verify-enumerate.ts`; no second implementation |

## User Constraints (from CONTEXT.md)

<user_constraints>
### Locked Decisions

**Area 1 — Identifying worked examples**
1. Identification is JUDGMENT (subagent); enumeration and recording are MECHANICAL (CLI). No mechanical rule identifies a worked example.
2. Add an `Example (p.N):` marker to the ingest transcription contract, but the check must NOT depend on it. Concrete cost: the annotation family is enumerated in lockstep across `verify-enumerate.ts` (`ANY_ANNOTATION_LINE_RE:116`, `ANNOTATION_VOCABULARY_RE:154`), `verify-derive-recheck.ts` (`ANY_ANNOTATION_LINE_RE:426`, `quoteLinesOnly`), and `verify-classify.ts`. Adding a 4th kind means widening all of them together — and `quoteLinesOnly` must be re-examined deliberately: CHECK-04's blind payload strips annotation lines, and an `Example` line is arguably quote-bearing content rather than an annotation. Getting this wrong silently changes CHECK-04's payloads. WR-07 (deny-list→allow-list inversion, deferred in 177-08) is directly adjacent — consider closing it here rather than widening a deny-list a fourth time.
3. Examples are TYPED: `transition` | `predicate`. Both in scope.
4. An example that contradicts its own source is NEVER turned into a test — emitted as `example-inconsistent`, routed to `## Open Rules Gaps`. `seven`'s Run example is the live fixture.

**Area 2 — Example → executable test derivation**
5. Extraction returns a structured `WorkedExample` spec, never test code. Fields: id, slice ref, page citation, `kind` (`transition`/`predicate`), verbatim source text, setup, action, expected outcome. Recorded through ONE atomic write path — the CHECK-04 ledger shape.
6. Two steps, not one: extract, then translate. A second shared subagent contract turns a `WorkedExample` spec into runnable test code, invoked identically by build and verify.
7. `unexecutable` is a first-class verdict with a NAMED reason.
8. Build-generated tests are ONE FILE PER CHUNK, committed with the chunk, in the generated project's test directory. Re-running build for a chunk regenerates only that chunk's file, idempotently — the CR-06 upsert-append discipline.

**Area 3 — Shared logic placement and pipeline wiring**
9. Mirror CHECK-04's module/CLI pairing exactly. `verify-example-replay.ts` is the single shared module (`--json` read/enumerate/report); `verify-example-record` is the ONLY atomic write surface.
10. `build/test.md`: a new step between existing steps 3 and 4; a mismatch IS build-blocking, routes to `repair`. Chunks with zero examples skip it and name the exemption explicitly (SKILLAUTO-08 pattern).
11. `verify-game.md`: new Step 8 (CHECK-06); Close renumbers to Step 9. REPORTS, exit 0, never gates Close. Project-wide, independent of staleness, source-free by construction.
12. A replay mismatch does NOT by itself mean the code is wrong — gate it on quote provenance. Reuse `QuoteVerifiedProvenance` (built 177-16, scope-fixed 177-19). When source is unavailable, downgrade to lower-confidence finding.

**Area 4 — Proof discipline and acceptance bar**
13. Pre-register expected extraction before any dispatch, committed first.
14. NEW GATE: every proposed criterion checked against "could this ever pass?" BEFORE committing.
15. Do NOT re-import the retired determinism gate. Stability is measured on the EXECUTABLE OUTCOME (generated test's pass/fail), not byte-identical spec text.
16. Report raw counts and per-game breakdown — never a percentage. n≈6.
17. A reference game with zero extractable examples is a REAL FINDING about the ingest contract, not a tuning signal.
18. Proof runs on `cp -R` copies with sha256 baselines; originals proven byte-identical after.

### Claude's Discretion
- Module boundaries/file placement within `src/cli/commands/` and `src/cli/slash-command/bs/`, and exact subagent contract filenames/handshake tokens (following `BS-*-V1`).
- `WorkedExample`'s exact field shape (verdicts must be test-pinned enumerated set; reuse single atomic ledger write path).
- Human-readable report grouping and generated test file naming.
- Whether to close WR-07 as part of decision 2's family widening, or widen the deny-list once more and leave WR-07 open — decide on evidence at plan time, explicitly.
- Dispatch batching, provided decisions 6 and 12 hold.

### Deferred Ideas (OUT OF SCOPE)
- Backfilling generated example tests into already-built chunks of existing games — no migration phase.
- Re-transcribing any reference game to add `Example (p.N):` markers.
- Cross-game example-replay battery as a single regression sweep — recorded as a Future Requirement in `REQUIREMENTS.md`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHECK-06 | Worked-example replay — worked examples in cited slices executed against the engine, mismatches reported as findings | `verify-derive-recheck.ts` pairing to mirror (Q1); `verify-game.md` Step 8 insertion point measured (Step count currently 8, Close is Step 8 — see Risks); `QuoteVerifiedProvenance` API (Q3) |
| TEST-01 | `build/test.md` generates example-derived tests for chunk's cited slices, accumulating systematically | `build/test.md`'s 7-step ordered sequence read in full (Q5); insertion point between steps 3 and 4 confirmed; `chunk-provenance.ts`'s `citedSlices`/`resolveCitedSlices` read for cited-slice resolution |
</phase_requirements>

## Standard Stack

This phase adds no new dependency. All infrastructure is internal BoardSmith CLI/TypeScript code
plus prose subagent contracts. No `npm install` is required — see Package Legitimacy Audit below
(N/A, no packages).

### Core (existing, reused)
| Module | Purpose | Why reuse |
|---|---|---|
| `src/cli/commands/verify-run.ts` — `atomicWriteFile` | The ONE atomic write path in the repo (temp-write-then-rename) | 173-REVIEW.md CR-01's defect class; every ledger module in the repo routes through this |
| `src/cli/commands/chunk-provenance.ts` — `computeVerificationScope`, `resolveCitedSlices` | Source-hash comparison, cited-slice resolution from CHUNK.md prose | `QuoteVerifiedProvenance.obtain()` composes this directly; do not build a second provenance notion |
| `src/cli/commands/verify-derive-recheck.ts` | Ledger/CLI pairing shape to mirror (structure, not mechanism) | CONTEXT decision 9 names this explicitly |
| `src/cli/commands/verify-enumerate.ts` — `QuoteVerifiedProvenance`, `classifyDerivedLines` shape | Class-with-private-constructor provenance guard; classification-with-downgrade pattern | Decision 12 names this exact class |
| `src/cli/lib/sandbox-scan.ts`, `src/testing/random-simulation.ts` | Cited-not-restated in `build/test.md`; the new example-test step must follow the same discipline | Existing convention in `build/test.md` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mirroring `verify-derive-recheck.ts`'s ledger/CLI shape | Mirroring `verify-enumerate.ts`'s shape (the CHECK-04 design that actually closed the requirement) | `verify-enumerate.ts` has NO CLI wiring at all (pure computation only) — nothing to mirror on the CLI side. CONTEXT decision 9 is correct to point at `verify-derive-recheck.ts` for the plumbing, even though it is the retired judgment design. |

**Installation:** N/A — no new packages.

## Package Legitimacy Audit

Not applicable. This phase adds zero external dependencies; every module and pattern cited above is
internal, already-committed BoardSmith source. No `npm install`/`pip install`/`cargo add` occurs.
`slopcheck` and registry verification were not run because there is nothing to verify.

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │         rulebook/*.md (live slices)           │
                    │  "Example (p.N):" marker (new, decision 2)   │
                    │  OR ad-hoc prose (seven/one-two-punch/doom)  │
                    └───────────────┬───────────────────────────────┘
                                    │ quote-lines-only payload
                                    │ (buildXxxPayload, mirrors buildEnumeratorPayload)
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  SUBAGENT 1: extract-example.md (BS-EX-V1)   │
                    │  Judgment: is this a worked example?         │
                    │  → WorkedExample{id, sliceRef, page,         │
                    │     kind, sourceText, setup, action,         │
                    │     expected} OR example-inconsistent        │
                    └───────────────┬───────────────────────────────┘
                                    │ WorkedExample spec (never test code)
                                    ▼
                    ┌─────────────────────────────────────────────┐
                    │  SUBAGENT 2: translate-example.md (BS-TR-V1) │
                    │  Judgment: spec → runnable test code         │
                    │  → test code string OR unexecutable+reason   │
                    └───────────────┬───────────────────────────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 │ SHARED — same two subagents, same     │
                 │ CLI construction/validation, invoked   │
                 │ identically from both call sites (SC-3)│
                 └──────────────────┬──────────────────┘
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        ▼                                                        ▼
┌───────────────────────┐                          ┌───────────────────────────┐
│ BUILD SIDE (TEST-01)    │                          │ VERIFY SIDE (CHECK-06)     │
│ build/test.md new step  │                          │ verify-game.md new Step 8  │
│ between steps 3 and 4   │                          │ (after Step 7, before Close)│
│ Runs in GENERATED       │                          │ Runs against reference game │
│ project, chunk's own     │                          │ (already built, may have    │
│ cited slices only        │                          │ no generated example tests) │
│ → writes ONE test file   │                          │ → runs translated test      │
│   per chunk, idempotent  │                          │   against real engine       │
│ Mismatch → BLOCKS,        │                          │ Mismatch → REPORTS finding, │
│ routes to repair (dec.10) │                          │ exit 0, never gates (dec.11)│
└───────────────────────┘                          └─────────────┬──────────────┘
                                                                   │
                                                                   ▼
                                                    ┌───────────────────────────┐
                                                    │ QuoteVerifiedProvenance     │
                                                    │ .obtain()/.covers(slicePath)│
                                                    │ gates the finding's         │
                                                    │ confidence (decision 12)    │
                                                    └───────────────────────────┘
                                                                   │
                                                                   ▼
                                            verify-example-record (ONLY write CLI)
                                            → rulebook/.example-replay/EXAMPLE-VERDICTS.md
                                            (project-level, upsert-append, atomic)
```

### Recommended Project Structure
```
src/cli/commands/
├── verify-example-replay.ts   # NEW — mirrors verify-derive-recheck.ts's shape:
│                               #   frozen verdict enum, one choke-point constructor,
│                               #   readLiveSlices reuse, ledger read/write/report,
│                               #   verifyExampleReplayCommand (report), verifyExampleRecordCommand (write)
├── example-derivation.ts      # NEW — the SHARED extract-payload/translate-payload builders +
│                               #   WorkedExample validation, imported by BOTH build/test.md's
│                               #   generation path and verify-example-replay.ts's replay path (SC-3)
src/cli/slash-command/bs/
├── verify/
│   ├── extract-example.md     # NEW — BS-EX-V1, judgment: identify + extract WorkedExample spec
│   └── translate-example.md   # NEW — BS-TR-V1, judgment: spec → runnable test code
├── build/
│   └── test.md                # EDIT — new step inserted between existing steps 3 and 4
├── ingest/
│   └── transcription-subagent.md  # EDIT — Example (p.N): marker joins line-kind contract
└── verify-game.md             # EDIT — new Step 8 (CHECK-06), Close renumbers to 9
```

### Pattern 1: Ledger/CLI pairing (mirror `verify-derive-recheck.ts`)
**What:** One module with (a) a frozen verdict enum + `createXRecord` choke-point validator, (b)
`readLiveSlices`-style enumeration, (c) `recordX`/`replaceX`/`readX` upsert-append triad through
`atomicWriteFile`, (d) two CLI commands — one read-only report (`verify-example-replay --json`,
never sets `process.exitCode`), one write-only (`verify-example-record`, no `--run-id`, no bypass
flag of any kind).
**When to use:** Any CHECK-0x-shaped project-level, source-free, run-less verification mechanism.
**Example:**
```typescript
// Source: src/cli/commands/verify-derive-recheck.ts:97-102, 205-323, 815-949
export const EXAMPLE_VERDICTS = Object.freeze([
  'agrees', 'disagrees', 'underivable' /* → 'unexecutable' per decision 7 */, 'example-inconsistent',
] as const);
// createExampleVerdictRecord(...) — the ONE choke point, throws on: out-of-enum verdict, empty
// reasoning, fence-marker injection, missing required fields for a given verdict.
// recordExampleVerdict(projectDir, record) — reads existing ledger, upserts by
// `slicePath:lineNumber` (or exampleId), writes merged set via replaceExampleVerdicts.
```

### Pattern 2: Quote-lines-only payload construction with construction-site backstop
**What:** A payload builder that strips all annotation-family lines (`Derived`, `Visual`,
`Named-but-undefined`, and — pending decision 2 — `Example`) via a SINGLE shared
`annotationBody`/`isQuoteLine` predicate, then THROWS if the assembled payload still matches any
annotation family (independent of which prefix regex missed it).
**When to use:** Any dispatch prompt that must guarantee independence from a specific line's own
text.
**Example:**
```typescript
// Source: src/cli/commands/verify-derive-recheck.ts:435-465 (isQuoteLine/quoteLinesOnly),
// 707-715 (construction-site backstop)
```

### Pattern 3: Two-dispatch split (extract, then translate — never one combined pass)
**What:** Two separately-invoked subagent contracts with distinct handshake tokens and
non-overlapping inputs, so "independent second stage" is structural, not an instruction a composed
prompt could drop.
**When to use:** Decision 6's extract→translate split; also the historical CHECK-04
blind-derive→compare split (177-04) and now the dual-enumeration design's enumerate→reconcile split
(`enumerate-facts.md` + `reconcile-facts.md`).
**Example:**
```
// Source: src/cli/slash-command/bs/verify/enumerate-facts.md:1-46 (handshake + dispatch-rejection
// block pattern to copy verbatim for extract-example.md / translate-example.md)
```

### Anti-Patterns to Avoid
- **Reusing `verify-derive-recheck.ts`'s blind-derivation JUDGMENT mechanism for CHECK-06:** that
  design was retired for CHECK-04 itself (177-EXPERIMENTS). Only its ledger/CLI *plumbing shape* is
  proven-good; its "hide the target, derive blind" judgment approach solves a different problem
  (re-deriving an already-stated fact) than this phase's problem (identifying + translating a
  worked example that has no prior "original" to hide).
- **A second, independently-maintained annotation-family regex.** `verify-enumerate.ts` already
  duplicates `ANY_ANNOTATION_LINE_RE`/`ANNOTATION_VOCABULARY_RE` from `verify-derive-recheck.ts`
  rather than importing them (deliberately, per that module's own comment, to avoid widening a
  sibling's export surface) — decision 2's widening MUST touch all five known sites (see Q2 below),
  not the four CONTEXT names.
- **Generating test code that executes uncontained in the game repo without a `cp -R` staging
  discipline** during proof (decision 18) — mirrors every prior phase in this milestone.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Atomic file writes | A second `fs.writeFile`+rename wrapper | `atomicWriteFile` (`verify-run.ts`) | 173-REVIEW.md CR-01's defect class; the repo's own rule is exactly one atomic write path |
| Source-provenance / hash verification | A new provenance class | `QuoteVerifiedProvenance.obtain()` (`verify-enumerate.ts`) | Already scope-fixed for multi-source projects (177-19); building a second one reintroduces the exact bug that fix closed |
| Cited-slice resolution from CHUNK.md | A new citation-parsing regex | `resolveCitedSlices`/`chunk-provenance.ts`'s `## Verified Against` block parser | Already handles the fenced-block format and hash verification |
| Random-play / a11y / sandbox test infrastructure | A hand-rolled play loop or lint pass | `simulateRandomGames`, `boardsmith lint`, `scanAssetReachability` | `build/test.md` already states this discipline explicitly ("cite the real command, never restate it in prose") |
| Annotation-line stripping for dispatch payloads | A new regex from scratch | `annotationBody`/`isQuoteLine`/`quoteLinesOnly` (`verify-derive-recheck.ts`) | Widen the existing single-choke-point functions (decision 2), don't fork a sixth copy |

**Key insight:** Almost nothing in this phase's *plumbing* is new engineering — it is Phase 177's
ledger/CLI/provenance/payload machinery reapplied to a new judgment problem (example
identification+translation instead of fact re-derivation). The genuinely new work is (a) the
`WorkedExample` spec schema and its two-subagent derivation, and (b) the build-side code-generation
step, which has no prior analog anywhere in the CHECK-0x family — CHECK-04/CHECK-01/CHECK-02/CHECK-03
all only ever REPORT; none of them writes generated code into the target project.

## Common Pitfalls

### Pitfall 1: Missing the 5th annotation-family enumeration site
**What goes wrong:** Decision 2 names 4 sites to widen: `verify-enumerate.ts:116,154`,
`verify-derive-recheck.ts:423,426`, `verify-classify.ts:102`, plus `ingest-archive.ts`. Research
confirms `verify-enumerate.ts` ALSO independently duplicates its own copy of
`ANY_ANNOTATION_LINE_RE` (`verify-enumerate.ts:106` region, comment explicitly says "Duplicated
from `verify-derive-recheck.ts`'s private `ANY_ANNOTATION_LINE_RE` rather than imported") — this
is the SAME line CONTEXT already cites as site 1, so it is covered, but the plan must grep for
`ANY_ANNOTATION_LINE_RE` AND `ANNOTATION_VOCABULARY_RE` by name across the whole `src/cli/commands/`
tree (not just the four named files) before considering the widening complete, since a 6th
undiscovered duplicate is exactly the failure class this milestone has hit four times already
(see `verify-enumerate.ts`'s own header comment, "this is now the fourth instance in this
milestone").
**Why it happens:** Multiple modules deliberately duplicate rather than import private constants
(a documented tradeoff, not an oversight) — so grepping only the files CONTEXT names will miss a
site if one exists outside them.
**How to avoid:** `grep -rn "Derived (p\.\|Visual (p\.\|Named-but-undefined (p\." src/cli/commands/*.ts src/cli/slash-command/bs/**/*.md` as a plan-time verification step, not just editing the four named files.
**Warning signs:** A test somewhere asserts a specific annotation-line count that silently doesn't
change after the widening — the CHECK-04 regression-count pins in `verify-derive-recheck.test.ts`
are exactly this shape and must be checked against, not just left passing.

### Pitfall 2: `quoteLinesOnly` stripping `Example` lines changes CHECK-04's already-closed measurements
**What goes wrong:** CHECK-04 is CLOSED (`REQUIREMENTS.md` line 531). Its blind-derivation payload
(retired design, still live code) and the dual-enumeration payload (`buildEnumeratorPayload`,
`verify-enumerate.ts`) BOTH route through `quoteLinesOnly`/`isQuoteLine`. If `Example (p.N):` is
added to the deny-list family stripped by `isQuoteLine`, every future CHECK-04 dispatch's payload
composition SILENTLY CHANGES — the quote-only content an enumerator/derivation subagent sees would
now exclude any line matching the new `Example` prefix, shrinking or reshaping the corpus a future
re-measurement would see. CHECK-04 itself is closed and unlikely to be re-run soon, but the SAME
`quoteLinesOnly` function is proposed for direct reuse by CHECK-06's own payload builder — so this
is a live design fork point, not an academic one.
**Why it happens:** `quoteLinesOnly` is a single, shared, deny-list-based choke point spanning two
different checks (CHECK-04's two implementations) with two different correctness requirements: for
CHECK-04, an `Example` line is presentation/annotation noise to strip; for CHECK-06, an `Example`
line IS the content under test (it needs to be identified, not hidden).
**How to avoid:** Resolve this explicitly at plan time per CONTEXT's own discretion item: either (a)
invert `quoteLinesOnly` to an allow-list (closing WR-07) so "what counts as quotable content" is
defined positively and CHECK-06's extraction payload can define its OWN allow-list including
`Example` lines without touching CHECK-04's deny-list at all, or (b) keep `quoteLinesOnly` as
CHECK-04's private concern and give CHECK-06 a SEPARATE, new payload-construction function that
happens to reuse `annotationBody` but has its own inclusion logic (Example lines ARE the point, not
stripped). Option (b) avoids re-touching CHECK-04's already-closed payload composition at all —
worth weighing as the lower-risk default even though CONTEXT frames the WR-07 closure as a live
discretion choice.
**Warning signs:** Any `verify-derive-recheck.test.ts` fixture-count assertion changes after this
phase's edits with no narrative explanation.

### Pitfall 3: Confusing CHECK-04's "current mechanism" between two coexisting implementations
**What goes wrong:** The repo contains BOTH the retired blind-derivation design
(`verify-derive-recheck.ts` + `derive-recheck.md`/`derive-compare.md`, still wired into
`verify-game.md` Step 7 and still fully CLI-registered) AND the dual-enumeration replacement
(`verify-enumerate.ts` + `enumerate-facts.md`/`reconcile-facts.md`, NO CLI registration, NOT wired
into `verify-game.md` at all). A planner reading CONTEXT decision 9 ("mirror CHECK-04's
module/CLI pairing exactly... built, code-reviewed, and hardened across 177-09/177-10") could
reasonably read this as pointing at "the current CHECK-04," but the module named
(`verify-derive-recheck.ts`) is the retired design's file. This is not a contradiction in
CONTEXT — decision 9 is explicitly about the LEDGER/CLI SHAPE, which IS what was hardened in
177-09/177-10 — but a plan that also tries to reuse `verify-derive-recheck.ts`'s blind-derivation
PROMPT-BUILDING functions (`buildBlindDerivePayload`, `focusQuoteWindow`, `blindDeriveHandle`) for
CHECK-06 would be reusing retired judgment machinery solving a different problem.
**Why it happens:** The repo never finished migrating `verify-game.md` Step 7 to point at the
design that actually closed CHECK-04 — that migration was out of scope for every 177 plan and
remains open, undiscovered technical debt.
**How to avoid:** Copy `verify-derive-recheck.ts`'s STRUCTURAL pattern (enum, choke-point,
ledger triad, CLI pair) into a new file; do NOT import or call its blind-derivation-specific
functions (`buildBlindDerivePayload`, `focusQuoteWindow`, `blindDeriveHandle`,
`derivePayloadSet`) for CHECK-06's own payload construction, since those solve "hide one line from
many candidates in a shared slice," a problem CHECK-06 does not have (an example either exists in a
slice or it doesn't — no multi-candidate collision risk of that shape).
**Warning signs:** A plan task that imports from `verify-derive-recheck.ts` for anything beyond the
literal DERIVED_LINE_RE-style shared regex constants.

### Pitfall 4: `predicate`-kind examples have no game action to execute
**What goes wrong:** `seven`'s examples (`isSet([5,5,5])`, `isRun([5,6,7])`) are definition
illustrations, not state→action→state transitions. A translation subagent asked to produce a
"runnable test" for one of these cannot write `game.doAction(...)`; it must call a pure
predicate/helper function on the engine or game class directly (if one is exported) — or, if no
such function is exported, decision 7's `unexecutable` verdict is the only honest outcome.
**Why it happens:** `WorkedExample.kind` is `transition | predicate` (decision 3) precisely because
`seven` would have ZERO examples under a transition-only design (measured reality #3) — but a
translate-example.md contract that only knows how to emit `game.doAction(...)` test bodies will
silently mishandle every `predicate` example, either fabricating a nonexistent API call or
defaulting to `unexecutable` for cases that actually ARE executable via a direct function call.
**How to avoid:** The translation contract must explicitly branch on `kind`, and for `predicate`
must be told it may call an exported pure function directly (not necessarily an `Action`) — cite
the real generated project's exported game-class API surface rather than assuming a uniform
action-execution shape for both kinds.
**Warning signs:** Every `predicate`-kind example in the pre-registered corpus (decision 13) coming
back `unexecutable` uniformly — decision 17's precedent (a uniform result is a real finding, not
success) applies here directly: 100% `unexecutable` on `predicate` kind would mean the translation
contract structurally cannot handle that kind, not that `seven`'s API genuinely lacks the hooks.

### Pitfall 5: n≈6 corpus makes "did this work?" nearly unmeasurable — a criterion that cannot pass
**What goes wrong:** Measured reality #3 puts the total corpus at ~5-6 examples across all three
games. Any percentage-based success bar (decision 16 already forbids this explicitly) or any bar
requiring, say, "at least 3 of 3 `transition` examples corroborate" risks being unsatisfiable by
construction if `one-two-punch`'s 2 Punch Examples are the ONLY clean `transition` fixtures in the
whole corpus (per CONTEXT's own Specific Ideas) — a single flaky dispatch or a single legitimate
`unexecutable` verdict on either of those 2 examples could make a 2-of-2 or 3-of-3 bar fail forever,
mirroring exactly the CHECK-04 determinism-gate trap (177-20 through 177-22, four full runs failing
an unsatisfiable criterion) that decision 14 was written to prevent.
**Why it happens:** Small-n proof corpora make any "X out of Y" threshold statistically fragile;
decision 14's gate exists precisely because this milestone already burned 4 measurement runs on
one such criterion.
**How to avoid:** Apply decision 14's "could this ever pass?" check explicitly, in writing, to
every proposed pre-registration criterion before committing it (decision 13) — per-example named
outcomes (as decision 16 requires: raw counts, per-game breakdown, never a percentage) rather than
an aggregate pass/fail bar over the whole n≈6 corpus.
**Warning signs:** Any pre-registration document phrasing a criterion as "N of M examples must
X" where M ≤ 3 for a single game.

### Pitfall 6: Generated test code executing in a game repo without sandboxing
**What goes wrong:** `build/test.md`'s new step and CHECK-06's replay step both EXECUTE
LLM-translated test code against a real game's real test runner (`vitest run`, per
`one-two-punch/package.json`'s `"test": "vitest run"`). A translation subagent's output is
model-generated code; running it directly against a live reference-game checkout without the
established `cp -R` staging discipline (decision 18) risks writing/executing arbitrary code in a
directory this milestone has repeatedly proven must stay byte-identical pre/post-proof.
**Why it happens:** Every prior CHECK-0x proof in this milestone only ever READS slices and WRITES
to a narrow ledger path (`rulebook/.derive-recheck/`, etc.) — this is the FIRST check in the
milestone whose correct operation requires writing and then EXECUTING arbitrary generated code
inside the target project's own test directory (`tests/*.test.ts` per `one-two-punch`'s existing
convention) and its own `node_modules` (including `boardsmith`, symlinked per `CLAUDE.md`).
**How to avoid:** Proof work must run on `cp -R` copies (decision 18 already requires this
generally); additionally, the plan should specify running the generated test file through the
copy's OWN `vitest run <path-to-generated-file>` (never `eval`/`new Function` in-process) so a
malformed or hostile generation fails as an ordinary test failure, never as an uncontained
process action. `boardsmith lint`'s sandbox rules (`no-network`, `no-filesystem`, `no-eval`, etc. —
already the hard gate in `build/test.md` step 2) apply to chunk code, not test code; there is no
existing sandbox scan for GENERATED TEST files themselves — flag as an explicit open question for
the plan, not an already-solved case.
**Warning signs:** A generated test importing anything outside the game project's own dependency
tree, or writing outside `tests/`.

## Code Examples

### Ledger choke-point constructor (verbatim pattern to mirror)
```typescript
// Source: src/cli/commands/verify-derive-recheck.ts:205-323 (createDeriveVerdictRecord)
// Copy this shape for createExampleVerdictRecord: validate verdict against frozen enum, require
// non-empty reasoning, require both-sides-verbatim fields for a "disagrees"-shaped verdict,
// reject fence-marker injection in every free-prose field, require named reason for the
// unexecutable-equivalent terminal verdict.
```

### Atomic upsert-append (verbatim pattern to mirror)
```typescript
// Source: src/cli/commands/verify-derive-recheck.ts:842-852 (recordDeriveVerdict)
export async function recordExampleVerdict(projectDir: string, record: ExampleVerdictRecord) {
  const existing = await readExampleVerdicts(projectDir);
  const merged = [
    ...existing.filter((r) => exampleVerdictKey(r) !== exampleVerdictKey(record)),
    record,
  ];
  return replaceExampleVerdicts(projectDir, merged);
}
```

### CLI registration pattern (verbatim pattern to mirror)
```typescript
// Source: src/cli/cli.ts:421-445 (verify-derive-recheck / verify-derive-record registration)
program
  .command('verify-example-replay')
  .description('...(read-only, project-level, source-free, machine-readable)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(verifyExampleReplayCommand);

program
  .command('verify-example-record')
  .description("Record one worked example's replay verdict, atomically upserted (ONLY write surface)")
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .requiredOption('--example-id <id>', '...')
  // ... no --run-id, no --force/--skip/--overwrite (mirrors verify-derive-record exactly)
  .action(verifyExampleRecordCommand);
```

### Dispatch-rejection handshake block (verbatim pattern to copy into both new subagent contracts)
```markdown
<!-- Source: src/cli/slash-command/bs/verify/enumerate-facts.md:25-46 -->
## FIRST: validate your dispatch prompt
**If you were dispatched as a subagent: before reading anything, check that the prompt you were
dispatched with contains the exact token `BS-EXTRACT-EXAMPLE-V1`.**
If it does not, STOP immediately. Read nothing. Return exactly:
`DISPATCH REJECTED — missing BS-EXTRACT-EXAMPLE-V1 token. ...`
```

### QuoteVerifiedProvenance usage (the exact API decision 12 needs)
```typescript
// Source: src/cli/commands/verify-enumerate.ts:1013-1097
const provenance = await QuoteVerifiedProvenance.obtain(projectDir); // null if no full-scope source
if (!provenance || !provenance.covers(claim.slicePath)) {
  // downgrade to lower-confidence finding — never a confident accusation against the code
}
```

### `claude -p` dispatch mechanism (real, working, reusable as-is)
```javascript
// Source: .planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/dispatch-enum.mjs
import { execFileSync } from 'node:child_process';
const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
const out = execFileSync('claude', args, { maxBuffer: 1024 * 1024 * 64, timeout: 300000, encoding: 'utf8' });
// prompt = contract file content (verbatim) + dispatch payload (pointer block, incl. token),
// concatenated with clear === CONTRACT === / === DISPATCH PAYLOAD === delimiters.
// Models used across 177: explicit `claude-opus-5`, `claude-haiku-4-5-20251001`,
// `claude-sonnet-5` — always a real subprocess, never native Task/Agent tool dispatch
// (this environment exposes no such tool, per 173-PROOF.md §6's standing precedent).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| CHECK-04 per-line blind re-derivation (hide the target, derive blind, compare) | Dual enumeration + reconciliation (list everything, match two independent lists) | 177-EXPERIMENTS (2026-07-31), closed CHECK-04 | The retired design's ledger/CLI shape (`verify-derive-recheck.ts`) is still the right plumbing to copy; its judgment MECHANISM is not applicable to CHECK-06's different problem |
| `quoteLinesOnly`'s deny-list of annotation prefixes | Proposed (WR-07, still open): allow-list of quotable content | Deferred 177-08, still open at Phase 178's start | Directly relevant to decision 2's family widening — closing it here avoids a 4th deny-list patch, per CONTEXT's own framing |
| `PRESENTATION_EXCLUSION_MARKERS` regex | Symmetric, nesting-tolerant qualifier group across all three markers | Fixed 177-08 (WR-09) | Not directly this phase's concern, but the pattern (single shared constant, symmetric across marker types) is the template for any new `Example`-marker exclusion logic |

**Deprecated/outdated:**
- The determinism gate (byte-identical classification across independent-model dispatches) —
  RETIRED as miscalibrated for CHECK-04 (177-22/closure). Decision 15 explicitly forbids
  re-importing this for CHECK-06; stability must be measured on executable-test pass/fail outcome,
  not spec-text identity.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `verify-enumerate.ts`'s independently-duplicated `ANY_ANNOTATION_LINE_RE` is the SAME logical site as `verify-derive-recheck.ts:426` (not a 5th distinct site requiring separate discovery) — confirmed by direct grep and file read, so this is HIGH confidence, not truly assumed. Listed here only because CONTEXT's decision 2 did not explicitly name it. | Pitfall 1 | Low — grep step in the pitfall write-up catches this regardless |
| A2 | No existing sandbox scan applies to GENERATED TEST files (only to chunk source code, per `build/test.md` step 2's explicit scope) | Pitfall 6 | Medium — if wrong, a plan step to "add sandbox scanning to generated tests" would be redundant; if right and unaddressed, generated test code has no automated safety net beyond ordinary `vitest run` failure |
| A3 | `predicate`-kind examples can be translated into direct function calls against exported game-class methods, not only `Action`-shaped `game.doAction()` calls, on the assumption `seven`'s engine exposes such pure functions somewhere in its public API (not verified by reading `seven`'s actual source in this research pass) | Pitfall 4 | Medium — if `seven`'s deck-composition/set/run logic is NOT separately exported (i.e. lives inline inside an Action's `.execute()` only), every `predicate`-kind example may be structurally `unexecutable`, which decision 17's honesty rule requires reporting plainly, not routing around |

**If this table is empty:** N/A — see above.

## Open Questions

1. **Should `quoteLinesOnly` be widened to include `Example`, or should CHECK-06 get its own
   payload function entirely (Pitfall 2)?**
   - What we know: CONTEXT frames this as live discretion (WR-07 closure vs. 4th deny-list
     widening), and flags the risk explicitly.
   - What's unclear: which choice is cheaper in practice — this research did not attempt the
     allow-list inversion to measure its blast radius against `verify-derive-recheck.test.ts`'s
     existing fixture-count pins.
   - Recommendation: default toward giving CHECK-06 its own, separate payload-construction
     function (reusing only `annotationBody`) rather than touching `quoteLinesOnly` at all — this
     is the lower-risk option since it leaves CHECK-04's closed, measured payload composition
     completely untouched. Revisit WR-07 as a genuinely separate, optional plan item.

2. **Does `seven`'s (or `one-two-punch`'s/`doom-machine`'s) generated game class actually export
   pure predicate functions (`isSet`, `isRun`) callable outside an Action's `.execute()` body?**
   - What we know: measured reality names `isSet([5,5,5])`/`isRun([5,6,7])` as the concrete
     `predicate`-kind examples.
   - What's unclear: whether these are free functions, static/instance methods on the game class,
     or logic inlined only inside action validators — this research did not read `seven`'s actual
     `src/` to confirm.
   - Recommendation: the plan's first task on the translate-example.md contract should include a
     concrete grep/read of `~/BoardSmithGames/seven/src/` for the actual exported shape before
     writing the contract's translation instructions, since this directly determines whether the
     translation subagent can honestly attempt a `predicate`-kind example at all.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `boardsmith` CLI in generated project | `build/test.md`'s existing steps AND the new example-test step | Yes | symlinked (`node_modules/boardsmith` → repo) via `npx boardsmith` | — |
| `vitest` in generated project | Executing generated example tests | Yes | `^2.0.0` (one-two-punch's `package.json`) | — |
| `claude` CLI subprocess | Extract/translate subagent dispatch | Yes, used throughout Phase 177 | — | native Task/Agent tool not exposed in this environment (standing, per 173-PROOF.md §6) |

**Missing dependencies with no fallback:** None identified.
**Missing dependencies with fallback:** `claude -p` subprocess dispatch is itself the established
fallback for native Task-tool dispatch, already in continuous use.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (BoardSmith repo) | Vitest, via `npm test` |
| Framework (generated reference games) | Vitest 2.x, via `npx vitest run` / `npm test` |
| Config file | BoardSmith: repo root `vitest.config.ts` (existing); generated games: each game's own `vite.config.ts` |
| Quick run command (BoardSmith unit tests for new modules) | `npx vitest run src/cli/commands/verify-example-replay.test.ts` |
| Full suite command | `npm test` (BoardSmith); `npx vitest run` inside each `cp -R` copy for proof |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TEST-01 | `build/test.md` generates a test file per chunk with ≥1 worked example | integration (real dispatch, `cp -R` copy) | `node dist/cli.js verify-example-record ...` then real `vitest run` on generated file | ❌ Wave 0 |
| TEST-01 | Re-running build for a chunk regenerates only that chunk's file (idempotent) | unit | `npx vitest run src/cli/commands/verify-example-replay.test.ts -t idempotent` | ❌ Wave 0 |
| CHECK-06 | Replay executes each example against real engine, reports mismatch as finding | integration (real dispatch, `cp -R` copy of a reference game) | `node dist/cli.js verify-example-replay --project <copy> --json` | ❌ Wave 0 |
| CHECK-06 | Mismatch gated on `QuoteVerifiedProvenance` | unit | `npx vitest run src/cli/commands/verify-example-replay.test.ts -t provenance` | ❌ Wave 0 |
| SC-3 (shared logic) | Both mechanisms call the same extract/translate module | unit (source-inspection, grep-gated) | Test asserting `build/test.md`'s generation code and `verify-example-replay.ts` both import from `example-derivation.ts` | ❌ Wave 0 |
| Decision 4 (`example-inconsistent`) | `seven`'s Run example (text vs. image contradiction) never becomes a test | integration (real dispatch against `seven` `cp -R` copy) | Real dispatch of `extract-example.md` against `seven/rulebook/01-definitions-and-components.md:6,12` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** unit tests for the new module's pure functions (payload construction,
  choke-point validator, ledger upsert)
- **Per wave merge:** real `claude -p` dispatch against `cp -R` copies of all three reference games
  (decision 18), full `npm test`
- **Phase gate:** Full BoardSmith `npm test` green + at least one real generated test file executed
  successfully (or honestly `unexecutable`/`example-inconsistent`) via the target game's own
  `vitest run`, before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/cli/commands/verify-example-replay.test.ts` — covers TEST-01, CHECK-06 (unit-level: enum, choke-point, ledger upsert/read/orphan/stale detection, mirroring `verify-derive-recheck.test.ts`'s own test shape)
- [ ] `src/cli/commands/example-derivation.test.ts` — covers SC-3 (shared payload/spec-validation functions, imported by both call sites)
- [ ] `src/cli/slash-command/bs/verify.test.ts` — extend with new describe blocks pinning `extract-example.md`/`translate-example.md` handshake tokens, RETURN shapes, never-given lists (mirrors 177-04's `derive-recheck.md`/`derive-compare.md` pins)
- [ ] `src/cli/slash-command/bs/templates.test.ts` — installer leaf-probe additions for the two new contract files (mirrors `SHARED_LEAF_PROBES` extension pattern, `install-claude-command.ts:67`)
- [ ] Framework install: none — Vitest already present in both BoardSmith and every reference game

## Security Domain

Not applicable in the ASVS sense — this phase has no authentication, session, or network-facing
surface. The one security-adjacent concern (executing LLM-generated test code) is covered under
Common Pitfalls #6 (sandboxing generated test execution) rather than as a formal ASVS category,
since BoardSmith explicitly forbids network/filesystem/eval access via `boardsmith lint`'s sandbox
rules for GAME code — but no equivalent scan currently exists for GENERATED TEST files, and this
research could not confirm the config value `security_enforcement`/`nyquist_validation` settings in
`.planning/config.json` without an explicit read; treat the omission of a `## Security Domain`
finding as a genuine gap for the plan to note rather than silently assumed-safe.

## Sources

### Primary (HIGH confidence — direct file reads of the real, current repo)
- `/Users/jtsmith/BoardSmith/src/cli/commands/verify-derive-recheck.ts` (full file, both offsets) — ledger/CLI pairing shape
- `/Users/jtsmith/BoardSmith/src/cli/cli.ts:396-460` — CHECK-04 command registration block
- `/Users/jtsmith/BoardSmith/src/cli/commands/verify-classify.ts:90-170` — `PRESENTATION_EXCLUSION_MARKERS`, `isPresentationLine`, `ruleBearingLines`
- `/Users/jtsmith/BoardSmith/src/cli/commands/verify-enumerate.ts` (headers, `QuoteVerifiedProvenance` class body 994-1250) — dual-enumeration replacement design, provenance guard
- `/Users/jtsmith/BoardSmith/src/cli/commands/ingest-archive.ts` (grep) — `DERIVED_LINE_RE` shared import, relabelling logic
- `/Users/jtsmith/BoardSmith/src/cli/commands/chunk-provenance.ts` (grep) — `resolveCitedSlices`, cited-slice parsing
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/build/test.md` (full file) — the 7-step ordered sequence, insertion point
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/verify/enumerate-facts.md` (full file) — handshake/dispatch-rejection contract template
- `/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/verify-game.md` (grep) — Step 7 CHECK-04 wiring, confirms it references the RETIRED design
- `~/BoardSmithGames/one-two-punch/package.json`, `tests/*.test.ts` listing, `node_modules/boardsmith` symlink check — generated project structure, test runner, CLI availability
- `.planning/phases/177-derived-line-re-derivation/177-22-MEASUREMENT/dispatch-enum.mjs` — real `claude -p` dispatch mechanism
- `.planning/phases/178-worked-example-tests/178-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` (Phase 177 entries), `./CLAUDE.md`, `.planning/phases/177-derived-line-re-derivation/177-CONTEXT.md` — full read per task instructions

### Secondary (MEDIUM confidence)
- None used — every claim traces to a direct file read in this session.

### Tertiary (LOW confidence)
- A3 (predicate-kind translatability) — not independently verified against `seven`'s actual `src/` in this research pass; flagged in Assumptions Log and Open Questions.

## Metadata

**Confidence breakdown:**
- Standard stack (no new deps): HIGH — nothing to verify externally
- Architecture (ledger/CLI mirroring, shared derivation module): HIGH — every pattern cited is a
  direct read of the exact file/line range to mirror
- Pitfalls: HIGH for Pitfalls 1-3, 5-6 (directly measured from repo state); MEDIUM for Pitfall 4
  (depends on unverified `seven` source shape, see A3/Open Question 2)

**Research date:** 2026-07-31
**Valid until:** Should be re-checked if `verify-game.md` Step 7 is migrated to the dual-enumeration
design before this phase executes (would change which module CONTEXT decision 9 actually points
at) — otherwise stable for the milestone's remaining duration (~7-14 days estimated).
</content>
