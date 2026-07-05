---
phase: 148-distribution-installer-bs-generate-ai
reviewed: 2026-07-04T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/cli/commands/install-claude-command.ts
  - src/cli/commands/install-claude-command.test.ts
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: issues_found
---

# Phase 148: Code Review Report (Iteration 2)

**Reviewed:** 2026-07-04
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Re-review of the DIST-01/02 installer after commits `3ec91dd4` (WR-01, WR-03) and
`fbb12309` (WR-02). All three prior fixes are functionally correct, and I verified the copy
source paths against the real tree: `src/cli/slash-command/bs/{build,ingest,templates}`,
top-level `aspects/`, `bs/state-machine.md`, and the five entry-point `.md` files all exist.

- **WR-01 (clean reinstall: `ownedPaths()` + pre-copy `fs.rm`)** — SAFE against the primary
  hazard. Every rm target is `join(targetDir, <fixed name>)`; the loop never removes `targetDir`
  itself, so it cannot wipe the entire `~/.claude/skills` tree. Local and global modes flow
  through the same `ownedPaths()`, so scoping is identical in both. `fs.rm(..., {force:true})` is
  a no-op on a fresh install (paths absent), and `targetDir` is `mkdir`'d before `copySkillTree`
  runs, so there is no rm-before-mkdir crash and no rm-before-copy ordering fault. **One residual
  data-loss edge remains** — see WR-01a.
- **WR-02 (`npm ls -g --depth=0 boardsmith` probe)** — CORRECT. Eliminates the registry
  fetch/hang; exit-code semantics are right (0 = present → "already linked", non-zero → warn).
  The test asserts no `execSync('npx …')` form survives.
- **WR-03 (`isFullyInstalled()` / `expectedInstallPaths()`)** — CORRECT with NO false negatives.
  The expected set is exactly the 5 `SKILL.md` + 4 shared dirs + `state-machine.md`, all of which
  a successful install writes, so a complete install short-circuits and there is no
  perpetual-reinstall loop; partial installs correctly fall through to a clean re-copy. One soft
  edge on dir-existence-only checking — see WR-03a.

No blockers. The findings below are the residual data-loss edge the WR-01 rm introduced plus two
robustness gaps.

## Structural Findings (fallow)

No `<structural_findings>` block was provided with this review.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01a: Pre-copy `fs.rm` can delete a user's unrelated skill named `build`/`ingest`/`templates`/`aspects`/`state-machine.md`

**File:** `src/cli/commands/install-claude-command.ts:47-53, 104-106`
**Issue:** `SHARED_DIRS = ['build', 'ingest', 'templates', 'aspects']` plus `state-machine.md` are
installed as **flat siblings directly under the Claude Code skills root** (`~/.claude/skills/build`,
`~/.claude/skills/templates`, …). `ownedPaths()` returns those generic names, and the new WR-01
pre-copy loop runs `fs.rm(path, { recursive: true, force: true })` over each. If a user (or another
tool) has an unrelated skill/dir named exactly `build`, `ingest`, `templates`, `aspects`, or a file
`state-machine.md` at that root, this installer **recursively deletes it** on any `--force`
reinstall or partial-install completion — data loss outside the `bs-*` namespace. WR-01 *elevated*
the pre-existing hazard: previously `fs.cp` merely merged BoardSmith files into a colliding dir;
now the dir is deleted first. The five skill dirs (`bs-*`) are safely namespaced; only the shared
tree is exposed, because it is not `bs-`-prefixed.
**Fix:** Namespace the shared reference tree under a single `bs-`-prefixed root so the installer
owns a collision-proof subtree, mirroring the skill dirs:
```ts
const SHARED_ROOT = 'bs-shared'; // ~/.claude/skills/bs-shared/{build,ingest,templates,aspects,state-machine.md}
function ownedPaths(targetDir: string): string[] {
  return [
    ...SKILL_ENTRY_POINTS.map(({ skillName }) => join(targetDir, skillName)),
    join(targetDir, SHARED_ROOT),
  ];
}
```
Then update the `SHARED_DIRS` copy destinations, `expectedInstallPaths()`, the entry-point relative
references, the tests, and `uninstallClaudeCommand()` (identical hazard) to the namespaced root. If
namespacing is out of phase scope, at minimum gate the `fs.rm` so a shared dir is only removed when
it contains an installer-authored marker.

### WR-01b: `uninstallClaudeCommand` shares the same generic-name deletion hazard

**File:** `src/cli/commands/install-claude-command.ts:221-237`
**Issue:** Uninstall iterates the same generic `SHARED_DIRS` + `state-machine.md` and `fs.rm`s each
under `targetDir`. A user's unrelated `~/.claude/skills/templates` (or `build`, `ingest`, `aspects`)
skill is silently removed by `boardsmith uninstall`. Same root cause as WR-01a; called out
separately because it is a distinct entry point not covered by the WR-01 tests.
**Fix:** Same namespacing remedy as WR-01a — uninstall should only remove the owned `bs-*` roots.

### WR-03a: `isFullyInstalled()` checks shared dirs by existence only, so an empty/half-copied shared dir reports "complete"

**File:** `src/cli/commands/install-claude-command.ts:59-77`
**Issue:** `expectedInstallPaths()` lists the four shared dirs as bare directory paths and
`isFullyInstalled()` only `fs.access()`-checks them. `fs.cp` creates the destination directory
before populating it, so an install interrupted **mid-shared-tree** can leave, e.g., an empty
`templates/` dir. A later non-`force` run then sees all 4 dirs + 5 `SKILL.md` + `state-machine.md`
present and short-circuits as "already installed", leaving the empty/partial shared tree in place —
the exact partial-install class WR-03 aimed to eliminate, one level deeper. The entry-point
`SKILL.md` checks are robust; the shared dirs are the gap.
**Fix:** Probe a known leaf file inside each shared dir instead of the dir itself, e.g.
`join(targetDir, 'aspects', 'index.md')`, or assert the dir is non-empty
(`(await fs.readdir(dir)).length > 0`). A test seeding an empty `templates/` then running a
non-force install would lock this in.

## Info

### IN-01: `npm ls -g` fallback can emit a spurious "Could not link" warning on an unrelated global-tree problem

**File:** `src/cli/commands/install-claude-command.ts:179-186`
**Issue:** `npm ls -g --depth=0 boardsmith` exits non-zero not only when `boardsmith` is absent but
also when the global tree has unrelated issues (extraneous/invalid deps surfaced by npm). In that
case the code falls into the `catch` and prints "Warning: Could not link BoardSmith globally" even
though the package may be present and linked. Low impact (advisory text only, after a real
`npm link` failure), but the message can misdirect.
**Fix:** Optional — parse `npm ls -g --json boardsmith` and check for the package key rather than
relying solely on the exit code, or soften the wording to "could not confirm global link".

---

_Reviewed: 2026-07-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
