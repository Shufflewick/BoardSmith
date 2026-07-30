# Phase 175: Impact Map & Repair Gating - Research

**Researched:** 2026-07-30
**Domain:** BoardSmith `bs-` skills CLI (TypeScript) + Claude-Code skill-text — orthogonal
rules-staleness marker, a hard human adjudication gate, and repair-scoped playtest gating.
**Confidence:** HIGH (every claim below is either read directly from source, measured against real
reference-game files, or measured against real leftover proof data found on disk)

## Summary

This phase is almost entirely mechanical CLI/skill-text extension of code that already exists and
already works: `chunk-provenance.ts` (Phase 171)'s `## Verified Against` fenced-region writer,
`drift-check.ts` (Phase 172, CHECK-05)'s code-movement authority, and `verify-classify.ts` (Phase
174)'s per-chunk `ChunkVerdict[]`/attribution ladder/ledger. The one genuinely new mechanism is the
rules-staleness marker itself — decision 1 requires it to be a NEW field orthogonal to `Status:`,
which means it does **not** slot into any of the three places that already enumerate the Status
enum (`state-machine.md`'s "Status Enum" section, `CHUNK.template.md` line 9's comment, and
`SKETCH.template.md` line 85's comment) — it needs its own new line/section in both templates, its
own citation in `state-machine.md`'s Write Order/Authority sections, and (per decision 5) an
explicit new entry in the Cold-Resume Parse Contract's item 3 recognized set, which today lists
exactly three parseable forms and nothing else.

The second genuinely new mechanism is the `RULINGS.md` write: today `RULINGS.md` is **100%
human/skill-authored prose** — no code anywhere parses or writes `### Ruling N` sections
structurally (`trace-check.ts`'s CHECK-03 only *reads* rulings for its untested-ruling sweep, via a
loose `### Ruling N` regex, never writes). Decision 7 requires appending a NEW `### Ruling N` entry
programmatically (or via skill-text write) into this existing human corpus, using the exact same
Decision/Citation/Rationale field shape measured live in both reference games (26 entries in
one-two-punch, 20 in seven) — and per 172-RESEARCH.md's finding, only ~3/62 rulings state
supersession in parseable form (one direction-reversed), so decision 7's append-only write must
follow the existing informal convention, not invent a new parseable supersession syntax.

Everything else — the impact map (reuses `verify-run.ts`'s exported ledger family unchanged), "did
code move" (reuses `drift-check.ts`'s `## Verified Commit Hash` diff unchanged), and repair scoping
(reuses `verify-classify.ts`'s `ChunkVerdict.attributions[]` unchanged) — is composition of
existing, already-proven machinery. No new external package is needed anywhere in this phase.

**Primary recommendation:** Extend `chunk-provenance.ts`'s CHUNK.md writer with a second,
independent machine-owned fenced region (its own distinct BEGIN/END sentinel pair, following the
`GAPS_BEGIN/END` vs `VERIFIED_AGAINST_BEGIN/END` precedent — never share a fence pair across two
unrelated sections) for the rules-staleness marker, register it in `state-machine.md`'s parse
contract and both templates in the SAME change per decision 5, and build the contradictory-gate and
repair-scoping logic as new pure functions in `src/cli/commands/` colocated with the existing
`verify-classify.ts`/`drift-check.ts`/`chunk-provenance.ts` family — reusing their exported helpers,
never re-deriving parsing.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|---|---|---|---|
| Rules-staleness marker write (CHUNK.md + SKETCH.md) | CLI (`src/cli/commands/`) | Skill text (invokes CLI) | Mechanical write into fixed authority/write-order rules — one correct output, per 170-MECHANISMS.md's mechanical/judgment split |
| Contradictory-finding detection + both-readings formatting | CLI | — | Reads `verify-classify-status --json`'s recorded `quotedPass1`/`quotedPass2` — pure formatting, no judgment |
| Adjudication resolution (which reading is correct) | Human (via skill-text stop-and-ask gate) | — | The ONE genuine judgment call in this phase — decision 6/9 forbid any CLI or subagent deciding it |
| `RULINGS.md` append write | CLI or skill text (Claude's discretion) | — | Structurally mechanical (fixed field shape) but the CONTENT is the human's adjudication answer |
| "Did this chunk's code move" | CLI (`drift-check.ts`, reused unchanged) | — | Decision 10 — one authority, not re-derived |
| Repair-scoping / impact map | CLI (`verify-classify.ts` + `verify-run.ts` ledger, reused) | — | Consumes `attributions[]`/`quotedPass1` already computed by Phase 174; this phase does not re-derive staleness |
| Human-readable staleness/adjudication report | Skill text (formats `--json`) | CLI (computes `--json`) | PROV-03's established split, held throughout 171-174 |

## Standard Stack

### Core

No new external package is required. This phase extends existing in-repo modules:

| Module | Role in this phase | Reuse discipline |
|---|---|---|
| `src/cli/commands/chunk-provenance.ts` | Machine-owned fenced-region pattern for the new marker; `## Verified Against` extension for decision 11's re-verification stamp | Copy the fence-pair-per-section discipline; do not add a second parsing convention |
| `src/cli/commands/drift-check.ts` | Decision 10's sole authority for "code moved" | Call `driftCheckCommand`/`diffedFilesSince` directly; never re-implement a second hash/diff scheme |
| `src/cli/commands/verify-classify.ts` | `ChunkVerdict[]`, `attributions[]`, `CITATION_ANCHOR_RUNGS`, `warnings` | Consume as-is; `deriveStale` is deliberately single-argument (do not widen it) |
| `src/cli/commands/verify-run.ts` | Atomic ledger write path (`atomicWriteFile`, `appendLedgerLine`, `locateFences`, `parseLedgerBody`, `resolveLedgerState`, `ledgerFilePath`, `readLedgerOrThrow`) | Reuse for the impact map (decision 17) — one ledger, one atomic write path, never a second |
| `src/cli/commands/build-manifest.ts` | `parseBuildManifest`, `extractVerifiedCommitHash`, `resolveManifestPath` — used by `drift-check.ts` | Reuse if repair-gating needs manifest parsing directly |

### Supporting

| Tool | Purpose | When to use |
|---|---|---|
| `chalk` (already a dependency, used throughout `src/cli/commands/`) | Colored CLI warnings | Match existing `⚠`-prefixed warning convention exactly |
| `git` via `execFile` (no new dependency — Node built-in `child_process`) | Diffing manifest files (already used in `drift-check.ts`) | Do not add a shell-string `exec`; follow `drift-check.ts`'s argv-array + hash-shape-validation convention (T-172-01) |

### Alternatives Considered

| Instead of | Could use | Tradeoff |
|---|---|---|
| Extending `chunk-provenance.ts`'s single fenced region | A wholly separate machine-owned file for staleness | Rejected by decision 2/17 — a new standalone artifact needs its own durability/resume story; the fenced-region-in-CHUNK.md pattern already has one |
| A second ledger for the impact map | Reusing `verify-run.ts`'s existing ledger with a new record `kind` (the precedent Phase 174 set for `classification` records) | The existing ledger is the only correct answer per decision 17 — CR-01's defect class (a second write path) is explicitly what must not recur |

**Installation:** none — no new packages.

## Package Legitimacy Audit

Not applicable. This phase installs no external packages; every dependency reused is already
present in `package.json` (verified: `chalk`, `commander`, `vitest` — all pre-existing, used
identically by the Phase 171-174 commands this phase extends).

## Architecture Patterns

### System Architecture Diagram

```
verify-classify-status --json (Phase 174, unchanged)
        │  chunkVerdicts[]: { slug, ruleDelta, stale, attributions[], pairIds[] }
        ▼
┌───────────────────────────────────────────────────────────────┐
│ NEW: verify-impact-* command family (this phase)              │
│                                                                 │
│  1. Gate check: any record where ruleDelta === 'contradictory' │
│     and NOT yet adjudicated?                                   │
│        │ yes                              │ no                 │
│        ▼                                  ▼                   │
│  STOP — format both readings         proceed to staleness      │
│  (quotedPass1/quotedPass2) for       write for every chunk      │
│  EVERY contradictory finding at      whose ChunkVerdict.stale   │
│  once (decision 6/14) — skill text   === true                  │
│  presents, human resolves            │                          │
│        │                             ▼                          │
│        ▼                    write rules-staleness marker       │
│  RULINGS.md append           into CHUNK.md (new fenced region)  │
│  (### Ruling N,              THEN SKETCH.md (decision 3, cites  │
│  decision 7) — resolved      state-machine.md Write Order)      │
│  or UNADJUDICATED           │                                    │
│  (decision 8)                ▼                                  │
│        │              impact map recorded in the RUN-SCOPED     │
│        └─────────────► LEDGER (verify-run.ts family, decision   │
│                         17) — same atomic append+resume path    │
└───────────────────────────────────────────────────────────────┘
        │
        ▼  (Phase 176 consumes, out of scope here)
Repair pass re-checks stale chunks via audit lenses (CHECK-02) →
drift-check.ts decides code-moved (decision 10) →
  code changed  → Status: built, marker cleared, playtest gate OPEN
  code unchanged → Status: verified (unchanged), marker cleared,
                    ## Verified Against gets a "re-verified, no code
                    change" stamp (decision 11) — needs a NEW field
```

### Recommended Project Structure

```
src/cli/commands/
├── chunk-provenance.ts        # EXTEND: new fenced region + new Verified Against field (decision 11)
├── drift-check.ts             # REUSE UNCHANGED (decision 10's authority)
├── verify-classify.ts         # REUSE UNCHANGED (consumes ChunkVerdict[]/attributions[])
├── verify-run.ts              # EXTEND: new ledger record `kind` for the impact map (decision 17),
│                               #   mirroring how 174-02 added `kind: 'classification'`
├── verify-impact.ts           # NEW (suggested name — Claude's discretion per CONTEXT.md):
│                               #   the contradictory-gate check, staleness-marker writer,
│                               #   repair-gate-reopen decision, colocated with *.test.ts
└── verify-impact.test.ts      # NEW

src/cli/slash-command/bs/
├── state-machine.md            # EXTEND: register new marker in Cold-Resume Parse Contract item 3,
│                               #   Write Order, Authority (cite, do not restate)
├── verify-game.md              # EXTEND: Step 3's boundary statement ("this step... flips no
│                               #   staleness marker anywhere and opens no repair loop") is now
│                               #   FALSE and must be rewritten in place; add a new Step (adjudication
│                               #   gate + staleness write) before Step 4 Close, renumbering Close
├── verify/
│   ├── classification-dispatch.md   # unchanged (Phase 174)
│   ├── classification-subagent.md   # unchanged (Phase 174)
│   └── adjudication-gate.md         # NEW (suggested) — the hard stop-and-ask prose, modeled on
│                                     #   build/ask.md's "Gate-Before-Write" pattern
└── templates/
    ├── CHUNK.template.md       # EXTEND: new section/line for the rules-staleness marker (NOT the
    │                           #   Status line's enum — orthogonal per decision 1)
    └── SKETCH.template.md      # EXTEND: derived reflection of the same marker, mirroring the
                                 #   existing "Status (derived from ...)" pointer pattern
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| "Did this chunk's code move" | A second content-hash/commit-diff scheme | `drift-check.ts`'s `diffedFilesSince`/`driftCheckCommand` (decision 10) | Two authorities for the same fact can disagree; 172 already solved this with a three-state (`clean`/`drifted`/`unknown`) model |
| Atomic, resumable ledger append | A new file format / new write function | `verify-run.ts`'s exported `atomicWriteFile`/`appendLedgerLine`/`locateFences`/`parseLedgerBody`/`resolveLedgerState` | 173-08 hardened this against a real CR-01 (truncate-on-write) defect via `fsync`+`rename()`; a second write path re-earns none of that hardening |
| Per-chunk staleness / repair scoping | Re-deriving which line changed from raw slice text | `verify-classify.ts`'s `ChunkVerdict.attributions[]` (already computed via the 3-rung `quoted-fragment` > `cited-page` > `slice-fallback` ladder) | Phase 174 built and proved this exact ladder; re-deriving it here risks disagreeing with the recorded verdict `deriveStale` already computed |
| Machine-owned marker persistence | A bespoke YAML/JSON sidecar file | A second fenced region in CHUNK.md, following `VERIFIED_AGAINST_BEGIN/END`'s exact pattern | `chunk-provenance.ts`'s doc comment explains why fencing (not polite prose) is necessary: a session filled a machine-owned section by hand on 2026-07-28 and it looked healthy while being wrong |

**Key insight:** every mechanical sub-problem in this phase already has a proven, exported solution
in `src/cli/commands/` from Phases 171-174. The only genuinely new code is (a) the marker's fence
pair + template/parse-contract registration, and (b) the gate/scoping glue logic that composes the
existing exports. Writing a second scheme for anything already solved is the single biggest risk in
this phase, because it silently reintroduces defect classes (CR-01, gap-dropping) that took whole
prior phases to close.

## Complete Status-Parsing Site Inventory (highest-risk mechanical detail)

Because decision 1 makes the new marker **orthogonal to the Status enum** (not a new enum value),
it does **not** need to be added everywhere the Status enum itself is checked. But it DOES need to
be added everywhere the **file's overall parseability** is asserted, per decision 5's "registered in
the Cold-Resume Parse Contract recognized set." Measured directly by reading every site:

| # | Site | What it currently recognizes | What decision 5 requires |
|---|---|---|---|
| 1 | `state-machine.md` "Status Enum" section (lines 5-21) | The 5 status enum values + the CHUNK-level `stale — re-derive before build` marker | Does NOT need the new marker added here (it is not a status value) — but needs a NEW adjacent section describing the marker, cited the same way |
| 2 | `state-machine.md` "Cold-Resume Parse Contract" item 3 (lines 98-101) | "All statuses parse against a recognized value: the Status Enum above, the CHUNK-level stale marker... or... the sketch-level marker... Any of these three is a valid parse; anything else is a parse failure" | **MUST be extended to a fourth recognized form** (the new marker's exact line/field), or the item must be restructured to state that the new marker is validated by a SEPARATE, ADDITIONAL parse rule (not folded into "all statuses") — decide explicitly, since the contract's literal wording ("all statuses") currently only governs the `Status:` line, and the new marker is NOT a status line per decision 1 |
| 3 | `CHUNK.template.md` line 9 comment (`Valid values (exact, case-sensitive): proposed \| approved \| built \| verified \| verified (user-waived) \| stale — re-derive before build`) | The Status line's own enum, inline in the template | Must NOT be extended with the new marker (it is the Status: line's own valid-values list, and the new marker is orthogonal) — instead a NEW line/section with its own "valid values" comment must be added |
| 4 | `CHUNK.template.md` lines 14-21 PARSE CONTRACT (required headings list) | Enumerates required `##` headings in order | Must add the new marker's heading/line to this required-sequence list if it becomes its own `##` section (vs. a bare line near `Status:`) |
| 5 | `SKETCH.template.md` line 85 (`Status (derived from .../CHUNK.md): <!-- proposed \| approved \| built \| verified \| verified (user-waived) \| stale — re-derive before build -->`) | Same enum, inline comment, in SKETCH.md's detailed-entry format | Same as #3 — do not fold in; add a separate derived-reflection line for the marker |
| 6 | `src/cli/slash-command/bs/templates.test.ts` (`STATUS_ENUM_VALUES`, `STALE_MARKER`, `STATE_MACHINE_ENUM_LINE`, `TEMPLATE_ENUM_LINE` constants, lines 48-79) | Pins state-machine.md's enum line against both templates byte-for-byte | Needs a NEW pinned constant + assertion for the new marker's exact string, mirroring `STALE_MARKER`'s existing pin — this is the test-pinning discretion item already named in 175-CONTEXT.md |
| 7 | `src/cli/slash-command/bs/build-chunk.test.ts` (`STATUS_ENUM_VALUES`, `STALE_MARKER` local consts, lines 67/70, used at 957/964/1364) | Pins `state-machine.md`/`build-chunk.md` prose against the enum | Same — needs a sibling pin if `build-chunk.md`'s prose references the new marker (e.g. in the Restyle/Cutover Rule area) |
| 8 | `src/cli/slash-command/bs/status-tools.test.ts` (`STALE_MARKER` const, line 42; `WAIVED_STATUS` used at line 119) | Pins `check-status.md`'s prose against the stale marker and waived status | `check-status.md` is a natural place to surface the new marker's count (per 175-CONTEXT.md's Integration Points note reviving the deferred Phase-174 item) — if added, needs its own pin here |
| 9 | `chunk-provenance.ts`'s `Status:` line regex (`/^Status:\s*(.*)$/m`, line 752) | Parses ONLY the literal `Status:` line value into `ChunkProvenanceEntry.status` | Does not need to change — the new marker lives outside this regex's scan by design (decision 1). If `chunk-provenance-status --json` is extended to also surface the marker, that is a NEW field read from a NEW location, not a change to this regex |
| 10 | `state-machine.md` "Consistency Check" (lines 87-104) | Item 3 is the same "all statuses parse against a recognized value" check, restated with the same three-way enumeration | Same site as #2 in different words — both must be updated together or the file self-contradicts (exactly the class of bug 174-05 had to fix in `verify-game.md`) |

**Recommendation for the planner:** because decision 1 makes the marker orthogonal, the cleanest
resolution — measured against what the templates and parsers already make natural (see next
section) — is to give it its OWN heading (`## Rules Staleness` or similar) with its own fenced
region and its own "Valid values" comment, and add ONE new item (not a modification of item 3) to
the Cold-Resume Parse Contract and Consistency Check enumerations: "the rules-staleness marker
(present/absent, in its own fenced section) parses against its own two-value set; a malformed or
unrecognized value there is also a parse failure." This keeps the existing Status-enum recognized
set completely unchanged (nothing here regresses items 1-9 above) while still satisfying decision
5's "registered... this is load-bearing, not bookkeeping" requirement literally.

## Marker Placement: Separate Line/Field vs. Suffix — Measured, Not Assumed

**Measured against both templates and both real reference games' actual `Status:` lines directly:**

- `CHUNK.template.md`'s Status line format is a single bare word or `verified (user-waived)` —
  never a compound/suffixed value beyond that one parenthetical. The Cold-Resume Parse Contract
  requires `Status:` to match ONE recognized enum value; the enum is closed and every consumer
  (`build-chunk.test.ts`, `templates.test.ts`, `chunk-provenance.ts`'s regex) treats the captured
  group as a single opaque string tested for membership/prefix (`status.startsWith('verified')`,
  line 766). Suffixing the Status line with staleness (e.g. `verified — rules-stale`) would turn a
  closed 5-value enum into a combinatorial product exactly as decision 1's own rationale warns
  against, AND it would break `chunk-provenance.ts`'s `startsWith('verified')` check, which assumes
  the value starts with one of the five canonical words.
- `chunk-provenance.ts`'s `## Verified Against` block is the only existing precedent for a
  **second, independent fenced field living alongside `Status:`** in the same file — proven,
  working, machine-owned, already repaired-in-place by `chunk-check`. This is the natural, already-
  measured home: a second heading with its own fence pair, not a suffix on any existing line.
- Conclusion (measured, not preferred in the abstract): **a separate fenced section/field is what
  the templates and every existing parser make natural.** A suffix is what would require touching
  the largest number of existing, working parse sites (the Status-line consumers listed above) for
  no benefit; a new section touches only the sites that specifically need to know about staleness.

## The Hard Human Gate Pattern (decision 9 — no bypass representable)

`build/ask.md`'s "Gate-Before-Write" section (lines 153-183) is the established pattern for a
**genuine, no-bypass stop-and-ask** in an existing `bs-` skill, and is the direct model for
VERIFY-04's adjudication gate:

1. **Present, then wait for explicit approval before any durable write.** Ask.md's exact wording:
   "Do **not** write anything durable... until the user has given explicit approval. Presenting is
   not approving; only an explicit yes authorizes the write." This is the literal mechanism for
   "no representable bypass" — there is no flag or parameter anywhere in this pattern that skips
   the wait; the skill-text prose simply never reaches a write step without the yes.
2. **Ordered, itemized writes only after the yes**, with the Status-analogous field written LAST
   (mirroring `state-machine.md`'s Write Order rule) so a crash mid-sequence leaves the file in a
   valid, resumable prior state, never half-written.
3. **A "refused twice" / unresolvable case still has a named terminal state** — the direct analogy
   is `state-machine.md`'s "Redteam Escalation" ("Refuted twice... Escalate to the user... Disputes
   go to the human, never to more agents") and decision 8's `UNADJUDICATED` state: an aborted or
   deferred gate must record an explicit, honest terminal marker (never silently proceed as if
   resolved), exactly as `ask.md`'s carve-out logic never silently infers approval.

This pattern requires **no new mechanism** — it is skill-text prose following an established shape,
plus one new CLI formatting step (both-readings side-by-side from `quotedPass1`/`quotedPass2`,
already recorded by Phase 174) and one new write (`RULINGS.md` append, `## Rules Staleness` marker
write). The "no bypass flag" requirement (decision 9) is satisfied structurally the same way ask.md
satisfies it today: by never writing a code path that offers one, not by removing a flag that would
otherwise exist.

## Is `RULINGS.md` Machine-Written Anywhere Today?

**No — measured directly, not assumed.** Grepped the entire `src/cli/commands/` tree for any
programmatic write to `RULINGS.md`: none exists. The only code that touches `RULINGS.md` today is
`trace-check.ts` (CHECK-03), which **reads** it via a `### Ruling N` regex for the untested-ruling
sweep — it never writes. Every one of the 26 (one-two-punch) and 20+ (seven) real entries was
written by a human/skill-text session following the prose convention documented in
`RULINGS.template.md`'s own comments (measured directly from both reference games' real
`RULINGS.md` files, reproduced verbatim below):

```
### Ruling N
- Decision: <plain-language decision text>
- Citation interpreted or overridden: <exact rulebook section/page, or "n/a — no citation, pure digital adaptation">
- Rationale: <why this call was made>
```

Supersession, when it occurs, is expressed as free prose inside a LATER entry's `Decision`/
`Citation` field (e.g. one-two-punch Ruling 14 → "This supersedes Ruling 14's card-shaped
presentation"; seven Ruling 3 carries `⚠ RATIONALE SUPERSEDED BY RULING 9` as a bespoke bolded
bullet, not a parseable field) — never a structured field. **172-RESEARCH.md's finding stands and
was re-confirmed here by direct grep: only ~3 of 62 total real rulings across both games use a
"supersede(s)"/"superseded" verb, and one of those (seven Ruling 3) is direction-reversed** (the
marker sits on the SUPERSEDED entry, naming the entry that supersedes it, rather than the other way
around). Decision 7's append-only write must therefore emit a NEW `### Ruling N` entry using the
next integer after the corpus's current highest number, with the standard three fields, embedding
`quotedPass1`/`quotedPass2` verbatim inside `Decision`/`Citation` prose — it must NOT invent a new
structured supersession syntax, since nothing downstream (including CHECK-01 in Phase 176) can rely
on one existing today.

**Recommendation:** either write `RULINGS.md`'s new entry via a CLI command (following
`chunk-check`'s repair-then-fail convention, appending rather than fencing since the whole file is
append-only human prose, not a single machine-owned region) or via skill-text direct-write —
Claude's Discretion per `175-CONTEXT.md`. Whichever is chosen, the number-assignment logic (find the
highest existing `### Ruling N`, emit N+1) is the one piece of genuine parsing this write needs, and
it should reuse `trace-check.ts`'s existing `### Ruling N` regex rather than writing a second one.

## Is Phase 174's Retained Line-Level Evidence Sufficient for Phase 176's Repair Scoping?

**Yes, with one gap to flag.** `ChunkVerdict` (verify-classify.ts, lines 881-894) already carries:

```typescript
export interface ChunkVerdict {
  slug: string;
  citedLiveSlices: string[];
  pairIds: string[];
  ruleDelta: RuleDelta;
  stale: boolean;
  attributions: Array<{
    pairId: string;
    liveSlice: string;
    rung: CitationAnchorRung;      // 'quoted-fragment' | 'cited-page' | 'slice-fallback'
    attributed: boolean;
    reason: string;
  }>;
}
```

Each `ClassificationRecord` in the ledger (verify-run.ts) additionally carries `evidence` (free
prose), `quotedPass1`/`quotedPass2` (verbatim quotes), and `lineFindings[]` in the raw subagent
return (confirmed present in the real leftover proof data below) though **`lineFindings[]` itself is
NOT currently persisted onto the recorded `ClassificationRecord`** — only the pair-level
`quotedPass1`/`quotedPass2` (the MAX-severity line) is retained per pair. This means: for a pair
whose group verdict is `contradictory` because of ONE line, but which also contains several
`cosmetic` line-level deltas (as the real one-two-punch finding does — 6 cosmetic + 1 contradictory
line, see below), only the ONE non-cosmetic quote is retained on the ledger record today. This is
**sufficient for decision 16's stated need** ("Repair scoping consumes... the attributed per-chunk
deltas... not just the boolean stale flag" — the WHAT-changed content is present via
`quotedPass1`/`attributions[].reason`), but if Phase 176 ever needs the FULL set of per-line deltas
(not just the max-severity one) to scope a multi-delta repair precisely, that would require widening
`ClassificationRecord` to persist `lineFindings[]` — a decision this phase should flag to Phase 176
rather than silently assume covers every future need. For THIS phase's stated scope (which chunks
need repair, and what to point the repair at), `quotedPass1` + `attributions[]` is sufficient.

## Decision 11's Re-Verification Stamp — Does `## Verified Against` Support It Today?

**No — it needs extending, and this is a genuine gap, not a trivial one.** Measured directly from
`chunk-provenance.ts`:

```typescript
export const VERIFIED_AGAINST_LABELS = Object.freeze([
  'Scope:', 'Reason:', 'Rulebook edition:', 'Rulebook source hash:',
  'BoardSmith version:', 'Skills tree hash:', 'Cited slices:', 'Unresolved citations:',
] as const);
```

There is **no timestamp field anywhere in this block**, and **no existing label expresses "this run
found no code change."** `SCOPE_REASONS` (`source-missing`, `source-hash-mismatch`,
`index-missing`, `no-rulebook-project`, `pre-provenance-project`) is a completely different concept
— it explains why a verification could not read source, not whether code moved since a prior
verification. Decision 11 ("gets a `## Verified Against` stamp recording a re-verification with NO
code change") therefore requires either:

- a new label (e.g. `Re-verified (no code change):`, with a value like the diffed commit range or a
  boolean + the two hashes compared), following the exact same
  `VERIFIED_AGAINST_LABELS`/`renderVerifiedAgainst`/`parseVerifiedAgainst` extension pattern Phase
  171 itself established when it added this block in the first place, or
- reusing the existing `Rulebook source hash:`/`BoardSmith version:` fields as an implicit "nothing
  changed since last write" signal by comparing against the PREVIOUS block's values before
  overwriting — but `renderVerifiedAgainst`/`parseVerifiedAgainst` are currently pure/stateless
  (no "previous value" is read before a repair), so this would require a genuinely new "read before
  overwrite" step that does not exist in `chunk-check` today.

**Recommendation:** add the new label as a first-class field (matches the existing extension
pattern most cleanly, and keeps every consumer's positional destructuring — `const [LABEL_SCOPE,
LABEL_REASON, ...] = VERIFIED_AGAINST_LABELS` — a simple append rather than a restructure). This is
a genuinely new capability of `chunk-provenance.ts`, not a pure reuse, and should be scoped as its
own task.

## Real Material Available Right Now for Proving This Phase

**Checked the actual disk state directly — do not trust 175-CONTEXT.md's claim uncritically.** The
committed, in-repo `.planning/phases/174-verify-classifier/174-FIXTURES/` directory contains the
real pass-1-vs-pass-2 `live`/`staged` slice material and lexicon regression pairs for BOTH reference
games (confirmed present: `seven/{live,staged,INDEX.md,RUN.md}`,
`one-two-punch/{live,staged,INDEX.md,RUN.md}`, 7 `lexicon/*` pairs each with `EXPECTED.md`) — but
this fixture set was archived in plan **174-01**, BEFORE the real `contradictory` mutation of
174-07 ever ran. Its `RUN.md` ledgers contain no classification records at all (grepped directly —
zero matches).

**The real `contradictory` finding from 174-07 is NOT in `174-FIXTURES/` and was NOT committed
anywhere in the repo.** However — checked directly, not assumed — **the OS scratch directory that
plan produced still exists on this machine, uncleaned, at
`${TMPDIR}174-07-proof/`** (macOS `$TMPDIR`, resolves under `/var/folders/.../T/174-07-proof/`).
It contains, byte-for-byte, a full copy of `one-two-punch` with the mutated `rules.pdf`
(`otp.after`/`otp.before` hash files), the raw subagent return
(`subagent-otp-sc3-classify-return.txt`) with the complete real `contradictory` verdict — including
the full `lineFindings[]` array (1 contradictory FIGHT-phase resolution-order line + 6 cosmetic
lines) — and the project copy's own `rulebook/.verify/<runId>/RUN.md` ledger with the recorded
`ClassificationRecord` line:

```
{"kind":"classification","pairId":"pages-1-2", ... ,"provenance":"source-changed",
 "ruleDelta":"contradictory","stale":true, ...
 "quotedPass1":"The player with the lower timing on their card must resolve their action first...",
 "quotedPass2":"The player with the higher timing on their card must resolve their action first...",
 "recordedAt":"2026-07-30T01:41:59.573Z"}
```

**This is real, live, exactly the natural exhibit `175-CONTEXT.md`'s Specific Ideas section names —
but it is sitting in OS temp storage that can be cleared at any time and is not guaranteed to
survive to this phase's execution.** The correct action for this phase's first proof plan is to
**archive this material into a committed `175-FIXTURES/` directory immediately** (mirroring
174-01's own `174-FIXTURES/MANIFEST.md` sha256-manifest discipline), NOT to assume it will still be
there when execution starts, and NOT to treat it as already-durable. If it has been cleared by
execution time, the exact reproduction recipe is fully documented in `174-PROOF.md` §5 ("The
mutation: a real edit to the archived source PDF") and is cheap to re-run (no package installs,
`pdftoppm`/Ghostscript/`magick`, already on the machine per that section).

Separately, **`seven`'s real chunk-level staleness data (6/16 stale, `sharper`, non-contradictory)
is also present** in the same scratch directory (`seven-final-status.json`,
`subagent-seven-chunkcheck-classify-return.txt`) and in the committed `174-FIXTURES/` for its
pass-1/pass-2 pairs — this is the natural anchor-density measurement target for VERIFY-06's "6 of 16
chunks rules-stale" scenario the specifics section names.

A proof run for this phase must, per the established 171-174 discipline: work against `cp -R`
copies (never the read-only `seven` original or the dirty-but-preserved `one-two-punch` original),
confirm both `~/BoardSmithGames` originals byte-identical before and after, and produce a
`175-PROOF.md` recording exact measured counts (never "ran clean").

## Common Pitfalls

### Pitfall 1: Folding the staleness marker into the Status enum after all
**What goes wrong:** A plan adds the marker as a suffix or parenthetical on the `Status:` line
(e.g. `verified (rules-stale)`), multiplying the enum combinatorially exactly as decision 1 warns.
**Why it happens:** It looks like the smallest diff — one line changes instead of a new section.
**How to avoid:** Give the marker its own heading/fenced section (see "Marker Placement" above);
never touch the closed 5-value Status enum or its "Valid values" comment.
**Warning signs:** Any new code that does `status.includes('stale')` on the `Status:` line's own
captured value, or any template edit that appends to the existing comma-separated enum list at
`CHUNK.template.md` line 9 / `SKETCH.template.md` line 85.

### Pitfall 2: A second parser for `RULINGS.md`'s `### Ruling N` shape
**What goes wrong:** Writing a fresh regex to find the highest ruling number or to append a new
entry, subtly different from `trace-check.ts`'s existing one, that disagrees on an edge case (e.g.
a ruling number embedded in prose elsewhere in the file).
**Why it happens:** `trace-check.ts`'s regex is read-only and colocated with an unrelated check;
easy to miss when writing a NEW write-path command.
**How to avoid:** Import/reuse `trace-check.ts`'s `### Ruling N` matching logic (or extract it to a
shared helper) rather than re-deriving it.
**Warning signs:** Two different `### Ruling (\d+)` regexes existing in the codebase simultaneously.

### Pitfall 3: Treating `## Verified Against`'s existing fields as sufficient for decision 11
**What goes wrong:** Assuming the re-verification stamp can be expressed with existing fields
(e.g. just re-running `chunk-check` and calling that "the stamp"), when no field distinguishes "ran
today, no code moved" from "ran a year ago."
**Why it happens:** The block already gets rewritten on every `chunk-check` run, so it's tempting to
believe rewriting it IS the stamp.
**How to avoid:** Add the explicit new label (see the dedicated section above) — the block's mere
existence/freshness is not visible to a human reading CHUNK.md without a `git blame`.
**Warning signs:** A plan that closes decision 11 with zero changes to `VERIFIED_AGAINST_LABELS`.

### Pitfall 4: Leaving `verify-game.md`'s Step 3 boundary statement stale
**What goes wrong:** Adding the new adjudication-gate/staleness-write step without deleting the
sentence "This step records verdicts only: it flips no staleness marker anywhere and opens no
repair loop (that is Phase 175's job)" — leaving self-contradicting skill text exactly like the
Phase-173-boundary-statement bug Phase 174 (174-05) had to fix in the same file.
**Why it happens:** The new step is naturally ADDED after Step 3, and the old sentence lives inside
Step 3's own prose, easy to miss when only editing the new step.
**How to avoid:** Grep `verify-game.md` for "Phase 175" and "flips no staleness marker" as an
explicit pre-commit check before considering this phase's skill-text task done.
**Warning signs:** `verify-game.md` containing both a working staleness-write step AND a sentence
claiming no such step exists.

### Pitfall 5: Assuming the OS-temp scratch proof data will persist
**What goes wrong:** Planning around `${TMPDIR}174-07-proof/` as a stable fixture location; it is
cleared by the OS on reboot/cleanup with no notice.
**Why it happens:** It happens to still be there right now (verified 2026-07-30).
**How to avoid:** Archive it into a committed `175-FIXTURES/` directory as the very first task of
this phase's first plan, exactly as 174-01 did for its own pass-1/pass-2 material.
**Warning signs:** A plan or proof doc that references a path under `$TMPDIR` as a citable source.

## Code Examples

### The existing machine-owned fenced-region pattern to copy (Source: `chunk-provenance.ts` lines 218-332)
```typescript
export const VERIFIED_AGAINST_HEADING = '## Verified Against';
export const VERIFIED_AGAINST_BEGIN = '<!-- boardsmith:verified-against:begin -->';
export const VERIFIED_AGAINST_END = '<!-- boardsmith:verified-against:end -->';
// A DISTINCT fence pair from GAPS_BEGIN/GAPS_END — two unrelated machine-owned sections
// sharing one fence pair is a data-corruption risk, not a convenience. (line 221-223)

function renderVerifiedAgainstSection(record: VerifiedAgainstRecord): string {
  return `${VERIFIED_AGAINST_HEADING}

<!-- MACHINE-OWNED. Do not write between the fences below... -->

${VERIFIED_AGAINST_BEGIN}${renderVerifiedAgainst(record)}${VERIFIED_AGAINST_END}
`;
}
```
The new rules-staleness marker section should follow this shape exactly, with its own distinct
heading and its own distinct fence-sentinel pair (e.g. `<!-- boardsmith:rules-staleness:begin -->`
/ `:end`), never reusing `VERIFIED_AGAINST_BEGIN`/`END`.

### The section-locate-by-line discipline to copy (Source: `chunk-provenance.ts` line 388, commit `f73153a3`)
```typescript
// Anchored to a LINE, not to the first substring occurrence. `indexOf(VERIFIED_AGAINST_HEADING)`
// alone would match the FIRST mention of the heading text anywhere in the file (e.g. inside a
// comment referencing it), not necessarily the real section. [paraphrased from source comment]
```
Any new locate-a-section helper for the staleness marker must use the same `findHeadingIndex`-style
by-line anchoring `chunk-provenance.ts` already exports, not a bare `indexOf`.

### The existing ask.md hard-gate pattern to model the adjudication gate on (Source: `build/ask.md` lines 153-183)
```
Do **not** write anything durable... until the user has given explicit approval.
Presenting is not approving; only an explicit yes authorizes the write.

Only after that explicit yes:
1. Write any RULINGS.md `### Ruling N` entries...
...
4. Write `Status: approved` to CHUNK.md **last**...
5. Then update this chunk's derived-status pointer in SKETCH.md to match...
```

## State of the Art

| Old Approach (Phase 174 and earlier) | Current Approach (this phase) | When Changed | Impact |
|---|---|---|---|
| Verdicts recorded, nothing downstream acts on them | A verdict now triggers a marker write, a possible hard gate, and (via Phase 176) a repair-gate decision | Phase 175 | `verify-game.md`'s "records verdicts only" boundary statement becomes false and must be rewritten in place, not appended around (same class of fix 174-05 made to 173's boundary statement) |
| `RULINGS.md` is 100% human/skill-authored | First programmatic (or skill-text-scripted) append of a `### Ruling N` entry, from a classifier-derived contradiction | Phase 175 | Must match the existing informal field shape exactly — no new structured syntax, since CHECK-01 (Phase 176) will read this corpus the same way it reads today's human-authored entries |

**Deprecated/outdated:** None — this phase extends rather than replaces any existing mechanism.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | Suggested module/file names (`verify-impact.ts`, `verify/adjudication-gate.md`, new heading `## Rules Staleness`) are illustrative, not locked — `175-CONTEXT.md`'s Claude's Discretion explicitly leaves module boundaries and the marker's exact string open | Recommended Project Structure, Marker Placement | None if the planner treats these as suggestions; risk only if mistaken for a locked decision |
| A2 | The recommendation to add a NEW, separate Cold-Resume Parse Contract item (rather than folding into item 3) is this researcher's synthesis of decision 1 (orthogonal) + decision 5 (must be registered) — not itself a locked CONTEXT.md decision | Complete Status-Parsing Site Inventory | Low — if the planner chooses instead to fold the marker into item 3's wording as a 4th recognized status-line form, that would contradict decision 1's "NOT a new status-enum value"; flagged so the planner catches this tension explicitly rather than resolving it silently either way |
| A3 | `lineFindings[]` is not persisted on `ClassificationRecord` — confirmed by reading the interface directly, but the exact severity of that gap for Phase 176's future needs is this researcher's judgment, not a measured requirement failure | Repair-scoping sufficiency section | Low — flagged as forward information for Phase 176, not something this phase must fix |

## Open Questions

1. **Should the rules-staleness marker be its own `##` heading (participating in the CHUNK.md
   PARSE CONTRACT's required-heading list) or a bare line living near `Status:` (not a heading)?**
   - What we know: the only existing precedent for a second machine-owned field is `## Verified
     Against`, which IS a full heading with its own fence pair.
   - What's unclear: whether a bare-line-near-Status approach (lower ceremony, no new required
     heading) was considered and rejected, or simply not surveyed since no such precedent exists.
   - Recommendation: follow the `## Verified Against` precedent (own heading, own fence pair) —
     it is the only pattern proven to survive `chunk-check`'s repair-then-fail discipline and cold
     resume, and mixing a bare unfenced line into a file whose fenced sections are load-bearing
     risks the exact "looked healthy while being wrong" failure `chunk-provenance.ts`'s own comment
     warns about.

2. **Does `/bs-check-status` gain a new item for staleness-count reporting in this phase, or is
   that explicitly deferred again?**
   - What we know: 174-CONTEXT.md deferred "surfacing classification verdicts in
     `/bs-check-status`" explicitly TO Phase 175's reporting surface ("revisit it here rather than
     deferring again").
   - What's unclear: whether the planner should treat this as in-scope by that carry-forward
     note, or whether 175-CONTEXT.md's own scope boundary (silent on `check-status.md`) means it
     stays out.
   - Recommendation: treat it as in-scope per the explicit carry-forward instruction — a new
     `/bs-check-status` item formatting the stale-fraction count (decision 15's "6 of 16 chunks
     rules-stale," never capped) is a natural, low-risk addition following the exact
     format-`--json`-never-compute pattern items 4/8 already establish.

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | Vitest (already configured; `vitest.config.ts` present) |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run src/cli/commands/<new-file>.test.ts` |
| Full suite command | `npm test` (→ `vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| VERIFY-04 | A `contradictory` verdict always halts the pass before any staleness write, formats both readings, and the adjudication resolution is recorded in `RULINGS.md` (or `UNADJUDICATED` if deferred) | unit + skill-text existence pin | `npx vitest run src/cli/commands/verify-impact.test.ts -t "contradictory"` | ❌ Wave 0 — new file |
| VERIFY-05 | Chunks whose `ChunkVerdict.stale === true` get the new marker written to CHUNK.md first, then SKETCH.md, following existing Write Order/Authority | unit (fixture CHUNK.md/SKETCH.md pairs) | `npx vitest run src/cli/commands/verify-impact.test.ts -t "marker"` | ❌ Wave 0 — new file |
| VERIFY-06 | A chunk whose code changed (per `drift-check.ts`) re-opens the playtest gate (`built`); a chunk whose code did NOT change keeps `verified`/gets the re-verification stamp, marker cleared | unit | `npx vitest run src/cli/commands/verify-impact.test.ts -t "repair-gate"` | ❌ Wave 0 — new file |
| (cross-cutting) | `state-machine.md`/templates stay internally consistent — no self-contradicting boundary statements | skill-text pin, mirroring `templates.test.ts`/`build-chunk.test.ts` | `npx vitest run src/cli/slash-command/bs/templates.test.ts` | ✅ existing file, extend |
| (cross-cutting) | Real proof against `cp -R` copies of both reference games, byte-identical before/after | manual/scripted proof run, not part of `npm test` | (documented in `175-PROOF.md`, following 171-174's precedent) | N/A — proof artifact, not a unit test |

### Sampling Rate
- **Per task commit:** `npx vitest run <the file(s) touched>`
- **Per wave merge:** `npm test` (full suite — currently 3706/3706 green per STATE.md as of Phase
  174's close; any new failures are this phase's own regressions)
- **Phase gate:** Full suite green before `/gsd:verify-work`, plus a real `cp -R`-copy proof run
  against both reference games recorded in `175-PROOF.md`, matching every prior phase in this
  milestone (171-174) exactly.

### Wave 0 Gaps
- [ ] `src/cli/commands/verify-impact.ts` + colocated `verify-impact.test.ts` — does not exist yet;
      this phase's entire mechanical surface
- [ ] `.planning/phases/175-impact-map-repair-gating/175-FIXTURES/` — archive the real leftover
      `${TMPDIR}174-07-proof/one-two-punch` contradictory-finding material (and `seven`'s real
      staleness data) into the repo BEFORE it can be lost to OS temp cleanup — see "Real Material
      Available Right Now" above; treat this as a Wave 0 task, not an afterthought
- [ ] No new test-framework install needed — Vitest is already fully configured and used
      identically by every sibling command this phase extends

## Sources

### Primary (HIGH confidence — read directly from repo source or measured from real files)
- `src/cli/slash-command/bs/state-machine.md` (full file read) — Status Enum, Authority, Write
  Order, Cold-Resume Parse Contract, Consistency Check, Session Lock, Redteam Escalation
- `src/cli/commands/chunk-provenance.ts` (lines 40-70, 218-460, 640-820) — `## Verified Against`
  fence pattern, `VERIFIED_AGAINST_LABELS`, `SCOPE_REASONS`, `Status:` regex, `chunkProvenanceStatusCommand`
- `src/cli/commands/drift-check.ts` (full file read) — `diffedFilesSince`, `driftCheckCommand`,
  three-state (`clean`/`drifted`/`unknown`) classification, git-subprocess conventions
- `src/cli/commands/verify-classify.ts` (lines 874-1060, exports list) — `ChunkVerdict`,
  `CITATION_ANCHOR_RUNGS`, `CHUNK_ATTRIBUTION_WARNING_KINDS`, `parseClaimCitationAnchors`
- `src/cli/commands/verify-run.ts` (exports list, lines 139-205) — `ClassificationRecord`,
  atomic ledger helpers
- `src/cli/slash-command/bs/templates/CHUNK.template.md` and `SKETCH.template.md` (full files)
- `src/cli/slash-command/bs/build/ask.md` (Gate-Before-Write section) — hard-gate pattern
- `src/cli/slash-command/bs/verify-game.md` (full file) — current Step 0-4 structure, the
  boundary statement this phase must rewrite
- `~/BoardSmithGames/one-two-punch/RULINGS.md`, `~/BoardSmithGames/seven/RULINGS.md` (grepped and
  read directly) — real `### Ruling N` shape, supersession-verb inventory (measured: 26 and 20+
  entries, ~3/62 with a supersede verb, one direction-reversed)
- `${TMPDIR}174-07-proof/` (checked live on this machine, 2026-07-30) — the real leftover
  `contradictory` finding, mutated `rules.pdf`, and full raw subagent return with `lineFindings[]`
- `.planning/phases/174-verify-classifier/174-FIXTURES/` (directory listing + `RUN.md` grep) —
  confirmed present, confirmed to predate 174-07's mutation, confirmed to contain no
  classification records
- `.planning/phases/174-verify-classifier/174-VERIFICATION.md`, `174-CONTEXT.md`, `174-PROOF.md`
  §5/§7/§8 (read directly) — the phase-goal reopen, decision 19's ladder, anchor-density diagnosis
- `.planning/phases/172-source-free-conformance-checks/172-CONTEXT.md` (read directly) — decision
  3's resolution-ladder precedent, the RULINGS.md supersession measurement
- `.planning/STATE.md` (lines 1-427) — Phase 174 gap-closure history, test-count baseline

### Secondary (MEDIUM confidence)
- None — every claim in this document was checked directly against repo source, real reference
  game files, or live disk state rather than relying on unverified web/training-data claims. This
  is an internal-codebase research task with no external library dependency, so the
  Context7/WebSearch source hierarchy does not apply.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; every reused module read directly, exports confirmed
- Architecture: HIGH — every integration point (state-machine.md, templates, verify-game.md,
  chunk-provenance.ts, drift-check.ts, verify-classify.ts, verify-run.ts) read directly, not inferred
- Pitfalls: HIGH — each pitfall is a directly observed structural fact (e.g. missing timestamp
  field, missing lineFindings persistence, stale boundary statement) or a directly documented prior
  incident from this same milestone (174-05's boundary-statement fix, the 2026-07-28 machine-owned
  section hand-fill incident)

**Research date:** 2026-07-30
**Valid until:** Effectively indefinite for the internal-codebase claims (they are direct source
reads, not time-sensitive external facts) — EXCEPT the `${TMPDIR}174-07-proof/` scratch data, which
is at risk of being cleared at any time and should be archived into `175-FIXTURES/` as this phase's
first action, not relied upon as a stable research artifact.
