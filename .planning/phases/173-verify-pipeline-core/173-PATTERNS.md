# Phase 173: Verify Pipeline Core - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 9 (create/modify units; 2 are colocated test files, 1 is a whole `bs/verify/`
subdirectory of unknown-count sub-step files)
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/commands/ingest-archive.ts` (MODIFY existing-INDEX branch) | CLI command / file-mutator | file-I/O (read-modify-write text header) | itself — the fresh-scaffold branch (`renderIndex`, same file) | exact (same function, sibling branch) |
| `src/cli/commands/ingest-archive.test.ts` (MODIFY, new cases) | test | unit / fixture-driven | `src/cli/commands/chunk-provenance.ts`'s test suite conventions (temp-dir fixture pattern) — not read this pass, infer from `install-claude-command.test.ts`'s `mkdtempSync` shape | role-match |
| `src/cli/commands/verify-run.ts` (NEW — RUN.md resume ledger) | CLI command / event-sourced append-only ledger | event-driven (append one record per completed step) + request-response (`--json` read) | `src/cli/commands/chunk-provenance.ts` (`chunkCheckCommand`, fenced-region read/write) + `src/cli/commands/build-manifest.ts` (`findHeadingIndex`) | exact (fence shape) / role-match (record-per-append is new) |
| `src/cli/commands/verify-run.test.ts` (NEW, colocated) | test | unit | `src/cli/commands/chunk-provenance.ts`'s corresponding `*.test.ts` (not opened; infer shape from `install-claude-command.test.ts` — `mkdtempSync`/`rmSync` real-fs fixtures, not mocks) | role-match |
| `src/cli/cli.ts` (MODIFY — register ledger command(s)) | route/registration | request-response (Commander `.action()` wiring) | itself, `ingest-archive`/`chunk-check`/`chunk-provenance-status`/`trace-check`/`drift-check` registration blocks (lines 136-199) | exact |
| `src/cli/commands/install-claude-command.ts` (MODIFY — register `bs-verify-game` + `bs/verify/`) | config/installer | file-I/O (recursive tree copy + array-driven registration) | itself — `SKILL_ENTRY_POINTS`, `SHARED_DIRS`, `SHARED_LEAF_PROBES`, post-install summary (same file, same arrays) | exact |
| `src/cli/commands/install-claude-command.test.ts` (MODIFY — extend 4 `SKILL_NAMES` arrays) | test | unit / integration (real temp-dir install) | itself — 4 existing `describe` blocks at lines 100, 242, 306, 444 | exact |
| `src/cli/slash-command/bs/verify-game.md` (NEW — skill entry point) | route / orchestrator (skill text) | request-response (dispatch loop, state-driven) | `src/cli/slash-command/bs/ingest-rules.md` (entry-point shape: frontmatter, Context-Economics restatement, numbered Steps, "Reference Files" footer) | exact |
| `src/cli/slash-command/bs/verify/*.md` (NEW — sub-steps) | route / sub-orchestrator (skill text) | request-response + event-driven (fan-out dispatch) | `src/cli/slash-command/bs/ingest/transcription.md` (fan-out dispatch shape) + `src/cli/slash-command/bs/state-machine.md` (Session Lock / Cold-Resume Parse Contract / Consistency Check, all cited not restated) | exact |
| `src/cli/slash-command/bs/ingest/transcription-subagent.md` (MODIFY — generalize output dir) | subagent contract (skill text) | file-I/O (subagent writes its own output) + request-response (structured return) | itself, unchanged except ~4 lines (Section 1 heading/prose, worked example, return-field description, "Your inputs" line already generic) | exact (surgical edit to same file, not a new analog) |

## Pattern Assignments

### `src/cli/commands/ingest-archive.ts` — existing-INDEX branch fix

**Analog:** the same file's fresh-scaffold branch (`renderIndex`, lines 110-176) shows what the
header is SUPPOSED to look like; the broken branch is lines 526-562.

**The exact broken branch to replace** (`ingest-archive.ts:526-562`):
```typescript
let wroteIndex = false;
try {
  await fs.access(indexPath);
  // INDEX.md already exists — rewrite only the provenance header, leave filled sections alone.
  const existing = await fs.readFile(indexPath, 'utf-8');
  const normalizedEdition = normalizeEdition(options.edition);
  const originalEdition = options.edition?.trim();
  const editionNoteLine =
    originalEdition && normalizedEdition === EDITION_UNKNOWN && originalEdition !== EDITION_UNKNOWN
      ? `${EDITION_NOTE_LABEL} ${originalEdition}`
      : undefined;
  // Strip any prior Edition note: line before rewriting, so a repeated ingest-archive run does
  // not accumulate duplicates — the same "replace, don't append" discipline as the Edition:
  // line itself.
  const withoutOldNote = existing.replace(/^Edition note:.*\n?/m, '');
  const withEditionNote = editionNoteLine
    ? withoutOldNote.replace(/^Edition:.*$/m, `Edition: ${normalizedEdition}\n${editionNoteLine}`)
    : withoutOldNote.replace(/^Edition:.*$/m, `Edition: ${normalizedEdition}`);
  const withHeader = withEditionNote
    .replace(/^Source:.*$/m, `Source: ${relArchivePath}`)
    .replace(/^Source hash:.*$/m, `Source hash: ${sourceHash}`)
    .replace(/^Transcribed:.*$/m, `Transcribed: ${transcribed}`);
  await fs.writeFile(indexPath, withHeader);
} catch {
  await fs.mkdir(dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, renderIndex({ gameName, edition: options.edition, archivedPath: relArchivePath, sourceHash, transcribed }));
  wroteIndex = true;
}
```

Three concrete defects the fix must close (all independently reproduced this session per
CONTEXT.md decision 1b / RESEARCH.md Pitfall 1):
1. `.replace(/^Source hash:.*$/m, ...)` and `.replace(/^Transcribed:.*$/m, ...)` are silent no-ops
   when the label is entirely absent (neither reference game's `INDEX.md` has these lines at all).
   **Fix shape: insert-if-absent.** Test each label's regex first; if no match, APPEND the new
   line (with the same ordering `renderIndex` uses: `Edition:` → `Source:` → `Source hash:` →
   `Transcribed:`) rather than calling `.replace()` blind.
2. `.replace(/^Source:.*$/m, ...)` matches only the FIRST physical line of a real, wrapped
   `Source:` paragraph (`seven`'s actual line 5: `` Source: `rules.pdf` (2 pages). This index is
   the term → slice cross-reference. It is built from the `` — continues onto the next line
   `transcribed subagents' returned...`). Blind single-line replace orphans the continuation.
   **Fix shape: wrap-safe.** Detect a `Source:` match whose remainder does not look like a bare
   path (contains sentence punctuation / the next line does not start a heading or blank-line
   boundary) and STOP AND ASK rather than truncate — this is the Cold-Resume Parse Contract
   "ambiguous ⇒ stop and ask" discipline (`state-machine.md:75-85`), the same shape decision 4
   already applies to multiple candidate root sources.
3. `.replace(/^Edition:.*$/m, ...)` unconditionally overwrites a real `Edition:` value with
   `EDITION_UNKNOWN` when `--edition` is not resupplied. **Fix shape: preserve.** When
   `options.edition` is undefined/empty, read the EXISTING `Edition:` line's value first and
   normalize the caller-supplied over it only if supplied — never regress a real value to the
   sentinel. `normalizeEdition()` (lines 80-86) and `EDITION_EMPTY_LEXICON` (lines 55-64) are the
   two functions to reuse for detecting "was this existing value itself already the sentinel or a
   recognizably-empty phrase."

**What the header is SUPPOSED to look like** (fresh-scaffold branch, `renderIndex`, lines 124-129):
```typescript
return `# Rulebook Index — ${gameName}

Edition: ${normalizedEdition}${editionNoteLine}
Source: ${archivedPath}
Source hash: ${sourceHash}
Transcribed: ${transcribed}
...
```
`HEADER_LABELS` (line 38) is the parsed-header contract: `['Edition:', 'Source:', 'Source hash:',
'Transcribed:']` — any insert-if-absent logic should iterate this tuple in this exact order so a
freshly-repaired legacy `INDEX.md` converges on the identical shape a fresh scaffold produces.

**Downstream proof target** (what "fixed" means, not just "exits 0"):
`computeVerificationScope()` (`src/cli/commands/chunk-provenance.ts:95-147`) is the payoff check —
```typescript
const hashMatch = /^Source hash:\s*(.*)$/m.exec(index);
if (!hashMatch) {
  return { scope: SCOPE_CODE_ONLY, reason: 'pre-provenance-project', edition };
}
```
The fix is proven only when this function returns `{ scope: SCOPE_FULL, ... }` against a `cp -R`
copy of `seven` or `one-two-punch` post-fix, not merely when `ingestArchiveCommand` exits 0.

---

### `src/cli/commands/verify-run.ts` (NEW — RUN.md resume ledger)

**Analog 1 — the fenced machine-owned region shape** (`ingest-archive.ts:97-98`, reused verbatim
per CONTEXT.md decision 9):
```typescript
export const GAPS_BEGIN = '<!-- boardsmith:gaps:begin -->';
export const GAPS_END = '<!-- boardsmith:gaps:end -->';
```
Write-bounded-by-fence read/replace pattern (`ingest-archive.ts:248-268`, inside
`ingestGapsCommand`):
```typescript
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
const before = index.slice(begin + GAPS_BEGIN.length, end);
const body = entries.length ? `\n${entries.join('\n')}\n` : `\n${GAPS_EMPTY}\n`;
const changed = before !== body;
await fs.writeFile(indexPath, index.slice(0, begin + GAPS_BEGIN.length) + body + index.slice(end));
```
`chunk-provenance.ts` reuses the SAME shape with a DISTINCT fence pair for a second machine-owned
section — reuse this precedent for why RUN.md needs its own new constant pair, never `GAPS_BEGIN`:
```typescript
// Source: src/cli/commands/chunk-provenance.ts:225-226
export const VERIFIED_AGAINST_BEGIN = '<!-- boardsmith:verified-against:begin -->';
export const VERIFIED_AGAINST_END = '<!-- boardsmith:verified-against:end -->';
```

**Analog 2 — line-anchored heading location, MUST reuse, do not hand-roll a third** (`build-manifest.ts:65-91`):
```typescript
export function findHeadingIndex(text: string, heading: string): number {
  const re = new RegExp(`^${escapeRegExp(heading)}[ \\t]*$`, 'm');
  const match = re.exec(text);
  return match ? match.index : -1;
}

export function extractSection(text: string, heading: string): string | undefined {
  const headingIdx = findHeadingIndex(text, heading);
  if (headingIdx === -1) return undefined;
  const headingLineEnd = text.indexOf('\n', headingIdx);
  const bodyStart = headingLineEnd === -1 ? text.length : headingLineEnd + 1;
  const bodyText = text.slice(bodyStart);
  const nextHeadingMatch = /^## /m.exec(bodyText);
  const bodyEnd = nextHeadingMatch ? nextHeadingMatch.index : bodyText.length;
  return bodyText.slice(0, bodyEnd);
}
```
This is a `git blame`-documented recurrence: `chunk-provenance.ts:388-394` records the SAME defect
(`indexOf` matching a heading NAME appearing in unrelated template prose, silently truncating a
scan — commit `f73153a3`) happening TWICE. Any RUN.md heading location must call
`findHeadingIndex`/`extractSection` from `build-manifest.ts`, imported exactly as
`chunk-provenance.ts:8` does: `import { findHeadingIndex } from './build-manifest.js';`

**Analog 3 — `--json`/human dual-output CLI registration shape** (`cli.ts:176-181`):
```typescript
program
  .command('chunk-provenance-status')
  .description('Report per-chunk verification provenance and drift (read-only)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(chunkProvenanceStatusCommand);
```

**Analog 4 — repair-then-fail / process.exitCode discipline** (`ingest-archive.ts:466-471`, inside
`ingestCheckCommand`):
```typescript
// Set the exit code rather than throwing: `program.parse()` does not await action handlers, so a
// rejection surfaces as an unhandled-rejection stack trace. The caller here is a git hook or a
// build session, both of which need the non-zero status and neither of which should be shown
// this repo's internal paths.
process.exitCode = 1;
```
Note research's Open Question 1: whether RUN.md wants ONE fence wrapping the whole ledger (GAPS
pattern) or one fence PER RECORD (crash-safety). This is planner discretion, not yet decided by any
locked decision — flag it as such in the plan, do not silently pick one.

**Non-recursive readdir convention (for enumerating live vs. staged slices, VERIFY-02's exclusion
guarantee)** (`ingest-archive.ts:226`, `chunk-provenance.ts:378`):
```typescript
const names = (await fs.readdir(rulebookDir)).filter(
  (f) => f.endsWith('.md') && f !== 'INDEX.md',
);
```
Non-recursive + `.md`-filter already structurally excludes a dot-prefixed `rulebook/.verify/`
staging directory without a new exclusion rule — do not write a recursive glob/walk.

---

### `src/cli/cli.ts` (MODIFY — register new command(s))

**Analog:** the `ingest-archive`/`chunk-check`/`chunk-provenance-status` registration blocks
(`cli.ts:136-181`, reproduced above). Copy this exact five-line shape per new command: `.command()`
→ `.description()` → `--project` option → `--json` option → `.action()`. New commands registered
after the top-level `program.parseAsync()` + `try/catch` (added Phase 171) inherit unhandled-
rejection safety automatically — **do not add a per-command catch.**

---

### `src/cli/commands/install-claude-command.ts` (MODIFY — register `bs-verify-game`)

**Exact four-point edit, all in this one file:**

1. `SKILL_ENTRY_POINTS` array (`install-claude-command.ts:30-37`):
```typescript
const SKILL_ENTRY_POINTS: Array<{ source: string; skillName: string }> = [
  { source: join('bs', 'create-game.md'), skillName: 'bs-create-game' },
  { source: join('bs', 'ingest-rules.md'), skillName: 'bs-ingest-rules' },
  { source: join('bs', 'build-chunk.md'), skillName: 'bs-build-chunk' },
  { source: join('bs', 'check-status.md'), skillName: 'bs-check-status' },
  { source: join('bs', 'insert-chunk.md'), skillName: 'bs-insert-chunk' },
  { source: 'generate-ai-instructions.md', skillName: 'bs-generate-ai' },
  // ADD: { source: join('bs', 'verify-game.md'), skillName: 'bs-verify-game' },
];
```
2. `SHARED_DIRS` (`install-claude-command.ts:50`):
```typescript
const SHARED_DIRS = ['build', 'ingest', 'templates', 'aspects'];
// becomes: ['build', 'ingest', 'templates', 'aspects', 'verify']
```
This is what makes `bs/verify/*.md` land at `bs-shared/verify/*.md` on install — `bs/verify/` is
NOT auto-discovered; both arrays are explicit hand-maintained lists (no directory scanning
anywhere in `copySkillTree`).

3. `SHARED_LEAF_PROBES` (`install-claude-command.ts:58-64`) — add one known leaf file inside the
new shared dir, otherwise `isFullyInstalled()` (WR-03a) cannot distinguish a complete vs. partial
install of the new shared dir (`fs.cp` creates the destination dir before populating it — an empty
dir would wrongly report "already installed"):
```typescript
const SHARED_LEAF_PROBES = [
  join(SHARED_ROOT, 'state-machine.md'),
  join(SHARED_ROOT, 'build', 'build.md'),
  join(SHARED_ROOT, 'ingest', 'transcription.md'),
  join(SHARED_ROOT, 'templates', 'SKETCH.template.md'),
  join(SHARED_ROOT, 'aspects', 'index.md'),
  // ADD: join(SHARED_ROOT, 'verify', '<first-real-file-in-bs/verify/>'),
];
```
4. Post-install console summary block (`install-claude-command.ts:231-237`) — add a
`bs-verify-game` line matching the existing one-line-per-skill format:
```typescript
console.log(chalk.cyan('  bs-create-game') + chalk.gray('   - Start a new game — from an idea or a rulebook (start here)'));
console.log(chalk.cyan('  bs-ingest-rules') + chalk.gray('  - Ingest a rulebook and produce the initial sketch/chunk plan'));
console.log(chalk.cyan('  bs-build-chunk') + chalk.gray('   - Build, test, audit, and playtest one chunk at a time'));
console.log(chalk.cyan('  bs-check-status') + chalk.gray('  - Report sketch/chunk progress and next steps'));
console.log(chalk.cyan('  bs-insert-chunk') + chalk.gray('  - Insert a new chunk into an existing sketch'));
console.log(chalk.cyan('  bs-generate-ai') + chalk.gray('   - Generate AI evaluation functions for a game chunk'));
// ADD a bs-verify-game line here, same alignment convention.
```
Note the top-of-file doc comment (`install-claude-command.ts:4-6`) also names the skill family by
hand — `"(bs-create-game, bs-ingest-rules, bs-build-chunk, bs-check-status, bs-insert-chunk,
bs-generate-ai)"` — update it too, or it silently drifts to describe six skills when seven exist.

`ownedPaths()` (`install-claude-command.ts:76-81`) and the uninstaller (`:255-287`) both derive
from `SKILL_ENTRY_POINTS` + `SHARED_ROOT` automatically — no separate edit needed there once (1) is
done; `bs-verify-game`'s pre-clean and uninstall paths fall out for free.

---

### `src/cli/commands/install-claude-command.test.ts` (MODIFY — 4 `SKILL_NAMES` arrays)

**All FOUR locations, confirmed by direct line read (not merely grep):**

| # | `describe` block | `SKILL_NAMES` declared at line | Purpose |
|---|---|---|---|
| 1 | `DIST-01, DIST-02` (real install to temp dir) | 100-107 | Asserts every `bs-<name>/SKILL.md` + shared tree exists |
| 2 | `bs- skill handoff contract` (no Skill-tool self-dispatch) | 242-249 | Asserts no skill sets `disable-model-invocation`, no skill self-dispatches via Skill tool |
| 3 | `clean reinstall removes orphans` (WR-01) | 306-313 | Asserts `--force` reinstall produces an orphan-free tree identical to fresh install |
| 4 | `empty shared dir is detected as partial` (WR-03a) | 444-451, again at 495-502 (two blocks share the pattern; 495 is the actual 4th distinct array, 444 was already counted — confirm exact count during planning by re-grep) | Asserts a non-force install completes a partially-populated shared tree |

Exact literal shape at every site (identical across all four/five occurrences):
```typescript
const SKILL_NAMES = [
  'bs-create-game',
  'bs-ingest-rules',
  'bs-build-chunk',
  'bs-check-status',
  'bs-insert-chunk',
  'bs-generate-ai',
];
```
Each needs `'bs-verify-game'` appended. **A plan that updates only the first occurrence will leave
the other three (or four) `describe` blocks silently asserting only the old six-skill set** — this
is RESEARCH.md Pitfall 2's explicit warning, confirmed here against real line numbers.

---

### `src/cli/slash-command/bs/verify-game.md` (NEW — skill entry point)

**Analog:** `src/cli/slash-command/bs/ingest-rules.md` — the entry-point shape to mirror.

**Frontmatter** (`ingest-rules.md:1-4`):
```markdown
---
name: bs-ingest-rules
description: Ingest a board game rulebook (or run a structured interview if none exists) and produce the initial sketch/chunk plan for a new BoardSmith game. Use when starting a new game project from a rulebook or from scratch.
---
```

**Cite-don't-restate opening convention** (`ingest-rules.md:8-13`):
```markdown
Cite `state-machine.md` and `templates/*.template.md` rather than restating their rules — if
you are extending this skill, link to the relevant section instead of copying rule text. This
file is a lean router: it detects state, dispatches to the right reference file for each step's
heavyweight prose, and synthesizes the durable artifacts from what subagents return. It does not
explain the status enum, the consistency check, the session lock, or template structure inline —
see `${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md` for all of that.
```

**Invocation block** (`ingest-rules.md:18-22`):
```markdown
## Invocation

\`\`\`
/bs-ingest-rules [path-to-rulebook]
\`\`\`
```

**Context-Economics Hard Rule restatement pattern** (`ingest-rules.md:36-42`) — `verify-game.md`
needs its own restatement at the point temptation is strongest (per decision 14's rationale,
mirroring why `transcription.md` restates it too):
```markdown
## Context-Economics Hard Rule

**The orchestrator never reads full rulebook slices.** ...
```

Numbered `## Step N: <Name> (REQ-ID)` heading convention throughout (`ingest-rules.md:44, 88, 101,
119, 209, 220, 234, 243`) — each step ID-tagged to a requirement, exactly as `verify-game.md`
should tag its steps to VERIFY-01/02/07/08. Footer convention: `## Reference Files`
(`ingest-rules.md:273`) — lists what the file cites without restating.

---

### `src/cli/slash-command/bs/verify/*.md` (NEW sub-steps)

**Analog 1 — fan-out dispatch shape** (`ingest/transcription.md`, full file, 191 lines) — the
verify orchestrator's re-transcription dispatch is this file's direct sibling. Key extracted
blocks:

Context-Economics Hard Rule, restated at point of temptation (`transcription.md:9-18`):
```markdown
## Context-Economics Hard Rule (restated here — this is where the temptation is strongest)

**The orchestrator never reads the full rulebook, and it never re-reads a slice file after a
subagent writes it.** ...
```

The `BS-DISPATCH-V2` pointer block — copy this shape, filling `Write slices to:` with the STAGING
path instead of `rulebook/` (`transcription.md:64-73`):
```
BS-DISPATCH-V2

Read `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md` in full and follow it
exactly.

Your page range: {N}-{M}
Rulebook path:   {rulebookPath}
Write slices to: rulebook/
```
Per decision 15, ONLY this last line's value changes for the verify dispatch
(`rulebook/.verify/<run-id>/slices/` instead of `rulebook/`) — the pointer, the token, and the
"do not compose/restate/summarize" instruction below it are copied byte-identical
(`transcription.md:59-61, 75-81`):
```markdown
**Do not compose, restate, or summarize the transcription contract in the dispatch prompt.** The
contract lives in `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md`; the
subagent reads it directly. Each dispatch prompt is short, and carries only the three
substitutions the subagent cannot know on its own:
...
**The `BS-DISPATCH-V2` token is required and the subagent validates it.** A dispatch without it is
rejected unread. ...
```

Orchestrator-records-never-writes-slices pattern (`transcription.md:156-159`, the VERIFY-07
enforcement shape decision 14 points at):
```markdown
## Orchestrator Records (never writes slices, never re-reads them)

The subagents write every `rulebook/NN-topic.md`; the orchestrator only accumulates the
summary fields.
```
For verify, "accumulates the summary fields" becomes "records the completed step via
`boardsmith verify-run <subcommand>`" — same shape, CLI-backed per decision 11.

**Analog 2 — `state-machine.md` sections to CITE, not restate** (already extracted above under
"Cold-Resume Parse Contract" / "Consistency Check" / "Session Lock" / "Git Protocol" /
"Autonomy Scope"). The Session Lock line grammar to reuse verbatim, verify-shaped
(`state-machine.md:133-134`, `SKETCH.template.md:15`):
```
Session Lock: <!-- none | "<slug> @ <session-id> — locked at <ISO timestamp>" -->
```
Per RESEARCH.md Pitfall 4: fill `<slug>` with a verify-shaped identity (`verify @ <run-id>` or
`verify:<run-id>`) — nothing in `state-machine.md`/`SKETCH.template.md` machine-parses this
position (confirmed: zero `.ts` hits for "Session Lock"), so any distinguishable human-legible
value satisfies the existing staleness/false-alarm design without touching either file.

**Analog 3 — timestamp discipline for `run-id`** (`state-machine.md:130-132`):
```markdown
- The timestamp is **always** produced by running `date -u +%Y-%m-%dT%H:%M:%SZ` at the moment the
  lock is taken or refreshed. It is never fabricated, estimated, or typed from memory — this is
  the only sanctioned source for the lock's ISO timestamp.
```
Reuse this exact discipline (and exact shell invocation) for `run-id` generation — CONTEXT.md
Specifics section makes this explicit; do not let the session compute or estimate its own
timestamp for the run-id.

---

### `src/cli/slash-command/bs/ingest/transcription-subagent.md` (MODIFY — generalize output dir)

**This is a surgical, non-forking edit to the SAME file** (per decision 15). Exact sites to touch,
confirmed by direct read (199-line file, full content already in context):

1. "Your inputs" (line 58) — ALREADY generic in spirit but still names the literal value:
```markdown
- **Output directory** `rulebook/` — relative to the project directory you are already inside.
```
→ becomes something like "Output directory `{outputDir}` — the path given to you above, relative
to the project directory you are already inside" (exact wording is plan/execution discretion).

2. Section 1 heading + prose (line 65) hardcodes the literal path:
```markdown
## 1. WRITE the transcribed text to `rulebook/NN-topic.md`
```
→ needs to say "your assigned output directory" instead of the literal word `rulebook/`.

3. The worked example (line 68, inside "Page-anchored numbering is self-allocating..."):
```markdown
`NN` is the section's **starting page number**, zero-padded to two digits (a section starting on
p.14 → `rulebook/14-movement.md`).
```

4. Return-field description (line 151):
```markdown
- **(a) `slicePath`** — the `rulebook/NN-topic.md` file you wrote.
```

**Explicitly do NOT touch** (per RESEARCH.md Pitfall 3's warning) — these are cross-references to
the SIBLING contract file, unrelated to the slice output location:
- Line 32-ish: `${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription.md` cross-reference.
- The `Visual (p.N):` / `Derived (p.N):` / `QUOTE` line-kind vocabulary, the decision test, the
  `BS-DISPATCH-V2` validation handshake (lines 18-49), the structured-return field list
  (`{ slicePath, sectionSummary, citedTerms[], componentMentions[], visualEvidence[], variants[],
  openGaps[], nextStep }`, line 183-184), and `nextStep`'s exact string (line 175) — none of these
  reference `rulebook/` as a literal and all are pinned by `ingest.test.ts` (see below).

**Confirmed safe against existing tests:** grepped `ingest.test.ts` for `Write slices to`,
`rulebook/NN-topic`, and `Output directory` — **zero hits**. No existing test pins the literal
`rulebook/` wording in the write-instruction lines targeted for generalization. The tests that DO
pin `transcription-subagent.md` content (see next section) all assert PRESENCE of vocabulary/
markers (`Visual (p.`, `Derived (p.`, `openGaps[]`, `BS-DISPATCH-V2`, `nextStep`, the return-shape
field list, the "legality, scoring, or sequencing" decision test, "Do not accept a paraphrase...")
— none of these are touched by the output-directory generalization.

## Shared Patterns

### Fenced machine-owned region
**Source:** `src/cli/commands/ingest-archive.ts:97-98, 248-268` (`GAPS_BEGIN`/`GAPS_END`); sibling
in `src/cli/commands/chunk-provenance.ts:225-226, 330` (`VERIFIED_AGAINST_BEGIN`/`END`).
**Apply to:** `verify-run.ts`'s RUN.md ledger (decision 9). New, distinct constant pair — never
reuse `GAPS_BEGIN`/`VERIFIED_AGAINST_BEGIN` for a third, unrelated section.

### Line-anchored heading location (`findHeadingIndex`/`extractSection`)
**Source:** `src/cli/commands/build-manifest.ts:65-91`, imported by `chunk-provenance.ts:8`.
**Apply to:** any new markdown parsing this phase adds (RUN.md heading lookup, any INDEX.md
provenance-block location the source-resolution skill text needs a command for). This defect class
has recurred twice (commit `f73153a3`, then again in `chunk-provenance.ts`'s own heading location)
— a third hand-rolled `indexOf('## ...')` in this phase is the single most avoidable regression.

### `--json` + human dual output
**Source:** `src/cli/cli.ts:176-199` (`chunk-provenance-status`, `trace-check`, `drift-check`
registrations).
**Apply to:** any new read-oriented `verify-run` subcommand (a resume-status reporter).

### `process.exitCode = 1`, never `throw`, from a Commander `.action()`
**Source:** `src/cli/commands/ingest-archive.ts:466-471` (`ingestCheckCommand`).
**Apply to:** any new verify CLI command that can fail from a live skill-text invocation.
`program.parseAsync()` + top-level `try/catch` in `cli.ts` (Phase 171) already covers genuinely
unrecoverable errors for every command registered after it — new commands inherit this for free,
they do not need their own catch.

### Non-recursive, `.md`-filtered `readdir`
**Source:** `src/cli/commands/ingest-archive.ts:226, 354`, `src/cli/commands/chunk-provenance.ts:378`.
**Apply to:** enumerating `rulebook/` while structurally excluding `rulebook/.verify/<run-id>/`
(decision 5's dot-prefix) — no new exclusion rule needed, the existing convention already excludes
it.

### Cold-Resume Parse Contract ("ambiguous ⇒ stop and ask")
**Source:** `src/cli/slash-command/bs/state-machine.md:75-85`.
**Apply to:** decision 1's "multiple candidate sources at root" gate, decision 1b's wrap-safe
`Source:` detection, and any other place this phase's skill text or CLI encounters ambiguous
on-disk state. Quote verbatim: *"If a state file does not parse against its template — required
headings missing, malformed, or a `Status:` line that doesn't match a recognized enum value — the
session STOPS and asks the user. It never guesses the intended state."*

### Session Lock line grammar
**Source:** `src/cli/slash-command/bs/state-machine.md:125-149`,
`src/cli/slash-command/bs/templates/SKETCH.template.md:15-20`.
**Apply to:** `bs/verify/*.md`'s session-lock acquire/check/release, verify-shaped identity
(decision 12). Grammar: `"<slug> @ <session-id> — locked at <ISO timestamp>"`; timestamp always
via `date -u +%Y-%m-%dT%H:%M:%SZ`; staleness = >24h old; release sets the line to exactly `none`.

## No Analog Found

None. Every file this phase touches has a strong, line-cited analog in the existing codebase —
this phase is explicitly scoped (per CONTEXT.md decision 16 and the phase boundary) to reuse
proven mechanisms rather than invent new ones.

## How skill-text `.md` files are tested today (relevant because this phase's deliverable is
substantially skill text)

Four test files exist: `src/cli/slash-command/bs/ingest.test.ts` (857 lines),
`build-chunk.test.ts` (1564 lines), `templates.test.ts` (552 lines), `status-tools.test.ts` (450
lines). **All of them are STRING-CONTENT assertions against the raw `.md` file text** —
`expect(fileText).toContain('...')` / `.toMatch(/regex/)` / occasional structural slicing
(`text.indexOf('## Step 3:')` to isolate one step's prose before asserting on it). None of them
execute a skill, dispatch an agent, or simulate a session. Representative examples pulled from
`ingest.test.ts`:
```typescript
// Presence of an instruction (does not prove it is FOLLOWED):
expect(ingestRules).toContain('ingest/transcription.md');
expect(transcription).toMatch(/per[- ]section/i);

// Absence of a forbidden pattern (regression guard against re-inlining a contract):
expect(transcription).not.toContain('- QUOTE lines:');
expect(transcription).not.toContain('Return exactly:');

// A field-name enumeration checked against a shared const array (WR-07 pinning):
for (const field of RETURN_SHAPE_FIELDS) {
  expect(contract, `transcription-subagent.md must define "${field}"`).toContain(field);
}
```
`ingest.test.ts:352-356` states this limitation explicitly, in the file's own comment:
> "these assertions prove the instruction EXISTS in skill text; they do not prove an agent
> RECEIVES or FOLLOWS it. On 2026-07-27 every one of the blocks below ... was green while the real
> INGEST-01/03/04 run diverged on every specified string. The acceptance bar is
> `npm run harness:ingest`, not this file."

**Consequence for this phase's planner:** `npx vitest run` on any new `verify.test.ts` proves
prose EXISTS, never that a live session follows it. VERIFY-01 (skill runs against a real project),
VERIFY-07 (orchestrator never reads a slice — an absence), and VERIFY-08's kill-and-resume are all
explicitly called out in RESEARCH.md as requiring a REAL live-session/harness proof, not a unit
test of the `.md` prose. Plan accordingly — a plan that ships only `.toContain()`-style skill-text
tests for these three has NOT closed them, by this codebase's own stated precedent.

## Whether any existing test pins `transcription-subagent.md`'s content in a way generalization
would break

**No.** Grepped `ingest.test.ts` (the only file referencing `transcription-subagent.md`, 21 hits)
for the three literal strings the generalization touches — `Write slices to`, `rulebook/NN-topic`,
`Output directory` — **zero matches**. Every existing assertion against this file targets content
UNRELATED to the output-directory literal: `Visual (p.`, `Derived (p.`, `legality, scoring, or
sequencing`, `rulebook/00-visual-survey.md` (this one IS a literal `rulebook/` reference, but it
names the FIXED orchestrator-owned visual-survey file, not the subagent's per-call output
directory — decision 15/Pitfall 3 both note this file is out of scope for the parameterization),
`BS-DISPATCH-V2`, `DISPATCH REJECTED`, `openGaps[]`, `nextStep`, the full return-shape field list,
`Do not accept a paraphrase of this file in place of the file`. The four-point minimal edit
(Section 1 heading/prose, worked example, return-field description, "Your inputs" line) is safe
against every currently-green assertion.

## Metadata

**Analog search scope:** `src/cli/commands/`, `src/cli/slash-command/bs/` (including `ingest/`,
`build/`, `templates/`), `src/cli/cli.ts`.
**Files scanned (full or targeted read):** `ingest-archive.ts` (full, 587 lines),
`install-claude-command.ts` (full, 287 lines), `install-claude-command.test.ts` (targeted, 4
SKILL_NAMES sites + surrounding describe blocks), `chunk-provenance.ts` (targeted, ~270 lines
across 3 reads), `build-manifest.ts` (targeted, 100 lines), `cli.ts` (targeted, 70 lines),
`ingest/transcription.md` (full, 191 lines), `ingest/transcription-subagent.md` (full, 199 lines),
`ingest-rules.md` (targeted, 45 of 302 lines — entry-point shape), `state-machine.md` (targeted,
170 of 331 lines), `SKETCH.template.md` (targeted, Session Lock block), `ingest.test.ts` (targeted,
~250 of 857 lines across 3 reads, all `transcription-subagent.md`-referencing blocks).
**Pattern extraction date:** 2026-07-28.
