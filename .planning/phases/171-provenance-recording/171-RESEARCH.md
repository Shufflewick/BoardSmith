# Phase 171: Provenance Recording - Research

**Researched:** 2026-07-28
**Domain:** BoardSmith CLI (Node/TypeScript, commander-based) + bs- skill markdown contracts
**Confidence:** HIGH for code precedent and reference-game facts (all read directly); MEDIUM for
how the planner should resolve two structural gaps this research surfaces (citation format,
package-version inertness) — those are planning inputs, not settled answers.

## Summary

This phase is CLI work, not skill-text work, per 171-CONTEXT.md's locked sort. The precedent to
copy line-for-line is `src/cli/commands/ingest-archive.ts`'s three-command shape (`ingest-archive`
/ `ingest-gaps` / `ingest-check`, folded together) — fenced machine-owned region, repair-then-fail
with `process.exitCode = 1`, one command that folds a second one in rather than requiring two
invocations. That whole file, its tests, and `170-PROOF-RUN-2.md`'s Run 1/Run 2 narrative should
be read by whoever plans this phase; this document extracts the load-bearing facts but the
comments in `ingest-archive.ts` are themselves half of the research.

Two facts surfaced here materially complicate the CONTEXT.md decisions and should be surfaced to
the user before or during planning, not silently absorbed by the planner:

1. **The chunk→slice citation format is free-form prose, not a parseable structure.** Real
   `## Interpretation` sections (verified in both `seven` and `one-two-punch`) mix inline
   backtick-quoted file references, `RULINGS.md` ruling numbers, and even source-code paths
   (`src/rules/elements.ts`) inside narrative sentences — there is no delimiter, no fixed field
   order, nothing a regex can trust to enumerate "the slices this chunk cites" completely and only
   those. PROV-01 says "record hashes of the slices the chunk CITES." A command cannot honestly
   compute that set from `## Interpretation`'s current shape. This needs a decision, not a parser.
2. **`package.json`'s `version` field has been `0.0.1` since the file's first commit** — verified
   via `git log -p -- package.json`, every revision. `cli.ts:27` hardcodes `.version('0.0.1')`
   rather than reading `package.json` at all. The user's decision 7 ("skills version = boardsmith
   package version + a content hash of the installed skills tree") is correct that version alone
   is insufficient, but the reasoning somewhat undersells it: right now the package-version half of
   that compound key is a **constant that has never once changed**, contributing zero
   discriminating signal. The content hash is doing 100% of the real work. This is not a reason to
   change the decision — it is a reason to flag, loudly, that `boardsmith` needs to start bumping
   `package.json`'s version as part of this work (or a separate housekeeping task), or the
   "package version" component the decision names is decorative.

**Primary recommendation:** implement `boardsmith chunk-provenance <slug>` (or fold straight into
`boardsmith chunk-check <slug>`, mirroring how `ingest-gaps` absorbed `ingest-relabel` per the
CONTEXT.md specifics note) as a new command in a new file (`src/cli/commands/chunk-provenance.ts`
or added to `ingest-archive.ts`'s neighbor), registered in `cli.ts` next to the ingest commands,
tested with the exact same temp-project + `process.exitCode` save/restore pattern as
`ingest-archive.test.ts`. Resolve the citation-format gap explicitly in the plan (see Q4 below)
before writing the parser.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Compute verification scope (full vs. code-conformance-only) | CLI (Node process, `src/cli/commands/`) | — | File-existence + hash comparison; exactly the shape of `ingestArchiveCommand`'s existing hash logic |
| Write/repair `## Verified Against` fenced block in CHUNK.md | CLI | — | Mirrors `GAPS_BEGIN`/`GAPS_END` fence-write in `ingestGapsCommand` |
| Enforce block presence/freshness at `close` | CLI (`chunk-check`, invoked from skill text) | Skill text (bs-build-chunk's `close`/`playtest` steps) | Skill text's only job is to invoke the command — same split as `ingest-check` invoked from Step 0 |
| Aggregate provenance across all chunks for reporting | CLI (`--json` flag) | Skill text (`/bs-check-status`, formats only) | CONTEXT.md specifics: "`/bs-check-status` should back it with a CLI command that emits the aggregation, so the skill formats rather than computes" |
| Determine which slices a chunk cites | **Unresolved — see Q4** | — | No existing structured citation format exists to parse; this is the single riskiest unknown in the phase |
| Read installed skills-tree location from inside a game project | CLI | — | No existing mechanism does this today (see Q5); must be built |

## Standard Stack

No new external dependencies. All primitives needed already exist in the codebase and are already
used by the precedent file:

| Capability | Module | Already used by |
|---|---|---|
| SHA-256 hashing | `node:crypto` `createHash('sha256')` | `ingest-archive.ts` `sha256()` |
| File read/write | `node:fs` `promises` | `ingest-archive.ts` throughout |
| CLI registration | `commander` (already a dependency) | `cli.ts` |
| Colored output | `chalk` (already a dependency) | `ingest-archive.ts` |
| Content-hash of a directory tree (new need, no precedent) | `node:crypto` + `node:fs` walk (write new, small) | none — must be authored fresh for the skills-tree hash (decision 7) |

**Installation:** none required.

### Alternatives Considered

None — the phase's own CONTEXT.md forecloses alternatives (`ingest-archive.ts`'s pattern is
"the pattern this phase must follow," not one option among several).

## Package Legitimacy Audit

No external packages are installed by this phase. All work is pure Node stdlib + the two
already-present dependencies (`commander`, `chalk`). The Package Legitimacy Gate protocol is
**not applicable** — nothing to run `slopcheck`/registry checks against.

## Architecture Patterns

### System Architecture Diagram

```
 designer / build session
        │
        │ (1) skill text invokes, unconditionally, no judgment
        ▼
 ┌────────────────────────────┐
 │ boardsmith chunk-check <slug>│   ← new CLI command, mirrors ingest-check
 │  (repair-then-fail shape)    │
 └──────────┬───────────────────┘
            │ reads
            ▼
 CHUNK.md's ## Interpretation      rulebook/INDEX.md
 (chunk's own citations — Q4)      (Source hash:, Edition:, slice table)
            │                              │
            └──────────────┬───────────────┘
                            ▼
                  compute scope:
                  full  ⇔  archived source exists AT the INDEX.md-recorded
                            path AND its sha256 == INDEX.md "Source hash:"
                  else  →  code-conformance-only + enumerated reason code
                            (source-missing | source-hash-mismatch |
                             index-missing | no-rulebook-project)
                            [+ a 5th case this research found: INDEX.md
                             exists but predates the Source-hash header
                             entirely — see Runtime State Inventory]
                            │
                            ▼
                  write/repair the FENCED
                  "## Verified Against" block
                  in CHUNK.md (GAPS_BEGIN/END-style fence)
                            │
              non-zero exit if repair was needed
                            │
                            ▼
                  process.exitCode = 1 (never throw —
                  program.parse() doesn't await actions)
                            │
                            ▼
                  session re-reads CHUNK.md, retries,
                  now exits 0

 Separately, read-only:
 /bs-check-status  →  boardsmith chunk-provenance-status --json (new)
                       │
                       aggregates ## Verified Against blocks across every
                       chunks/<slug>/CHUNK.md: edition groups, skills-version
                       groups, code-conformance-only count, chunks with NO
                       block at all (the "unknown" third state — CONTEXT.md
                       specifics item 3) — never collapsed into
                       code-conformance-only.
                       skill formats the JSON into item 3/4 of its 7-item report
```

### Recommended Project Structure

No new top-level structure — this phase extends existing files:

```
src/cli/
├── commands/
│   ├── ingest-archive.ts        # PRECEDENT — read, do not duplicate constants
│   ├── ingest-archive.test.ts   # PRECEDENT — copy the temp-project + exitCode pattern
│   └── chunk-provenance.ts      # NEW — chunk-check / chunk-provenance-status commands
│   └── chunk-provenance.test.ts # NEW
├── cli.ts                       # add 1-2 `program.command(...)` registrations
└── slash-command/bs/
    ├── templates/CHUNK.template.md   # add "## Verified Against" section
    ├── build/close.md                # Bookkeeping Sequence item 2 area — add invocation
    ├── build/playtest.md             # cites close.md's sequence BY NAME — no separate edit needed
    │                                   for the light path IF the new step is folded into the
    │                                   existing item-2-area sequence close.md defines once
    └── check-status.md               # item 3 (or new item) reads --json aggregation
```

### Pattern 1: Fenced machine-owned region

**What:** A section in a markdown state file bounded by `<!-- boardsmith:xxx:begin -->` /
`<!-- boardsmith:xxx:end -->` HTML comments. A write command refuses to operate if the fences are
missing (loud, actionable error naming how to restore them); it always replaces exactly the
content between the fences, never a wider "next heading" range.

**When to use:** Any section a session might have a real, well-intentioned motive to hand-edit.
Per `170-PROOF-RUN-2.md` Run 2, this is the *only* mechanism in the whole pipeline's proven history
with an observed behavioral effect on a live session — the session recognized the fence and
declined to edit inside it, narrating why.

**Example (from `ingest-archive.ts`):**
```typescript
// Source: src/cli/commands/ingest-archive.ts:196-205
const begin = index.indexOf(GAPS_BEGIN);
const end = index.indexOf(GAPS_END);
if (begin === -1 || end === -1 || end < begin) {
  throw new Error(
    `rulebook/INDEX.md's "${heading}" section is missing its machine-owned fences.\n` +
      `Expected ${GAPS_BEGIN} ... ${GAPS_END}.\n` +
      `This section is written by \`boardsmith ingest-gaps\`, never by hand. Restore the fences by\n` +
      `re-running \`boardsmith ingest-archive <rulebook>\`, then re-run this command.`,
  );
}
```
This phase's `## Verified Against` block needs the identical treatment: new constants
`VERIFIED_AGAINST_BEGIN` / `VERIFIED_AGAINST_END` (do not reuse `GAPS_BEGIN`/`GAPS_END` — a
distinct fence per section, matching the CONTEXT.md instruction "use the same SHAPE; do not invent
a second convention" — same mechanism, new named constants).

### Pattern 2: Repair-then-fail, never throw

**What:** A command performs whatever repair it can, then sets `process.exitCode = 1` (does NOT
`throw`, does NOT call `process.exit()` inside library code) if repair was needed; exits 0/does
nothing further if the state was already current.

**Why `process.exitCode` and not `throw`:** `program.parse()` (commander) does not `await` async
action handlers. A `throw` inside an async action handler becomes an **unhandled promise
rejection**, which Node prints as a raw stack trace — leaking internal paths to a git hook or a
build session, and defeating this repo's Hard Rule against leaking implementation details. Setting
`process.exitCode` lets the process finish its event loop, print the human-facing message via
`console.error`, and exit non-zero cleanly.

```typescript
// Source: src/cli/commands/ingest-archive.ts:414-418
// Set the exit code rather than throwing: `program.parse()` does not await action handlers, so a
// rejection surfaces as an unhandled-rejection stack trace. The caller here is a git hook or a
// build session, both of which need the non-zero status and neither of which should be shown
// this repo's internal paths.
process.exitCode = 1;
```

`ingestCheckCommand` (`ingest-archive.ts:368-419`) is the exact shape `chunk-check` must copy:
call two sub-operations, compute `repaired = a.changed || b.changed`, print a green "up to date"
line and return on `!repaired`, otherwise print yellow "REPAIRED:" bullets, tell the caller to
re-read the file, and set `process.exitCode = 1`.

### Pattern 3: Folding a forgettable second command into the first

**What:** `ingestGapsCommand` internally calls `ingestRelabelCommand` first (`ingest-archive.ts:154-159`),
unless `skipRelabel` is passed. This happened because "`ingest-relabel` was simply never invoked —
the same way every other newly-introduced step in this pipeline has been skipped. Reducing
synthesis to a single command removes the thing that gets forgotten." CONTEXT.md's specifics
section explicitly asks the planner to "consider folding write into check" the same way. Given
Phase 170's evidence is unambiguous on this point (twelve failed multi-command mechanisms, one
successful single-command one), the plan should default to **one command**
(`boardsmith chunk-check <slug>`) that both computes/writes and enforces, rather than a
`chunk-provenance` write command plus a separate `chunk-check` enforcement command — unless there's
a reason (e.g. wanting a dry-run/preview mode) to keep them distinct like `ingest-relabel --dry-run`
does.

### Anti-Patterns to Avoid

- **A second copy of any shared constant** (lexicon, fence markers, header labels) in a different
  file. `PRESENTATION_LEXICON` already exists duplicated between `ingest-archive.ts` and
  `scripts/ingest-harness/check.mjs`, pinned equal only by a dedicated test. If this phase's
  aggregation command needs constants the harness or skill text also reference, either export a
  single source of truth or add the same pinning test — do not silently duplicate.
- **Skill-text mechanics.** Any instruction of the shape "write this exact block," "run this
  computation," "compare these two hashes" belongs in the CLI command, never reworded prose. This
  is not a style preference — it is the entire finding of Phase 170.
- **Declaring scope instead of computing it.** CONTEXT.md decision 1 is explicit and confirmed by
  F-1's Run 2 evidence: never give the session (or a flag) the power to assert `full` scope. Only
  a hash comparison the command performs may set it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fenced machine-owned region parsing | A new markdown-section parser | String `indexOf`/`slice` between two exact literal marker strings, exactly as `ingestGapsCommand` does | The existing approach is already proven, tested, and simple; a general parser is unneeded complexity |
| SHA-256 of a file | Any hashing library | `node:crypto` `createHash('sha256')` | Already the pattern; zero-dependency |
| Repair-then-fail CLI signaling | A custom error/exit-code framework | `process.exitCode = 1` + plain `console.error`, matching `ingestCheckCommand` exactly | Proven to survive a live session; anything fancier is an unproven mechanism in a phase whose entire lesson is "proven mechanisms only" |

**Key insight:** every mechanical primitive this phase needs already has a working, tested
implementation one file away. The risk in this phase is not "how do I write a hash comparison" —
it is the citation-format gap (Q4) and the version-inertness gap (package.json), both of which are
requirements-shape problems, not code problems.

## Common Pitfalls

### Pitfall 1: Assuming `## Interpretation` citations are structured enough to parse
**What goes wrong:** A command is written that regexes `## Interpretation` for `rulebook/*.md`
paths expecting one citation per numbered claim, and either misses citations embedded mid-sentence
(`` `src/rules/elements.ts` ``, `RULINGS.md Ruling 25`) or picks up spurious matches.
**Why it happens:** `CHUNK.template.md`'s own comment for `## Interpretation` says only "each with
a citation into the rulebook (via INDEX.md) or RULINGS.md" — no format is specified beyond prose
convention. Real chunks (verified in both `seven` and `one-two-punch`) freely mix backtick file
paths, page numbers, quoted rule text, `RULINGS.md Ruling N` references, and source-code paths in
full sentences.
**How to avoid:** Do not attempt to derive "the slices this chunk cites" by parsing free prose. See
Open Questions Q4 for the decision this forces.
**Warning signs:** A parser that needs an ever-growing regex to catch edge cases, or one that
silently under- or over-counts cited slices with no way for a human to audit the miss.

### Pitfall 2: Assuming `boardsmith --version` or `package.json` version is a live signal
**What goes wrong:** A plan step reads `package.json`'s `version` field (or `program.version()`'s
hardcoded string) expecting it to distinguish releases, and it never changes.
**Why it happens:** `cli.ts:27` hardcodes `.version('0.0.1')` — it is a literal string, not a
`package.json` read. `git log -p -- package.json` shows the `version` field has been `0.0.1` since
the very first commit that added the file.
**How to avoid:** Either (a) the plan includes bumping `package.json`'s version as part of this
milestone's release process (a housekeeping decision, likely out of this phase's scope but worth
flagging to the user), or (b) the plan is explicit that the version component of "skills version"
is currently inert and the content hash of the installed skills tree is doing all real
discrimination — which the CONTEXT.md's decision 7 rationale already independently supports
("version alone is insufficient").
**Warning signs:** Two chunks recorded on different days, with materially different skill text,
both showing identical `boardsmithVersion: 0.0.1` in their provenance block — technically true, not
useful without the accompanying content hash.

### Pitfall 3: Trusting the reference games' `Edition:` field as a canonical string
**What goes wrong:** A grouping/aggregation command that buckets chunks by exact `Edition:` string
equality treats `seven`'s and `one-two-punch`'s real, live edition strings as unique editions
distinct from the canonical `EDITION_UNKNOWN` sentinel — silently fragmenting what should be one
group.
**Why it happens:** Both reference games predate F-1's fix and predate `ingest-archive.ts`'s exact
header format entirely (see Runtime State Inventory below). Their real `Edition:` lines are:
- `seven`: `Edition: not stated in the rulebook (no edition/printing on cover, title page, or
  colophon) — pending designer confirmation`
- `one-two-punch`: `Edition: none stated in the rulebook — © 2020 Alright Games (transcribed from
  \`rules.pdf\`, 2 pages)`

Neither equals `EDITION_UNKNOWN` (`'not stated in the rulebook'`) exactly — `seven`'s is a
superstring of it, `one-two-punch`'s is a different paraphrase entirely. This is F-1's exact
failure mode, already present in real project data, not hypothetical.
**How to avoid:** F-1's normalization (decision 5) must run BEFORE PROV-03 groups by edition, and
the normalization function needs to handle "recognizably-empty" as more than exact-string-equals —
CONTEXT.md's own wording ("normalise recognisably-empty edition strings ... or refuse them") allows
either a fuzzy-match normalizer or a hard refusal; a hard refusal is safer per this repo's Pit of
Success ethos but would make both reference games' existing `INDEX.md` files non-conforming until
manually fixed. Decide and record this in the plan.
**Warning signs:** `/bs-check-status`'s edition-drift report shows three "editions" for a game that
only ever had one printing.

## Runtime State Inventory

Both reference games (`~/BoardSmithGames/seven`, `~/BoardSmithGames/one-two-punch`) were built
before Phase 170 landed `ingest-archive.ts`'s exact `INDEX.md` header contract. This phase's
scope-computation logic (decision 1) must handle their as-is state gracefully, since REQUIREMENTS.md
explicitly puts "backfilling provenance into existing bs-built games" **out of scope** — no
migration phase — and both are the phase's own proof targets.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **`rulebook/source/` archive dir** | Absent in both games. `rules.pdf` sits at the project ROOT (`~/BoardSmithGames/seven/rules.pdf`, `~/BoardSmithGames/one-two-punch/rules.pdf`), never copied into `rulebook/source/`. | Code edit: the scope-computation logic must treat this as `source-missing` (one of the 4 enumerated codes) — do NOT attempt to auto-locate `rules.pdf` at the project root as a fallback; that would be inventing a second discovery convention the CONTEXT.md decisions don't sanction. |
| **`Source hash:` header line** | Absent from both `INDEX.md` files entirely — neither the label nor any value. This is a FIFTH case beyond the four enumerated reason codes (`source-missing`, `source-hash-mismatch`, `index-missing`, `no-rulebook-project`): the index exists and has *some* header content but predates the `Source hash:` line's existence. `source-hash-mismatch` implies a hash exists to mismatch; here there is none to compare. | Code edit: the plan must decide whether this collapses into `source-hash-mismatch` (vacuous "no match because nothing recorded") or needs a distinct reason code. This is a genuine gap in the CONTEXT.md decision list, not an oversight in this research — flag to the user. |
| **`Edition:` field format** | Both games have non-canonical free-text edition strings predating F-1's fix (see Pitfall 3 above) — real, live data exhibiting exactly the bug F-1 describes. | Code edit only (F-1's normalization, already in scope per decision 5) — no data migration, since no migration phase exists for this milestone. |
| **`## Verified Against` block** | Absent from every single CHUNK.md in both games (12 chunks in one-two-punch, 17 in seven, all `Status: verified` or `verified (user-waived)`). | None — this is the exact "unknown" third state CONTEXT.md's specifics section names explicitly ("A chunk verified before this phase existed has no block... it is *unknown*, a third state"). No code or data action needed beyond correctly classifying it as `unknown`, never `code-conformance-only`, in `chunk-check`'s and the aggregation command's output. |
| **`## Verified Commit Hash`** | Present and correctly filled in every chunk checked (full 40-char git SHA, e.g. `d5d10bc3572bee4418f72ec39ef10e4c172d3a06` in seven's `scoring-set-of-7`). | None — this field is unaffected by this phase; PROV-01's new block is a sibling section, not a replacement. |
| **`## Interpretation` citation format** | Free-form prose mixing rulebook slice paths, page numbers, quoted text, `RULINGS.md Ruling N` references, and source-code paths, verified in both games (see Pitfall 1). | **Decision required, not a migration** — see Open Questions Q4. No existing data needs to change; the question is whether/how a command can compute "the slices cited" from this shape at all. |

## Code Examples

### The exact repair-then-fail command shape to copy

```typescript
// Source: src/cli/commands/ingest-archive.ts:368-419 (ingestCheckCommand)
export async function ingestCheckCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  const relabel = await ingestRelabelCommand({ project: projectDir, quiet: true });
  const gaps = await ingestGapsCommand({ project: projectDir, skipRelabel: true, quiet: true });
  const repaired = relabel.relabelled > 0 || gaps.changed;
  // ... print, then:
  if (!repaired) return; // exit 0 implicitly
  // ... print REPAIRED bullets + "re-read before continuing" message
  process.exitCode = 1; // never throw — program.parse() does not await action handlers
}
```

### The exact fence-refusal shape to copy

```typescript
// Source: src/cli/commands/ingest-archive.ts:196-205
const begin = index.indexOf(GAPS_BEGIN);
const end = index.indexOf(GAPS_END);
if (begin === -1 || end === -1 || end < begin) {
  throw new Error(
    `rulebook/INDEX.md's "${heading}" section is missing its machine-owned fences.\n` +
      `Expected ${GAPS_BEGIN} ... ${GAPS_END}.\n` +
      `This section is written by \`boardsmith ingest-gaps\`, never by hand. Restore the fences by\n` +
      `re-running \`boardsmith ingest-archive <rulebook>\`, then re-run this command.`,
  );
}
```
(Note: this one legitimately `throw`s, not `process.exitCode` — this is a caller-error path invoked
directly, not the terminal repair-vs-fail branch of `ingestCheckCommand`. Follow the same
distinction: structural-error paths throw, "repair happened, notify and non-zero" paths set
`process.exitCode`.)

### Command registration shape

```typescript
// Source: src/cli/cli.ts:140-146 (ingest-gaps registration — closest analog)
program
  .command('ingest-gaps')
  .description('Relabel presentation-only Derived lines, then fill Open Rules Gaps from the slices')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--skip-relabel', 'Do not relabel presentation-only Derived lines first')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(ingestGapsCommand);
```

### The test-suite pattern to copy exactly (temp project + exitCode save/restore)

```typescript
// Source: src/cli/commands/ingest-archive.test.ts:341-349
describe('ingest-check', () => {
  let exitCode: number | undefined;
  beforeEach(() => {
    exitCode = process.exitCode;
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = exitCode;
  });
  // ... individual tests assert process.exitCode === 1 or undefined after each call
});
```
And the temp-project helper (`ingest-archive.test.ts:31-51`): `fs.mkdtemp(join(tmpdir(), 'bs-...'))`
in `beforeEach`, `fs.rm(dir, { recursive: true, force: true })` in `afterEach`, a small `run()`
helper that creates a nested `project` dir and returns its path.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `## Open Rules Gaps` filled by session narration | Filled by `boardsmith ingest-gaps`, fenced, enforced by `boardsmith ingest-check` from `/bs-build-chunk` Step 0 | Phase 170, commits `92f88bb9` + `c32bc184`, 2026-07-28 | Direct precedent this phase must replicate for `## Verified Against` |
| `--edition` free text trusted verbatim | Should be normalized to `EDITION_UNKNOWN` or refused (F-1, decision 5, **this phase**) | Not yet shipped — this phase's job | Both reference games currently carry non-canonical edition strings; F-1's fix must run before PROV-03 groups by edition or the grouping will fragment falsely |

**Deprecated/outdated:** Nothing in this phase's domain is deprecated; it is pure net-new
provenance recording layered on top of Phase 170's already-shipped ingest contract.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The new `## Verified Against` fence constants should be distinct from `GAPS_BEGIN`/`GAPS_END` (not reused) | Pattern 1 | Low — CONTEXT.md explicitly says "same shape, not a second convention," which this research reads as "same mechanism, new marker names"; if the user meant literally reuse the gaps fence, that would be a data-corruption risk (two unrelated sections sharing one fence pair) and should be confirmed at plan time |
| A2 | `chunk-check` should default to folding write+enforce into one command (Pattern 3) rather than keep them separate CLI verbs | Pattern 3, Don't Hand-Roll | Medium — this is CONTEXT.md's own "consider folding" suggestion, not a hard decision; the planner should decide explicitly rather than let this research's recommendation stand unchallenged |
| A3 | The 5th "INDEX.md predates Source hash: entirely" case (Runtime State Inventory) needs its own reason code or explicit vacuous-mismatch handling | Runtime State Inventory | High if unresolved — silently treating it as `source-hash-mismatch` is defensible but was never explicitly decided in CONTEXT.md; getting this wrong means the two reference games either can't be proven against at all, or are proven against with a reason code that doesn't quite describe their real state |

**If this table is empty:** not applicable — see above.

## Open Questions

1. **Q4 — What IS "the slices a chunk cites," mechanically?**
   - What we know: `## Interpretation`'s real-world shape is free prose with embedded citations of
     varying form (rulebook slice + page + quote, `RULINGS.md Ruling N`, source-code paths). The
     template's own contract does not mandate a parseable structure.
   - What's unclear: whether PROV-01 can be satisfied by (a) hashing every slice in
     `INDEX.md`'s `## Slices` table wholesale regardless of whether this specific chunk cites it —
     directly contradicted by decision 4's explicit rejection ("Hashing all slices would flag a
     chunk stale when an unrelated slice changed... a check that fires on correct work gets
     waived"); (b) requiring a NEW structured citation field going forward (e.g., a parseable
     `Cites: rulebook/01-x.md` line per claim) while old chunks fall into the "unknown" bucket;
     (c) best-effort regex extraction of `` `rulebook/*.md` `` backtick-quoted paths from
     `## Interpretation`, accepting it may over/under-count, and reporting the extracted set to the
     human for confirmation once during `close` rather than trusting it silently.
   - Recommendation: (b) is the only option consistent with "mechanical, one correct output" (the
     CONTEXT.md sort rationale for all three PROV requirements) — a regex over unstructured prose
     is not mechanical, it is a heuristic with false positives/negatives, which is exactly the
     category of thing Phase 170 proved doesn't survive contact with live sessions when embedded in
     skill text, and doesn't become more trustworthy embedded in code that has no ground truth to
     check itself against. This is a genuine open decision for the plan, not something this
     research can resolve unilaterally — surface it explicitly rather than picking silently.

2. **The 5th scope-computation case (pre-Source-hash `INDEX.md`).**
   - What we know: both reference games have this exact shape today (see Runtime State Inventory).
   - What's unclear: whether it's `source-hash-mismatch` (vacuously), a new 5th enumerated code, or
     folds into `index-missing` (arguably wrong — the index is present, just an older shape).
   - Recommendation: treat as a genuinely new enumerated code (e.g. `source-hash-not-recorded`) —
     conflating "recorded and different" with "never recorded" loses honest information PROV-02
     exists to preserve, and CONTEXT.md's own bar for reduced-scope reasons is "an ENUMERATED CODE,
     not free text," which argues for precision over reuse.

3. **Does `/bs-build-chunk` Step 0's existing `ingest-check` call get joined by a second
   `chunk-check`/`chunk-provenance` call, or does the new command run ONLY from `close`?**
   - What we know: CONTEXT.md decision 6 says "`close` runs `boardsmith chunk-check <slug>`" —
     scoped to close, not Step 0.
   - What's unclear: whether `/bs-check-status`'s consistency check (Step 0 of `check-status.md`)
     should also invoke the new command in read-only/`--json` mode, or purely read the block
     `close` already wrote.
   - Recommendation: keep `/bs-check-status` strictly read-only per its own documented posture
     ("This skill performs no writes of any kind") — its new item should read the existing
     `## Verified Against` blocks across chunks via a separate `--json` aggregation subcommand
     (read-only), never invoke the write/repair command. This matches `check-status.md`'s explicit
     "read-only reader ... dispatches no subagents" framing already in the file.

## Environment Availability

Skipped — this phase has no external dependencies beyond the Node/TypeScript toolchain already
present and exercised by every other CLI command in this repo (`node`, `npm`, `vitest`, `git`, all
confirmed available and in active use by the precedent commands and their tests).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^2.1.0 |
| Config file | `vitest.config.ts` (project root) |
| Quick run command | `npx vitest run src/cli/commands/chunk-provenance.test.ts` (once authored) |
| Full suite command | `npm test` (= `vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROV-01 | `chunk-check` writes a correctly-shaped `## Verified Against` block with slice paths/hashes, edition, boardsmith version, skills version, scope | unit (temp project fixture) | `npx vitest run -t "chunk-check writes"` | ❌ Wave 0 — new file `src/cli/commands/chunk-provenance.test.ts` |
| PROV-01 | Fence refuses to write when fences absent, exact error text naming restoration | unit | `npx vitest run -t "machine-owned fences"` | ❌ Wave 0 |
| PROV-02 | Scope computes `code-conformance-only` + correct enumerated reason for each of source-missing / hash-mismatch / index-missing / no-rulebook-project (+ the 5th case if adopted, Q2) | unit, one test per reason code | `npx vitest run -t "scope"` | ❌ Wave 0 |
| PROV-02 | Scope never presents partial as full — property-style test asserting `full` requires BOTH archive-exists AND hash-match, never either alone | unit | `npx vitest run -t "full requires"` | ❌ Wave 0 |
| PROV-03 | Aggregation command's `--json` output correctly buckets chunks with no block as `unknown`, distinct from `code-conformance-only` | unit | `npx vitest run -t "unknown bucket"` | ❌ Wave 0 |
| PROV-03 | Aggregation groups correctly by (normalized) edition and skills version | unit | `npx vitest run -t "groups by edition"` | ❌ Wave 0 |
| F-1 | `--edition` free-text paraphrase of "no edition" normalizes to `EDITION_UNKNOWN`, or is refused with an actionable message | unit, extending `ingest-archive.test.ts`'s existing edition describe block | `npx vitest run -t "edition"` | Existing file `ingest-archive.test.ts`, new test cases |
| — | `chunk-check` repair-then-`process.exitCode = 1` shape, retry passes | unit, copy the exact `ingest-check` describe block shape | `npx vitest run -t "chunk-check"` | ❌ Wave 0 |

**Live-session proof (cannot be unit-tested — see below):** whether `close`'s skill-text invocation
of the new command actually fires on a real multi-turn session. Phase 170's own history shows a
contract test proves the instruction *exists*, never that it is *followed*.

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/commands/chunk-provenance.test.ts`
- **Per wave merge:** `npm test` (full suite)
- **Phase gate:** full suite green before `/gsd:verify-work`, PLUS a live-session proof (see below)
  before PROV-01/02/03 can honestly be marked Complete — do not repeat Phase 170's mistake of
  marking requirements Complete off contract-test green alone.

### Wave 0 Gaps
- [ ] `src/cli/commands/chunk-provenance.test.ts` — new file, covers PROV-01/02/03 unit behavior
      per the table above
- [ ] Extend `src/cli/commands/ingest-archive.test.ts`'s existing edition-handling describe block
      with F-1's normalize-or-refuse cases (the file and describe block already exist; only new
      `it()`s are needed)
- [ ] **Live proof, not a Wave 0 test-framework gap but a phase-gate requirement**: run
      `/bs-build-chunk`'s `close` step on a real chunk in a throwaway project (or on
      `one-two-punch`/`seven` under a git worktree/branch, NEVER on the canonical clean tree per
      the "never mutate seven" rule — use a disposable clone) and confirm the `## Verified Against`
      block actually appears without operator intervention. `170-PROOF-RUN-2.md`'s "What is still
      unproven" section flags this exact class of risk for the `close`-invoked `ingest-check` call
      too — it has never been exercised by a live session either, as of this research. Plan a
      dedicated proof step; do not assume skill-text invocation "just works" because the contract
      test passes.

## Security Domain

Not applicable in the ASVS sense — this phase touches no authentication, session, network, or
user-input-validation surface. It is local file I/O (hashing, reading/writing markdown files in a
git-tracked project directory) executed by a CLI the designer already runs locally. No new attack
surface is introduced. `security_enforcement` config was not checked in `.planning/config.json` but
this section is included per protocol; the honest assessment is "no applicable ASVS categories."

## Sources

### Primary (HIGH confidence — all read directly this session)
- `src/cli/commands/ingest-archive.ts` — full file, the precedent
- `src/cli/commands/ingest-archive.test.ts` — full file, the test pattern
- `src/cli/cli.ts` — command registration
- `src/cli/slash-command/bs/templates/CHUNK.template.md` — section structure/order
- `src/cli/slash-command/bs/build/close.md` — Bookkeeping Sequence, light-path reuse
- `src/cli/slash-command/bs/build/playtest.md` — light-path citation of close.md by name
- `src/cli/slash-command/bs/check-status.md` — read-only aggregation contract
- `src/cli/slash-command/bs/build-chunk.md` (Step 0) — existing `ingest-check` invocation pattern
- `src/cli/slash-command/bs/state-machine.md` — status enum, step names
- `src/cli/commands/install-claude-command.ts` — skills-tree install layout (`bs-shared/`)
- `~/BoardSmithGames/seven/rulebook/INDEX.md`, `~/BoardSmithGames/seven/chunks/*/CHUNK.md` — live
  reference-game data
- `~/BoardSmithGames/one-two-punch/rulebook/INDEX.md`,
  `~/BoardSmithGames/one-two-punch/chunks/*/CHUNK.md` — live reference-game data
- `git log -p -- package.json` (this repo) — confirms version has never changed from `0.0.1`
- `.planning/phases/170-ingest-contract-upgrade/170-MECHANISMS.md` — the fourteen-attempt history
- `.planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN-2.md` — the human gate findings F-1/F-2/F-3
- `.planning/phases/171-provenance-recording/171-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — requirement text and project state

### Secondary / Tertiary
None used — every claim in this document traces to a file read or command run in this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, every primitive already in use in the precedent file
- Architecture: HIGH — the precedent pattern is unambiguous and CONTEXT.md mandates copying it
- Pitfalls: HIGH for the citation-format and version-inertness findings (directly observed in
  live repo/game data); MEDIUM for how the planner should resolve them (genuinely open decisions)

**Research date:** 2026-07-28
**Valid until:** Should be treated as valid for the life of Phase 171's planning — the underlying
facts (package.json version history, reference-game file contents, ingest-archive.ts's shape) are
static unless another phase changes them first. Re-verify only if 170's artifacts are touched again
before 171 is planned.
