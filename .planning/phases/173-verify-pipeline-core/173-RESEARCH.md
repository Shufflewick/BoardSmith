# Phase 173: Verify Pipeline Core - Research

**Researched:** 2026-07-28
**Domain:** BoardSmith CLI (Node/TypeScript) + Claude Code Agent Skills (bs- family)
**Confidence:** HIGH — every finding below is empirical (source read in full, or a live command run
against a scratch copy of a real reference game and diffed). No external library research was
needed; this is entirely an internal-repo investigation.

## Summary

Phase 173 is buildable, but **decision 1's adoption path is not implementable as literally
written against the current `ingest-archive` command** — this is proven empirically below, not
assumed. `ingest-archive`'s "INDEX.md already exists" branch only rewrites header lines that
already match its four exact regexes; run against either real reference game it (a) silently
corrupts the `Source:` line's prose (the line is a multi-line sentence that happens to start with
the literal token `Source:`), (b) silently fails to insert `Source hash:` and `Transcribed:` at
all (regex `.replace()` on a non-matching pattern is a no-op, not an insert), and (c)
unconditionally overwrites `Edition:` with a poorer value if `--edition` is not re-supplied. The
practical consequence is worse than cosmetic corruption: because `computeVerificationScope()`
(Phase 171) keys `pre-provenance-project` vs. `full` purely on whether a `Source hash:` line
exists, running today's `ingest-archive` against `seven` or `one-two-punch` as they stand would
NOT convert them to `full` scope — the entire point of decision 1's adoption path would silently
fail. This is a concrete, in-scope fix this phase must make (extend `ingestArchiveCommand`'s
existing-INDEX branch to append missing header lines and refuse — not corrupt — an ambiguous
`Source:` line), not a redesign of the locked decision.

Everything else validates cleanly. The installer's `SHARED_DIRS`/`SKILL_ENTRY_POINTS` shape is a
plain array-registration job — `bs/verify/` is NOT auto-discovered, it must be added to
`SHARED_DIRS` explicitly, exactly like `bs/ingest/` and `bs/build/` were. The
`transcription-subagent.md` reuse (decision 15) is achievable as a small, additive, non-forking
change: the file already treats "Output directory" as one of its three dispatch inputs in prose,
but Section 1's actual write instructions hardcode the literal string `rulebook/` throughout —
that literal needs to become a reference to the dispatched output directory, nothing else in the
file changes. The resume-ledger convention (fenced machine-owned regions) is well precedented by
`GAPS_BEGIN/END` and `VERIFIED_AGAINST_BEGIN/END`, and the Session Lock grammar is free-text enough
(`"<slug> @ <session-id> — locked at <ISO timestamp>"`) to carry a verify-shaped identity with zero
parser changes, because nothing in this repo parses that line with code — it is skill-text-read
only. No glob or walker in this repo recurses into `rulebook/` in a way that would pick up a
dot-prefixed staging directory.

**Primary recommendation:** Sequence a dedicated early task that (1) fixes `ingest-archive`'s
existing-INDEX.md branch to be robust against a pre-170 malformed INDEX.md (append missing header
lines; stop-and-ask rather than corrupt an ambiguous `Source:` line) and proves it converts both
reference games to `full` scope end-to-end, before building anything else in this phase — every
other success criterion is unprovable against real data until this lands.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Skill installation/registration (`bs-verify-game`) | CLI / installer | — | Filesystem copy job, same tier as the existing 6 skills; `install-claude-command.ts` owns it exclusively. |
| Source adoption (archive + hash) | CLI (`ingest-archive`) | Skill text (gate/ask) | Hashing and header-writing are mechanical (CLI); the designer-confirmation gate is judgment (skill text), per CONTEXT.md decision 2. |
| Re-transcription fan-out | Skill text (orchestrator) + subagents | CLI (path computation only) | Dispatch/confirmation loop is judgment (mirrors `ingest/transcription.md`); WHERE files land is a pure path computation the CLI or orchestrator prose can make deterministic. |
| Staging tree location/isolation | CLI (path computation) | — | "Never a live slice" must be structural, not instructed — decision 5's dot-prefix. |
| Resume ledger (RUN.md) | CLI (write/read command) | Skill text (invoke only) | Decision 11: mechanical, must be a command, not prose. |
| Session lock (verify-shaped) | Skill text (SKETCH.md edit) | — | No code parses this line anywhere in the repo; it is a documented convention only. |

## User Constraints (from CONTEXT.md)

<user_constraints>
### Locked Decisions

See `.planning/phases/173-verify-pipeline-core/173-CONTEXT.md` in full — all 16 decisions are
binding and are NOT re-litigated here. Summary of the ones this research most directly informs
(do not treat this summary as a substitute for the source document):

1. **Adopt-on-first-verify** — when `rulebook/source/` is absent but a root `rules.pdf` exists,
   verify detects it, asks once, and runs `ingest-archive` to archive+hash it, then proceeds as a
   normal full verify. Gated on designer confirmation (writes to the live project). A hash
   mismatch against a previously archived source is the `source-changed` signal, not an error.
   Multiple candidate sources at root ⇒ STOP AND ASK, never guess.
5. Staging location: `rulebook/.verify/<run-id>/slices/` — dot-prefixed, run-scoped, inside
   `rulebook/`.
6. Committed, not gitignored.
7. Staging is KEPT after the pass closes; path recorded in the provenance block.
8. Live slices are NEVER overwritten in this phase. No `--apply`, no cutover.
9. A machine-owned, append-only `RUN.md` ledger, fenced-region convention, one record per
   completed step.
10. Step granularity = the slice-unit `ingest/transcription.md`'s fan-out already dispatches.
11. The ledger is written/read by a CLI command, not skill text.
12. Verify reuses `SKETCH.md`'s EXISTING session lock, verify-shaped identity, 24h staleness rule
    reused verbatim.
13. Layout: `bs/verify-game.md` + a `bs/verify/` subdirectory, mirroring `bs/ingest/`/`bs/build/`.
14. VERIFY-07 enforced structurally: subagent writes its own output, returns a structured summary
    only, never slice content.
15. Reuse `ingest/transcription-subagent.md` UNCHANGED, parameterized by output directory. No fork.
16. This phase classifies NOTHING — stages and records only.

### Claude's Discretion

Everything not explicitly pinned above is the planner's call within the guardrails this research
establishes — in particular: the exact `run-id` format (must derive from
`date -u +%Y-%m-%dT%H:%M:%SZ`, per the Specifics section), the exact RUN.md record shape (must
identify a slice-unit and prove write-completion — see "Resume Ledger" below), and how the
adoption-path fix to `ingest-archive` is sequenced relative to the rest of the phase.

### Deferred Ideas (OUT OF SCOPE)

Classification (174), impact map + repair gating (175), stale-chunk repair (176), derived-line
re-derivation (177), worked-example tests (178), source-free mode (179), cutover, retention/pruning
policy for old runs, wiring `trace-check`/`drift-check` into the verify report.
</user_constraints>

## Phase Requirements

<phase_requirements>
| ID | Description | Research Support |
|----|-------------|------------------|
| VERIFY-01 | `/bs-verify-game` installs as a new skill and runs against an existing bs-built project without rebuilding it | "The Skill-Installation Mechanism" section — exact `SKILL_ENTRY_POINTS`/`SHARED_DIRS`/`SHARED_LEAF_PROBES`/test-file registration points identified |
| VERIFY-02 | Full rulebook re-transcribed into a non-destructive staging tree; existing slices never overwritten before close | "The Staging Tree" + "Where the Run Directory Lives" sections |
| VERIFY-07 | Orchestrator never reads a full slice; re-transcription and classification run in subagents | "The Orchestrator/Subagent Contract" section — exact reuse mechanics and the minimal parameterization change |
| VERIFY-08 | A pass is resumable; crash resumes at the first unrecorded step | "The Resume Ledger's Real Shape" section |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Never leave processes running in the background (no lingering `boardsmith dev`, no orphaned
  child processes from proof harnesses).
- No dummy data / fallbacks / hacks — the adoption-path fix below must be a real fix to
  `ingest-archive`, not a workaround that papers over the corruption found.
- Pit of Success: the easy path (running `ingest-archive` as designed) must be the correct path;
  currently it silently does the wrong thing on real data — this phase must close that gap, not
  route around it.
- Do not remove debug output before confirming a fix with the user.
- Real browser testing via the Claude Code Chrome extension is NOT applicable here — this phase has
  no UI surface; proof is CLI + skill-session based, per BoardSmith's own CLAUDE.md testing rules
  (verify behavior by running the application, not reviewing code structure; trace at least one
  real value through the full stack).
- No Backward Compatibility: fixing `ingest-archive`'s existing-INDEX branch is not "deprecating"
  anything — extend it directly.
- Prove Before Fix: the adoption-path corruption below was independently reproduced against a
  scratch copy before being asserted; do the same discipline for any other suspected defect found
  during planning/execution.

## Standard Stack

No new external dependencies. This phase is 100% internal: TypeScript CLI commands under
`src/cli/commands/`, registered in `src/cli/cli.ts`; skill-text markdown under
`src/cli/slash-command/bs/`. No `npm install` is needed and the Package Legitimacy Audit below is
consequently empty by design.

### Alternatives Considered

None — the codebase's own established patterns (fenced machine-owned regions, `--json`-emitting
read commands, `program.parseAsync()` + top-level catch) are the only sanctioned shapes; CONTEXT.md
explicitly forbids inventing a second ledger convention (decision 9) or a second lock mechanism
(decision 12).

## Package Legitimacy Audit

Not applicable — no packages are installed by this phase.

## Architecture Patterns

### System Architecture Diagram

```
Designer types /bs-verify-game
        │
        ▼
┌───────────────────────────────┐
│ bs-verify-game/SKILL.md        │  ← orchestrator, thin entry point
│ (installed from bs/verify-     │
│  game.md)                      │
└───────────────┬────────────────┘
        │ Step 0: consistency check (state-machine.md, every bs- entry point)
        │ Step 0: session lock check/acquire (SKETCH.md Session Lock line, verify-shaped identity)
        ▼
┌────────────────────────────────┐
│ Source resolution (decision 1) │
│  - rulebook/source/ present?    │──No──▶ root rules.pdf present? ──▶ ask designer ──▶
│                                  │                                    `boardsmith ingest-archive`
│                                  │                                    (FIXED this phase, see below)
│  - multiple root candidates?    │──Yes─▶ STOP AND ASK (never guess)
└───────────────┬──────────────────┘
        │ archived + hashed source now guaranteed
        ▼
┌────────────────────────────────┐
│ boardsmith verify-run-init      │  ← NEW CLI command (mechanical):
│  (or equivalent path-computing  │     allocates run-id (date -u +%Y-%m-%dT%H:%M:%SZ-derived),
│   command)                      │     creates rulebook/.verify/<run-id>/slices/, RUN.md
└───────────────┬──────────────────┘
        │ orchestrator reads RUN.md to find first unrecorded slice-unit (resume)
        ▼
┌────────────────────────────────┐
│ Fan-out dispatch (reuses        │  ← orchestrator dispatches one Task subagent per
│  ingest/transcription.md shape, │     page range/slice-unit, output dir = staging path
│  transcription-subagent.md      │     (parameterized — see below), never rulebook/ directly
│  UNCHANGED text)                │
└───────────────┬──────────────────┘
        │ subagent writes rulebook/.verify/<run-id>/slices/NN-topic.md directly
        │ subagent returns ONLY a structured summary (no slice text) — VERIFY-07
        ▼
┌────────────────────────────────┐
│ boardsmith verify-record-step   │  ← NEW CLI command (mechanical, decision 11):
│  (or folded into the dispatch   │     appends one RUN.md record per completed slice-unit,
│   loop's per-section step)      │     write-ordered so a crash never records an incomplete write
└───────────────┬──────────────────┘
        │ repeat until every slice-unit recorded
        ▼
┌────────────────────────────────┐
│ Pass closes: staging KEPT,      │  ← decision 7 — no cutover, no --apply, live slices untouched
│  path recorded in provenance    │     (VERIFY-02 / decision 8)
└──────────────────────────────────┘
```

### Recommended Project Structure

No new top-level `src/` directories. New files land in the existing skill-tree shape:

```
src/cli/slash-command/bs/
├── verify-game.md              # NEW — entry point, mirrors ingest-rules.md's orchestrator shape
└── verify/                     # NEW subdirectory — mirrors bs/ingest/, bs/build/
    ├── source-resolution.md    # decision 1's gated adoption flow (judgment — skill text)
    ├── staging-dispatch.md     # the verify-side sibling of ingest/transcription.md (judgment)
    └── (transcription-subagent.md is NOT duplicated here — decision 15 reuses
        ../ingest/transcription-subagent.md UNCHANGED via the existing relative path shape)

src/cli/commands/
├── verify-run-init.ts          # NEW — allocates run-id, creates staging dir + RUN.md skeleton
├── verify-run-init.test.ts
├── verify-record-step.ts       # NEW — append-only RUN.md writer/reader (decision 9, 11)
├── verify-record-step.test.ts
└── ingest-archive.ts           # MODIFIED — existing-INDEX branch fixed for the adoption path
```

### Pattern 1: Fenced machine-owned region (reuse verbatim)

**What:** A `<!-- boardsmith:<name>:begin -->` / `<!-- boardsmith:<name>:end -->` pair delimiting
a section only a CLI command writes. Writes are bounded to strictly between the fences; their
absence is a hard, actionable thrown error, never a silent re-fence.
**When to use:** Any new record a session might otherwise be tempted to hand-author (decision 9's
RUN.md is exactly this).
**Example — the exact shape to copy** (from `ingest-archive.ts`, `GAPS_BEGIN`/`GAPS_END`; the
`## Verified Against` block in `chunk-provenance.ts` follows the identical pattern with
`VERIFIED_AGAINST_BEGIN`/`END`):

```typescript
// Source: src/cli/commands/ingest-archive.ts:97-98
export const GAPS_BEGIN = '<!-- boardsmith:gaps:begin -->';
export const GAPS_END = '<!-- boardsmith:gaps:end -->';
// ... write strictly between begin.length and the end index; throw if either index is -1.
```

A new `RUN_BEGIN`/`RUN_END` pair (or per-record fencing, if the planner prefers one fence per
record for append-only-without-full-rewrite semantics — see "Resume Ledger" below for the
crash-safety argument) should follow this exact shape.

### Pattern 2: repair-then-fail terminal path (reuse verbatim)

**What:** A command that repairs on disk AND sets `process.exitCode = 1` (never throws) when a
repair was needed, so the caller is forced to re-read but the project is never left uncommittable.
**When to use:** Not directly needed by 173 (nothing here repairs an existing broken state the way
`ingest-check`/`chunk-check` do), but the same `process.exitCode = 1`-not-`throw` discipline
applies to any new CLI command this phase adds that can fail from a live skill-text invocation —
`program.parse()` does not await async actions, so a thrown `Error` from an un-awaited action
handler becomes a raw unhandled-rejection stack trace. `cli.ts`'s existing top-level
`program.parseAsync()` + `try/catch` (added in Phase 171) already covers this for every command
registered after it — **new commands do not need their own catch, they inherit this.**

### Pattern 3: `--json` + human-readable dual output (reuse verbatim)

**What:** Every read-oriented command in this pipeline (`chunk-provenance-status`, `trace-check`,
`drift-check`) accepts `--json` and, absent it, prints a grouped, count-first human report. New
verify commands (`verify-run-init`, a resume-status reporter if the planner adds one) should follow
this exact convention so `/bs-verify-game` formats rather than parses prose — decision 11's own
rationale.

### Anti-Patterns to Avoid

- **Forking `transcription-subagent.md`:** decision 15 explicitly rejects this. The subagent
  contract's `BS-DISPATCH-V2` validation handshake, its three-line-kind decision test, and its
  structured-return shape are all reused byte-identical; only the dispatch prompt's "Write slices
  to:" value changes, and (per the finding below) one internal cross-reference needs to stop
  hardcoding the literal string `rulebook/`.
- **A second ledger/lock convention:** decisions 9 and 12 both explicitly reject inventing a
  parallel mechanism. Reuse the fence shape and the `SKETCH.md` Session Lock line verbatim.
- **Restating the context-economics rule in prose and trusting it:** decision 14 explicitly rejects
  this — Phase 170 disproved exactly that pattern for twelve other mechanisms. VERIFY-07 must be
  enforced by the subagent writing its own output and returning only a summary — the SAME
  mechanism `transcription-subagent.md` already uses, not a restated warning.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fenced machine-owned regions | A new comment-marker scheme | `GAPS_BEGIN/END` / `VERIFIED_AGAINST_BEGIN/END` shape, string constants + `indexOf` bounds check | Proven pattern, one behavioural success in this pipeline's history (Phase 170 Run 2's declined edit) |
| Timestamp generation for `run-id` | `new Date().toISOString()` computed by the session, or any session-fabricated value | `date -u +%Y-%m-%dT%H:%M:%SZ` shell invocation, the ONLY sanctioned timestamp source per `state-machine.md`'s Session Lock section | A session-computed/estimated timestamp is exactly the fabrication `state-machine.md` forbids for the lock; reuse the identical discipline for run-id |
| Non-zero exit / error surfacing from a new CLI command | `throw` inside an `.action()` handler | `process.exitCode = 1` + a caught, one-line `Error` message (or rely on the existing top-level `parseAsync()` catch in `cli.ts`) | `program.parse()` does not await; an uncaught rejection prints a raw stack trace with internal paths, which CLAUDE.md forbids |
| Enumerating `rulebook/` contents | A recursive glob/walk | `fs.readdir(rulebookDir)` (non-recursive), filtered to `.md` files, exactly as `chunk-provenance.ts:378` and `ingest-archive.ts:226,354` already do | Non-recursive + `.md`-filter already structurally excludes any dot-prefixed staging directory without needing a new exclusion rule |

**Key insight:** Every mechanical piece this phase needs already has a working precedent
elsewhere in this exact repo, proven against real data in Phases 170-172. The risk in this phase is
not "what pattern to invent" — it is "does the one existing near-miss (`ingest-archive`'s
existing-INDEX branch) actually work against real, messy, pre-contract data," and the answer,
proven below, is no.

## Common Pitfalls

### Pitfall 1: `ingest-archive` silently fails to establish provenance on a pre-170 project (CRITICAL — proven empirically)

**What goes wrong:** Running `boardsmith ingest-archive <rulebook>` against a project whose
`INDEX.md` already exists but predates the four-header-line contract (both `seven` and
`one-two-punch`) does NOT produce a `full`-scope project. It silently no-ops on two of the four
required header insertions and corrupts a third.

**Why it happens:** `ingestArchiveCommand`'s existing-INDEX branch (`ingest-archive.ts:527-548`)
uses `String.prototype.replace(/^Label:.*$/m, newLine)` for each of `Edition:`, `Source:`,
`Source hash:`, `Transcribed:`. `.replace()` on a pattern that finds no match returns the string
**unchanged** — it does not insert the line. Neither reference game's `INDEX.md` has a `Source
hash:` or `Transcribed:` line at all (confirmed by direct `grep -n` against both real files, see
"Evidence" below), so those two required provenance fields are silently never written.
Additionally, `seven`'s (and `one-two-punch`'s) `Source:` line is not a clean single-token value —
it is the FIRST line of a wrapped, multi-sentence paragraph that happens to start with the literal
token `Source:` (`Source: \`rules.pdf\` (2 pages). This index is the term → slice cross-reference.
It is built from the` / next line: `transcription subagents' returned...`). The `/^Source:.*$/m`
regex matches only that first physical line and replaces it wholesale, leaving the paragraph's
continuation line (`transcription subagents' returned \`citedTerms[]\` lists...`) as an orphaned
sentence fragment directly below the new `Source: rulebook/source/rules.pdf` line.

**Downstream consequence, independently confirmed:** `computeVerificationScope()`
(`chunk-provenance.ts:95-140`, Phase 171) determines `pre-provenance-project` vs. `full` purely by
whether a `Source hash:` line exists (`hashMatch = /^Source hash:\s*(.*)$/m.exec(index); if
(!hashMatch) return { scope: SCOPE_CODE_ONLY, reason: 'pre-provenance-project', ... }`). Because
`ingest-archive` (as currently written) never inserts that line on an existing-but-legacy
`INDEX.md`, running it against either reference game leaves the project computing
`pre-provenance-project` — **exactly the state it was in before "adoption" ran.** Decision 1's
entire premise — that running the existing `ingest-archive` turns a pre-provenance project into a
verifiable one — does not hold against the actual command as it exists today.

**How to avoid:** This phase must extend `ingestArchiveCommand`'s existing-INDEX branch (not fork
a new command — the fix belongs in the same function, since decision 1 says "runs the existing
`ingest-archive`", and the fix keeps that literally true) to:
1. **Insert** `Source hash:` and `Transcribed:` as new lines when the label is entirely absent from
   the file, rather than silently no-op'ing a failed `.replace()`.
2. **Detect** a `Source:` line whose match spans into a multi-line sentence (heuristically: the
   matched line's remainder, after the label, does not look like a bare path — e.g. it contains
   sentence punctuation and the following line does not start a new heading/blank-line boundary) and
   **stop and ask** rather than silently truncate the sentence — this is the same TMPL-02
   Cold-Resume Parse Contract "ambiguous ⇒ stop and ask" discipline decision 4 already applies to
   multiple candidate sources; a malformed legacy header is the identical shape of problem.
3. Preserve the existing (non-canonical but real) `Edition:` value if the caller does not supply
   `--edition`, rather than unconditionally overwriting it with `EDITION_UNKNOWN` — the current
   unconditional-overwrite behavior loses real designer-authored text (confirmed: seven's original
   line carries a `(no edition/printing on cover, title page, or colophon) — pending designer
   confirmation` qualifier that today's code silently discards down to the bare sentinel when
   `--edition` is omitted).

**Warning signs a plan is NOT accounting for this:** Any plan that treats decision 1's adoption
step as "just call the existing `ingest-archive` command" without a task that fixes and re-proves
`ingestArchiveCommand`'s existing-INDEX branch against copies of BOTH reference games (asserting
`computeVerificationScope()` returns `full`, not `pre-provenance-project`, afterward) has not
actually closed decision 1.

**Evidence (reproduced this session, against `cp -R` scratch copies only — originals confirmed
byte-identical/unchanged before and after via `git status --porcelain` + `rev-parse HEAD`):**

```
$ node bin/boardsmith.js ingest-archive <scratch>/seven/rules.pdf --project <scratch>/seven --json
{
  "archivedPath": "rulebook/source/rules.pdf",
  "sourceHash": "5138858e...",
  "indexPath": "rulebook/INDEX.md",
  "wroteIndex": false
}

$ diff ~/BoardSmithGames/seven/rulebook/INDEX.md <scratch>/seven/rulebook/INDEX.md
3c3
< Edition: not stated in the rulebook (no edition/printing on cover, title page, or colophon) — pending designer confirmation
---
> Edition: not stated in the rulebook
5c5
< Source: `rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the
---
> Source: rulebook/source/rules.pdf
```
(No `Source hash:` or `Transcribed:` lines appear anywhere in the diff — because neither exists in
the original AND neither got inserted; the file after the run still has zero occurrences of either
label, confirmed by `grep -c`.)

`one-two-punch`'s `INDEX.md` is structurally even further from the contract — `grep -n '^##'`
against it returns **zero** headings at all (no `## Slices`, no `## Term → Slice`, no `## Open
Rules Gaps`), versus `seven`'s three headings that use non-canonical wording (`## Open Rules Gaps
(named-but-undefined in the source)` vs. the exact `## Open Rules Gaps` `INDEX_HEADINGS[0]` — this
one happens to still pass `ingest-gaps`'s substring `indexOf` check, but neither game has the
`GAPS_BEGIN`/`GAPS_END` fence pair at all, so `boardsmith ingest-gaps` would throw its own
"missing its machine-owned fences" error if invoked against either game as they stand today —
confirmed via `grep -c boardsmith:gaps` returning 0 for both).

### Pitfall 2: Treating `bs/verify/` as auto-discovered by the installer

**What goes wrong:** A plan that writes `bs/verify-game.md` + `bs/verify/*.md` and assumes the
installer will pick up the new subdirectory the way it picks up new `.md` files inside an already-
registered shared dir.

**Why it happens:** `install-claude-command.ts`'s copy loop iterates a hardcoded `SHARED_DIRS =
['build', 'ingest', 'templates', 'aspects']` array (`install-claude-command.ts:50`) and a separate
`SKILL_ENTRY_POINTS` array (`:30-37`) mapping one entry-point `.md` file to one installed
`bs-<name>/SKILL.md`. Neither is directory-scanning; both are explicit, hand-maintained lists.

**How to avoid:** The installer change is a precise four-point edit:
1. `SKILL_ENTRY_POINTS`: add `{ source: join('bs', 'verify-game.md'), skillName: 'bs-verify-game' }`.
2. `SHARED_DIRS`: add `'verify'` → becomes `['build', 'ingest', 'templates', 'aspects', 'verify']`.
   This is what makes `bs/verify/*.md` land at `bs-shared/verify/*.md` on install, mirroring how
   `bs/ingest/*.md` lands at `bs-shared/ingest/*.md` today.
3. `SHARED_LEAF_PROBES`: add one known leaf file inside the new shared dir, e.g.
   `join(SHARED_ROOT, 'verify', 'source-resolution.md')` (or whatever the planner names the first
   file in `bs/verify/`) — otherwise `isFullyInstalled()`/WR-03a's empty-dir-detection cannot
   distinguish a complete vs. partial install of the new shared dir.
4. The post-install console summary block (`install-claude-command.ts:232-237`) — add a
   `bs-verify-game` line alongside the other six, matching the existing one-line-per-skill format.

**Warning signs:** `install-claude-command.test.ts` has FOUR separate hardcoded `SKILL_NAMES`
const arrays (one per `describe` block, lines ~100, ~242, ~306, ~444) — a plan must update ALL
FOUR, not just the first, or three of the four test suites will silently continue asserting only
the old six-skill set and never catch a regression in the seventh.

### Pitfall 3: Assuming `transcription-subagent.md` is parameterizable today

**What goes wrong:** Decision 15 requires reusing `transcription-subagent.md` UNCHANGED,
parameterized by output directory. Read literally, "unchanged" + "parameterized" sound like they
already coexist in the file. They do not, quite.

**Why it happens:** The file's own "Your inputs" section (line 58) DOES already name "Output
directory `rulebook/` — relative to the project directory you are already inside" as one of three
dispatch-supplied inputs — so the FILE'S OWN LANGUAGE already treats it as a parameter. But every
subsequent instruction that tells the subagent WHERE to write hardcodes the literal string
`rulebook/` rather than referring back to that input: `## 1. WRITE the transcribed text to
\`rulebook/NN-topic.md\`` (line 65), the worked example `rulebook/14-movement.md` (line 68), the
return-field description `` (a) `slicePath` — the `rulebook/NN-topic.md` file you wrote `` (line
151). None of these say "your assigned output directory" — they all say the literal word
`rulebook/`. Similarly, `ingest/transcription.md`'s dispatch template (`transcription.md:72`)
already has `Write slices to: rulebook/` as a templated line inside the `BS-DISPATCH-V2` block —
today it is filled with the literal constant `rulebook/`, but nothing about the block's shape
prevents filling it with `rulebook/.verify/<run-id>/slices/` instead.

**How to avoid — the minimal non-forking change:** Change `transcription-subagent.md`'s Section 1
heading and prose (and the return-field line at line 151, and the `rulebook/00-visual-survey.md`
cross-reference at line 125 IF the verify orchestrator dispatches a visual-survey-equivalent step,
which VERIFY-02/-07/-08 do not require) to say "your assigned output directory" instead of the
literal word `rulebook/`, and have the caller (both `ingest/transcription.md`'s existing dispatch
AND the new verify-side dispatch) fill the "Output directory" input with the concrete path each
time. This is a wording generalization inside the ALREADY-templated "Your inputs" contract, not new
branching logic and not a fork — the file's `BS-DISPATCH-V2` validation, its three-line-kind
contract, its structured-return shape, and its `nextStep` field are completely untouched.
`ingest/transcription.md`'s own dispatch line `Write slices to: rulebook/` simply keeps working
unchanged (it already fills the same input with the same literal value it always did); only the
verify orchestrator's dispatch fills it with the staging path instead.

**Warning signs:** A plan that proposes a literal string-replace of `rulebook/` → `{outputDir}`
throughout the file, rather than a targeted edit to the handful of write-instruction lines, risks
also touching `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md` cross-references (line 32,
`.../transcription.md`) — those are unrelated file-path references to the SIBLING contract file,
not to the slice output location, and must not be touched.

### Pitfall 4: Assuming a chunk/slug-shaped Session Lock identity fits verify

**What goes wrong:** The grammar is `"<slug> @ <session-id> — locked at <ISO timestamp>"`. A verify
pass has no chunk slug — it operates over the whole rulebook, not one chunk.

**Why it happens:** Every existing consumer of this line (`build/close.md`, `SKETCH.md` itself) is
chunk-scoped, so the `<slug>` position naturally reads as "chunk slug" even though nothing in
`state-machine.md` or the template's PARSE CONTRACT actually constrains that position to a real
chunk slug — no code parses this line at all (confirmed: `grep -rn "Session Lock"` across
`src/cli` returns zero `.ts` hits; only `.md` skill-text files reference it).

**How to avoid:** Fill the `<slug>` position with a verify-shaped identity string, e.g. `verify
@ <run-id>` or `verify:<run-id>`, and document that shape once in `bs/verify-game.md`/
`bs/verify/*.md`. Because the position is prose-read by a session (not machine-parsed), any
distinguishable, human-legible value satisfies the existing consistency-check item 4 ("there is no
stale session lock") and the concurrent-session warning path without touching
`state-machine.md`/`SKETCH.template.md` at all. This also cleanly avoids re-opening the SKILLDEF-01
false-alarm fix, which depends on a clean chunk close setting the line to exactly the literal
string `none` — a verify-shaped identity in the SAME field, released to the SAME `none` sentinel on
close, is fully compatible.

## Code Examples

### The installer's exact registration points (copy this shape)

```typescript
// Source: src/cli/commands/install-claude-command.ts:30-37, :50
const SKILL_ENTRY_POINTS: Array<{ source: string; skillName: string }> = [
  { source: join('bs', 'create-game.md'), skillName: 'bs-create-game' },
  { source: join('bs', 'ingest-rules.md'), skillName: 'bs-ingest-rules' },
  { source: join('bs', 'build-chunk.md'), skillName: 'bs-build-chunk' },
  { source: join('bs', 'check-status.md'), skillName: 'bs-check-status' },
  { source: join('bs', 'insert-chunk.md'), skillName: 'bs-insert-chunk' },
  { source: 'generate-ai-instructions.md', skillName: 'bs-generate-ai' },
  // ADD: { source: join('bs', 'verify-game.md'), skillName: 'bs-verify-game' },
];

const SHARED_DIRS = ['build', 'ingest', 'templates', 'aspects'];
// ADD 'verify' → ['build', 'ingest', 'templates', 'aspects', 'verify']
```

### The fenced machine-owned region shape (copy for RUN.md)

```typescript
// Source: src/cli/commands/ingest-archive.ts:97-98, :248-268 (write-bounded-by-fence pattern)
export const GAPS_BEGIN = '<!-- boardsmith:gaps:begin -->';
export const GAPS_END = '<!-- boardsmith:gaps:end -->';
// ...
const begin = index.indexOf(GAPS_BEGIN);
const end = index.indexOf(GAPS_END);
if (begin === -1 || end === -1 || end < begin) {
  throw new Error(`... missing its machine-owned fences ...`);
}
```

### The dual `--json`/human CLI registration shape (copy for new verify commands)

```typescript
// Source: src/cli/cli.ts:187-199
program
  .command('trace-check')
  .description('Report traceability gaps ... (read-only)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(traceCheckCommand);
```

### `computeVerificationScope`'s exact precedence (what the adoption-path fix must satisfy)

```typescript
// Source: src/cli/commands/chunk-provenance.ts:95-140
// Order: no-rulebook-project -> index-missing -> pre-provenance-project (no "Source hash:" line
// at all) -> source-missing (archived file absent) -> source-hash-mismatch -> full.
// "full" requires BOTH a Source hash: line to exist AND the archived file's SHA-256 to match it.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Skill text instructs a mechanism | A CLI command performs the mechanism; skill text only invokes it | Phase 170 (`170-MECHANISMS.md`) | Governs the mechanical/judgment split for every requirement in this phase (CONTEXT.md's "The sort" section) |
| Inline dispatch-prompt contract (retyped per call) | Pointer + validated token (`BS-DISPATCH-V2`) to a single canonical contract file | Phase ~149/150 era, hardened through 170 | Directly informs why decision 15 forbids forking `transcription-subagent.md` |
| A single un-fenced provenance/status section | Fenced machine-owned regions (`GAPS_BEGIN/END`, `VERIFIED_AGAINST_BEGIN/END`) | Phase 170 (gaps), Phase 171 (verified-against) | The only mechanism in this pipeline's history with proven behavioral effect — decision 9 reuses it for RUN.md |

**Deprecated/outdated:** None specific to this phase — everything reused here is the CURRENT state
of the repo (Phases 170-172, all landed 2026-07-28 or earlier this milestone).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The minimal `RUN.md` record shape needs (at least) a slice-unit identifier (e.g. the page range or the resulting `slicePath`) and a completion marker written only after the corresponding slice file's write is durably on disk — no code precedent for this EXACT shape exists yet (GAPS/VERIFIED-AGAINST are single-block fences, not one-fence-per-append-record); this research recommends but does not prove the specific record format. | "Resume Ledger" (Common Pitfalls did not need a dedicated section since decisions 9-11 are unambiguous on mechanics, but the RECORD SHAPE itself is unspecified in CONTEXT.md) | A record format that logs "dispatched" before "written" could let a resume treat a crashed unit as done; the planner must design write-ordering (e.g. append the RUN.md record only after the subagent's structured return confirms `slicePath` was written and the orchestrator has independently confirmed the file exists on disk via `fs.access`, never before) |
| A2 | Extending `ingestArchiveCommand` (rather than adding a new command) is the correct fix location for Pitfall 1, per CONTEXT.md decision 1's literal wording ("runs the existing `ingest-archive`") | "Pitfall 1" | If the planner instead adds a parallel adoption-only command, decision 1's exact wording is technically violated even though the behavior might be equivalent — flag for discuss-phase/plan-check if the planner departs from "extend the existing command" |
| A3 | `bs/verify/`'s first file should be named to serve as the `SHARED_LEAF_PROBES` entry (e.g. `source-resolution.md`) — this is a planner-discretion naming choice, not a locked decision | "Pitfall 2" | Low risk — any real file in the new subdir works as the probe; naming is cosmetic |

**If this table is empty:** N/A — see above.

## Open Questions (RESOLVED)

**RESOLVED — Q1:** one fence pair (the `GAPS_BEGIN` shape, so the codebase keeps exactly one fencing
convention) wrapping line-delimited JSON records. Per-line self-delimitation buys the same crash
safety a per-record fence would, without minting a second convention: an unparseable trailing line
reads as *not recorded*, so resume re-dispatches that unit. Decided in `173-02-PLAN.md` Task 2, which
also mints distinct `RUN_LEDGER_BEGIN`/`END` constants — a ledger must never share a fence with
another section.

**RESOLVED — Q2:** resolved by the wave split itself. The CLI fix (`173-01`, wave 1) is sequenced
ahead of the skill-text gate (`173-04`, wave 3), which is what this document recommended.

1. **Exact RUN.md record-per-step format.**
   - What we know: fenced machine-owned, append-only, one record per slice-unit (decisions 9-10),
     written/read by a CLI command (decision 11).
   - What's unclear: whether the fence wraps the WHOLE ledger (one begin/end pair, contents grow
     inside it — closer to the GAPS pattern) or whether each record gets its OWN begin/end pair
     (more robust against a crash mid-append, since a single shared fence risks a torn write
     corrupting the whole ledger if the process dies between opening and closing the fence on one
     append).
   - Recommendation: favor one-fence-per-record (or a single fence wrapping a format where each
     LINE is self-delimiting, e.g. one JSON object per line) specifically because CONTEXT.md's own
     crash-safety framing (decision 9's rejection of disk-existence-based resume) implies the
     ledger itself must survive a crash mid-write without leaving an ambiguous partial state —
     decide this during planning, it is squarely in "Claude's Discretion."

2. **Where does the adoption-path fix's designer-confirmation gate (decision 2) live relative to
   the CLI fix (Pitfall 1)?**
   - What we know: the CLI fix (inserting missing header lines, stop-and-ask on ambiguous
     `Source:`) is mechanical and belongs in `ingest-archive.ts`. The "ask the designer once before
     writing to the live project" gate is judgment and belongs in `bs/verify/source-resolution.md`
     skill text, per decision 1's own framing ("Adoption is GATED on designer confirmation").
   - What's unclear: nothing structurally — this is stated for completeness so the planner does not
     conflate the two (fix the command's correctness first, prove it separately from the
     skill-text gate that decides WHETHER to invoke it).
   - Recommendation: two separate tasks/waves — CLI fix + proof, then skill-text gate + proof.

## Environment Availability

Not applicable — this phase has no external tool/service/runtime dependencies beyond what is
already present in this repo (Node, npm, git, the existing `boardsmith` CLI via `tsx`, no build
step). Skipped per the "no external dependencies" condition.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (`vitest run`), per `package.json` `"test": "vitest run"` |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/cli/commands/<new-file>.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VERIFY-01 | Installer registers `bs-verify-game` + `bs-verify/` shared dir | unit (installer integration test, real temp-dir install) | `npx vitest run src/cli/commands/install-claude-command.test.ts` | ❌ needs the 4 `SKILL_NAMES` arrays + new assertions — Wave 0 |
| VERIFY-01 | `/bs-verify-game` runs against an existing project without rebuilding it | live-session proof (cannot be a unit test — this is a skill-text invocation) | N/A — real skill session against a scratch copy, per the harness below | N/A |
| VERIFY-02 | Staging tree write-only, never overwrites a live slice; dot-prefix excluded from every walker | unit (path-computation command) + live cross-check that `chunk-provenance.ts`/`trace-check.ts`/`drift-check.ts` ignore the staging dir | `npx vitest run src/cli/commands/<verify-run-init>.test.ts` | ❌ Wave 0 |
| VERIFY-07 | Orchestrator never reads a slice — subagent writes directly, returns summary only | live-session proof (an absence — see "The Observable for Criterion 3" below); NOT unit-testable | N/A — see below | N/A |
| VERIFY-08 | Resumable: crash mid-pass resumes at first unrecorded step | unit (RUN.md append/read logic) + a REAL interrupted-and-resumed run | `npx vitest run src/cli/commands/<verify-record-step>.test.ts` PLUS a deliberate-kill proof (see below) | ❌ Wave 0 |
| Pitfall 1 fix | `ingest-archive` converts a pre-170 project to `full` scope, not `pre-provenance-project` | integration (against `cp -R` copies of both reference games) + `computeVerificationScope()` assertion | `npx vitest run src/cli/commands/ingest-archive.test.ts` plus a proof-doc run per the existing 171/172 harness | ❌ new test cases needed in the existing file — Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant `npx vitest run <file>.test.ts`.
- **Per wave merge:** `npm test` (currently 3503+/3503+ baseline as of Phase 172's close — confirm
  current baseline count at plan time, it will have moved).
- **Phase gate:** full suite green before `/gsd:verify-work`, plus the live-session/interrupted-run
  proofs below (these are NOT covered by `npm test` and must be a separate proof artifact, exactly
  as `171-PROOF.md`/`172-PROOF.md` did).

### Wave 0 Gaps
- [ ] `src/cli/commands/ingest-archive.test.ts` — new cases for the existing-INDEX branch against a
      synthetic pre-170-shaped `INDEX.md` fixture (missing `Source hash:`/`Transcribed:`, a
      multi-line `Source:` paragraph) — pins the Pitfall 1 fix.
- [ ] `src/cli/commands/install-claude-command.test.ts` — extend all FOUR `SKILL_NAMES` arrays plus
      the shared-dir assertions for `verify`.
- [ ] A new `verify-run-init.test.ts` and `verify-record-step.test.ts` (or whatever the planner
      names the resume-ledger commands) — none exist yet.
- [ ] Framework install: none — Vitest is already fully configured project-wide.

### The proof harness this phase reuses (verbatim, from 171/172)

```
SCRATCH=<session-scratchpad>/173-proof
COPY_SEVEN=$SCRATCH/seven
COPY_OTP=$SCRATCH/one-two-punch

# preflight, on the ORIGINALS, before any copy
git -C ~/BoardSmithGames/seven rev-parse HEAD
git -C ~/BoardSmithGames/seven status --porcelain
git -C ~/BoardSmithGames/one-two-punch rev-parse HEAD
git -C ~/BoardSmithGames/one-two-punch status --porcelain
find ~/BoardSmithGames/seven -type f -not -path '*/.git/*' -print0 | sort -z | xargs -0 shasum -a 256
find ~/BoardSmithGames/one-two-punch -type f -not -path '*/.git/*' -print0 | sort -z | xargs -0 shasum -a 256

cp -R ~/BoardSmithGames/seven "$SCRATCH/seven"
cp -R ~/BoardSmithGames/one-two-punch "$SCRATCH/one-two-punch"

# ... every command under test runs ONLY against $COPY_SEVEN / $COPY_OTP, never the originals ...

# post-run re-verification: re-run the same rev-parse/status/shasum block on the ORIGINALS and
# diff against the preflight capture — must be byte-identical, no exceptions.
npm test
```

Every count reported in the eventual `173-PROOF.md` should be independently cross-checked by a
second method, per `172-PROOF.md`'s discipline (e.g. `computeVerificationScope()`'s `full` verdict
independently confirmed by a hand `grep`/`shasum` of the resulting `INDEX.md` and archived file,
not trusted from the tool's own output alone).

### A real interrupted-run proof for success criterion 4 (VERIFY-08)

Success criterion 4 needs an ACTUAL kill-and-resume, not a unit test of the ledger reader
(CONTEXT.md Specifics explicitly calls this out). Concrete proposal:

1. Run the verify pass's fan-out dispatch against a copy of one reference game.
2. After the RUN.md ledger shows at least one (but not all) slice-units recorded, deliberately
   terminate the session/process performing the dispatch — e.g. if the dispatch loop is driven by
   a script the plan can `kill -9` mid-loop; if it is a live Claude Code skill session, the
   deliberate interruption is a real session abort after confirming (via `RUN.md`) that at least
   one unit landed and at least one more remains undispatched.
3. Re-invoke `/bs-verify-game` (or the resuming command directly) against the SAME run-id/staging
   directory.
4. Assert: (a) the already-recorded slice-unit(s) are NOT re-dispatched (no duplicate subagent
   call, confirmed by absence of a second write timestamp / absence of a second RUN.md record for
   the same unit), (b) the remaining unrecorded unit(s) ARE dispatched, (c) the pass eventually
   reaches the same completed state a clean, uninterrupted run would.

### The observable for success criterion 3 (VERIFY-07 — an ABSENCE)

CONTEXT.md's own Specifics section flags this as requiring a positive observable, not an assertion
of compliance. Concrete proposal, derived directly from how `transcription-subagent.md`'s existing
contract already structurally enforces the same property for ingest:

- **Structural observable (proof, not trust):** the dispatched Task-subagent's prompt (captured in
  the orchestrator's own transcript/tool-call log) contains ONLY the three inputs
  (`{N}-{M}` or slice-unit id, `{rulebookPath}`, output directory) — never rulebook prose. The
  subagent's RETURN (also captured in the transcript) contains ONLY the structured summary fields
  (`slicePath`, `sectionSummary`, `citedTerms[]`, etc.) — never the transcribed text body. A proof
  document can grep the captured orchestrator transcript for the ABSENCE of slice-body-shaped
  content (e.g. absence of `QUOTE`/`Derived (p.`/`Visual (p.` prefixed lines, which only ever
  appear inside a written slice file, never inside a structured-summary return) across the entire
  verify pass.
- This mirrors exactly how Phase 172's proof caught real defects by independently re-deriving
  values rather than trusting the tool's own output — here, the "tool" is the orchestrator's own
  transcript, and the independent check is "does it ever contain a rule-shaped line" rather than
  "does it claim compliance."

## Security Domain

Not applicable in the ASVS sense — this phase has no auth/session/network/crypto surface beyond
SHA-256 hashing of a local file (already implemented, unchanged by this phase) and local filesystem
writes gated by an explicit designer confirmation (decision 2). No new input-validation surface is
introduced beyond what `ingest-archive.ts` already validates (unreadable path throws loudly).
`workflow.nyquist_validation`/`security_enforcement` config was not checked in `.planning/config.json`
during this research pass — the planner should confirm the config key state, but given the
above, a full ASVS table would be near-entirely "not applicable."

## Sources

### Primary (HIGH confidence — direct source read or live command run this session)
- `src/cli/commands/install-claude-command.ts` (full file read)
- `src/cli/commands/install-claude-command.test.ts` (full file read)
- `src/cli/slash-command/bs/ingest/transcription.md` (full file read)
- `src/cli/slash-command/bs/ingest/transcription-subagent.md` (full file read)
- `src/cli/slash-command/bs/state-machine.md` (Session Lock, Git Protocol, Cold-Resume Parse
  Contract, Consistency Check sections read in full)
- `src/cli/slash-command/bs/templates/SKETCH.template.md` (Session Lock line + parse contract
  comment read in full)
- `src/cli/commands/ingest-archive.ts` (full file read)
- `src/cli/commands/chunk-provenance.ts` (`computeVerificationScope`, citation-resolution readdir
  sections read)
- `src/cli/commands/trace-check.ts`, `src/cli/commands/drift-check.ts` (walker/readdir sections
  read, confirmed neither recurses into `rulebook/`)
- `src/cli/cli.ts` (full command-registration block read)
- Live command run: `node bin/boardsmith.js ingest-archive <scratch-copy>/rules.pdf --project
  <scratch-copy> --json` against a `cp -R` copy of `~/BoardSmithGames/seven`, diffed against the
  untouched original (originals confirmed byte-identical/unmodified before and after via
  `git status --porcelain` + `rev-parse HEAD`)
- Direct inspection (`grep`/`head`/`wc -l`) of both real reference games' `rulebook/INDEX.md`
  files (read-only, no writes to the originals at any point)
- `.planning/phases/171-provenance-recording/171-CONTEXT.md`, `171-PROOF.md` (full/substantial read)
- `.planning/phases/172-source-free-conformance-checks/172-PROOF.md` (full read — proof-harness
  and independent-cross-check discipline)
- `.planning/STATE.md` (phase history, standing findings)
- `.planning/REQUIREMENTS.md` (VERIFY-01/02/07/08 definitions + full requirements context)
- `.planning/phases/173-verify-pipeline-core/173-CONTEXT.md` (all 16 decisions, full read)

### Secondary (MEDIUM confidence)
None — no WebSearch/Context7 lookups were needed for this phase; it is entirely internal-repo
mechanics.

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no external stack, entirely observed from source.
- Architecture: HIGH — every pattern cited has a working, tested precedent in this exact repo.
- Pitfalls: HIGH — Pitfall 1 (the highest-risk item) was independently reproduced this session
  against a real reference game copy, not inferred from reading code alone.

**Research date:** 2026-07-28
**Valid until:** This is fast-moving internal-repo research tightly coupled to the current state of
`src/cli/commands/` and `src/cli/slash-command/bs/` — treat as valid only until the next commit
touches `ingest-archive.ts`, `install-claude-command.ts`, or the `bs/ingest/` directory (i.e.
effectively until Phase 173 planning begins; re-verify line numbers if planning is delayed more
than a few days).
