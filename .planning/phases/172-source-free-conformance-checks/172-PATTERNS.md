# Phase 172: Source-Free Conformance Checks - Pattern Map

**Mapped:** 2026-07-28
**Files analyzed:** 5 (2 commands + 2 test files + 1 shared parser module) + 1 modified (`cli.ts`)
**Analogs found:** 5 / 5

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/cli/commands/trace-check.ts` | command (CLI, read-only aggregator) | batch/transform (parse→resolve→set-diff) | `src/cli/commands/chunk-provenance.ts` (`chunkProvenanceStatusCommand`) | exact — same shape: enumerate `chunks/*/CHUNK.md`, parse a fenced/labelled section, aggregate, emit `--json`/human report, always exit 0 |
| `src/cli/commands/drift-check.ts` | command (CLI, read-only aggregator + subprocess) | batch/transform + external process (git) | `src/cli/commands/chunk-provenance.ts` (`chunkProvenanceStatusCommand`) for shape; **no existing command shells to git** — `src/cli/commands/init.ts` (git init/add/commit via `execSync`) and `src/cli/lib/ingest-hook.test.ts` (`execSync('git init', {cwd,...})` test fixture) are the only git-invocation precedents in the repo | role-match (aggregator shape) + partial (git plumbing has no command precedent, only a scaffolding one) |
| `src/cli/commands/trace-check.test.ts` | test (colocated vitest) | — | `src/cli/commands/chunk-provenance.test.ts` | exact — same `mkdtemp`/`makeProject`-style fixture-building convention |
| `src/cli/commands/drift-check.test.ts` | test (colocated vitest, needs a REAL git repo) | — | `src/cli/lib/ingest-hook.test.ts` (`gitProject()` helper) for the git-fixture half; `chunk-provenance.test.ts` for the parsing-fixture half | role-match — no single existing file does both; compose the two patterns |
| shared manifest/claim/ruling parser module (recommend `src/cli/commands/build-manifest.ts`, per RESEARCH's "Recommended Project Structure") | utility (pure parse functions, no CLI action) | transform | `src/cli/commands/chunk-provenance.ts` (`resolveCitedSlices`, `parseVerifiedAgainst`, section-locating helpers) — pure exported functions living in a command file, not a separate `lib/` module | role-match |
| `src/cli/cli.ts` (modified) | route/config (commander registration) | request-response (CLI invocation) | itself, lines 165–180 (`chunk-check`/`chunk-provenance-status` registration block) | exact |

## Pattern Assignments

### `src/cli/commands/trace-check.ts` (command, batch/transform)

**Analog:** `src/cli/commands/chunk-provenance.ts`, specifically `chunkProvenanceStatusCommand` (lines 706–864) as the read-only-aggregator shape, and the section-locating/body-extraction helpers (lines 217–332, 394–401) as the parsing discipline to copy into the new shared parser.

**Imports pattern** (`chunk-provenance.ts:1-7`):
```typescript
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import chalk from 'chalk';
import { normalizeEdition } from './ingest-archive.js';
import { readBoardsmithVersion } from '../lib/boardsmith-version.js';
import { hashSkillsTree } from '../lib/skills-tree-hash.js';
```
`trace-check.ts` needs no crypto/version/skills-tree imports — its analogous import block is just `node:fs`, `node:path`, `chalk`, plus the new shared parser module (`./build-manifest.js`).

**Project-root resolution** (`chunk-provenance.ts:709`, `chunk-provenance.ts:358`) — **the `--project <dir>` override already exists and is the established convention; do not invent a new flag**:
```typescript
const projectDir = resolve(options.project ?? process.cwd());
```
This is exactly what the proof harness in RESEARCH.md invokes (`--project <copy-dir> --json`). Copy verbatim.

**Enumerating chunks** (`chunk-provenance.ts:706-725`):
```typescript
export async function chunkProvenanceStatusCommand(
  options: { project?: string; json?: boolean } = {},
): Promise<ChunkProvenanceStatusResult> {
  const projectDir = resolve(options.project ?? process.cwd());
  const chunksDir = join(projectDir, 'chunks');

  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(chunksDir, { withFileTypes: true });
  } catch {
    throw new Error(
      `No chunks/ directory in ${projectDir}.\n` +
        `This command looks for chunks/<slug>/CHUNK.md files — run it from a BoardSmith game\n` +
        `project directory, or pass --project <dir>.`,
    );
  }
  const slugs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
```
Copy this loop shape for `trace-check`'s chunk enumeration — the "no chunks/ dir" error message pattern (actionable, names the exact flag to fix it) is the house style for a tool-failure (locked decision 6's non-zero-exit class), distinct from a finding.

**Line-anchored section location — THE pattern to copy verbatim, not re-derive** (`chunk-provenance.ts:387-395`):
```typescript
// The heading position in the file AS READ, before this run writes anything. Computed once and
// reused both for scanning citations and for locating where to write below.
//
// Anchored to a LINE, not to the first substring occurrence. `indexOf(VERIFIED_AGAINST_HEADING)`
// also matched prose, and CHUNK.template.md:18 legitimately names "## Verified Against" inside
// its required-headings comment — 130 lines above the real section. That made `citableText`
// truncate at line 18, before `## Interpretation`, so EVERY citation was silently dropped and
// every chunk scaffolded from the template recorded provenance citing nothing. Silent
// under-recording is the exact defect class this phase exists to prevent, so the heading is
// located structurally rather than by substring.
const headingMatch = /^## Verified Against[ \t]*$/m.exec(chunkText);
const headingIdx = headingMatch ? headingMatch.index : -1;
```
Apply the same `^## Heading[ \t]*$` + `.exec(...).index` pattern (never `indexOf(headingText)`) for every heading `trace-check`/`drift-check` read: `## Interpretation`, `## Build Manifest`, `## Verified Commit Hash`, and (in `RULINGS.md`) `### Ruling N`. RESEARCH.md's Pattern 1/2 examples are this exact idiom applied to the new headings — use them as written.

**Section-scoped body extraction (bounded to the NEXT `## ` heading, not any `#+`)** — RESEARCH.md's Pattern 2 example, itself built on the same `chunk-provenance.ts` discipline:
```typescript
const bodyMatch = new RegExp(
  `^## Interpretation\\n([\\s\\S]*?)(?=\\n## |$)`, 'm'
).exec(chunkText);
```

**Aggregation-loop + counts-first summary pattern** (`chunk-provenance.ts:734-772, 799-807`):
```typescript
for (const slug of slugs) {
  let chunkText: string;
  try {
    chunkText = await fs.readFile(join(chunksDir, slug, 'CHUNK.md'), 'utf-8');
  } catch {
    continue; // a chunks/<slug> dir with no CHUNK.md is not this command's problem to report
  }
  // ... parse, classify, push into an array of records ...
}
// ...
for (const c of chunks) {
  console.log(`${c.slug} — ${c.status} — ${label}${reasonSuffix}`);
}
console.log('');
console.log(
  `full: ${counts.full}  code-conformance-only: ${counts.codeConformanceOnly}  unknown: ${counts.unknown}`,
);
```
For `trace-check`, this becomes: a per-finding-kind COUNT-FIRST summary line before any per-finding detail — RESEARCH.md's Open Question 2 explicitly recommends copying this exact "counts, then examples" convention to avoid burying real signal in the predicted high finding-volume (dozens–hundreds of `ambiguous-claim-ref`/`claim-untested`).

**`--json` emission — the exact, only convention in this codebase**:
```typescript
if (options.json) {
  console.log(JSON.stringify(result, null, 2));
  return result;
}
```
`--json` goes to **stdout via `console.log`**, unconditionally, as the LAST thing computed (after all counts/aggregation, before any human-readable branch). There is no shared `emitJson()` helper anywhere in `src/cli/commands/` — every command (`chunk-provenance.ts:465,795`, and `ingest-archive.ts` — see below) inlines this same two-line `if (options.json) { console.log(JSON.stringify(...)); ... }` block. Human-readable output, when `--json` is NOT passed, mostly also goes to **stdout via `console.log`** (`chunkProvenanceStatusCommand`'s report body) — **`console.error` is reserved for warnings/errors surfaced ALONGSIDE a `--json` result** (e.g. `chunkCheckCommand`'s repair-notice branch at lines 496-502 uses `console.error` because it fires even when `options.json` is NOT set, as a stderr-routed "this mutated something, re-read it" alert — but `trace-check`/`drift-check` mutate nothing, so this stderr branch has no analogue here; both commands should route ALL non-JSON human output to stdout via `console.log`, matching `chunkProvenanceStatusCommand`, not `chunkCheckCommand`).

**Read-only guarantee, stated as a doc comment directly above the function** (`chunk-provenance.ts:701-704`):
```typescript
/**
 * READ-ONLY. This is not incidental: it backs `check-status.md`, whose documented posture is
 * "This skill performs no writes of any kind." No `fs.writeFile` (or any other mutating fs call)
 * appears anywhere in this function's body — the read-only property is pinned directly by a
 * before/after whole-project byte-hash test (T-171-19).
 */
```
Both `trace-check.ts` and `drift-check.ts` should carry an identical doc-comment declaration, and both `.test.ts` files should include the SAME class of before/after whole-project byte-hash test this comment references (see Shared Patterns below) — this is the direct precedent for CONTEXT.md's own PROC-01-style proof requirement.

---

### `src/cli/commands/drift-check.ts` (command, batch/transform + subprocess)

**Analog for command shape:** same as `trace-check.ts` above (`chunkProvenanceStatusCommand`).

**Analog for git plumbing: NONE exists as a command precedent.** This is confirmed directly: `chunk-provenance.ts` never shells out to git (`grep` for `execFile`/`spawnSync`/`exec(` inside `src/cli/commands/*.ts` other than `init.ts` returns nothing). `init.ts` is a **scaffolding** git user (`git init`/`git add`/`git commit`), not a **querying** git user — its pattern (`execSync`, not `execFile`) is NOT the one to copy; RESEARCH.md's own recommendation (`execFile('git', [...], { cwd })`, never `exec`/`execSync` with a shell string, to avoid injection via a hand-editable hash value) should be followed instead. Concretely:
```typescript
// Source: 172-RESEARCH.md "Code Examples" — this repo's own new parsing surface, no in-repo
// command precedent exists yet; this phase SETS the convention.
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
**Critical discipline (Pitfall 3 from RESEARCH.md):** `cwd: projectDir` MUST be the resolved GAME project directory (the same `resolve(options.project ?? process.cwd())` value used everywhere else in this phase), never BoardSmith's own repo — this is the first command in the codebase to shell out to git at all, so there is no existing `cwd`-discipline bug to avoid repeating, but also no existing safety net to lean on.

**Verified Commit Hash extraction** — RESEARCH.md's own worked example, directly reusable:
```typescript
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
Note this already applies the line-anchored heading pattern (Pattern 1 above) — do not simplify it back to `indexOf`.

**`--json`/error/exit-code conventions:** identical to `trace-check.ts` above — copy from `chunkProvenanceStatusCommand`, not from `chunkCheckCommand` (drift-check never writes, so it never needs the repair-notice `console.error` branch or the "changed" boolean).

---

### `src/cli/commands/trace-check.test.ts` and `drift-check.test.ts` (test, colocated vitest)

**Analog:** `src/cli/commands/chunk-provenance.test.ts` for the pure-fixture half (both files); `src/cli/lib/ingest-hook.test.ts` for the real-git-repo half (`drift-check.test.ts` only).

**`mkdtemp`/`afterEach` cleanup scaffold — copy verbatim, both new test files** (`chunk-provenance.test.ts:1-40`):
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// ... import the functions under test ...

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-chunk-provenance-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
```
Rename the `mkdtemp` prefix per command (`bs-trace-check-`, `bs-drift-check-`).

**Fixture-builder helper convention** (`chunk-provenance.test.ts:49-58`, abbreviated):
```typescript
async function makeProject(
  shape: 'no-rulebook-project' | 'index-missing' | /* ... */ | 'full',
): Promise<string> {
  const project = join(dir, `game-${shape}`);
  await fs.mkdir(project, { recursive: true });
  if (shape === 'no-rulebook-project') return project;
  // ... build up the shape incrementally, returning early at each shape boundary ...
}
```
`trace-check.test.ts` should build a single `makeChunk(project, slug, { interpretation, buildManifest })`-style helper (mirroring `chunk-provenance.test.ts:395`'s `makeChunk(project, slug, interpretation)`) that writes a real `CHUNK.md` on disk with the real heading shapes, rather than hand-stringing partial fixtures per test — this is the established convention, and RESEARCH.md's own measured pitfalls (non-contiguous claim numbering, `### Corrections from Redteam Round N` continuations, comma-joined manifest rows) are exactly the shapes this helper needs to be able to produce.

**No existing test in this repo constructs a real temp GIT repo inside `src/cli/commands/`** — `chunk-provenance.test.ts` never does (it is pure `node:fs` fixtures, no git). **Two files DO build real temp git repos, and this is the pattern `drift-check.test.ts` must copy:**

`src/cli/lib/ingest-hook.test.ts:27-32` (the `gitProject()` helper — smallest, most direct precedent):
```typescript
async function gitProject(): Promise<string> {
  const p = join(dir, 'proj');
  await fs.mkdir(p, { recursive: true });
  execSync('git init', { cwd: p, stdio: 'ignore' });
  return p;
}
```
`src/cli/lib/ingest-hook.test.ts:71-79` (commit-with-explicit-identity pattern, needed because CI/sandbox environments have no configured git user):
```typescript
execSync('git add -A', { cwd: p, stdio: 'ignore' });
execSync('git -c user.email=t@t -c user.name=t commit -m scaffold', {
  cwd: p,
  stdio: 'ignore',
});
```
`drift-check.test.ts` needs to extend this by TWO commits (a "verified" commit whose hash goes into the fixture `CHUNK.md`'s `## Verified Commit Hash`, then one or more later commits that touch/delete a manifest-listed file) and then assert `diffedFilesSince()`/the command's drift finding against real `git diff --name-only <hash1> <hash2>` output — this is exactly Pitfall 3's own warning ("a test that passes without ever creating a `.git` directory in its fixture is not actually exercising the git-diff code path").

`src/cli/commands/init.test.ts` is the other real-git-repo precedent in this repo but is scaffolding-focused (asserts `git init` itself ran, not querying prior history) — secondary reference only, not the shape to copy for drift-check's tests.

---

### Shared Build Manifest / CHUNK.md parsing module

**Analog:** `src/cli/commands/chunk-provenance.ts`'s own internal structure — pure exported functions living directly in a `commands/` file (`resolveCitedSlices`, `parseVerifiedAgainst`, the section-locating regexes), NOT split into a separate `src/cli/lib/` module, even though they are reused by two different exported command functions (`chunkCheckCommand` and `chunkProvenanceStatusCommand`) within that same file.

**`src/cli/lib/` vs. inline-in-`commands/` convention — reported findings from both directories:**
- `src/cli/lib/` holds infrastructure that is either (a) cross-cutting across MANY unrelated commands (`boardsmith-version.ts`, `config.ts`, `zip.ts`, `asset-scan.ts`, `bundle-limits.ts`), or (b) genuinely operates outside the `commands/` request/response shape (`ingest-hook.ts` installs a git hook script; `project-scaffold.ts` writes a whole new project tree; `publish-api.ts` is an HTTP client).
- `src/cli/commands/` holds one-command-per-file logic PLUS whatever pure helper functions only that command (or a small, tightly related family of commands in the SAME file) needs — `chunk-provenance.ts` is the direct precedent: `resolveCitedSlices`/`parseVerifiedAgainst`/`computeVerificationScope` are all pure, exported, and unit-tested directly, but they live in `commands/chunk-provenance.ts`, not `lib/`.
- **Recommendation, following this convention exactly:** the shared manifest/claim/ruling parser belongs in `src/cli/commands/build-manifest.ts` (RESEARCH.md's own suggested filename) — a `commands/`-directory module with NO commander `.action()` export of its own, imported by BOTH `trace-check.ts` and `drift-check.ts`. This mirrors `chunk-provenance.ts` importing `normalizeEdition` from `./ingest-archive.js` (`chunk-provenance.ts:5`) — a cross-file-but-same-directory import between two command modules is already the established pattern, not a new one.

**Manifest row / path-token extraction** — RESEARCH.md Pattern 4, this module's core function:
```typescript
// One row can yield MULTIPLE files — real data, discard-phase-and-reclaim/CHUNK.md
const PATH_TOKEN = /[A-Za-z0-9_./-]+\.[A-Za-z0-9]+/g;
for (const row of manifestRows) {
  const firstCell = row.split('|')[1] ?? '';
  const paths = [...firstCell.matchAll(PATH_TOKEN)].map(m => m[0]);
  if (paths.length === 0) { /* manifest-file-missing candidate */ }
}
```

---

### `src/cli/cli.ts` (modified — two new `.command()` registrations)

**Analog:** the file's own existing `chunk-check`/`chunk-provenance-status` block, `cli.ts:165-180`:
```typescript
// Provenance: record or repair a chunk's `## Verified Against` block. Same mechanical-work-
// belongs-in-code rationale as the ingest-* family above (171-CONTEXT.md).
program
  .command('chunk-check <slug>')
  .description("Record or repair a chunk's Verified Against provenance block, and exit non-zero if it was stale")
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(chunkCheckCommand);

program
  .command('chunk-provenance-status')
  .description('Report per-chunk verification provenance and drift (read-only)')
  .option('--project <dir>', 'Project directory (defaults to cwd)')
  .option('--json', 'Emit JSON instead of human-readable output')
  .action(chunkProvenanceStatusCommand);
```
`trace-check`/`drift-check` register identically — no positional `<slug>` argument (both operate over the whole project, matching `chunk-provenance-status`'s zero-argument shape, not `chunk-check <slug>`'s), same two options (`--project <dir>`, `--json`), same description-line convention (imperative, states read-only-ness explicitly — "report ... (read-only)" is the exact phrase to reuse, since these two commands share that property per locked decision 5).

**Import line to add** (mirrors `cli.ts:20`):
```typescript
import { chunkCheckCommand, chunkProvenanceStatusCommand } from './commands/chunk-provenance.js';
// add:
import { traceCheckCommand } from './commands/trace-check.js';
import { driftCheckCommand } from './commands/drift-check.js';
```

**Top-level error handling — already covers both new commands with zero changes needed** (`cli.ts:195-207`):
```typescript
// `program.parse()` does not await async action handlers — a rejection from one (any command
// that throws, e.g. an unreadable rulebook path or a missing chunk slug) would otherwise surface
// as a raw Node unhandled-rejection stack trace, leaking internal file paths and line numbers.
// ...
try {
  await program.parseAsync();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
```
This is the ONE place `process.exitCode = 1` fires for a THROWN error (tool failure, per locked decision 6 — unparseable project, missing `INDEX.md`, not a git repo). `trace-check.ts`/`drift-check.ts` should `throw new Error(...)` with an actionable message for tool-failure conditions (mirroring `chunkProvenanceStatusCommand`'s `No chunks/ directory in ${projectDir}...` message at `chunk-provenance.ts:716-720`) and let this top-level catch set the exit code — they should NEVER set `process.exitCode = 1` themselves for a FINDING (that would violate locked decision 6, "findings exit 0"). Contrast with `chunkCheckCommand`, which DOES set `process.exitCode = 1` itself (`chunk-provenance.ts:509`) because it repairs a machine-owned region and needs the non-zero exit to force a re-read — that idiom does NOT apply to either new command, since neither writes anything.

---

## Shared Patterns

### `--project <dir>` resolution (already exists — no new flag needed)
**Source:** `src/cli/commands/chunk-provenance.ts:709` / `:358`, registered in `cli.ts:170,177`
**Apply to:** both `trace-check.ts` and `drift-check.ts`
```typescript
const projectDir = resolve(options.project ?? process.cwd());
```
Confirms RESEARCH.md's own question directly: an explicit `--project` override already exists across every `ingest-*`/`chunk-*` command and is exactly what the proof harness's `--project <copy-dir> --json` invocation expects — nothing new to design here.

### `--json` output convention
**Source:** `chunk-provenance.ts:464-465`, `:794-797`; also present identically in `ingest-archive.ts` (same two-line `if (options.json) { console.log(JSON.stringify(result, null, 2)); }` shape — no shared helper exists anywhere in the codebase)
**Apply to:** both new commands
```typescript
if (options.json) {
  console.log(JSON.stringify(result, null, 2));
  return result;
}
```
`--json` → stdout, always. Non-JSON human report → also stdout (`console.log`) for a pure aggregator like `chunkProvenanceStatusCommand`; `console.error` is reserved for a mutation-notice that fires alongside a non-JSON run (not applicable to either new command, since neither mutates).

### Enumerated finding/reason codes, never free text
**Source:** `chunk-provenance.ts:48-54` (`SCOPE_REASONS`), `ingest-archive.ts:37-38` (`INDEX_HEADINGS`/`HEADER_LABELS`)
**Apply to:** the new `FINDING_KINDS` constant (already locked in `172-CONTEXT.md` decision 7: `claim-untested`, `ruling-untested`, `test-unlinked`, `unassociated-test`, `ambiguous-claim-ref`, `unresolved-claim-ref`, `manifest-file-missing`, `chunk-code-drifted`, `drift-unknown`)
```typescript
export const SCOPE_REASONS = Object.freeze([
  'source-missing',
  'source-hash-mismatch',
  'index-missing',
  'no-rulebook-project',
  'pre-provenance-project',
] as const);
export type ScopeReason = (typeof SCOPE_REASONS)[number];
```
Define `FINDING_KINDS` the identical way: `Object.freeze([...] as const)` + a derived `type FindingKind = (typeof FINDING_KINDS)[number]`, and every finding record's `kind` field typed against it — never a bare string union typed by hand in two places.

### Cross-boundary shared-constant pinning (only if the finding-kind enum ever crosses the `src/`↔`scripts/` boundary)
**Source:** `src/cli/commands/ingest-archive.ts:285-326` (`PRESENTATION_LEXICON` declaration) + `src/cli/slash-command/bs/ingest.test.ts:402-441` (the pinning test) + `scripts/ingest-harness/check.mjs:77` (the second copy)

The declaration, with its "why two copies" doc comment (`ingest-archive.ts:285-294`):
```typescript
/**
 * Presentation-only vocabulary: terms describing how a page LOOKS, which cannot carry a
 * statement about legality, scoring, or sequencing.
 *
 * MUST stay in sync with PRESENTATION_LEXICON in scripts/ingest-harness/check.mjs — a test pins
 * the two together. ...
 */
export const PRESENTATION_LEXICON = Object.freeze([
  'sans-serif', 'serif', /* ... */
]);
```
The pinning test (`ingest.test.ts:402-437`, abbreviated — note it ALSO had to fix its own `indexOf` substring bug, `f73153a3`'s exact defect class recurring in a second place):
```typescript
it('the presentation lexicon is identical in the command and the checker', () => {
  // Two copies exist because scripts/*.mjs cannot import from src/*.ts without a build step.
  const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
  const checker = readFileSync(
    join(__dirname, '../../../../scripts/ingest-harness/check.mjs'),
    'utf-8',
  );
  const extract = (src: string) => {
    // Anchor on the DECLARATION, not the first mention of the name. `indexOf('PRESENTATION_LEXICON')`
    // matched prose too, so a doc comment mentioning the constant above its own declaration
    // silently redirected this extraction at the wrong bracket ...
    const decl = /(?:export\s+)?const\s+PRESENTATION_LEXICON\s*=\s*(?:Object\.freeze\(\s*)?\[/.exec(src);
    if (!decl) throw new Error('PRESENTATION_LEXICON declaration not found');
    const open = decl.index + decl[0].length - 1;
    const close = src.indexOf(']', open);
    return src.slice(open + 1, close).split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n').split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean).sort();
  };
  const fromCmd = extract(cmd);
  const fromChecker = extract(checker);
  expect(fromCmd.length).toBeGreaterThan(5);
  expect(fromCmd).toEqual(fromChecker);
});
```
**Applicability check for this phase, reported as requested:** RESEARCH.md and CONTEXT.md both confirm neither `trace-check` nor `drift-check` needs a second, `scripts/`-side copy of `FINDING_KINDS` — both checks are pure `src/cli/commands/` code with no `scripts/ingest-harness/`-style companion harness. **This pinning pattern is therefore not needed for this phase as currently scoped**, but is recorded here per the phase brief's explicit request, and — if any later phase (173+) adds a `scripts/`-side consumer of the finding-kind enum — this is the exact test shape to copy, including the anchor-on-declaration fix (do not repeat the substring-match mistake a THIRD time in this codebase).

### The `f73153a3` bug shape — canonical before/after, for the new parsers to not repeat
**Bug (pre-fix shape, reconstructed from the fix's own comment, `chunk-provenance.ts:387-393` and `parseVerifiedAgainst`'s surviving `indexOf` call at `chunk-provenance.ts:563`, which is a DIFFERENT, still-live use of `indexOf` — see caveat below):**
```typescript
// BEFORE (the bug): substring search over the WHOLE file matches a heading name that also
// appears in unrelated prose (CHUNK.template.md's own required-headings comment, ~130 lines
// above the real section) — silently truncates the scan and drops every citation.
const headingIdx = chunkText.indexOf(VERIFIED_AGAINST_HEADING);
```
**Fix (current, live code, `chunk-provenance.ts:394-395`):**
```typescript
// AFTER (the fix): anchored to a LINE — `^`/`$`/`m` flag — so a heading NAME appearing inside
// prose (not at the start of its own line) cannot match.
const headingMatch = /^## Verified Against[ \t]*$/m.exec(chunkText);
const headingIdx = headingMatch ? headingMatch.index : -1;
```
**Caveat worth flagging to the planner:** `parseVerifiedAgainst()` (`chunk-provenance.ts:562-563`) STILL uses `chunkText.indexOf(VERIFIED_AGAINST_HEADING)` directly — this is a DIFFERENT, read-only parsing path (not the write path `f73153a3` fixed) and appears NOT to have been fixed the same way. This is out of scope to fix in this phase (Phase 172 must not modify `chunk-provenance.ts`), but the new parsers in `build-manifest.ts`/`trace-check.ts`/`drift-check.ts` must use the LINE-ANCHORED form everywhere, matching `chunkCheckCommand`'s fixed version, not `parseVerifiedAgainst`'s unfixed one — do not copy `parseVerifiedAgainst` as a shape reference for heading location, only for its section-body-extraction and record-building structure downstream of the heading index.

## No Analog Found

| File/Concern | Role | Data Flow | Reason |
|---|---|---|---|
| Git-querying subprocess invocation as a CLI command's core mechanism | command | event-driven (external process) | This phase is confirmed (via grep across `src/cli/commands/`) to be the FIRST command that shells out to `git` to QUERY history (`init.ts` only ever WRITES via `git init`/`add`/`commit`, a scaffolding use, not a querying one). No in-repo command precedent to copy beyond RESEARCH.md's own worked `execFile` example — see `drift-check.ts`'s Pattern Assignment above for the closest available material (the `ingest-hook.test.ts`/`init.test.ts` TEST fixtures that build real repos, even though no PRODUCTION command reads history from one yet). |

## Metadata

**Analog search scope:** `src/cli/commands/*.ts`, `src/cli/commands/*.test.ts`, `src/cli/lib/*.ts`, `src/cli/cli.ts`, `src/cli/slash-command/bs/*.test.ts`, `scripts/ingest-harness/check.mjs` (grep-only, for the cross-boundary-pinning question)
**Files scanned:** `chunk-provenance.ts` (864 lines, read in full across 4 non-overlapping ranges), `chunk-provenance.test.ts` (981 lines, read first 100 lines + targeted greps), `ingest-archive.ts` (586 lines, read lines 280-360 + targeted greps), `ingest-hook.test.ts` (read lines 1-110), `init.ts`/`init.test.ts` (grepped only), `cli.ts` (207 lines, read in full), `ingest.test.ts` (read lines 390-440)
**Pattern extraction date:** 2026-07-28
