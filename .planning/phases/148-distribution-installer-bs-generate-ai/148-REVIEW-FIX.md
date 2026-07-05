---
phase: 148-distribution-installer-bs-generate-ai
fixed_at: 2026-07-04T00:00:00Z
review_path: .planning/phases/148-distribution-installer-bs-generate-ai/148-REVIEW.md
iteration: 3
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 148: Code Review Fix Report

**Fixed at:** 2026-07-04
**Source review:** .planning/phases/148-distribution-installer-bs-generate-ai/148-REVIEW.md
**Iteration:** 3

**Summary:**
- Findings in scope: 4 (3 warnings + 1 optional info)
- Fixed: 4
- Skipped: 0

All four iteration-2 findings were fixed as one coherent, cross-cutting layout
change: the shared reference tree is now namespaced under a single `bs-shared/`
root instead of installing as flat, un-namespaced siblings at the skills root.

## Fixed Issues

### WR-01a: Pre-copy `fs.rm` could delete a user's unrelated skill named `build`/`ingest`/`templates`/`aspects`/`state-machine.md`

**Files modified:** `src/cli/commands/install-claude-command.ts`, `src/cli/commands/install-claude-command.test.ts`, `src/cli/slash-command/bs/build-chunk.md`, `src/cli/slash-command/bs/check-status.md`, `src/cli/slash-command/bs/insert-chunk.md`, `src/cli/slash-command/bs/ingest-rules.md`
**Commit:** 8c7bfb3f
**Applied fix:** Introduced `SHARED_ROOT = 'bs-shared'` and made `copySkillTree`
copy the four shared dirs and `state-machine.md` INTO `~/.claude/skills/bs-shared/`
instead of as flat siblings. `ownedPaths()` now returns exactly the 5 `bs-<name>/`
skill dirs plus the single `bs-shared/` root — every owned path is `bs-`-prefixed,
so the WR-01 pre-copy `fs.rm(recursive)` can never wipe a generic top-level name.
Updated all 142 `${CLAUDE_SKILL_DIR}/../<dir>` references across the 5 entry-point
skill files to `${CLAUDE_SKILL_DIR}/../bs-shared/<dir>`, plus the "Installed
location" prose paragraphs. Added a test asserting a pre-existing unrelated
`~/.claude/skills/templates/` (and `build`/`ingest`/`aspects`/`state-machine.md`)
SURVIVES a `--force` reinstall while BoardSmith's own `bs-shared/` tree installs
alongside it.

### WR-01b: `uninstallClaudeCommand` shared the same generic-name deletion hazard

**Files modified:** `src/cli/commands/install-claude-command.ts`
**Commit:** 8c7bfb3f
**Applied fix:** `uninstallClaudeCommand`'s `itemsToRemove` now lists the 5 skill
names plus `SHARED_ROOT` only — never the generic `SHARED_DIRS` names or a bare
`state-machine.md` at the root. Uninstall can no longer remove an unrelated user
skill that happens to share a name with a shared dir.

### WR-03a: `isFullyInstalled()` checked shared dirs by existence only (empty/half-copied dir reported "complete")

**Files modified:** `src/cli/commands/install-claude-command.ts`, `src/cli/commands/install-claude-command.test.ts`
**Commit:** 8c7bfb3f
**Applied fix:** Added `SHARED_LEAF_PROBES` — a known leaf file inside each shared
dir (`bs-shared/state-machine.md`, `bs-shared/build/build.md`,
`bs-shared/ingest/transcription.md`, `bs-shared/templates/SKETCH.template.md`,
`bs-shared/aspects/index.md`). `expectedInstallPaths()` now probes these leaves
rather than bare directory existence, so an install interrupted mid-shared-tree
(leaving an empty `templates/`) is correctly detected as partial on the next
non-force run and completed. Added a test seeding empty shared dirs and asserting
a non-force install finishes them.

### IN-01: `npm ls -g` fallback could emit a spurious "Could not link" warning

**Files modified:** `src/cli/commands/install-claude-command.ts`
**Commit:** 8c7bfb3f
**Applied fix:** Softened the fallback warning wording from "Could not link
BoardSmith globally" to "Could not confirm BoardSmith is linked globally", with a
comment noting `npm ls -g` also exits non-zero for unrelated global-tree problems,
so a failure there does not prove boardsmith is unlinked.

## Verification

- `npx vitest run src/cli/commands/install-claude-command.test.ts src/cli/slash-command/bs/` — 249 passed (5 files).
- `npm test` — 2647 passed (184 files).
- `git status --short package.json` — empty (package.json untouched).

---

_Fixed: 2026-07-04_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
