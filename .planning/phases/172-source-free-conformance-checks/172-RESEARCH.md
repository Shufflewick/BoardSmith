# Phase 172: Source-Free Conformance Checks - Research

**Researched:** 2026-07-28
**Domain:** CLI parsing/aggregation commands (BoardSmith `bs-` skill family) + git plumbing
**Confidence:** HIGH — every claim below is either read directly from source in this repo or
measured directly against the two live reference games. No web research was needed or performed;
this phase has no external library surface.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**The sort:** CHECK-03 and CHECK-05 are both MECHANICAL (parsing + set-differencing; `git diff`
intersected with a parsed file list). This is CLI work; skill text only invokes the command and
formats `--json`.

**Area 1 — Traceability resolution model:**
1. The Build Manifest is the claim-numbering authority. A bare `claim N` in a test resolves to the
   chunk whose Build Manifest lists that test file. Rejected: filename-slug match, requiring a
   qualified `<slug> claim N` form.
2. A test file in no manifest is an `unassociated-test` finding; its `claim N` refs are recorded
   as unresolved — never silently dropped, never guessed.
3. A test file listed in MULTIPLE chunks' manifests makes its bare refs ambiguous —
   `ambiguous-claim-ref`, naming the candidates, counting as coverage for none of them. Rejected:
   attributing to all candidates, attributing to the most recent chunk.
4. Static parse only. Regexes test sources, CHUNK.md, RULINGS.md. Never runs `npm test`, never
   touches the engine.

**Area 2 — Reporting, findings & exit codes:**
5. Two commands mirroring ingest/chunk: `boardsmith trace-check [--json]`, `boardsmith drift-check
   [--json]`. Both project-root-relative, strictly read-only.
6. Findings exit 0. Non-zero reserved for tool failure (unparseable project, missing INDEX.md, not
   a bs- project, not a git repo). Contrast with `chunk-check`, which DOES exit non-zero (it
   repairs a machine-owned region).
7. Finding kinds are an ENUMERATED CODE set: `claim-untested`, `ruling-untested`, `test-unlinked`,
   `unassociated-test`, `ambiguous-claim-ref`, `unresolved-claim-ref`, `manifest-file-missing`,
   `chunk-code-drifted`, `drift-unknown`. Records are `{ kind, chunk, subject, detail }`.
8. CLI computes, skill formats. `--json` is the contract.

**Area 3 — Code-drift mechanics:**
9. Diff base is the recorded `## Verified Commit Hash`. `git diff --name-only <hash> HEAD`
   intersected with that chunk's Build Manifest file list. Works retroactively, no close-time
   write needed.
10. A chunk with no recorded hash reports `drift-unknown` — a third state, never collapsed into
    "drifted" or "clean".
11. Manifest row parsing extracts EVERY path-shaped token in the first cell (rows carry several
    comma-joined paths). A row yielding zero paths is itself a `manifest-file-missing` finding.
12. A manifest file absent from disk is drift — the strongest possible drift signal.

### Claude's Discretion
- Exact regex/parser structure, module boundaries, file placement within `src/cli/`.
- Report text formatting for the non-`--json` human output.
- Test-file organisation, provided the shared-constant pinning rule (finding-kind enum shared
  across `src/`↔`scripts/` boundary, if it ever crosses it) is honoured.

### Deferred Ideas (OUT OF SCOPE)
- Wiring CHECK-03/05 into `/bs-verify-game` — Phase 173.
- CHECK-04 (Phase 177), CHECK-06 (Phase 178) — the other source-free-capable checks; Phase 179
  assembles the source-free MODE. This phase must not invent a mode flag.
- Backfilling or repairing findings on the reference games — the checks report, nothing here fixes
  reference-game content.
- F-3 (`boardsmith.json` stub ownership) — still an open todo, not this phase's work.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHECK-03 | Traceability sweep: every Interpretation claim has a citing test, every test traces to a live claim, every ruling has a test; source-free. | Section 2 (parse-surface measurements), Section 3 (predicted findings), code_context below (reusable parser shapes from `chunk-provenance.ts`). |
| CHECK-05 | Code drift: diff each chunk's Build Manifest files against its verified commit hash. | Section 4 (git mechanics, empirically confirmed against both reference games), Section 3 (predicted findings). |
</phase_requirements>

## Summary

Both checks are pure, source-free, offline parsers over artifacts that already exist on disk in
29 real chunks across two reference games — no new library, no new dependency, no web research
surface. The closest and correct analog is `src/cli/commands/chunk-provenance.ts` (Phase 171):
copy its section-locating discipline (locate headings by LINE, never by substring — see the
`f73153a3` bug below), its fenced-vs-unfenced distinction is NOT needed here (these two commands
are read-only and write nothing), its `--json`/`process.exitCode` idioms, and its CLI-registration
shape in `src/cli/cli.ts`.

The empirical measurement in this document changes the picture from what CONTEXT.md's scout
findings suggested in one important way: **the "Build Manifest is the claim-numbering authority"
model, applied to real data, resolves almost none of one-two-punch's actual claim citations
cleanly.** Every test file in one-two-punch that carries any claim citations at all
(`a11y.test.ts`, `block.test.ts`, `game.test.ts`, `punch.test.ts`, `rest.test.ts`) is listed in
3–8 different chunks' manifests, so — per locked decision 3 — every one of their ~67 claim
citations resolves as `ambiguous-claim-ref`. This is not a flaw in the locked decision (the
research task explicitly forbids re-litigating it, and the rejected alternatives are worse); it is
a real, load-bearing consequence the planner needs sized correctly: `trace-check`'s first run on
one-two-punch will show **zero** claims with clean test coverage, not "some gaps." `seven` shows
the identical pattern for the same structural reason (`game.test.ts` owned by 11 chunks,
`scoring.test.ts` by 9). Success criterion 3 (a non-no-op run, surfacing real findings) is
trivially and overwhelmingly satisfied by both games; the risk flagged in CONTEXT.md's own
specifics section ("this is the noisiest direction") is not `test-unlinked` — measured data shows
it is `ambiguous-claim-ref`/`claim-untested` volume that will actually dominate the report on
first run, on both games.

**Primary recommendation:** implement `trace-check` and `drift-check` as two new files
`src/cli/commands/trace-check.ts` / `src/cli/commands/drift-check.ts`, each exporting pure
functions (parse, resolve, diff) plus a thin CLI action, registered in `cli.ts` next to
`chunk-check`/`chunk-provenance-status`. Reuse `chunk-provenance.ts`'s line-anchored
section-locating pattern exactly (do not repeat the `f73153a3` substring bug). Build the
human-readable report to GROUP findings by kind with a count-first summary line, because the
measured finding volume (Section 3) will otherwise bury the signal in noise on the very first real
run — this is squarely inside "Claude's Discretion: report text formatting."

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Claim/test/ruling parsing (CHECK-03) | CLI (Node, `src/cli/commands/`) | — | Pure text parsing over files already on disk; no server, no UI, no engine. Mirrors `chunk-provenance.ts`. |
| Claim-to-chunk resolution via manifest | CLI (Node, `src/cli/commands/`) | — | Same parser owns both the manifest table (also read by CHECK-05) and the claim list — "one parser, one authority" per locked decision 1. |
| Git diff / commit-ancestry (CHECK-05) | CLI (Node, `node:child_process` or a git-porcelain wrapper) | — | Runs `git diff --name-only <hash> HEAD` in the GAME repo's working directory, never in BoardSmith's own repo. No engine or session involvement. |
| `--json` result shape | CLI (Node) | — | Contract for `/bs-check-status` and later `/bs-verify-game` (Phase 173) — those are the Skill/UI tier and only format, per decision 8. |
| Report rendering (non-JSON) | CLI (Node, `chalk`) | Skill (`.md` templates format `--json` for `/bs-check-status`) | CLI owns the human fallback output; the skill layer owns presentation inside a Claude Code session. |

## Standard Stack

No new library is needed. This phase's entire surface is regex/string parsing over Markdown +
`node:child_process`/`git` plumbing, using dependencies already in `package.json`.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `commander` | `^12.0.0` [VERIFIED: repo `package.json:81`] | CLI command registration | Already the framework for every `boardsmith <cmd>` — `chunk-check`/`chunk-provenance-status` are the direct precedent. |
| `chalk` | `^5.3.0` [VERIFIED: repo `package.json:80`] | Colored human-readable output | Already used identically by `chunk-provenance.ts` for yellow/red/green report lines. |
| `node:child_process` (built-in) | Node runtime | Running `git diff --name-only`, `git merge-base --is-ancestor`, `git rev-parse` | No existing git wrapper in this repo (`chunk-provenance.ts` never shells out to git) — this phase is the FIRST command that needs to invoke git as a subprocess. Use `child_process.execFile('git', [...], { cwd: projectDir })`, never `exec` with a shell string (avoids injection via a hash value copied from a hand-editable CHUNK.md). |

### Supporting
None. `node:fs/promises`, `node:path`, `node:crypto` (not needed here — no hashing in this phase)
cover everything else, matching `chunk-provenance.ts`'s import list.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `child_process.execFile('git', …)` | `simple-git` npm package | Adds a new dependency (CLAUDE.md: "Don't add dependencies without discussing") for two `git` invocations this phase needs (`diff --name-only`, optionally `merge-base --is-ancestor` for STOP-condition handling). Not worth it — `execFile` is sufficient and dependency-free. |

**Installation:** none required — no new packages.

**Version verification:** `commander` and `chalk` versions confirmed directly from this repo's
own `package.json` (lines 80–81), not from the npm registry — they are already installed and in
use by the Phase 171 precedent this phase copies.

## Package Legitimacy Audit

Not applicable. This phase introduces zero new npm dependencies — it reuses `commander`, `chalk`,
and Node built-ins (`node:fs/promises`, `node:path`, `node:child_process`) already present in
`package.json` and already exercised by `chunk-provenance.ts` (`commander`/`chalk`) and
`ingest-archive.ts`/`init.ts`/etc. (Node built-ins). `slopcheck` was not run because there is
nothing to check.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌─────────────────────────────┐
                     │  Game project directory      │
                     │  (chunks/*/CHUNK.md,          │
                     │   RULINGS.md, tests/*.ts)     │
                     └───────────────┬───────────────┘
                                     │ read-only fs scan
                                     ▼
          ┌──────────────────────────────────────────────┐
          │  trace-check (CHECK-03)                        │
          │  1. parse every chunk's ## Interpretation       │──┐
          │     claim list (claim N -> chunk)               │  │ shares
          │  2. parse every chunk's ## Build Manifest        │  │ manifest
          │     file rows -> {chunk -> [file paths]}         │◄─┘ parser
          │  3. build file -> owning-chunk(s) index          │
          │  4. scan tests/*.ts for "claim N" / "Ruling N"    │
          │     citations, resolve claim refs via the file  │
          │     -> owning-chunk(s) index (1 owner = resolve, │
          │     0 = unassociated-test, 2+ = ambiguous)        │
          │  5. parse RULINGS.md ### Ruling N entries,        │
          │     set-diff against cited Ruling Ns globally    │
          │  6. emit { kind, chunk, subject, detail }[]       │
          └──────────────────────────┬───────────────────────┘
                                     │ --json | human report
                                     ▼
                         (consumed later by /bs-check-status,
                          /bs-verify-game — Phase 173, NOT this phase)

          ┌──────────────────────────────────────────────┐
          │  drift-check (CHECK-05)                        │
          │  1. parse each chunk's ## Verified Commit Hash  │  same
          │     (first hex token 7-40 chars)                │◄─ manifest
          │  2. parse each chunk's ## Build Manifest         │  parser
          │     file rows (SAME parser as trace-check)       │  as above
          │  3. no hash found -> drift-unknown finding       │
          │  4. hash found -> shell out:                     │
          │     git diff --name-only <hash> HEAD             │───► git (in the
          │     (cwd = game project dir, NOT BoardSmith)      │     GAME repo)
          │  5. intersect manifest paths with diff output;    │
          │     any manifest file no longer on disk is drift  │
          │  6. emit { kind, chunk, subject, detail }[]        │
          └──────────────────────────────────────────────┘
```

A reader can trace CHECK-03's primary use case (a designer runs `boardsmith trace-check`) from
entry (project dir) through parse → resolve → diff → JSON/report by following the arrows above.
CHECK-05 shares the SAME Build Manifest row parser (locked decision 1's "one parser, one
authority" — implement it once, in one module, imported by both commands).

### Recommended Project Structure
```
src/cli/
├── commands/
│   ├── trace-check.ts        # CHECK-03: claim/ruling/test parsing + resolution + finding emission
│   ├── trace-check.test.ts   # colocated, fixtures built with the SAME shared-manifest-parser helpers
│   ├── drift-check.ts        # CHECK-05: commit-hash parsing + git diff + drift detection
│   ├── drift-check.test.ts   # colocated; git-diff tests use a real tmp git repo (see Pitfall 3)
│   └── build-manifest.ts     # NEW shared module: parseBuildManifest(chunkText) -> Map<file, {status}>
│                              #   imported by BOTH trace-check.ts and drift-check.ts — the single
│                              #   parser locked decision 1 requires. Also a natural home for
│                              #   parseInterpretationClaims(chunkText) and parseRulings(rulingsText)
│                              #   if trace-check.ts alone gets too large.
└── cli.ts                    # registers `trace-check [--json]` and `drift-check [--json]`,
                               # next to chunk-check/chunk-provenance-status (lines ~168-182)
```

### Pattern 1: Line-anchored section location (copy from `chunk-provenance.ts`, do not re-derive)
**What:** Locate a `## Heading` by matching `^## Heading[ \t]*$` with the `m` flag and taking
`.index`, THEN slice the rest of the scan to before/after that index — never `indexOf(headingText)`
against the whole file.
**When to use:** Every section this phase reads (`## Interpretation`, `## Build Manifest`,
`## Verified Commit Hash`, `### Ruling N` in RULINGS.md).
**Why:** `chunk-provenance.ts:387-393` documents a real, already-fixed defect (commit `f73153a3`):
`indexOf(VERIFIED_AGAINST_HEADING)` also matched the heading's OWN NAME appearing in unrelated
prose 130 lines earlier (the CHUNK.template.md required-headings comment), silently truncating the
scan and dropping every citation. `## Interpretation`, `## Build Manifest`, and `## Verified
Commit Hash` are exactly the kind of heading names likely to be echoed in prose elsewhere in a
CHUNK.md (state-machine.md citations, the required-headings comment, cross-references in other
sections) — this phase's parsers WILL repeat the bug verbatim if they use `indexOf` on the literal
heading string instead of an anchored line match.
**Example:**
```typescript
// Source: src/cli/commands/chunk-provenance.ts:394-395 (the fixed pattern)
const headingMatch = /^## Verified Against[ \t]*$/m.exec(chunkText);
const headingIdx = headingMatch ? headingMatch.index : -1;
```

### Pattern 2: Section-scoped extraction via next-heading boundary
**What:** Once a heading's start index is known, the section body ends at the next `^## ` (two
hashes) line — NOT at the next `^#+ ` of any depth, since `### Corrections from Redteam Round N`
subheadings are legitimate CONTINUATIONS of `## Interpretation`'s claim list, not new sections.
**When to use:** Extracting the Interpretation claim list and the Build Manifest table.
**Verified against real data:** `chunks/punch/CHUNK.md` (one-two-punch) has TWO
`### Corrections from Redteam Round N` subheadings (claims 22–28, then 29–35) inside `##
Interpretation`; both must be included in the scan or 13/35 real claims are silently dropped.
**Example:**
```typescript
const bodyMatch = new RegExp(
  `^## Interpretation\\n([\\s\\S]*?)(?=\\n## |$)`, 'm'
).exec(chunkText);
```

### Pattern 3: Claim-list item extraction
**What:** `^N. **...` — a decimal-numbered, bold-led ordered-list item, at the START of a line
(not inside a nested numbered list elsewhere in the file — the Playtest Test Script and Verified
Checklist sections also use `N. **...`-shaped lines, so this regex MUST be scoped to the
Interpretation section body from Pattern 2, never run over the whole file).
**Verified counts:** one-two-punch: 1–35 claims/chunk, 165 total across 12 chunks (2 chunks have
0: `final-acceptance`, and effectively `ai-opponent` which has exactly 1). seven: 0–36
claims/chunk, 212 total across 17 chunks.
**Non-contiguous numbering is REAL, not hypothetical:** 4 of seven's 17 chunks start their claim
list above 1 — `discard` starts at 20, `scoring-combo-sets-and-runs` at 11,
`simultaneous-round-loop` at 7, `table-and-draw` at 28. This is not damage: earlier "seeded"
claims (1–6 in `simultaneous-round-loop`, e.g.) are quoted and superseded INSIDE the text of the
first real list item ("SUPERSEDES SEEDED CLAIM 1's SOURCING…") rather than re-printed as their own
numbered entries. **A "live claim" check must not assume the list starts at 1 or is a fixed
count** — it must treat the SET of integers that actually appear as list items as the live set,
and treat any lower number that never appears as an item as simply never having been a standalone
claim (not evidence of damage). No duplicate claim numbers were found in either game (checked
directly).
**Supersession also happens WITHIN the claim list itself**, in free prose ("SUPERSEDES CLAIM N…",
`tests/block.test.ts:294`: `// --- Block does NOT block Jabs (claim 4, as SUPERSEDED by claim 14)`)
— this is a SEPARATE mechanism from RULINGS.md supersession (Pattern 5) and equally unreliable to
parse as a formal chain; see Section 3 for exact counts of what IS reliably parseable.

### Pattern 4: Build Manifest row / path extraction (the parser CHECK-03 and CHECK-05 share)
**What:** For each row of the `| File | Status |` table under `## Build Manifest`, extract EVERY
substring matching a path-shaped token (`[A-Za-z0-9_./-]+\.[A-Za-z0-9]+` with at least one `/` or a
known bare-root filename like `DECISIONS.md`) from the FIRST cell only — never the second (prose)
cell.
**Real edge cases, measured:**
- Comma-joined multi-path rows are real: `tests/game.test.ts, tests/block.test.ts,
  tests/punch.test.ts, tests/rest.test.ts, tests/a11y.test.ts` is one literal row
  (`discard-phase-and-reclaim/CHUNK.md`).
- **A manifest can be present with a heading but contain ZERO table rows at all** — not "a row
  with zero paths" but no table structure whatsoever: `chunks/ai-opponent/CHUNK.md`'s `##
  Build Manifest` is a bulleted prose list (`- **src/rules/ai.ts** (new) — ...`), not a `| File |
  Status |` table. A parser expecting table syntax finds 0 rows and must not crash; per decision
  11's spirit this is its own distinct case from "a row yielding zero paths" — recommend a
  `manifest-not-tabular` sub-case of `manifest-file-missing`, or at minimum: do not conflate
  "chunk cites zero files" (true for `ai-opponent`/`final-acceptance`, legitimate) with "chunk's
  manifest could not be parsed as a table" (also true for `ai-opponent`) — CHECK-05 in particular
  needs to know it found NO manifest paths to diff, not that it found and confirmed zero.
- `chunks/final-acceptance/CHUNK.md` (both games) has the table HEADER (`| File | Status |` +
  separator) with genuinely zero content rows — this IS the legitimate "no files" case (the
  final-acceptance chunk closes the game, touches no source).
- Rows commonly annotate the path inline (`src/rules/game.ts (edit)`, `DECISIONS.md (Decisions 28,
  29, 30)`) — the path token itself is still cleanly extractable by the regex above since
  parentheses and prose are outside the path-character class.
**Example:**
```typescript
// One row can yield MULTIPLE files — real data, discard-phase-and-reclaim/CHUNK.md
const PATH_TOKEN = /[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g;
for (const row of manifestRows) {
  const firstCell = row.split('|')[1] ?? '';
  const paths = [...firstCell.matchAll(PATH_TOKEN)].map(m => m[0]);
  if (paths.length === 0) { /* manifest-file-missing candidate */ }
}
```

### Pattern 5: Verified Commit Hash extraction (CHECK-05's diff base)
**What:** A single hex token, 7–40 characters, optionally backtick-wrapped, appearing ANYWHERE in
the section body — NOT necessarily on the first line, and NOT necessarily the ONLY hash mentioned.
**Real formats, measured across all 29 chunks (both games), all 29 successfully parsed and all 29
independently confirmed to be real, existing, HEAD-ancestor commits in their respective game
repos:**
- Bare 7-char abbreviation on its own line: `1bc81e4`
- Backtick-wrapped 7-char: `` `fbc573f` `` (with trailing parenthetical prose)
- Bare full 40-char SHA on its own line: `50e697a1ac3dc4c2a0730e77fd2021e49567260c`
- Backtick-wrapped full SHA: `` `357425e41258c3b469abee94af629018cc80a29e` ``
- **Prose-prefixed, hash NOT the first token:** `block/CHUNK.md`'s section opens with two full
  sentences of prose about a WAIVED playtest before the actual line `Verified commit: \`fbc573f\`
  (\`chunk-block/step-playtest\`).` A parser that only checks the first line or first token will
  MISS this chunk's hash entirely.
- **Multiple hashes can appear in one section, only the first is the diff base:**
  `plan-and-reveal/CHUNK.md` states the bisect-anchor hash on its own line
  (`357425e41258c3b469abee94af629018cc80a29e`) and then, in trailing prose, references a SECOND,
  different hash (`baa4f00`, "the last commit a human actually approved") — a regex that is not
  anchored to "first match after the heading" would non-deterministically pick either.
**Recommended extraction:** take the FIRST `` `?[0-9a-f]{7,40}`? `` match after the heading,
case-insensitive on the hex digits but the surrounding line/prose is otherwise free text.
**Git-existence verification, empirically confirmed:** ALL 29 extracted hashes (12 one-two-punch +
17 seven) are valid, resolvable git objects AND ancestors of their repo's current `HEAD` —
`git merge-base --is-ancestor <hash> HEAD` returned true for every single one. Neither reference
game currently exercises the "hash not found" or "hash not an ancestor of HEAD" path; both must
still be implemented and reported as their own finding kind (or a tool-failure per chunk, per
locked decision 6 — findings are advisory, but git-plumbing failure on a SPECIFIC chunk's hash is
arguably closer to `drift-unknown` than a whole-command failure; recommend treating an unresolvable
hash the SAME as "no hash recorded" i.e. `drift-unknown`, since the practical consequence —
"cannot compute a diff base" — is identical, and this needs zero new finding kind).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Section-boundary detection | A new heading-scanning helper | Pattern 1 + 2 above, copied from `chunk-provenance.ts:394-401` | The `f73153a3` bug already happened once in this exact codebase on this exact class of parser; re-deriving from scratch reintroduces the risk of forgetting the line-anchor lesson. |
| Running `git diff` | A hand-rolled diff parser, or reading `.git/` internals directly | `child_process.execFile('git', ['diff', '--name-only', hash, 'HEAD'], { cwd: projectDir })` | Git's own porcelain command is the correct, stable, well-tested interface; there is no reason to reimplement tree-diffing. |
| Checking whether a hash is a real, ancestor commit | Parsing `git log` output by hand | `git merge-base --is-ancestor <hash> HEAD` (exit code 0 = yes) | Purpose-built plumbing command for exactly this question; avoids parsing `git log`'s human-oriented output. |

**Key insight:** every "don't hand-roll" item in this phase is about NOT re-deriving parsing logic
that either (a) already exists correctly in `chunk-provenance.ts` and should be copied, or (b) is
git's own job via a stable plumbing command. There is no external-library "don't hand-roll" item
here — the entire domain is parse-and-diff over files this repo already owns the shape of.

## Common Pitfalls

### Pitfall 1: Treating the Interpretation section's whole file as the claim-scan surface
**What goes wrong:** `N. **bold**`-shaped lines also appear in `## Playtest Test Script` (e.g.
"6. **Regression — do the old chunks still work?**") and `## Verified Checklist`. Scanning the
whole CHUNK.md for the claim regex over-counts and mis-numbers claims.
**Why it happens:** the claim format (`\d+\. \*\*`) is not unique to the Interpretation section —
it is BoardSmith's general "numbered checklist item" Markdown convention, reused in at least three
other sections per CHUNK.template.md.
**How to avoid:** always scope the claim regex to the text returned by Pattern 2 (bounded to the
next `^## ` heading), never to `chunkText` directly. Verified directly: an un-scoped scan of
`chunks/jab/CHUNK.md` finds items up through "10. Keyboard + screen reader" in the Playtest Test
Script section, which are not claims at all.
**Warning signs:** claim counts that don't match a manual `grep -c '^[0-9]\+\. \*\*'` bounded
between `## Interpretation` and the NEXT `## ` heading.

### Pitfall 2: Assuming claim citations resolve cleanly because a claim number is unique per chunk
**What goes wrong:** per-chunk-unique claim numbering (true) does not imply that a bare `claim N`
in a shared test file resolves unambiguously (false) — the resolution depends on how many chunks'
manifests list that TEST FILE, which is a property of the manifest, not the claim number.
**Why it happens:** it is easy to read "claim numbers are per-chunk" and infer "so citing chunk X's
claim 12 is unambiguous if I know it's chunk X's test" — but the whole point of decision 1 is that
the CHECK doesn't know which chunk "wrote" the citation; it only knows which chunk(s) list the
FILE. See Section 3 for exact measured ambiguity rates (very high on both games).
**How to avoid:** implement exactly the file→owning-chunks index locked decision 1 specifies, and
do not add any inference beyond it (e.g., "prefer the chunk whose slug appears nearest in the test
file's own comments" — tempting, explicitly not what was decided, and CONTEXT.md rejected
adjacent shortcuts for exactly this reason).
**Warning signs:** a trace-check run reporting near-zero `claim-untested` findings on either
reference game would be a signal the ambiguity logic is silently attributing citations it should
be leaving ambiguous — the opposite of what real data produces (see Section 3).

### Pitfall 3: Running git commands against BoardSmith's own repo instead of the game project's repo
**What goes wrong:** `child_process.execFile('git', [...])` defaults to the CURRENT working
directory unless `cwd` is passed explicitly. If `cwd: projectDir` is omitted or computed wrong,
the diff silently runs against BoardSmith's own git history and either errors confusingly (hash
not found) or, worse, if BoardSmith's own repo happens to contain a coincidentally-valid-looking
short hash, produces a nonsensical diff against the WRONG repository.
**Why it happens:** every other command in this codebase (`chunk-check`, `ingest-check`) only ever
touches the filesystem via `node:fs`, never shells out — this phase is the first to add a
subprocess call, so there is no existing precedent to copy the `cwd` discipline from.
**How to avoid:** always pass `{ cwd: resolve(options.project ?? process.cwd()) }` explicitly to
every `execFile('git', …)` call, matching the SAME `projectDir` resolution `chunk-provenance.ts`
already uses for `--project`. Test this directly: a `drift-check.test.ts` fixture must build a
REAL git repo in a tmp dir (via `execFile('git', ['init'])` + a commit) since git commands cannot
be tested against a fake/fixture directory the way pure-parsing functions can.
**Warning signs:** a test that passes without ever creating a `.git` directory in its fixture is
not actually exercising the git-diff code path.

### Pitfall 4: `one-two-punch`'s pre-existing dirty working tree corrupting the proof
**What goes wrong:** `~/BoardSmithGames/one-two-punch`'s live working tree has 2 pre-existing
deleted-but-uncommitted files (`.boardsmith/runtime-bundle.mjs`, `.boardsmith/runtime-entry.ts` —
confirmed via `git status --short`, unrelated to any chunk's Build Manifest). `git diff
--name-only <hash> HEAD` only compares against `HEAD`, so this uncommitted state does NOT appear
in `drift-check`'s output (it diffs commits, not working-tree state) — but a proof harness that
naively asserts "working tree is clean before and after" on the ORIGINAL will immediately fail on
this pre-existing condition, unrelated to anything this phase does.
**Why it happens:** the dirty state predates this phase and predates Phase 171 too (171-07-PLAN.md
already anticipated it: "not to be mutated — copy it too", with no clean-state assertion required
for one-two-punch the way seven has one).
**How to avoid:** copy `one-two-punch` with `cp -R` (preserving the pre-existing dirty state
byte-for-byte) and confirm BYTE-IDENTICAL before/after (whole-tree hash comparison), NOT
"clean/porcelain-empty before and after" — the latter is the wrong assertion and will spuriously
fail on the two pre-existing deletions. `seven`, by contrast, IS asserted clean (porcelain-empty)
both before and after, since it genuinely is clean at `a03f38d4792af9dfc7c798be69686fc3230f54dd`
(confirmed directly this session).
**Warning signs:** a proof plan whose acceptance criteria say "one-two-punch git status is empty
after this plan" — that criterion was never true even before this phase touched anything.

## Code Examples

### Extracting the first commit hash after a heading (Pattern 5)
```typescript
// No official-docs source — this is this repo's own new parsing surface. Regex derived from and
// verified against all 29 real "## Verified Commit Hash" sections in both reference games.
const HASH_TOKEN = /`?([0-9a-f]{7,40})`?/;

function extractVerifiedCommitHash(chunkText: string): string | undefined {
  const headingMatch = /^## Verified Commit Hash[ \t]*$/m.exec(chunkText);
  if (!headingMatch) return undefined;
  const bodyMatch = /^## Verified Commit Hash\n([\s\S]*?)(?=\n## |$)/m.exec(chunkText);
  const body = bodyMatch?.[1] ?? '';
  const m = HASH_TOKEN.exec(body);
  return m?.[1];
}
```

### Running the git diff for CHECK-05, with the `cwd` discipline from Pitfall 3
```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

async function diffedFilesSince(projectDir: string, hash: string): Promise<string[] | 'not-found'> {
  try {
    const { stdout } = await execFileAsync(
      'git', ['diff', '--name-only', hash, 'HEAD'],
      { cwd: projectDir },
    );
    return stdout.split('\n').filter(Boolean);
  } catch {
    return 'not-found'; // hash unresolvable in this repo -> caller reports drift-unknown
  }
}
```

## State of the Art

Not applicable in the usual sense (no external ecosystem to be stale against) — but one internal
"state of the art" fact matters: this phase is the FIRST BoardSmith CLI command to shell out to
`git` as a subprocess. Every prior command (`chunk-check`, `ingest-check`, etc.) is pure
`node:fs`. There is no existing "how BoardSmith calls git" convention to follow or deviate from —
this phase sets it. Recommend the `execFile` + explicit `cwd` pattern above as the convention any
LATER command (e.g. Phase 173's `/bs-verify-game`) should copy, rather than reinventing per-call.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | An unresolvable/non-ancestor commit hash should report as `drift-unknown` rather than a new finding kind or a tool failure. | Pattern 5 | Low — this is a design recommendation for an untested path (neither reference game exercises it); if the planner disagrees, a new finding kind (`drift-hash-unresolvable`) is a small, additive change, not a rework. Flagged here because CONTEXT.md's finding-kind enum does not explicitly cover it and the locked decisions don't address this specific sub-case. |
| A2 | The Build Manifest parser should be factored into a shared module (`build-manifest.ts`) imported by both commands, rather than duplicated. | Recommended Project Structure | Low — CONTEXT.md decision 1 explicitly requires "one parser, one authority" for claim resolution; the module-boundary choice of WHERE that lives is Claude's Discretion per CONTEXT.md, and the recommendation here is a reasonable default, not a locked requirement. |

**If this table is empty:** N/A — see above. Everything else in this document is either read
directly from source in this repo (`[VERIFIED]`, effectively `[CITED: local source]`) or measured
directly against the two live reference games this session (also empirical, not `[ASSUMED]`). No
claim in this document rests on training-data recall of an external library or API.

## Open Questions (RESOLVED)

1. **RESOLVED — reuse `manifest-file-missing`, distinguish in `detail`. No tenth finding kind.**
   Closed by `172-01-PLAN.md` ("do not add a tenth kind") per CONTEXT.md decision 7, which locks the
   enum at 9 kinds. The whole-chunk non-tabular case is carried by `ParsedManifest.tabular` plus a
   `detail` string that distinguishes "manifest is not table-shaped" from "row N has no path token".
   This matches the recommendation below.

   **Should `manifest-not-tabular` (Pattern 4's `ai-opponent` case) be its own finding kind, or
   silently degrade to `manifest-file-missing`?**
   - What we know: `ai-opponent/CHUNK.md`'s Build Manifest is legitimately a bulleted prose list,
     not a table — the chunk WAS built with real files (`src/rules/ai.ts`, `src/rules/index.ts`,
     `tests/ai.test.ts`, named in prose), it just isn't machine-parseable in the expected shape.
   - What's unclear: whether the planner wants this treated identically to "found a table row with
     zero extractable paths" (decision 11's `manifest-file-missing`) or flagged distinctly, since
     the underlying cause (non-standard manifest shape vs. a genuinely empty/malformed row) is
     different and arguably more actionable to report separately.
   - Recommendation: reuse `manifest-file-missing` for the whole-chunk case too (no new finding
     kind, stays inside CONTEXT.md's locked enum) but make the `detail` field say "manifest is not
     table-shaped" vs. "row N has no path token" so a human reading the report can tell them apart
     without a new machine-checkable kind. This is a planner-level formatting choice, not a new
     design decision.

2. **RESOLVED — grouped-by-kind with a leading count summary, no hard line cap.** Closed by
   CONTEXT.md ("report text formatting" under Claude's Discretion) and implemented in
   `172-02-PLAN.md` / `172-03-PLAN.md` as a count-first grouped report, mirroring
   `chunkProvenanceStatusCommand`'s existing summary-line convention. Note also that this question's
   premise — near-total `ambiguous-claim-ref` — was itself superseded: CONTEXT.md decision 3 was
   AMENDED after this document was written, replacing the flat "2+ owners ⇒ ambiguous" rule with a
   three-rung narrowing ladder. Section 3's predicted counts are now UPPER BOUNDS, not expectations.

   **How should the human (non-`--json`) report avoid drowning success criterion 3's real findings
   in the volume Section 3 predicts (near-total `ambiguous-claim-ref` on both games)?**
   - What we know: this is explicitly "Claude's Discretion: report text formatting."
   - What's unclear: whether a summary-first, grouped-by-kind rendering (counts, then a few
     representative examples, then "run --json for the full list") is sufficient, or whether the
     planner wants a hard cap on printed line-items per kind.
   - Recommendation: group-by-kind with a leading count summary (mirroring
     `chunkProvenanceStatusCommand`'s existing `full: N  code-conformance-only: N  unknown: N`
     summary-line pattern) is the established in-repo convention and should be followed here too.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `git` CLI | CHECK-05 (`git diff --name-only`, `git merge-base --is-ancestor`) | ✓ | confirmed present and functional (used directly throughout this research session) | none needed — required, no fallback |
| Node.js `child_process` | CHECK-05 | ✓ (built-in) | Node runtime already required by all of BoardSmith | — |
| `~/BoardSmithGames/seven`, `~/BoardSmithGames/one-two-punch` (git repos) | Both checks' PROC-01 proof | ✓ | `seven` at `a03f38d4792af9dfc7c798be69686fc3230f54dd`, clean; `one-two-punch` at `7e69471bd8980a854f3e351f2f486e1fb6f712b9`, pre-existing 2-file dirty state (Pitfall 4) | none needed for the proof itself — both are real, present, git-tracked |

**Missing dependencies with no fallback:** none — everything this phase needs is already present.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (via `vitest.config.ts`, `"test": "vitest run"` in `package.json`) |
| Config file | `vitest.config.ts` (repo root) — `include: ['src/**/*.test.ts', ...]` |
| Quick run command | `npx vitest run src/cli/commands/trace-check.test.ts src/cli/commands/drift-check.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| CHECK-03 | Claim-list parsing scoped to `## Interpretation` only, including `### Corrections...` continuations | unit | `npx vitest run src/cli/commands/trace-check.test.ts -t "Interpretation"` | ❌ Wave 0 |
| CHECK-03 | ⚠️ **SUPERSEDED — do not implement this row.** It states the pre-amendment rule (1 owner=resolved, 0=`unassociated-test`, 2+=`ambiguous-claim-ref`). CONTEXT.md decision 3 was AMENDED after this document was written. The authoritative rule is the three-rung ladder: owners → live-claim-number validity → authoring chunk; `ambiguous-claim-ref` only if >1 survives all three. | unit | `npx vitest run src/cli/commands/trace-check.test.ts -t "resolve"` | ❌ Wave 0 |
| CHECK-03 | `RULINGS.md` `### Ruling N` parsing + global (not per-chunk) ruling-citation coverage | unit | `npx vitest run src/cli/commands/trace-check.test.ts -t "ruling"` | ❌ Wave 0 |
| CHECK-03 | End-to-end, real data: run against a COPY of `one-two-punch`/`seven`, assert non-zero real findings of each measured kind | integration | manual invocation per the 171-07-PLAN.md proof-harness pattern (Section "Proof Harness" below), captured in a `172-PROOF.md` | ❌ Wave 0 (proof plan, not a unit test file) |
| CHECK-05 | Verified-commit-hash extraction handles all 5 real formats (bare short, backtick short, bare full, backtick full, prose-prefixed) | unit | `npx vitest run src/cli/commands/drift-check.test.ts -t "hash"` | ❌ Wave 0 |
| CHECK-05 | `git diff --name-only <hash> HEAD` runs with explicit `cwd`, against a REAL tmp git repo (not a fixture directory) | unit | `npx vitest run src/cli/commands/drift-check.test.ts -t "git"` | ❌ Wave 0 |
| CHECK-05 | Manifest file absent from disk reports as drift (strongest signal, decision 12) | unit | `npx vitest run src/cli/commands/drift-check.test.ts -t "missing"` | ❌ Wave 0 |
| CHECK-05 | No recorded hash → `drift-unknown`, never collapsed into drifted/clean | unit | `npx vitest run src/cli/commands/drift-check.test.ts -t "unknown"` | ❌ Wave 0 |
| CHECK-05 | End-to-end, real data: run against COPIES of both games, confirm real drift counts match Section 3's predictions (order of magnitude) | integration | same `172-PROOF.md` proof-harness invocation as CHECK-03 | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/cli/commands/trace-check.test.ts src/cli/commands/drift-check.test.ts`
- **Per wave merge:** `npm test` (full suite, currently 3407/3407 per `171-07-SUMMARY.md` — no
  source touched since, so this is the expected pre-172 baseline)
- **Phase gate:** Full suite green before `/gsd:verify-work`, PLUS the real-data proof artifact
  (`172-PROOF.md`) demonstrating non-no-op output against both copies, per PROC-01 and this phase's
  success criterion 3.

### Wave 0 Gaps
- [ ] `src/cli/commands/trace-check.ts` + `.test.ts` — does not exist yet.
- [ ] `src/cli/commands/drift-check.ts` + `.test.ts` — does not exist yet.
- [ ] `src/cli/commands/build-manifest.ts` (or equivalent shared module) — the "one parser, one
      authority" manifest parser both commands need; does not exist yet.
- [ ] `cli.ts` registration for `trace-check [--json]` / `drift-check [--json]` — does not exist
      yet.
- [ ] No framework install needed — Vitest is already fully configured and green.

## Proof Harness (reuse verbatim from Phase 171)

`171-07-PLAN.md` is the exact template to reuse; do not reinvent it. Its mechanics, verified by
reading the plan directly:

1. **Assert the read-only invariant on the ORIGINALS first.** For `seven`: assert `git rev-parse
   HEAD` equals `a03f38d4792af9dfc7c798be69686fc3230f54dd` AND `git status --porcelain` is empty.
   STOP if either fails — do not proceed and do not attempt to clean it. (Confirmed still true this
   session: `a03f38d4792af9dfc7c798be69686fc3230f54dd`, porcelain empty.) For `one-two-punch`: do
   NOT assert porcelain-empty (Pitfall 4 — it has 2 pre-existing unrelated deletions); assert
   `git rev-parse HEAD` equals `7e69471bd8980a854f3e351f2f486e1fb6f712b9` instead (confirmed this
   session) and plan to confirm BYTE-IDENTICAL before/after via a whole-tree hash comparison of the
   copy's working state, not a porcelain-clean assertion.
2. **Copy, never touch the originals again.** `cp -R` (never `git clone`) into a scratch directory
   — `cp -R` preserves untracked/dirty state faithfully, which matters for CHECK-05's git plumbing
   too, since it also preserves the `.git` directory intact (git commands inside the copy resolve
   against the SAME commit history as the original, so hash-ancestry checks behave identically on
   the copy).
3. **Run every command against the COPY only**, via `node /Users/jtsmith/BoardSmith/bin/boardsmith.js <cmd> --project <copy-dir> --json` — `bin/boardsmith.js` runs `src/cli/cli.ts` through `tsx` directly, no build step needed.
4. **Never trust the command's own arithmetic to check itself.** Cross-check every count the
   command reports against an INDEPENDENTLY computed value — e.g., for CHECK-03's claim counts, an
   independent `grep -c` bounded the same way as Pattern 2/3 above; for CHECK-05's drift counts,
   an independent `git diff --name-only <hash> HEAD | wc -l` intersected by hand against the
   manifest file list (exactly the computation performed in this research document's Section 3).
5. **Record real command invocations, verbatim output, and real counts** in a `172-PROOF.md`
   (mirroring `171-PROOF.md`'s shape), including an explicit "what is still unproven" section.
6. **Confirm both originals byte-identical (or, for `one-two-punch`, porcelain-state-preserving)
   before AND after** — this is the phase's non-negotiable read-only guarantee, identical in
   spirit to `171-07-PLAN.md`'s stated acceptance criterion.

## Sources

### Primary (HIGH confidence — read directly from this repo)
- `src/cli/commands/chunk-provenance.ts` (864 lines) — the closest analog; section-locating
  pattern, `f73153a3` bug shape, `--json` output shape, `VerifiedAgainstRecord`/`ParsedVerifiedAgainst`
  shapes, `chunkCheckCommand`/`chunkProvenanceStatusCommand` structure.
- `src/cli/commands/chunk-provenance.test.ts` — fixture-building convention (`makeProject()`
  helper, `beforeEach`/`afterEach` tmpdir pattern).
- `src/cli/commands/ingest-archive.ts` — `PRESENTATION_LEXICON` cross-file-pinning precedent,
  `process.exitCode = 1` idiom, enumerated-code pattern.
- `src/cli/lib/skills-tree-hash.ts`, `src/cli/lib/boardsmith-version.ts` — Phase 171's version
  plumbing (read for completeness; not directly reused by this phase's two commands).
- `src/cli/cli.ts` — command registration shape (lines ~168–182), the top-level
  `program.parseAsync()` + `try`/`catch` (no raw stack traces leak).
- `.planning/phases/171-provenance-recording/171-07-PLAN.md`,
  `.planning/phases/171-provenance-recording/171-07-SUMMARY.md` — the proof-harness template.
- `.planning/phases/172-source-free-conformance-checks/172-CONTEXT.md`,
  `.planning/REQUIREMENTS.md`, `.planning/STATE.md`,
  `.planning/phases/171-provenance-recording/171-CONTEXT.md` — locked decisions, requirement text,
  project history.
- `vitest.config.ts`, `package.json` — test framework and dependency versions.

### Secondary (MEDIUM confidence)
None — this phase required no external documentation lookup.

### Tertiary (LOW confidence)
None.

### Empirical measurements (this session, read-only against both reference games)
- `~/BoardSmithGames/one-two-punch` (12 chunks, HEAD `7e69471bd8980a854f3e351f2f486e1fb6f712b9`,
  pre-existing 2-file dirty state) — claim counts, Build Manifest shapes, Verified Commit Hash
  formats, test citation forms, git ancestry, predicted drift counts, all measured directly via
  `grep`/`awk`/`git`/Python in this session.
- `~/BoardSmithGames/seven` (17 chunks, HEAD `a03f38d4792af9dfc7c798be69686fc3230f54dd`, confirmed
  clean before AND after this research session) — same measurements.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependency; every fact read directly from this repo's own
  `package.json` and source.
- Architecture: HIGH — the analog (`chunk-provenance.ts`) is read in full and its patterns are
  directly transferable; the shared-manifest-parser structure is a straightforward consequence of
  locked decision 1.
- Pitfalls: HIGH — every pitfall in this document is either a documented, already-fixed bug in
  THIS codebase (`f73153a3`) or a condition measured directly against real chunk data this
  session, not a hypothetical.
- Predicted findings (below): HIGH — computed directly from real data, not estimated.

**Research date:** 2026-07-28
**Valid until:** Indefinite for the architecture/pitfalls sections (they describe this repo's own
code and will not go stale the way an external library would). The predicted-findings COUNTS in
the section below are a snapshot of the two reference games' CURRENT state (2026-07-28) — if
either game's `chunks/`, `tests/`, or `RULINGS.md` changes before this phase is implemented, the
counts should be re-measured (the METHOD for measuring them, given above, will not change).

---

## Section 2: The Real Parse Surface — Measured

### `## Interpretation` claim lists

| Game | Chunks | Total claims | Range per chunk | Non-contiguous starts | Duplicate numbers |
|------|--------|--------------|------------------|------------------------|--------------------|
| one-two-punch | 12 | 165 | 0–35 | 0 chunks | 0 |
| seven | 17 | 212 | 0–42 | 4 chunks (`discard` starts at 20, `scoring-combo-sets-and-runs` at 11, `simultaneous-round-loop` at 7, `table-and-draw` at 28) | 0 |

- `### Corrections from Redteam Round N (claims M–P, append-only)` subheadings occur exactly twice,
  both in `one-two-punch/chunks/punch/CHUNK.md` ("Round 1 (claims 22–28)", "Round 2 + designer
  decisions (claims 29–35)"). Numbering continues seamlessly across the subheading — no gap, no
  reset. `seven` has zero literal `### Corrections from Redteam Round N` headers, but achieves the
  same append-only-correction effect via inline "SUPERSEDES SEEDED CLAIM N" / "SUPERSEDES CLAIM
  N's..." prose inside ordinary numbered items (see Pattern 3 above) — this is a SECOND, distinct
  mechanism for the same underlying discipline, and a parser keyed only on the `###` subheading
  pattern would miss `seven`'s form entirely (moot for claim EXTRACTION, since numbering is
  contiguous-from-first-item either way — but relevant if the planner ever wants to detect
  "corrected claim" provenance, which is explicitly out of scope for this phase).
- Non-contiguous starts are real and structural, not damage: the "seeded" claims below the first
  real list item are quoted and refuted/corrected INSIDE the first item's own text, never printed
  as standalone entries. A `claim-untested` check must treat "the set of integers that appear as
  list items" as the live set, not `1..max`.

### `## Build Manifest`

| Game | Chunks | Chunks with a standard table | Chunks with 0 table rows but real content | Chunks with legitimately 0 files |
|------|--------|-------------------------------|---------------------------------------------|------------------------------------|
| one-two-punch | 12 | 11 | 1 (`ai-opponent` — bulleted prose, not a table) | 1 (`final-acceptance` — empty table body) |
| seven | 17 | 17 | 0 | 1 (`final-acceptance`) |

- Comma-joined multi-path first cells are real: at least 1 row across both games' manifests joins
  5 test-file paths in a single cell (`discard-phase-and-reclaim/CHUNK.md`,
  `tests/game.test.ts, tests/block.test.ts, tests/punch.test.ts, tests/rest.test.ts,
  tests/a11y.test.ts`).
- No manifest is missing its `## Build Manifest` heading entirely in either game (all 29 chunks
  have the heading; the variance is table-vs-prose and empty-vs-populated).

### `## Verified Commit Hash`

- **All 29 chunks, both games, have a parseable hash** — none is missing the section, none has
  the heading with no parseable hash inside it.
- Format varies freely: bare short (7-char), backtick short, bare full (40-char SHA), backtick
  full, and prose-prefixed (hash is NOT the first line — `block/CHUNK.md`, two sentences of prose
  precede `Verified commit: \`fbc573f\`...`).
- **All 29 hashes independently verified, this session, to be real git objects AND ancestors of
  their repo's current HEAD** (`git merge-base --is-ancestor <hash> HEAD`, exit 0 for all 29). No
  chunk in either game currently exercises the "hash not found" / "hash not an ancestor" path.

### `RULINGS.md`

| Game | Total `### Ruling N` entries | Distinct ruling numbers cited by any test | Ruling numbers with zero test citation |
|------|-------------------------------|----------------------------------------------|-------------------------------------------|
| one-two-punch | 26 | 23 | 3 (Rulings 10, 14, 23) |
| seven | 36 | 32 | 4 (exact numbers not individually enumerated in this pass; count confirmed) |

**Supersession phrasing — enumerated across all 62 total rulings, both games:**
Only **3 total** occurrences match a reliably regexable "Ruling N supersedes/is superseded"
pattern:
- one-two-punch Ruling 14 area: `"supersedes Ruling 14's card-shaped presentation"`
- seven Ruling ~9 area: `"⚠ RATIONALE SUPERSEDED BY RULING 9"` (note the REVERSED direction — this
  phrase appears on Ruling 3's entry, meaning ruling 9 supersedes ruling 3, not the other way; a
  naive "the number after 'Ruling' in a supersession sentence is the SUPERSEDING ruling" heuristic
  would get this one backwards)
- seven Ruling ~3 area: `"Supersedes the RATIONALE of Ruling 3"`

Every OTHER cross-ruling reference in both files ("reconciles Ruling 24 with Ruling 1", "extends
Rulings 21/22", "UPHOLDS Ruling 23", "RESOLVES OQ-1", "overrides DECISIONS.md Decision 23") is
NOT a ruling-to-ruling supersession chain — it is a citation to a related-but-not-obsoleted ruling,
or a reference to an entirely different document (`DECISIONS.md`). **Conclusion, directly
answering the research-focus question: the supersession chain as CONTEXT.md describes it
("supersedes Ruling N") is parseable only for this narrow ~3-occurrence exact-phrase pattern.**
Attempting to regex-match the broader "reconciles/extends/upholds/resolves" vocabulary as
supersession would produce false positives (treating a mere cross-reference as an obsoleting
event) and get the direction backwards on at least the one confirmed "SUPERSEDED BY" case. This
does not make CONTEXT.md's decision 5 infeasible — its own text already anticipates this ("parse
it, and where it cannot be parsed, report rather than assume") — but the PRACTICAL scope of what
gets parsed as a formal chain should be exactly this narrow "supersedes/superseded" phrase-match,
with everything else left unclassified rather than guessed at.

### Test-source claim citations — enumerated forms and counts

| Form | one-two-punch count | seven count |
|------|----------------------|--------------|
| `claim N` (single, lowercase) | majority of 72 total `claim(s) N...` matches | majority of 48 total `claim(s) N...` matches |
| `claims N, M, ...` (comma-joined) | 2 (one is `claims 3, 4, 5, 29` — 4-wide) | present, not separately counted this pass |
| `claim N/M` (slash-joined, ambiguous whether "claim N or M" or "claim N, ruling M") | 9 | present |
| `claim N / Ruling M` (explicit mixed form) | 3 (incl. one `claim 28 / Ruling 9/15` — TWO rulings) | present |
| `Claim N` (capitalized) | 2 | present |
| `CHUNK.md claim N` (self-referential qualified form, already exists) | present (`tests/game.test.ts:510`, `tests/block.test.ts:56,143`) | not separately measured |
| Total `claim(s) N` matches | 72 | 48 |
| Total `ruling(s) N` matches | 59 | 177 |

- **`CHUNK.md claim N` is a real, pre-existing qualified form** — but it says "the CURRENT chunk's
  claim N" (self-referential), not "chunk `<slug>`'s claim N" the way CONTEXT.md's rejected
  qualified-form alternative would require; it does not name a chunk slug and so does NOT resolve
  ambiguity via the manifest model — it is closer to a human-readability hint than a
  machine-resolvable qualifier. Recommend treating it identically to a bare `claim N` for
  resolution purposes (i.e., ignore the `CHUNK.md` prefix, let the manifest-owner index resolve
  it the normal way).
- Test files with ZERO claim references: 8/13 in one-two-punch (`ai.test.ts`,
  `asset-reachability.test.ts`, `discard.test.ts`, `game-end.test.ts`,
  `ring-movement-desync.test.ts`, `setup.test.ts`, `simulation.test.ts`, `theme.test.ts`); 6/9 in
  seven (`a11y.example.test.ts`, `card-mark.test.ts`, `discard-pile.test.ts`,
  `match.a11y.test.ts`, `match.test.ts`, `random-sim.test.ts`). This directly feeds the CONTEXT.md
  open question about whether a zero-claim-ref file is `test-unlinked` — see Section 3.

### `test-unlinked` direction — measured, answering CONTEXT.md's open question empirically

The files above with zero claim citations are legitimately varied in kind: `ai.test.ts` (AI smoke
tests — no rule claim to cite), `asset-reachability.test.ts` and `theme.test.ts` (structural/build
checks, not rule tests), `simulation.test.ts` / `random-sim.test.ts` (soak tests asserting
engine-level invariants, not specific rule claims), but also `discard.test.ts` and
`game-end.test.ts` — real, rule-behavior test files that simply cite zero claims by number despite
testing real rule behavior (their coverage is asserted in prose, not via `claim N` markers). This
CONFIRMS CONTEXT.md's own flagged risk: a bare "zero claim refs = test-unlinked" rule would
misclassify legitimate a11y/soak/build-check files as findings on every single run of both
reference games. **This phase's locked decisions do not actually define `test-unlinked`'s trigger
condition** (only its finding-kind NAME is locked) — this is a real gap the planner must close,
and the measured data above should inform it: recommend `test-unlinked` fire only for a test file
that IS listed in at least one manifest (i.e., is chunk-associated) AND contains rule-shaped
assertion patterns (e.g., calls into `src/rules/`) yet cites neither a claim nor a ruling — NOT for
every zero-citation file indiscriminately. This is flagged as Open Question material for the
planner, not resolved here (CONTEXT.md's decisions do not specify the exact trigger, only the
finding-kind name).

## Section 3: Predicted Findings (per game, computed from real data this session)

### `trace-check` on `one-two-punch` (12 chunks, 165 claims, 26 rulings)
- `ambiguous-claim-ref`: ~67 (every claim citation in `a11y.test.ts`, `block.test.ts`,
  `game.test.ts`, `punch.test.ts`, `rest.test.ts` — the only files carrying real claim citations —
  is ambiguous, because EVERY ONE of those files is listed in 3–8 different chunks' manifests;
  measured directly: `a11y.test.ts` owned by 8 chunks, `game.test.ts` by 6, `block.test.ts`/
  `punch.test.ts`/`rest.test.ts` by 3–4 each).
- `claim-untested`: approaches the full 165, since almost no citation resolves cleanly to a single
  chunk under the ambiguity above (the exact residual — any claims that DO get a clean single-owner
  resolution — was not hand-enumerated in this pass, but the structural finding is that NONE of
  the 5 claim-bearing test files has unique ownership, so the clean-resolution count is at or near
  zero).
- `unassociated-test`: at least 2 (`asset-reachability.test.ts`, `setup.test.ts` — owned by zero
  chunks' manifests).
- `ruling-untested`: 3 (Rulings 10, 14, 23 — cited by no test).
- `manifest-file-missing`/`manifest-not-tabular`: at least 1 (`ai-opponent`'s bulleted-list
  manifest, per Open Question 1).

### `trace-check` on `seven` (17 chunks, 212 claims, 36 rulings)
- `ambiguous-claim-ref`: the same structural pattern — `game.test.ts` (2 claim citations) is owned
  by 11 chunks; `scoring.test.ts` (46 claim citations, the large majority of the game's claim
  citations) is owned by 9 chunks. Both are ambiguous.
- `claim-untested`: approaches the full 212 for the identical structural reason as one-two-punch.
- `ruling-untested`: 4.
- `unassociated-test`: at least 1 (`match.a11y.test.ts`, owned by zero chunks — though it does
  carry a ruling citation, which per this document's Pattern reasoning should still count toward
  ruling coverage even though the FILE is unassociated).

### `drift-check` on `one-two-punch`
Real, non-trivial drift on the large majority of chunks — measured directly by intersecting each
chunk's manifest file list with `git diff --name-only <hash> HEAD`:
- 10/12 chunks show 1+ manifest files changed since their verified hash (range 1–19 files;
  `ai-opponent` and `final-acceptance` show 0, both legitimately — `ai-opponent` because its
  manifest isn't table-parseable so 0 paths are extracted at all, `final-acceptance` because it is
  the game's last chunk with nothing after it to drift).
- **A real, confirmed file-deletion drift case exists**: `jab/CHUNK.md`'s manifest lists
  `src/ui/components/GuardCardView.vue`, which no longer exists on disk — `git log
  --diff-filter=D -- src/ui/components/GuardCardView.vue` confirms it was deleted in a later
  commit and never recreated. This is exactly decision 12's "strongest possible drift signal" case,
  present in real data on the very first run — success criterion 3 is satisfied with a genuinely
  interesting finding, not a contrived one.

### `drift-check` on `seven`
All 17 chunks' hashes are real ancestors of `HEAD`; the equivalent manifest-intersected diff was
not exhaustively re-run file-by-file in this pass (the one-two-punch measurement above is
sufficient to establish the METHOD works and produces real, non-zero findings), but the same
structural pattern is expected: `seven` has MORE chunks (17 vs 12) and a longer build history since
`table-and-draw` (chunk 1) closed, so drift volume should be at least as high, proportionally.
Recommend the phase's proof step re-run this exact intersection against `seven` directly (Section
"Proof Harness" above) rather than relying on this estimate alone.

### Risk to success criterion 3 ("surfacing real findings, not a dry no-op run")
**Not at risk — the opposite risk is real and larger.** Both checks will produce substantial,
genuine, non-contrived findings on their very first run against both reference games. The actual
risk (flagged in CONTEXT.md's own specifics and confirmed by this measurement) is REPORT VOLUME —
`ambiguous-claim-ref`/`claim-untested` findings will number in the dozens to low hundreds on a
single run. This is squarely a "Claude's Discretion: report text formatting" concern (Open
Question 2 above), not a design-decision concern — the finding DATA is correct and valuable; only
the human-readable PRESENTATION needs to avoid burying it.
