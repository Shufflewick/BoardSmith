---
phase: 148-distribution-installer-bs-generate-ai
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/cli/commands/install-claude-command.ts
  - src/cli/commands/install-claude-command.test.ts
  - src/cli/cli.ts
  - src/cli/slash-command/bs/ingest-rules.md
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/generate-ai-instructions.md
findings:
  critical: 0
  warning: 3
  info: 4
  total: 7
status: issues_found
---

# Phase 148: Code Review Report

**Reviewed:** 2026-07-04
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Phase 148 rewires the Claude Code installer to the Agent Skills layout, adds `skipLink`, removes `/design-game`, renames `/generate-ai` → `/bs-generate-ai`, and adds a real install-to-temp-dir integration test. The migration is fundamentally **correct**: I verified every claim in the review brief.

- **fs.cp filter is correct, not the gotcha case.** `excludeTestFiles` returns `!src.endsWith('.test.ts')`, which returns `true` for all directories (they never end in `.test.ts`), so no subtree is ever pruned — only individual test files would be dropped. The filter does not trigger the "false-on-directory prunes subtree" hazard.
- **Reference paths resolve.** I grepped every `${CLAUDE_SKILL_DIR}/../…` reference across all 5 entry points and confirmed each target exists in the copied shared tree (`build/`, `ingest/`, `templates/`, `aspects/`, `state-machine.md`). The one apparent exception, `build/light.md`, is a documented negative reference (build-chunk.md line 194 states it deliberately does not exist) and is correctly listed in the test's `KNOWN_NONEXISTENT_REFS`.
- **The test is real, not superficial.** It installs to a `mkdtemp` dir with `skipLink:true` + `local:true`, asserts the resolved layout, cleans up in `afterAll`, and its reference-resolution assertion actually checks real `existsSync` (with `checkedAtLeastOne` guarding against a vacuous pass). The skip-list is tightly scoped — I confirmed `SKETCH.template.md`/`CHUNK.template.md`/`DESIGN.template.md`/`ASSETS.template.md` are **not** masked by the `SKETCH.md`/`CHUNK.md`/… `GAME_PROJECT_ARTIFACTS` prefixes (the `.template.` infix diverges at char 7), so the skip-list does not hide shared-tree breakage.
- **Uninstaller fix verified.** `fs.access` is checked before `fs.rm(..., {force:true})`, and `removedAny` is only set when the path existed — so the "force never throws → always reports removed" bug is genuinely fixed.
- **design-game removal is clean** in cli.ts and install-claude-command.ts (grep confirms zero residue); the legitimate `/design-game` **migration** references in ingest-rules.md Step 0 case 4 are correctly preserved and are not filename residue.
- **bs-generate-ai reframe preserves the 5-hook capability** (frontmatter present, all 5 hooks + late-sketch guidance present; DIST-02 test asserts this).

The findings below are robustness/quality gaps, not correctness breakers.

## Structural Findings (fallow)

No `<structural_findings>` block was provided with this review.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: `--force` reinstall leaves stale/orphaned shared files behind

**File:** `src/cli/commands/install-claude-command.ts:79-87`
**Issue:** `fs.cp(srcDir, destDir, { recursive: true, filter })` **merges** into an existing `destDir`; it never deletes destination files that no longer exist in the source. On a `boardsmith claude --force` reinstall after a shared file was renamed or removed (e.g. a former `build/foo.md` deleted upstream), the orphaned file persists in `~/.claude/skills/build/`. Given the project's "No Backward Compatibility / cleanest implementation" rule, `--force` should produce a tree identical to a fresh install, but it does not. A skill that still cites the removed name would resolve to stale content instead of failing loudly.
**Fix:** Remove each shared destination before copying when `force` is set, so the copy is authoritative:
```ts
for (const dirName of SHARED_DIRS) {
  const srcDir = dirName === 'aspects' ? join(slashCommandDir, 'aspects') : join(bsDir, dirName);
  const destDir = join(targetDir, dirName);
  if (force) await fs.rm(destDir, { recursive: true, force: true });
  await fs.cp(srcDir, destDir, { recursive: true, filter: excludeTestFiles });
}
```
(Apply the same pre-clean to each `<skillName>/` dir and `state-machine.md`.)

### WR-02: `npx boardsmith --version` fallback can fetch an arbitrary registry package / hang in CI

**File:** `src/cli/commands/install-claude-command.ts:137-140`
**Issue:** When `npm link --force` fails, the catch block runs `execSync('npx boardsmith --version', { stdio: 'pipe' })` with the default cwd (the user's directory, not `boardsmithRoot`). If `boardsmith` is not resolvable locally, `npx` will attempt to **download and execute a package named `boardsmith` from the npm registry** — a network side-effect the user never asked for (and a supply-chain surface if a squatter owns that name), or a hang/prompt in a non-interactive/CI shell. This defeats the intent (detect an already-linked binary) and violates "fail fast and loud, not silently."
**Fix:** Constrain the probe to the known root and forbid remote install, e.g.:
```ts
execSync('npm ls -g --depth=0 boardsmith', { stdio: 'pipe' });
// or, if invoking the binary, pin it: execSync('node ./bin/boardsmith.js --version', { cwd: boardsmithRoot, stdio: 'pipe' });
```
Never rely on bare `npx <name>` for a presence check.

### WR-03: Sentinel-only install detection reports a partially-installed (broken) tree as "already installed"

**File:** `src/cli/commands/install-claude-command.ts:59-68`
**Issue:** The "already installed" check keys on a single sentinel (`bs-ingest-rules/SKILL.md`). If a previous install was interrupted after the entry-point loop wrote that first SKILL.md but before the shared-tree copy (lines 80-87) completed, a later non-`--force` run sees the sentinel, returns `false`, and prints "already installed" — leaving skills present but their `${CLAUDE_SKILL_DIR}/../build|ingest|templates|state-machine.md` references dangling, with no signal to the user that `--force` is required. The right path (a clean, complete install) is not the easy path here.
**Fix:** Either treat the presence of all sentinels (each `<skillName>/SKILL.md` plus `state-machine.md` and each `SHARED_DIRS` entry) as "installed", or make the copy transactional (stage to a temp dir, then rename into place) so a partial tree can never be mistaken for complete.

## Info

### IN-01: `excludeTestFiles` filter is a no-op under the current layout; the "no .test.ts leaks" test passes vacuously

**File:** `src/cli/commands/install-claude-command.ts:41-44, 80-84`; `src/cli/commands/install-claude-command.test.ts:169-173`
**Issue:** The `.test.ts` files (`bs/ingest.test.ts`, `bs/build-chunk.test.ts`, `bs/templates.test.ts`, `bs/status-tools.test.ts`) live at the `bs/` **root**, which is a *sibling* of every copied `SHARED_DIRS` entry (`bs/build`, `bs/ingest`, `bs/templates`, `aspects`) — none are *inside* a copied directory. The entry-point loop copies only named `.md` files. So no test file can leak regardless of the filter, and the test's `expect(testFiles).toEqual([])` assertion is trivially satisfied without ever exercising the filter predicate. The filter is legitimate defense-in-depth for a future `bs/build/*.test.ts`, but the brief's framing that it "genuinely excludes test code" overstates its current effect.
**Fix:** No code change required. Optionally add a test that seeds a throwaway `*.test.ts` inside a copied dir to actually exercise the filter, or document the filter as forward-looking defense.

### IN-02: Residual `/generate-ai` name in the generated-file header comment

**File:** `src/cli/slash-command/generate-ai-instructions.md:126`
**Issue:** The `ai.ts` file template the skill instructs the model to write still carries `// Generated by /generate-ai slash command`. The command was renamed to `/bs-generate-ai`, so every game's generated `ai.ts` will bear a stale, non-existent command name.
**Fix:** Update the comment to `// Generated by the bs-generate-ai skill`.

### IN-03: Cross-skill citations by bare filename don't resolve in the installed layout

**File:** `src/cli/slash-command/bs/check-status.md:12` (also the `Cite \`build-chunk.md\``-style prose in other entry points)
**Issue:** check-status.md cites `` `build-chunk.md`'s Context-Economics Hard Rule ``, but build-chunk.md installs as `bs-build-chunk/SKILL.md`, not as a `build-chunk.md` sibling. An agent that tried to `Read` the cited filename would not find it. These are bare (un-anchored) prose citations, so the test correctly does not treat them as resolvable paths and they cause no test failure — but the cross-reference is stale relative to the installed skill directory names.
**Fix:** Cite the installed skill by name (e.g. "the `bs-build-chunk` skill's Context-Economics Hard Rule") rather than a flat filename that no longer exists post-install.

### IN-04: Reference-resolution test scope excludes internal cross-refs in build/*.md and ingest/*.md

**File:** `src/cli/commands/install-claude-command.test.ts:134-161`
**Issue:** The dangling-reference assertion scans only the 5 entry-point `SKILL.md` files (documented, deliberate scope). A dangling `${CLAUDE_SKILL_DIR}/../build/<missing>.md` inside `build/audit.md` or `ingest/transcription.md` would not be caught. Those files are copied verbatim and unchanged by this phase, so this is a coverage gap rather than a regression, but the installed tree's internal reference graph is unverified.
**Fix:** Optionally extend `extractAnchoredRefs` scanning to walk every installed `.md` (not just the 5 entry points), reusing the same skip-list, to guard the full reference graph.

---

_Reviewed: 2026-07-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
