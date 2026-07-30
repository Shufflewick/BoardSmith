# Phase 176: Stale-Chunk Repair - Research

**Researched:** 2026-07-30
**Domain:** CLI (TypeScript) + Claude-Code skill-text — reusing existing build-pipeline audit/repair
mechanisms from a verify-side caller
**Confidence:** HIGH (mechanism reuse, disk-state facts, ruling corpus) / MEDIUM (round-bound
interaction with already-closed chunks — see Open Questions)

## Summary

Phase 176 does not build a new audit or repair mechanism. `src/cli/slash-command/bs/build/audit.md`
and `build/repair.md` already exist, are already parameterized by slice paths (not build-context
literals), and their dispatch templates, findings-ledger persistence, and round-bound logic can be
invoked unchanged from a verify-side caller — confirmed by direct inspection, not assumption. The
"composite source of truth" rule (`RULINGS.md` alongside raw slices) is already baked into all three
lens templates. The genuinely new work is: (1) a ruling re-validation command that dispatches a
judgment subagent per `RULINGS.md` entry against the fresh staged transcription and records one of
four verdicts, respecting the narrow, already-measured supersession corpus; and (2) a thin
verify-side orchestration layer that resolves "stale chunk" → "which staged slice paths" → dispatch
the SAME three (or four) lenses → run the SAME repair loop → hand the result to Phase 175's
already-built `computeRepairGate`/`verify-impact-apply`.

The sharpest planning risk this research surfaced is **not** hypothetical: 4 of the 12 real stale
chunks across both reference games (`best-seven-selection`, `table-and-draw` in `seven`;
`block`, `jab` in `one-two-punch`) **already have exactly 3 recorded `### Audit Round` entries** in
their CHUNK.md `## Findings Ledger` from their *original build*. `state-machine.md`'s "Repair Loop
Bound" says "Maximum 3 audit rounds per chunk" and 176-CONTEXT.md decision 8 says the bound is
inherited **unchanged**, with no looser verify-side variant. Whether that means "3 rounds total,
ever" (these 4 chunks get zero rounds and go straight to round-3 triage) or "3 rounds per audit
episode" (a verify-repair pass is a new episode with its own budget) is **not resolved** by
CONTEXT.md and materially changes what CHECK-02's proof subset (decision 15) can even attempt on 4
of the 12 available stale chunks. This must be a plan-time decision, not an execution-time
surprise.

Fresh staged transcription material for BOTH reference games — full-rulebook coverage, not just the
one delta each pass targeted — is already committed at
`.planning/phases/175-impact-map-repair-gating/175-FIXTURES/174-07-contradictory/staged/{seven,one-two-punch}/slices/`.
This is genuinely reusable as decision 9's required lens input for a real proof, with no
re-transcription needed. A second, larger, uncommitted copy of the same material (plus the mutated
PDF and node_modules-free game trees) sits in OS scratch at
`${TMPDIR}174-07-proof/{seven,one-two-punch}/rulebook/.verify/<run-id>/slices/` (323MB) and should
not be relied on — it is exactly the kind of material Phase 174 lost once and Phase 175 rescued
"just in time." The committed copy is authoritative; do not re-derive from scratch if the committed
copy suffices.

**Primary recommendation:** Build CHECK-01 as a small new command (`verify-ruling-recheck` or
similar) that reuses `parseRulings`'s heading-split logic (extended to expose raw per-ruling body
text — it does not today) to enumerate rulings, dispatches one fresh-context judgment subagent per
non-superseded ruling against the fresh staged transcription, and records one of
`still-needed | resolved-by-source | contradicted | undetermined`. Build CHECK-02 as a verify-side
dispatch layer that resolves each stale chunk's cited live slices to their staged counterparts (via
Phase 174's `pairSlices()`/`ChunkVerdict.pairIds`/`attributions[]`, already computed), then invokes
`build/audit.md`'s three lens templates and `build/repair.md`'s loop with slice paths substituted —
literally the same prompt text, new parameter values only. Resolve the round-bound-vs-already-closed
question explicitly before planning tasks around it.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ruling re-validation (CHECK-01) | CLI (`src/cli/commands/`) computing + fresh-context subagent judging | Skill text (dispatch prose) | Same split as every prior phase: CLI enumerates/records, subagent judges, skill formats. |
| Audit lens re-run (CHECK-02) | CLI (slice-path resolution, ledger recording) + Skill text (verbatim-reused dispatch templates) | Fresh-context subagent (the lens itself) | The lens templates already live in skill text (`build/audit.md`); this phase's CLI work is entirely "which slice paths / which code paths to substitute," never re-implementing the lens. |
| Repair loop (bounded, fix/refute) | Skill text (`build/repair.md`, cited not forked) | CLI (`## Findings Ledger` persistence — already a plain markdown append, no new command needed) | The loop is orchestration prose today, not a CLI command; Phase 176 adds no new mechanism here, only a verify-side entry point that dispatches into it. |
| Repair-gate disposition after code change | CLI (`computeRepairGate`, `verify-impact-apply` — Phase 175, already built) | — | Phase 176 does not rebuild this; it must re-invoke it AFTER repair completes, since repair is the event that can flip `driftState` from `clean` to `drifted` (see Pitfall 1). |
| Fresh staged transcription (composite source of truth input) | Filesystem (already-staged `rulebook/.verify/<run-id>/slices/`) | CLI (path resolution only) | Decision 9 — never re-derive from live slices; the run's own staged tree is the input, already produced by Phase 173/174's staging pipeline. |

## Standard Stack

### Core

No new external packages. This phase is 100% internal reuse:

| Component | Location | Purpose | Why Standard (for this phase) |
|-----------|----------|---------|-------------------------------|
| `parseRulings` | `src/cli/commands/build-manifest.ts:326` | Ruling enumeration + supersession parse | Existing, exact-signature match to decision 3/4's needs — see "Don't Hand-Roll" below for its precise gap. |
| `build/audit.md` dispatch templates | `src/cli/slash-command/bs/build/audit.md` | The three (four) lens prompts | Decision 6 mandates VERBATIM reuse; forking creates exactly the drift risk the phase goal exists to prevent. |
| `build/repair.md` loop | `src/cli/slash-command/bs/build/repair.md` | Fix/refute/triage, round-bound | Decision 8 mandates unchanged reuse. |
| `verify-classify.ts` (`pairSlices`, `ChunkVerdict.attributions`) | `src/cli/commands/verify-classify.ts` | Live-slice ↔ staged-slice mapping per stale chunk | Already computed by Phase 174; re-deriving pairing here would be a second pairing authority. |
| `verify-impact.ts` (`computeRepairGate`, `verifyImpactStatusCommand`) | `src/cli/commands/verify-impact.ts` | Post-repair disposition | Already built by Phase 175; Phase 176 is a consumer, not a builder, of this. |
| `verify-run.ts` ledger helpers | `src/cli/commands/verify-run.ts` | Atomic append, single ledger authority | 173-REVIEW.md CR-01's defect class — exactly one atomic write path must remain. |

**Installation:** none. No `npm install` for this phase.

**Version verification:** N/A — no external packages.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. All work is internal reuse of existing
BoardSmith CLI modules and skill-text files, plus fresh-context subagent dispatch (already an
established mechanism, no new package).

## Architecture Patterns

### System Architecture Diagram

```
/bs-verify-game Step 4 (Phase 175, existing)
        │
        ▼
verify-impact-status --json  ──────────────► ImpactMapEntry[] (stale chunks, pairIds, attributions)
        │
        │  (NEW — Phase 176 orchestration, "verify/repair-dispatch.md")
        ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ For each stale chunk (decision 5 — ONLY the stale set, never every chunk):│
│                                                                           │
│  1. Resolve cited live slice(s) → staged slice path(s)                  │
│     via ChunkVerdict.pairIds + the run's RUN.md classification record   │
│     (liveSlices[] / stagedSlices[] already recorded by Phase 174)        │
│                                                                           │
│  2. Dispatch build/audit.md's 3 lenses VERBATIM, {slicePaths} = staged   │
│     paths, {codeFilePaths} = chunk's Build Manifest files (existing)     │
│     + 4th design-review lens IF ui: touches|major (existing rule)        │
│                                                                           │
│  3. Append "### Audit Round N" to THIS chunk's own CHUNK.md              │
│     ## Findings Ledger (existing template section, existing chunks      │
│     already have this — round numbering CONTINUES from build-time)      │
│                                                                           │
│  4. Dispatch build/repair.md's fix/refute loop UNCHANGED, bounded by     │
│     state-machine.md "Repair Loop Bound" (max 3 rounds — SEE Pitfall 2   │
│     for chunks already AT 3 from their original build)                  │
│                                                                           │
│  5. Loop back to step 2 if repair produced a fix (same session group,   │
│     no handoff) until no new findings or round bound reached            │
└───────────────────────────────────────────────────────────────────────────┘
        │
        ▼  (repair may have changed code)
computeRepairGate + verify-impact-apply — RE-RUN, not reused from Step 4's
pre-repair snapshot (drift-check must see the POST-repair code state)
        │
        ▼
Chunk's Status flips to `built` (reopen-playtest) or stays `verified` with a
Re-verified stamp (close-without-replaytest) — Phase 175's existing mechanism

PARALLEL, INDEPENDENT (CHECK-01):
┌───────────────────────────────────────────────────────────────────────────┐
│ RULINGS.md (all ~62 entries, both games) — NEW ruling-recheck command    │
│                                                                           │
│  1. parseRulings (extended to expose raw body text) enumerates entries   │
│  2. Skip entries where supersededBy is set (decision 3 — not demanded    │
│     still-needed)                                                        │
│  3. Dispatch ONE fresh-context judgment subagent per remaining ruling,   │
│     reading: this ruling's full body + the fresh staged transcription   │
│     (never the live slices — same decision-9 rule as CHECK-02)          │
│  4. Subagent returns ONE of: still-needed | resolved-by-source |        │
│     contradicted | undetermined, plus reasoning text                    │
│  5. CLI records the verdict; orchestrator never reads a slice           │
└───────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/cli/commands/
├── verify-ruling-recheck.ts       # NEW — CHECK-01: enumerate + dispatch + record verdicts
├── verify-ruling-recheck.test.ts
├── verify-repair.ts               # NEW — CHECK-02: stale-chunk → staged-slice resolution,
│                                   #   round bookkeeping, re-invocation of computeRepairGate
├── verify-repair.test.ts
├── build-manifest.ts              # EXTEND — expose raw ruling body text alongside parseRulings
├── verify-classify.ts             # UNCHANGED — read-only consumer (pairIds, attributions)
└── verify-impact.ts               # UNCHANGED — computeRepairGate re-invoked, not modified

src/cli/slash-command/bs/verify/
├── ruling-recheck.md               # NEW — CHECK-01 skill text, dispatch prompt + verdict contract
├── repair-dispatch.md              # NEW — CHECK-02 skill text, delegates to build/audit.md and
│                                   #   build/repair.md BY REFERENCE, never copies their prose
└── adjudication-gate.md            # UNCHANGED (Phase 175)

src/cli/slash-command/bs/build/
├── audit.md                        # UNCHANGED — reused verbatim, parameterized by slice paths
└── repair.md                       # UNCHANGED — reused verbatim
```

### Pattern 1: Verbatim Template Reuse via Parameter Substitution Only

**What:** `build/audit.md`'s three dispatch templates take `{gameName}`, `{slug}`, `{slicePaths}`,
`{codeFilePaths}`, and (visibility lens) `{visibilityDeclarationText}` as their only variable
points. Everything else — the composite-source-of-truth framing, the no-`## Interpretation` rule,
the return contract — is fixed prose.

**When to use:** Every CHECK-02 dispatch. Confirmed by direct read of `build/audit.md` lines 50-108
(see `## Code Examples` below for exact excerpted text): nothing in the templates hardcodes "this is
a build pass" — the only build-specific framing lives OUTSIDE the templates, in the surrounding
file's prose (e.g. "Referenced by `build-chunk.md` Step 3"), which Phase 176 does not need to quote.

**Example (fidelity lens, verbatim from `src/cli/slash-command/bs/build/audit.md` lines 54-66):**
```
You are auditing built code for {gameName}, chunk "{slug}", for RULES FIDELITY. Read the
following rulebook slice(s): {slicePaths}. Also read RULINGS.md in this project — rulings
outrank the rulebook (state-machine.md "Rulings Outrank Rulebook"); the rulebook plus
RULINGS.md together form the composite source of truth. Do NOT read this chunk's CHUNK.md
"## Interpretation" section — you are checking the CODE against the RAW SOURCE, not against a
prior agent's summary of it.

Then read the built code at: {codeFilePaths}.

Return exactly: a list of { findingId, lens: 'fidelity', description, citation, severity } —
one entry per defect found (empty array if none).
```
For CHECK-02, `{slicePaths}` = the FRESH STAGED slice path(s) for this chunk (per decision 9), not
the live slice paths the original build used. This is the only substitution required to make the
composite-source-of-truth check against the post-drift rulebook instead of the pre-drift one.

### Pattern 2: Findings Ledger as the Cross-Episode Persistence Layer

**What:** `## Findings Ledger` in each chunk's own CHUNK.md is already a durable, append-only,
cold-resumable record populated by the ORIGINAL build's audit rounds. It is not a build-session-only
structure — it is a per-chunk lifetime record. A verify-repair pass appending to it is not a new
mechanism; it is the SAME mechanism, invoked again, later.

**When to use:** Every CHECK-02 round. Round numbering CONTINUES from wherever the chunk's build
left off (see Pitfall 2 for the load-bearing consequence of this).

### Anti-Patterns to Avoid

- **Forking the lens templates "just to add a verify-specific framing sentence."** Decision 6
  explicitly forbids this. If a verify-specific instruction seems necessary (e.g. "these slices are
  freshly staged, not live"), that instruction belongs in the surrounding orchestration file
  (`verify/repair-dispatch.md`), not injected into the lens prompt text itself — the prompt text is
  parameterized by WHICH paths, never by WHAT KIND of pass this is.
- **Building a second ruling parser for CHECK-01's body-text needs.** `parseRulings` already exists
  and already owns `### Ruling N` heading detection + supersession. Extend it (or add a sibling
  function using its identical heading-split logic) rather than writing a second `### Ruling (\d+)`
  regex — `175-03-SUMMARY.md` already grep-asserts there is exactly one such regex in the repo.
- **Treating Step 4's pre-repair `ImpactMapEntry.gate` as final.** It is a snapshot computed BEFORE
  repair runs. Repair (if it fixes code) can change `driftState`. Re-invoke
  `computeRepairGate`/`verify-impact-status` after the repair loop closes, not before.
- **A silent fallback to live slices if the fresh staged transcription is missing or incomplete.**
  Decision 10 requires an explicit SCOPE-LIMITED report, following PROV-02's precedent — never a
  quiet substitution.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rules-fidelity / visibility / undo checking | A new "verify-lens" prompt family | `build/audit.md`'s existing 3(+1) templates, parameterized | Decision 6; a forked lens is a lens that can silently disagree with the build pipeline's own trusted behavior. |
| Fix-or-refute round bookkeeping | A new repair-loop state machine | `build/repair.md`, cited not restated | Decision 8; a second bound is a second policy that can disagree with the first. |
| Ruling numbering / supersession detection | A second `### Ruling (\d+)` regex | `parseRulings` (`build-manifest.ts`), extended for body text | Grep-gated single-parser rule already established (175-03). |
| Live↔staged slice pairing | A new pairing algorithm keyed on filenames | `pairSlices()` / `ChunkVerdict.pairIds` (Phase 174, `verify-classify.ts`) | Already handles the real m:n fan-out (`seven`: 3 live → 6 staged); a filename-based re-pairing would silently disagree with the classifier's own grouping. |
| Code-movement detection for the repair gate | A new content-hash scheme | `drift-check` (Phase 172) via `computeRepairGate` | 175-CONTEXT.md decision 10 — one authority for "did this chunk's code move." |
| Atomic durable writes | `fs.writeFile` truncate-and-rewrite | `verify-run.ts`'s exported atomic helpers | 173-08 hardened this after CR-01 found the naive version was not crash-safe; a second write path reopens that exact defect class. |

**Key insight:** Every mechanism this phase needs already exists somewhere in the codebase except
one thing — a per-ruling verdict classifier subagent contract (CHECK-01's core judgment) and the
thin glue that maps "stale chunk" to "staged slice path" (CHECK-02's core glue). Everything else is
citation, not construction.

## Common Pitfalls

### Pitfall 1: Trusting the Pre-Repair Impact-Map Snapshot for Gate Disposition

**What goes wrong:** `verifyImpactStatusCommand` (Phase 175) computes `ImpactMapEntry.gate` from
`drift-check`'s CURRENT state at the moment it is called — which, at Step 4 of `/bs-verify-game`
(before any repair has happened), reflects the code as it existed BEFORE this pass touched anything.
If repair changes code, that snapshot is stale the instant repair finishes.

**Why it happens:** The impact map and the repair-gate computation are the same pure function
composition (`buildImpactMapEntry` → `computeRepairGate`), called once, at one point in the
pipeline. Nothing re-invalidates it automatically when code changes later in the SAME session.

**How to avoid:** Phase 176's plan must explicitly re-run `verify-impact-status` (or equivalent)
AFTER the repair loop closes for a chunk, before reporting or acting on that chunk's final
disposition (`reopen-playtest` vs `close-without-replaytest`).

**Warning signs:** A proof or test that computes the gate disposition once, before dispatching any
repair, and reports it as final.

### Pitfall 2: The Repair-Loop Round Bound Colliding With Already-Closed Build History

**What goes wrong:** 4 of the 12 real stale chunks across both reference games —
`best-seven-selection` (3 rounds), `table-and-draw` (3 rounds) in `seven`; `block` (3 rounds),
`jab` (3 rounds) in `one-two-punch` — already have exactly 3 recorded `### Audit Round` entries in
their `## Findings Ledger`, from their ORIGINAL build. `state-machine.md`'s "Repair Loop Bound" says
"Maximum 3 audit rounds per chunk" with no qualifier distinguishing "per build" from "per chunk,
lifetime." 176-CONTEXT.md decision 8 requires the SAME bound, unchanged, with "no looser bound."

Read literally and lifetime-scoped, these 4 chunks have ZERO audit rounds remaining and must be
routed straight to round-3 user triage the instant CHECK-02 dispatches its first lens against them —
without ever actually running a lens. That would make roughly a third of the real stale-chunk
population untestable by the mechanism CHECK-02 exists to run.

**Why it happens:** `state-machine.md`'s Repair Loop Bound section was written for the single-episode
build-time audit/repair loop and was never written with a second, later, independent verify-episode
in mind. Decision 8's "inherited unchanged" resolves WHICH loop mechanism to use; it does not
resolve WHETHER the round counter is per-episode or per-chunk-lifetime.

**How to avoid:** This is a plan-time decision, not an implementation detail to improvise mid-plan.
Two defensible readings exist:
- **Per-episode (recommended reading, pending user confirmation):** a verify-repair pass is a
  distinct episode from the original build; its own `### Audit Round` numbering for THIS pass
  starts fresh (e.g. a sub-heading or a new episode marker distinguishes "build-time round 3" from
  "verify-repair round 1"), and the max-3 bound applies within this episode. This preserves the
  ability to actually run CHECK-02 against these 4 real chunks.
- **Lifetime (literal reading of the bound, unmodified):** these 4 chunks get zero verify-repair
  audit rounds and go straight to round-3 triage, reported honestly as such — not as a defect in
  the mechanism, but as a real, measured consequence of a chunk having already exhausted its
  budget during build.

Because CONTEXT.md's decision 8 explicitly says "A verify pass does not get its own looser bound,"
the LIFETIME reading may in fact be the one the user intends — but this needs to be surfaced and
confirmed before planning tasks around it, not assumed either way. **Flag this explicitly at
plan time or discuss-phase**, since it changes whether decision 15's "real measured subset" can
include these 4 chunks in a normal lens-dispatch proof at all.

**Warning signs:** A plan or task that assumes every stale chunk starts CHECK-02 at "round 1" without
checking each chunk's actual `## Findings Ledger` round count first.

### Pitfall 3: `parseRulings` Does Not Expose Per-Ruling Body Text

**What goes wrong:** CHECK-01's judgment subagent needs each ruling's full Decision/Citation/
Rationale text to compare against the fresh transcription. `parseRulings` (`build-manifest.ts:326`)
returns only `{ number, supersededBy?, unparsedSupersession[] }` — it computes body boundaries
internally (`bodyStart`/`bodyEnd` per heading) to scan for supersede verbs, but never returns the
body text itself.

**Why it happens:** The function was built for Phase 172/175's supersession-parsing need only; body
text was never a required output for those phases.

**How to avoid:** Extend `parseRulings` (or add a sibling function reusing its exact heading-split
logic — same `### Ruling (\d+)` regex, no second copy) to also return each ruling's raw body text.
This is additive, not a behavior change to the existing exported shape (or export a second
narrowly-scoped helper if widening the existing interface risks the callers that already destructure
it — check `trace-check.ts`'s usage before choosing).

**Warning signs:** A plan that has the CHECK-01 dispatcher re-slice `RULINGS.md` on its own with a
second regex "just for this one field."

### Pitfall 4: Absence-of-Source Is Not Mechanically Detectable — It Is a Judgment Call, By Design

**What goes wrong:** It is tempting to look for a machine-checkable signal (a keyword, a structured
tag) that flags "this ruling cites a source absence" so decision 4's rule can be applied
mechanically. There isn't one, and building one is the wrong layer for this.

**What was actually measured:** `seven`'s Ruling 1's Citation field reads, verbatim: *"The rulebook
names this card and depends on it for all scoring, but never reproduces its face — see
`rulebook/INDEX.md` 'Open Rules Gaps'."* `rulebook/INDEX.md`'s `## Open Rules Gaps` section (item 1)
independently names the exact same gap ("'Ways to Score' card contents — the card is dealt to every
player at setup but its face is never reproduced or described"). This is a REAL, PROSE, cross-file
corroboration — but it is prose-to-prose, with no structured ID linking them. A keyword scan for
"never reproduces"/"absent from"/"n/a — entirely silent" would catch this specific case and
Ruling 3's "n/a — the rulebook is entirely silent" but is not a general solution and is exactly the
kind of brittle heuristic 174-CONTEXT.md's decision-19 discipline warns against inventing without
measurement.

**How to avoid:** Per 176-CONTEXT.md decision 2 ("judgment lives in a subagent; the CLI enumerates
and records"), this is squarely the judgment subagent's job: it reads the ruling's full body AND the
fresh transcription and is instructed to recognize when the ruling's own Citation field asserts an
absence, in which case a non-`still-needed` verdict is wrong unless the fresh transcription now
actually contains the previously-absent content. Do not build a mechanical absence-detector in the
CLI layer; the CLI's job stays enumerate-and-record.

**Warning signs:** A CHECK-01 implementation with a regex list of "absence phrases" gating verdict
eligibility in code, rather than in the subagent's dispatch prompt.

### Pitfall 5: OS Scratch Material Is At-Risk; the Committed Copy Is Authoritative

**What goes wrong:** A large, complete, real fresh-staged-transcription tree for both reference
games exists RIGHT NOW at `${TMPDIR}174-07-proof/{seven,one-two-punch}/rulebook/.verify/<run-id>/`
(323MB total, uncommitted). This is exactly the kind of material Phase 174's research found ZERO of
(already cleaned) and Phase 175's research rescued "just in time" into
`175-FIXTURES/174-07-contradictory/staged/`. Relying on the TMPDIR copy for Phase 176's plans/proof
without checking it is still there at execution time repeats a now-twice-documented failure mode.

**How to avoid:** Use the COMMITTED copy at
`.planning/phases/175-impact-map-repair-gating/175-FIXTURES/174-07-contradictory/staged/{seven,one-two-punch}/slices/`
as the primary source for any CHECK-02 proof dispatch. It is confirmed (by direct listing, this
research pass) to cover the FULL live rulebook of both games — not just the single delta each
originating pass targeted — because staging fans out per-page-range, not per-finding: `seven`'s
staged set (6 files) covers all 3 of its live rule slices; `one-two-punch`'s staged set (7 files,
plus a `superseded/` subfolder) covers both of its live rule slices. This is sufficient breadth to
audit ANY of the 12 stale chunks against, not merely the 2 chunks whose original classification
produced the sharper/contradictory finding.

**Warning signs:** A plan step that re-runs `/bs-ingest-rules`/`verify-run-init` "just to be safe"
before checking whether the committed fixture already covers what's needed.

## Code Examples

### CHECK-01: `parseRulings`'s existing supersession contract (reuse, extend for body text)

```typescript
// Source: src/cli/commands/build-manifest.ts:284-378 (existing, verified by direct read)
export interface ParsedRuling {
  number: number;
  /** Set only for the explicit supersede verbs, direction-resolved. */
  supersededBy?: number;
  /** Supersede-verb sentences whose target number or direction could not be resolved. */
  unparsedSupersession: string[];
}

export function parseRulings(rulingsText: string): ParsedRuling[] {
  // ... heading-split logic, bodyStart/bodyEnd computed per `### Ruling N` heading ...
  // Only TWO explicit verb shapes are read as a chain — measured against the real 62-ruling
  // corpus (172-RESEARCH.md): "supersede[sd]? by ruling N" (backward) and
  // "supersedes ruling N" (forward). Everything else with a supersede verb present but
  // unresolved lands in unparsedSupersession, reported not assumed.
}
```

CHECK-01 needs a sibling (or an additive widening) that ALSO returns each entry's raw body text —
`bodyStart`/`bodyEnd` are already computed internally per heading; only the return needs widening.

### CHECK-02: exact staged/live pairing data already available per stale chunk

```typescript
// Source: src/cli/commands/verify-classify.ts:881-894 (existing ChunkVerdict shape)
export interface ChunkVerdict {
  slug: string;
  citedLiveSlices: string[];
  pairIds: string[];           // <- join key into the run's classification records
  ruleDelta: RuleDelta;
  stale: boolean;
  attributions: Array<{
    pairId: string;
    liveSlice: string;
    rung: CitationAnchorRung;  // 'quoted-fragment' | 'cited-page' | 'slice-fallback'
    attributed: boolean;
    reason: string;
  }>;
}
```

The run's own ledger (`RUN.md`, e.g.
`175-FIXTURES/174-07-contradictory/staged/seven/RUN.md`) already records, per classification line,
`"liveSlices":[...]` and `"stagedSlices":[...]` for the pairId — this is the concrete lookup table
CHECK-02 needs to turn a stale chunk's `pairIds`/`citedLiveSlices` into the staged file paths
`{slicePaths}` should point at.

### Real ruling text — SC-3's exact target (verbatim, for the classifier's evaluation)

```
### Ruling 1
- Decision: The "Ways to Score" card — absent from the rulebook PDF — is a table of Points / Method,
  scoring a hand of exactly 7 cards: [... full table ...]
  Each "+1" bonus point card is worth 1 point if still in the player's hand at the end of the game.
- Citation interpreted or overridden: p.1, Setup ("Ways to Score" card) and p.1, Game End ("Each
  player scores their best hand of 7 cards, and adds any bonus point cards (even beyond the hand of
  7) to their score."). The rulebook names this card and depends on it for all scoring, but never
  reproduces its face — see `rulebook/INDEX.md` "Open Rules Gaps".
- Rationale: Supplied verbatim by the designer at ingest. Without it the game has no scoring rules at
  all and cannot reach an outcome. This ruling is the sole authority for scoring values; nothing in
  the build may infer a scoring table from any other source.
```
(`~/BoardSmithGames/seven/RULINGS.md`, read directly this pass.) A fresh transcription of the same
PDF will still not contain this card's face — the correct verdict is `still-needed`, and per
decision 4 the reasoning (not just the label) must be recorded.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Audit/repair as a build-only mechanism | Audit/repair as a mechanism invokable from either a build session or a verify session, unchanged | This phase (176) is the first to invoke it from verify | The round-bound/findings-ledger design must now be understood as per-chunk-lifetime infrastructure, not per-build-session infrastructure — see Pitfall 2. |
| `RULINGS.md` as 100% human/skill-authored, zero code writes (true as of Phase 174) | Phase 175 made the FIRST machine write into it (`appendRuling`, resolved contradictions) | Phase 175 | CHECK-01 is a READ-only consumer of `RULINGS.md` (it records verdicts elsewhere, in a new ledger/record — it does not itself write ruling text), consistent with "the checks report; nothing in this phase fixes reference-game content" (decision 16). |

**Deprecated/outdated:** none — this phase does not deprecate anything; it is additive reuse.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The Repair Loop Bound (max 3 rounds) should be read as PER VERIFY-EPISODE, not per-chunk-lifetime, allowing the 4 already-at-3 chunks a fresh budget for CHECK-02 | Pitfall 2 | If the user actually intends the lifetime reading, a plan built around the per-episode reading would need chunk-affecting rework (round-numbering scheme) mid-execution. **This should be confirmed by the user or resolved explicitly at plan time, not defaulted silently either way.** |
| A2 | Extending `parseRulings`'s return shape to add body text is safe and non-breaking for its existing callers (`trace-check.ts`) | Pitfall 3 | Low risk — additive field, but must verify `trace-check.ts`'s exact destructuring at implementation time to avoid an accidental behavior change. |
| A3 | `computeRepairGate`/`verify-impact-status` are safe to invoke a SECOND time (post-repair) without side effects beyond re-reading current state | Architecture Pattern diagram; Pitfall 1 | If either command has a hidden write-once assumption not surfaced in this research, a second invocation could misbehave. Direct code reading here found both to be pure/read compositions with no apparent idempotency hazard, but this was not unit-tested during this research pass. |

**If empty:** not applicable — see table above.

## Open Questions

1. **Does the Repair Loop Bound reset per verify-episode, or is it a per-chunk lifetime cap shared
   with the original build?**
   - What we know: 4 of 12 real stale chunks across both games already carry exactly 3 recorded
     `### Audit Round` entries from their original build (`best-seven-selection`, `table-and-draw`,
     `block`, `jab` — confirmed by direct grep of both games' real CHUNK.md files this pass).
   - What's unclear: CONTEXT.md decision 8 says the bound is inherited unchanged with "no looser
     bound," which reads as supporting the lifetime interpretation, but it was written without this
     specific collision in view (Phase 175's research, which produced the stale sets, did not
     cross-reference audit-round history against them).
   - Recommendation: Surface this explicitly before planning tasks; do not assume either reading.
     If lifetime, decision 15's proof subset should deliberately include at least one of these 4
     chunks to demonstrate (honestly) that they go straight to round-3 triage rather than silently
     excluding them from the subset to avoid the awkward case.

2. **Where does `verify-impact-status`'s classification data (quoted pass-1/pass-2 text) get
   surfaced to the lens dispatch, given `ImpactMapEntry` carries `attributions[]` (pairId/liveSlice/
   rung/reason) but not the quoted delta text itself?**
   - What we know: The quoted text lives in the run's ledger (`RUN.md`'s `classification` records,
     keyed by `pairId`), not in `ImpactMapEntry`.
   - What's unclear: Whether CHECK-02's dispatch needs to surface "what changed" to the lens
     (beyond just pointing it at the staged slice, which already contains the new text) — the
     fidelity lens template as written only needs `{slicePaths}`/`{codeFilePaths}`, so this may be a
     non-issue for the lens itself, but could matter for CHECK-01's absence/contradiction reasoning
     or for human-readable reporting.
   - Recommendation: Confirm at plan time whether any new command needs to join `ImpactMapEntry` to
     its governing classification record by `pairId`, or whether the lens's own read of the staged
     slice is sufficient (likely sufficient, per the templates' actual parameter list).

3. **Does the round-3 user-triage step (already defined in `build/repair.md`) need any wording
   adjustment for a verify-context user prompt** (e.g. referencing "this chunk was already verified"
   rather than assuming a mid-build chunk)?
   - What we know: `build/repair.md`'s triage presents three options in "designer register" — none
     of the wording is build-specific in an obviously-false way for a verify context.
   - What's unclear: Whether citing it unchanged (decision 8) extends to literally dispatching the
     SAME triage prompt text, or whether a verify-side wrapper file should add ONE sentence of
     framing (e.g. "this finding surfaced during a rules re-verification pass") before presenting
     the same three options.
   - Recommendation: Lean toward citing unchanged per decision 8's spirit; add framing only in the
     surrounding orchestration file if the triage prompt is confirmed to read confusingly in a
     verify context during actual proof dispatch.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI (subprocess dispatch) | Fresh-context lens/judgment subagent dispatch | ✓ | 2.1.220 | — |
| `node` | CLI commands, vitest | ✓ | v22.21.1 | — |
| `git` | Diff-based drift-check, proof discipline (cp -R copies) | ✓ | 2.50.1 | — |
| `vitest` (project devDependency) | Test suite | ✓ | ^2.1.0 (package.json) | — |
| Committed staged-transcription fixtures | CHECK-02 proof input (decision 9) | ✓ | `.planning/phases/175-.../175-FIXTURES/174-07-contradictory/staged/` | Re-run `/bs-verify-game` Steps 1-2 against `cp -R` copies if the committed fixture is found insufficient (unlikely — see Pitfall 5) |
| `~/BoardSmithGames/seven` at pinned commit | SC-3 proof, ruling re-validation proof | ✓ | `a03f38d4792af9dfc7c798be69686fc3230f54dd` (confirmed via `git rev-parse HEAD` this pass; unrelated dirty state present — `.boardsmith/runtime-bundle.mjs`/`runtime-entry.ts` deleted locally, pre-existing pattern, not from this phase) | — |
| `~/BoardSmithGames/one-two-punch` at pinned commit | Same | ✓ | `7e69471bd8980a854f3e351f2f486e1fb6f712b9` | — |

**Missing dependencies with no fallback:** none.

**Missing dependencies with fallback:** none — all required tooling is present.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 |
| Config file | `vitest.config.ts` (project root, pre-existing) |
| Quick run command | `npx vitest run src/cli/commands/verify-ruling-recheck.test.ts src/cli/commands/verify-repair.test.ts` (once these files exist) |
| Full suite command | `npm test` (currently 3826/3826 green per STATE.md) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHECK-01 | `parseRulings` extension exposes raw ruling body text without breaking existing callers | unit | `npx vitest run src/cli/commands/build-manifest.test.ts` | ❌ Wave 0 — new test cases needed in existing file |
| CHECK-01 | Ruling verdict enum is frozen-array + derived-type + pinning test (`still-needed \| resolved-by-source \| contradicted \| undetermined`) | unit | `npx vitest run src/cli/commands/verify-ruling-recheck.test.ts` | ❌ Wave 0 |
| CHECK-01 | Superseded rulings are excluded from re-validation (decision 3) | unit | same file | ❌ Wave 0 |
| CHECK-01 | SC-3: `seven` Ruling 1 verdicts `still-needed` with recorded reasoning against a real fresh transcription | integration (real subagent dispatch against committed fixture) | manual/scripted `claude -p` dispatch, recorded in `176-PROOF.md` | ❌ — proof-only, not a repeatable CI assertion (subagent judgment) |
| CHECK-02 | Stale-chunk → staged-slice-path resolution is correct for real m:n pairing (`seven` 3 live → 6 staged) | unit | `npx vitest run src/cli/commands/verify-repair.test.ts` | ❌ Wave 0 |
| CHECK-02 | Lens dispatch templates are read VERBATIM from `build/audit.md` (no forked copy exists) | unit (grep-style drift guard, matching 174/175's lexicon-pin pattern) | `npx vitest run src/cli/slash-command/bs/verify.test.ts` | ❌ Wave 0 — extend existing `verify.test.ts` |
| CHECK-02 | Post-repair `computeRepairGate` re-invocation reflects code changes made during repair | unit | `npx vitest run src/cli/commands/verify-impact.test.ts` (extend) | ❌ Wave 0 — new cases in existing file |
| CHECK-02 | Real lens dispatch against a real stale chunk + real staged fixture surfaces real findings | integration (real subagent dispatch) | manual/scripted `claude -p` dispatch, recorded in `176-PROOF.md` | ❌ — proof-only |

### Sampling Rate

- **Per task commit:** the relevant unit test file(s) above.
- **Per wave merge:** `npm test` (full suite).
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus `176-PROOF.md` documenting the
  real subagent-dispatch proofs (SC-3, the real-subset lens run, the full ~62-ruling re-validation)
  that cannot be expressed as a deterministic vitest assertion.

### Wave 0 Gaps

- [ ] `src/cli/commands/verify-ruling-recheck.test.ts` — new file, covers CHECK-01's enumeration/
      recording mechanics.
- [ ] `src/cli/commands/verify-repair.test.ts` — new file, covers CHECK-02's slice-resolution and
      post-repair gate re-invocation mechanics.
- [ ] `build-manifest.test.ts` — extend with cases for the widened `parseRulings` (or new sibling
      function) body-text output.
- [ ] `verify.test.ts` — extend with a drift guard proving `build/audit.md`/`build/repair.md` are
      never forked (grep for a second copy of their template text or step names, matching the
      existing lexicon-pin pattern from Phases 174/175).
- [ ] Framework install: none — vitest already present, no new install needed.

## Security Domain

No `security_enforcement: false` override found in `.planning/config.json` context provided; this
phase touches no network input, no auth, no session boundary, and no cryptography. It reads local
files (`RULINGS.md`, staged rulebook slices, CHUNK.md) already trusted within the existing bs-
project trust boundary and dispatches fresh-context subagents via the existing `claude -p`
subprocess mechanism, unchanged from Phases 173-175. No new ASVS category becomes applicable that
wasn't already applicable (and already addressed) by those phases.

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V5 Input Validation | Marginal | `RULINGS.md`/CHUNK.md parsing already throws/stops on parse failure per `state-machine.md`'s Cold-Resume Parse Contract — no new validation surface introduced. |

### Known Threat Patterns for this stack

None newly applicable — this phase adds no network-facing surface, no new file-write authority
beyond the existing atomic ledger path, and no new external package.

## Sources

### Primary (HIGH confidence — direct file reads and command execution this session)

- `src/cli/slash-command/bs/build/audit.md` — full read, exact dispatch template text quoted above.
- `src/cli/slash-command/bs/build/repair.md` — full read, round-bound/triage mechanics.
- `src/cli/slash-command/bs/verify-game.md` — full read, current 6-step structure, Step 4's
  explicit "Performing the repair itself is Phase 176's job" pointer (confirms no rewrite needed
  there for THIS phase's arrival — it already anticipates it correctly).
- `src/cli/slash-command/bs/state-machine.md` — full read, Status Enum, Rules Staleness Marker,
  Repair Loop Bound, Session Handoff Seams.
- `src/cli/commands/build-manifest.ts` — `parseRulings`, full read, exact signature and gap
  confirmed (no per-field body-text export).
- `src/cli/commands/trace-check.ts` — confirmed it reads `RULINGS.md` and calls `parseRulings`,
  skips superseded rulings for test-demand purposes.
- `src/cli/commands/verify-impact.ts` — `ImpactMapEntry`, `computeRepairGate`,
  `REPAIR_GATE_DISPOSITIONS`, `VerifyImpactStatusResult` — full read of relevant sections.
- `src/cli/commands/verify-classify.ts` — `ChunkVerdict`, `attributions`, `CITATION_ANCHOR_RUNGS`.
- `~/BoardSmithGames/seven/RULINGS.md`, `~/BoardSmithGames/one-two-punch/RULINGS.md` — direct read,
  ruling counts (36 + 26 = 62, exact match to CONTEXT.md's "~62"), Ruling 1 and Ruling 3 full text.
- `~/BoardSmithGames/seven/rulebook/INDEX.md` — `## Open Rules Gaps` section, direct
  cross-reference confirmation against Ruling 1/3.
- `~/BoardSmithGames/{seven,one-two-punch}/chunks/*/CHUNK.md` — direct grep for
  `### Audit Round` counts across all real chunks in both games (Pitfall 2's evidence).
- `.planning/phases/175-impact-map-repair-gating/175-FIXTURES/174-07-contradictory/` — direct
  listing and `RUN.md` read, confirming committed staged-slice coverage and its
  `MANIFEST.md`/sha256 provenance.
- `${TMPDIR}174-07-proof/` — direct listing, confirming a second, larger, at-risk copy of similar
  material exists in OS scratch (not to be relied on).
- Shell commands this session: `command -v claude/node/git/pdftoppm/magick`, `git rev-parse HEAD`
  in both reference games, `npm test` script confirmation in `package.json`.

### Secondary (MEDIUM confidence)

- None — all findings in this research were verified directly against the repository or the
  reference-game filesystems, not sourced from external web search (this phase is 100% internal
  reuse with no external library research needed).

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack (internal reuse only): HIGH — every cited file was read directly this session.
- Architecture (dispatch/reuse pattern): HIGH — templates and round-bound logic confirmed
  parameterized, not build-hardcoded, by direct inspection.
- Round-bound-vs-lifetime interaction (Pitfall 2): MEDIUM — the underlying facts (4 chunks at 3
  rounds) are HIGH confidence (direct grep); the RESOLUTION of what it means for planning is
  explicitly an open question, not yet decided.
- Ruling corpus / SC-3 target: HIGH — read directly, counts cross-verified against CONTEXT.md's
  "~62" figure exactly.
- Disk-state / fixture availability: HIGH — verified directly this session, not assumed.

**Research date:** 2026-07-30
**Valid until:** 14 days (fast-moving — this milestone's phases land roughly daily and the exact
disk-state findings, especially the OS-scratch material, could be cleared or superseded by the time
planning executes if there is significant delay).
