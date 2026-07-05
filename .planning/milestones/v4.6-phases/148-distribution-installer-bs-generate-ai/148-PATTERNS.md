# Phase 148: Distribution — Installer & `/bs-generate-ai` - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 8 (2 rewired production files, 1 new test file, 5 bs-entry-point content edits + delete/rename set)
**Analogs found:** 6 / 8 (2 have no direct analog — see "No Analog Found")

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `src/cli/commands/install-claude-command.ts` | CLI command / installer (file-copy) | file-I/O | itself (existing file, rewired in place) — structurally same role/shape as `src/cli/lib/project-scaffold.ts` (also a "generate/write files to a target dir" module) | role-match |
| `src/cli/commands/install-claude-command.test.ts` | test (integration, real-fs) | file-I/O | `src/cli/lib/project-scaffold.test.ts` (temp-dir compile-check pattern) + `src/cli/commands/validate.test.ts` (temp-dir `mkdtempSync`/`rmSync` bundle-size pattern) | exact (for the temp-dir harness), role-match (for install-specific assertions) |
| `src/cli/cli.ts` (command descriptions) | CLI entry / route registration | request-response (arg parsing) | itself — no rewrite pattern needed, just string edits at existing lines | exact |
| 5 `bs/*.md` entry-point skill files (reference-path edits) | config / content (markdown skill definitions) | transform (path rewriting) | `src/cli/slash-command/bs/ingest-rules.md` (already has the canonical "Reference Files" section shape to mirror in the other 4) | exact |
| `src/cli/slash-command/bs/ingest/interview-fallback.md` (aspects path fix) | config / content | transform | itself — fix is local, no external analog needed | n/a (self-fix) |
| DELETE `instructions.md`, `design-game.template.md` | dead code removal | n/a | n/a | n/a |
| RENAME `generate-ai-instructions.md` → `bs-generate-ai/SKILL.md` | config / content | transform | `src/cli/slash-command/bs/ingest-rules.md` (frontmatter + "Reference Files" section shape) for the SKILL.md wrapper; content body stays close to original | role-match |

## Pattern Assignments

### `src/cli/commands/install-claude-command.ts` (installer, file-I/O)

**Analog:** itself (current version) — read in full below; this is a rewire, not a from-scratch port, so the "pattern to copy" is really "the parts of the current structure to KEEP" plus the new Node built-ins to introduce.

**Current imports** (`src/cli/commands/install-claude-command.ts:8-16`):
```typescript
import { promises as fs } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```
Keep this import block as-is — no new dependency is needed for `fs.cp` (it's on `fs.promises` already imported). Do not add path-traversal helpers; every `dest` argument must stay `join(targetDir, ...)`-derived per RESEARCH's Security Domain note.

**boardsmithRoot / verification pattern to KEEP verbatim** (`install-claude-command.ts:98-113`):
```typescript
const boardsmithRoot = resolve(__dirname, '../../..');

try {
  const packageJson = await fs.readFile(join(boardsmithRoot, 'package.json'), 'utf-8');
  const pkg = JSON.parse(packageJson);
  if (!pkg.name?.includes('boardsmith')) {
    throw new Error('Not a BoardSmith installation');
  }
} catch {
  console.error(chalk.red('Error: Could not find BoardSmith installation.'));
  console.error(chalk.gray(`Looked in: ${boardsmithRoot}`));
  process.exit(1);
}
```
This root-resolution + package.json sniff-test pattern is unrelated to the skills-format migration — keep unchanged.

**targetDir pattern to KEEP, only the leaf directory name changes** (`install-claude-command.ts:115-121`):
```typescript
const targetDir = options.local
  ? join(process.cwd(), '.claude', 'commands')
  : join(homedir(), '.claude', 'commands');

await fs.mkdir(targetDir, { recursive: true });
```
Change `'commands'` → `'skills'` only. Keep the local/global ternary shape and `recursive: true` mkdir call exactly.

**npm link pattern to KEEP verbatim, unrelated to this phase** (`install-claude-command.ts:163-178`):
```typescript
console.log(chalk.gray('Linking BoardSmith globally...'));
try {
  execSync('npm link --force', { cwd: boardsmithRoot, stdio: 'pipe' });
  console.log(chalk.green('✓ BoardSmith linked globally'));
} catch (err) {
  try {
    execSync('npx boardsmith --version', { stdio: 'pipe' });
    console.log(chalk.green('✓ BoardSmith already linked globally'));
  } catch {
    console.error(chalk.yellow('Warning: Could not link BoardSmith globally.'));
    console.error(chalk.gray('You may need to run with sudo or fix npm permissions.'));
    console.error(chalk.gray(`Manual fix: cd ${boardsmithRoot} && npm link`));
  }
}
```

**Pattern to REPLACE — the single-file embed-inline model** (`install-claude-command.ts:29-96`, the whole `installCommand()` function): this per-command "read one instructions file, string-replace `{{BOARDSMITH_ROOT}}`, write one `.md`" function is exactly what CONTEXT.md says to stop doing. Replace with a `copySkillTree()`-style function using `fs.cp` per RESEARCH's Code Examples section:
```typescript
// Source: RESEARCH.md "Recursive tree copy excluding test files"
await fs.cp(
  join(boardsmithRoot, 'src', 'cli', 'slash-command', 'bs', 'templates'),
  join(targetDir, 'templates'),
  {
    recursive: true,
    filter: (src) => !src.endsWith('.test.ts'),
  }
);
```
Apply the same `fs.cp(..., { recursive: true, filter })` call shape uniformly for `build/`, `ingest/`, `templates/`, and `aspects/` (aspects has no `.test.ts` to exclude, but apply the filter defensively per Pitfall 4). Use a single `fs.copyFile` for `state-machine.md` (single file, not a directory). Each of the 5 entry-point `.md` files needs individual `fs.readFile` + rewrite (bump relative-path depth or substitute `${CLAUDE_SKILL_DIR}`-anchored form) + `fs.writeFile` to `targetDir/bs-<name>/SKILL.md` with `fs.mkdir(dirname, {recursive:true})` first — this per-entry-point read/rewrite/write loop is the direct descendant of the current `installCommand()` function's read/transform/write shape, just retargeted at 5 known filenames instead of a generic `commandName` parameter with a lookup map.

**Existence-check pattern to REPLACE** (`install-claude-command.ts:125-152`, the design-game/generate-ai `fs.access` existence check before install): rewrite to check for `targetDir/bs-ingest-rules/SKILL.md` (or similar) as the "already installed" sentinel, same `try { fs.access } catch {}` idiom, just against the new path shape.

**Console-output pattern to REPLACE** (`install-claude-command.ts:180-196`): keep the `chalk.green('✓ ...')` / `chalk.cyan(...)` / `chalk.gray(...)` styling conventions exactly, but the "Commands:" list must enumerate the 5 `bs-*` skills and drop the "/design-game skill is self-contained" blurb per CONTEXT.md.

**Uninstall pattern to REPLACE** (`install-claude-command.ts:199-232`, `uninstallClaudeCommand()`): currently two `fs.unlink` calls against flat `.md` files. Replace with `fs.rm(targetDir, {recursive:true, force:true})`-per-skill-directory calls (5 `bs-*` dirs) plus removal of the shared `build/`/`ingest/`/`templates/`/`aspects/`/`state-machine.md` siblings — same `try/catch` per-item idiom, `removedAny` boolean accumulator pattern preserved.

---

### `src/cli/commands/install-claude-command.test.ts` (NEW, integration, file-I/O)

**Primary analog:** `src/cli/lib/project-scaffold.test.ts` — specifically the one real-fs test in that file (lines 110-149, `describe('generateRulesIndexTs')`, the "type-checks cleanly against the real engine" test):

**Temp-dir setup/teardown pattern** (`project-scaffold.test.ts:117, 145-147`):
```typescript
const dir = mkdtempSync(join(tmpdir(), 'bs-scaffold-compile-'));
try {
  // ... write files into dir, assert ...
} finally {
  rmSync(dir, { recursive: true, force: true });
}
```
Use identically for the installer test: `mkdtempSync(join(tmpdir(), 'bs-install-'))`, wrap the whole real-install-and-assert body in `try { ... } finally { rmSync(dir, { recursive: true, force: true }); }` — this is the mandatory "never leave global side-effects in tests" pattern CONTEXT.md calls for.

**Imports needed** (`project-scaffold.test.ts:1-6`):
```typescript
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
```
For the installer test, additionally need `existsSync`/`readFileSync` (for post-install assertions) and `readdirSync` (to enumerate installed tree for the "no `.test.ts` files present" / "no dangling reference" checks) — same `node:fs` import, just more named exports.

**Secondary analog for the temp-dir + repo-root path-resolution idiom** (`project-scaffold.test.ts:129`):
```typescript
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
```
Use the same `import.meta.url`-relative `repoRoot` resolution to locate `boardsmithRoot` for constructing the expected `installClaudeCommand()` call in the test (the installer itself resolves `boardsmithRoot` via `__dirname`, but the test needs its own independent path to the repo root to point `installClaudeCommand`'s local-mode `process.cwd()` override at the temp dir — likely via a `cwd`-injection option or by `process.chdir()`-ing into the temp dir for the duration of the test, mirroring how `validate.test.ts` uses its own `cwd` temp dir, see below).

**`validate.test.ts` secondary analog** (`src/cli/commands/validate.test.ts:172-190`) — a second real-fs temp-dir pattern in this codebase, worth confirming during planning for the exact `cwd`-scoping idiom used for CLI commands that read `process.cwd()`:
```typescript
const cwd = mkdtempSync(join(tmpdir(), 'bs-bundle-size-'));
try {
  // ... exercise the command against `cwd` ...
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
```

**Structural drift-test analog for asserting markdown reference-path integrity** — `src/cli/slash-command/bs/ingest.test.ts:26-35` (the `read()` helper + byte-identical marker-constant technique used for pinning cross-file markdown references):
```typescript
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}
```
Adapt this `read()`-relative-to-`__dirname` helper for the installer test's "no dangling relative reference" assertion (RESEARCH's Phase Requirements → Test Map row 2): after installing to the temp dir, read each installed `SKILL.md` body, regex-extract markdown-relative paths (backtick-quoted `templates/...`, `state-machine.md`, `ingest/...`, `${CLAUDE_SKILL_DIR}/../...` forms), and assert `existsSync(join(installedSkillDir, extractedPath))` for each — this is the concrete implementation of Pitfall 1's "no dangling relative reference" warning-sign check.

**Assertion style to mirror** (`project-scaffold.test.ts`, throughout — e.g. lines 33-37, 84-87): plain `expect(x).toBe(...)` / `expect(x).toContain(...)` / `expect(x).not.toHaveProperty(...)`, no custom matchers, no snapshot testing. Follow this flat assertion style for the installer test rather than introducing new test infra.

---

### `src/cli/cli.ts` (command descriptions)

**Analog:** itself — line 126 is the only located edit site in this pass:
```typescript
.description('Remove /design-game and /generate-ai slash commands')
```
Change to something like `.description('Remove BoardSmith bs- skills')` (exact wording is Claude's Discretion per CONTEXT.md). No structural pattern to copy — this is a string literal edit, not a new code path. Grep `src/cli/cli.ts` for any other `install`/`uninstall` action registration lines mentioning skill names before considering this file done (Pitfall 3's residual-reference risk applies here too).

---

### 5 `bs/*.md` entry-point skill files (reference-path depth bump)

**Analog:** `src/cli/slash-command/bs/ingest-rules.md` lines 192-205 — the canonical "Reference Files" section shape already in the codebase, to be mirrored (with depth-bumped or `${CLAUDE_SKILL_DIR}`-anchored paths) across all 5 entry points:
```markdown
## Reference Files

- `ingest/transcription.md` — fan-out subagent dispatch, per-section confirmation protocol
- `ingest/interview-fallback.md` — the no-rulebook structured interview
- `ingest/sketch-derivation.md` — chunk-carving heuristic and lazy-tail detail cap
- `ingest/scaffold.md` — naming rules, `boardsmith init`, compile + serve verification, kill
...
- `state-machine.md` — status enum, consistency check, session lock, write order, authority
- `templates/SKETCH.template.md` — the sketch skeleton this skill fills
- `templates/ASSETS.template.md` — the asset ledger skeleton this skill seeds
```
Per RESEARCH's Pattern 1 and Pitfall 2, every bare relative path here (`ingest/...`, `state-machine.md`, `templates/...`) must become either `${CLAUDE_SKILL_DIR}/../ingest/...` / `${CLAUDE_SKILL_DIR}/../state-machine.md` / `${CLAUDE_SKILL_DIR}/../templates/...`, or a single `../`-prepended relative form — RESEARCH recommends editing the SOURCE `.md` files directly (not rewriting during copy) so the installer's copy step stays a pure verbatim `fs.cp`, per Pitfall 2's "more robust" recommendation. Apply this same transform to all in-body references (not just the "Reference Files" section — e.g. lines 3, 8, 18, 53, 56, 61, 67, 82, 84, 103, 105, 112, 132, 134, 142, 150, 167, 171, 175, 177 in `ingest-rules.md` all contain inline relative references needing the same bump — grep each of the 5 entry-point files for backtick-quoted `ingest/`, `build/`, `templates/`, `state-machine.md` occurrences, not just the trailing "Reference Files" list).

**Frontmatter pattern to ADD** (RESEARCH Code Examples, "SKILL.md frontmatter"):
```yaml
---
name: bs-ingest-rules
description: Ingest a board game rulebook and produce the initial sketch/chunk plan for a new BoardSmith game. Use when starting a new game project from a rulebook.
disable-model-invocation: true
---
```
None of the 5 entry-point `.md` files currently have this frontmatter block (they were authored as flat command bodies) — this is new content to prepend, one block per file, `name` matching the `bs-<name>` directory it will be installed into.

---

### `src/cli/slash-command/bs/ingest/interview-fallback.md` (aspects path — self-contained fix)

Current content (lines 174-178) already reads `../aspects/index.md` correctly for the TARGET Skills layout (where `ingest/` and `aspects/` are both direct children of `.claude/skills/`) — per RESEARCH §2 "The pre-existing bug is in the *source* tree, not in the target install layout." **No edit needed to this file's reference text itself** — the fix is entirely in the installer's copy step (place `aspects/` as a sibling of `ingest/` in the installed tree, sourced from `src/cli/slash-command/aspects/`, not wherever a naive verbatim `bs/`-tree copy would put it). Do not "fix" this file's paths — that would break the already-correct reference.

---

### DELETE: `src/cli/slash-command/instructions.md`, `design-game.template.md`

No pattern needed — plain `fs.unlink` / `rm` at the source-tree level (via shell/git, not the installer's runtime code, since these are dev-time source-file deletions, not install-time operations).

---

### RENAME: `generate-ai-instructions.md` → `bs-generate-ai/SKILL.md`

**Analog for the wrapper shape:** same `ingest-rules.md` frontmatter + "Reference Files" section pattern shown above. The body content (5-hook AI-generator instructions: objectives/threatResponseMoves/playoutPolicy/moveOrdering/uctConstant, Hex reference) is preserved per CONTEXT.md — read current file to confirm hook names before editing framing (add "late sketch chunk" positioning per DIST-02, do not restructure the hook list).

## Shared Patterns

### Recursive tree copy excluding test files
**Source:** RESEARCH.md Code Examples (no existing repo precedent — this is the first `fs.cp` usage in the codebase; confirmed via `grep -rn "fs.cp("` returning zero hits)
**Apply to:** the installer's `build/`, `ingest/`, `templates/`, `aspects/` copy steps
```typescript
await fs.cp(src, dest, {
  recursive: true,
  filter: (src) => !src.endsWith('.test.ts'),
});
```

### Temp-dir real-fs test harness (try/finally cleanup)
**Source:** `src/cli/lib/project-scaffold.test.ts:117,145-147` and `src/cli/commands/validate.test.ts:172-190`
**Apply to:** `install-claude-command.test.ts` — every test that performs a real install must `mkdtempSync` at test start and `rmSync(..., {recursive:true, force:true})` in a `finally`, never leaving a global `~/.claude/skills/...` side-effect (CONTEXT.md explicitly calls out testing the file-copy layer only, never the `npm link` step, and never leaking global install artifacts).

### chalk console-output styling
**Source:** `install-claude-command.ts:164-196` (existing file, unchanged convention)
**Apply to:** rewritten console-output block — `chalk.green('✓ ...')` for success, `chalk.yellow(...)` for warnings, `chalk.gray(...)` for secondary detail lines, `chalk.cyan(...)` for command names in the "Commands:" list.

### `__dirname`-relative markdown-reference reading (drift-test technique)
**Source:** `src/cli/slash-command/bs/ingest.test.ts:26-35`
**Apply to:** the "no dangling relative reference" assertion in the new installer test — same `read(relativePath)` helper shape, applied against the freshly-installed temp-dir tree instead of the source tree.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/cli/slash-command/bs/ingest/interview-fallback.md` (aspects reference) | config/content | transform | No fix needed to this file at all — see above; flagged here only because it was in the file list, not because it lacks a pattern |
| DELETE targets (`instructions.md`, `design-game.template.md`) | dead code | n/a | Deletion has no "pattern to copy from" — verify via `grep -rn design-game src/cli` returning zero hits post-delete (Pitfall 3), not via an analog file |

## Metadata

**Analog search scope:** `src/cli/commands/`, `src/cli/lib/`, `src/cli/slash-command/`, `src/cli/cli.ts`
**Files scanned:** `install-claude-command.ts`, `project-scaffold.ts`/`.test.ts`, `validate.test.ts`, `simulate.test.ts`, `sandbox-scan.test.ts`, `cli.ts`, `bs/ingest-rules.md`, `bs/ingest.test.ts`, `bs/ingest/interview-fallback.md`
**Pattern extraction date:** 2026-07-04
</content>
