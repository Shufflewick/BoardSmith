---
phase: 148-distribution-installer-bs-generate-ai
fixed_at: 2026-07-04T00:00:00Z
review_path: .planning/phases/148-distribution-installer-bs-generate-ai/148-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 148: Code Review Fix Report

**Fixed at:** 2026-07-04
**Source review:** .planning/phases/148-distribution-installer-bs-generate-ai/148-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (all Warnings; 4 Info findings out of scope for `critical_warning`)
- Fixed: 3
- Skipped: 0

All three fixes and their tests were verified with
`npx vitest run src/cli/commands/install-claude-command.test.ts` (10/10 pass) and the full
suite `npm test` (184 files, 2645 tests, all green). `git diff -- package.json` is empty —
zero new dependencies. All test installs keep `skipLink: true`, so no `npm link`/global
side-effects occur.

## Fixed Issues

### WR-01: `--force` reinstall leaves stale/orphaned shared files behind

**Files modified:** `src/cli/commands/install-claude-command.ts`, `src/cli/commands/install-claude-command.test.ts`
**Commit:** 3ec91dd4 (shared with WR-03 — both rewrite the same `copySkillTree` guard block)
**Applied fix:** Added an `ownedPaths(targetDir)` helper listing exactly the paths this
installer owns (the 5 `bs-<name>/` skill dirs, the 4 `SHARED_DIRS`, and `state-machine.md`).
Before copying, `copySkillTree` now `fs.rm(..., { recursive: true, force: true })`s each owned
path so the subsequent `fs.cp` is authoritative and a `--force` reinstall (or partial-install
completion) yields a tree identical to a fresh install. Scoped strictly to installer-owned
paths — the user's wider `~/.claude/skills` tree is never touched. Test seeds orphan files
inside `build/` and a skill dir, reinstalls with `--force`, and asserts the orphans are gone
while the legit tree remains complete.

### WR-03: Sentinel-only install detection reports a partial tree as "already installed"

**Files modified:** `src/cli/commands/install-claude-command.ts`, `src/cli/commands/install-claude-command.test.ts`
**Commit:** 3ec91dd4 (shared with WR-01)
**Applied fix:** Replaced the single-sentinel (`bs-ingest-rules/SKILL.md`) "already installed"
check with `isFullyInstalled(targetDir)`, which verifies the FULL expected set via
`expectedInstallPaths()` — all 5 `bs-<name>/SKILL.md`, all 4 `SHARED_DIRS`, and
`state-machine.md`. A partial/interrupted install now fails the completeness check and falls
through to the (pre-cleaning) copy that completes it, instead of short-circuiting. Test seeds
only the first sentinel `SKILL.md`, runs a non-`--force` install, and asserts the full tree is
completed rather than misreported as done.

_Note: WR-01 and WR-03 were committed together because both edits rewrite the same contiguous
guard block at the top of `copySkillTree`; splitting them would produce an artificial,
functionally-broken intermediate commit._

### WR-02: `npx boardsmith --version` fallback can fetch an arbitrary registry package / hang in CI

**Files modified:** `src/cli/commands/install-claude-command.ts`, `src/cli/commands/install-claude-command.test.ts`
**Commit:** fbb12309
**Applied fix:** Replaced the network-touching `execSync('npx boardsmith --version')`
link-detection fallback with `execSync('npm ls -g --depth=0 boardsmith')`, which only inspects
already-installed global packages and never fetches from the registry (no supply-chain surface,
no CI hang/prompt). Test reads the installer source and asserts (a) no `execSync('npx ...`
invocation form exists, and (b) the network-free `npm ls -g --depth=0 boardsmith` probe is
present.

## Skipped Issues

None — all in-scope findings were fixed. The 4 Info findings (IN-01..IN-04) are out of scope
for the `critical_warning` fix scope and were not addressed.

---

_Fixed: 2026-07-04_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
