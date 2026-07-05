---
phase: 148-distribution-installer-bs-generate-ai
plan: 02
subsystem: cli
tags: [claude-code, agent-skills, cli, installer, fs.cp]

requires: [148-01]
provides:
  - installClaudeCommand() copies the Agent Skills layout (5 bs-<name>/SKILL.md dirs + shared
    build/, ingest/, templates/, aspects/ tree + state-machine.md) via Node's built-in fs.cp
  - InstallOptions.skipLink gates the npm-link global side-effect for test use
  - uninstallClaudeCommand() removes the full skills tree recursively
  - cli.ts claude/uninstall descriptions carry no design-game/generate-ai wording
affects: [148-03]

tech-stack:
  added: []
  patterns:
    - "fs.cp(src, dest, {recursive:true, filter}) for shared reference-tree copies, applied
      uniformly to build/, ingest/, templates/, aspects/"
    - "skipLink?: boolean option gating a global side-effect (npm link) so tests can exercise
      the file-copy layer with zero side-effects"

key-files:
  created: []
  modified:
    - src/cli/commands/install-claude-command.ts
    - src/cli/cli.ts

key-decisions:
  - "Scoped the 'zero design-game residual' acceptance criterion to the installer source
    (install-claude-command.ts) and cli.ts only, per the executor prompt's explicit scoping
    note. Legitimate /design-game references remain in bs/ingest-rules.md,
    bs/ingest/interview-fallback.md, and bs/ingest/scaffold.md (Phase 142's old-skill migration
    feature, which must name /design-game by string to detect and convert old projects) -- these
    are unchanged and out of this plan's files_modified scope, matching Plan 01's identical
    scoping decision."
  - "Found and fixed a self-introduced design-game reference during Task 2's verification pass:
    the new install console-output text (Task 1) said 'Projects built with the old /design-game
    skill are auto-detected' -- reworded to 'Projects built with an older BoardSmith skill are
    auto-detected' so the installer SOURCE carries zero design-game references while still
    describing the migration path in the sentence."
  - "copySkillTree() implements the 4 shared-dir copies (build/ingest/templates/aspects) as a
    single loop over a SHARED_DIRS array rather than 4 literal fs.cp(...) call sites. This
    satisfies the plan's underlying intent (T-148-04: filter applied to every shared-tree copy)
    but means grep -c 'fs.cp(' on the source returns 1 (one call site, executed 4 times at
    runtime), not >= 3 as the plan's Task 1 acceptance criterion literally states. Verified the
    functional behavior directly via a temporary smoke test (see Verification Results) rather
    than relying on the textual grep count."
  - "uninstallClaudeCommand() checks fs.access() before fs.rm() for each item (rather than
    fs.rm(..., {force:true}) alone) because {force:true} silently no-ops on a missing path,
    which would make the removedAny accumulator always true -- an actual Rule 1 bug fix over
    the plan's literal single-fs.rm-per-item description."

requirements-completed: [DIST-01, DIST-02]

duration: ~20min
completed: 2026-07-05
---

# Phase 148 Plan 02: Installer Copy-Tree Rewrite Summary

**Rewired `installClaudeCommand()` from the flat embed-inline `.claude/commands/*.md` model to a recursive `fs.cp`-based Agent Skills copy-tree (`.claude/skills/bs-<name>/SKILL.md` + shared `build/`/`ingest/`/`templates/`/`aspects/`/`state-machine.md`), added a `skipLink` option to gate the npm-link side-effect, rewired the uninstaller to remove the full tree recursively, and purged design-game/generate-ai wording from the installer source and `cli.ts`.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2/2 completed
- **Files modified:** 2 (`install-claude-command.ts`, `cli.ts`)

## Accomplishments

- `installClaudeCommand()` now builds the Agent Skills layout: 5 `bs-<name>/SKILL.md` entry
  points (`bs-ingest-rules`, `bs-build-chunk`, `bs-check-status`, `bs-insert-chunk`,
  `bs-generate-ai`) written verbatim from their Plan-01-prepared source files, plus `build/`,
  `ingest/`, `templates/`, `aspects/` copied recursively via `fs.cp(..., {recursive:true,
  filter: excludeTestFiles})` and `state-machine.md` copied as a single file — all as flat
  siblings directly under `.claude/skills/` (or `<cwd>/.claude/skills/` with `--local`).
- `aspects/` is sourced from its true location (`src/cli/slash-command/aspects/`, a sibling of
  `bs/` in the source tree) and lands as a direct sibling of `ingest/` in the installed tree, so
  `ingest/interview-fallback.md`'s `../aspects/index.md` reference resolves correctly — confirmed
  by direct filesystem inspection in the smoke test below.
- Every shared-tree copy applies the same `(src) => !src.endsWith('.test.ts')` filter
  defensively, even for `aspects/` which has no test files today.
- `InstallOptions` gained `skipLink?: boolean`; the npm-link `execSync` block is now wrapped in
  `if (!options.skipLink) { ... }` with its internal try/catch/fallback logic completely
  unchanged — default/unset behavior for real installs is identical to before.
- `uninstallClaudeCommand()` removes the 5 skill directories plus the 4 shared dirs plus
  `state-machine.md`, each via an `fs.access` existence check followed by `fs.rm(...,
  {recursive:true, force:true})`, preserving the original per-item try/catch +
  `removedAny`-accumulator idiom (adjusted to check existence first — see Deviations).
- `targetDir` leaf changed from `'commands'` to `'skills'` in both the `--local` and global
  branches; no other resolution logic touched.
- `cli.ts`'s `claude` and `claude uninstall` command `.description(...)` strings no longer
  mention `/design-game` or `/generate-ai`.
- No new dependency: `fs.cp`/`fs.copyFile`/`fs.rm` are all on the already-imported
  `node:fs` `promises` API; `package.json` diff is empty.

## Task Commits

1. **Task 1: Replace the embed-inline installer with the Agent Skills copy-tree; add skipLink
   gate** - `9e040e48` (feat)
2. **Task 2: Rewire uninstall + cli.ts description; purge design-game residue** - `761a2c9c`
   (docs)

## Files Created/Modified

- `src/cli/commands/install-claude-command.ts` - full rewrite of `installClaudeCommand()` /
  `uninstallClaudeCommand()`: `copySkillTree()` helper replaces `installCommand()`;
  `SKILL_ENTRY_POINTS` and `SHARED_DIRS` constant tables; `InstallOptions.skipLink`; npm-link
  block gated; console output rewritten for the 5-skill model
- `src/cli/cli.ts` - `claude`/`claude uninstall` `.description(...)` strings reworded

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `fs.rm(..., {force:true})` alone does not throw on a missing path, which
would make `uninstallClaudeCommand`'s `removedAny` accumulator always report `true`**
- **Found during:** Task 2, writing the uninstaller loop
- **Issue:** The plan's pattern doc describes "same per-item try/catch idiom" reusing
  `fs.rm(itemPath, {recursive:true, force:true})` directly inside a try/catch. Because
  `{force:true}` suppresses `ENOENT` (it never throws when the path doesn't exist), a bare
  try/catch around it can never observe "did not exist" — `removedAny` would always flip `true`
  even on a no-op uninstall of an already-clean tree, breaking the "No BoardSmith skills found."
  message.
- **Fix:** Added an `fs.access(itemPath)` existence check before each `fs.rm` call; only mark
  `removedAny = true` and log the removal line if the item was actually present.
- **Files modified:** `src/cli/commands/install-claude-command.ts`
- **Commit:** `9e040e48`

**2. [Rule 1 - Bug] Self-introduced `design-game` string in the new install console output**
- **Found during:** Task 2's residual-purge grep pass
- **Issue:** Task 1's rewritten console-output block (documenting the old-skill migration path)
  literally said `"the old /design-game skill"`, which the Task 2 acceptance criterion (`grep -rc
  design-game src/cli/commands/install-claude-command.ts src/cli/cli.ts == 0`) requires to be
  zero.
- **Fix:** Reworded to `"an older BoardSmith skill"` — preserves the informational content
  (migration is auto-detected and offered by `bs-ingest-rules`) without the literal string.
- **Files modified:** `src/cli/commands/install-claude-command.ts`
- **Commit:** `9e040e48`

### Scope Adaptations (per executor prompt's explicit instruction)

**3. Residual `design-game` grep scoped to installer source + cli.ts, not blanket `src/cli`**
- **Plan's literal criterion:** `grep -rc "design-game" src/cli` == 0 (both the phase-level
  `<verification>` and Task 2's acceptance criteria state this against `src/cli`, unscoped).
- **Adapted scope:** Verified `grep -rn design-game src/cli/commands/install-claude-command.ts
  src/cli/cli.ts | wc -l` == 0 instead. A repo-wide `src/cli` grep still finds 3 hits, all
  pre-existing and out of this plan's `files_modified` scope: `bs/ingest-rules.md` (INGEST-07
  case 4, the one-time `/design-game`-project migration detection), `bs/ingest/
  interview-fallback.md` and `bs/ingest/scaffold.md` (provenance notes for content extracted
  from the old `/design-game` skill). These are Phase 142's shipped old-skill migration feature
  — the ingest skill must name `/design-game` by string to detect and convert legacy projects.
  Plan 01's SUMMARY documents this identical scoping decision for the same 3 files; this plan
  did not touch them and confirms the decision still holds.
- **Rationale:** Matches the executor prompt's explicit "CRITICAL SCOPING NOTE," which
  instructed adapting the blanket grep to target (a) installer source, (b) cli.ts, and (c) the
  installed command/skill set, while excluding legitimate migration prose.

**4. `fs.cp(` textual occurrence count is 1, not >= 3, though the functional copy count is 4**
- **Plan's literal criterion:** `grep -c "fs.cp(" src/cli/commands/install-claude-command.ts` >=
  3.
- **What was built instead:** A single `for (const dirName of SHARED_DIRS) { ... await
  fs.cp(...) ... }` loop, so the literal source text contains one `fs.cp(` call site that
  executes 4 times at runtime (once each for `build`, `ingest`, `templates`, `aspects`) — the
  same functional coverage the plan's acceptance criterion was checking for (T-148-04: filter
  applied to every shared-tree copy), just expressed as a loop instead of 4 repeated call sites.
  Verified the actual runtime behavior directly: a temporary smoke test (installed to a real
  temp dir, asserted all 4 shared dirs exist post-install and are fully removed post-uninstall,
  then deleted before committing) confirmed all 4 copies execute correctly. This is a more
  DRY implementation of the same requirement, not a functional gap — documented rather than
  padding the source with redundant literal call sites purely to satisfy a textual grep count.

## Threat Model Verification

- T-148-04 (fs.cp filter correctness): `excludeTestFiles` filter applied uniformly to all 4
  shared-dir copies via the `SHARED_DIRS` loop — confirmed via smoke test that no `.test.ts`
  files leak into the installed tree.
- T-148-05 (residual design-game path): resolved per the scoped grep in Deviation #3 above.
- T-148-06 (path traversal / writing outside targetDir): every destination path remains
  `join(targetDir, <literal>)`-derived; no user-supplied path segments introduced.
- T-148-10 (npm link global side-effect during tests): `skipLink` option added and verified via
  smoke test — `installClaudeCommand({ local: true, skipLink: true })` performed a full install
  with zero `execSync`/npm-link invocation.

## Verification Results

- `grep -c "fs.cp("` = 1 (loop-based, see Deviation #4); functional coverage confirmed via smoke
  test (4/4 shared dirs installed and removed correctly)
- `grep -c "'skills'"` = 4; no remaining `'commands'` targetDir literal
- `grep -c "bs-generate-ai"` = 3
- `grep -c "\.test\.ts"` = 2 (filter definition + comment)
- `grep -c "skipLink"` = 2 (interface field + guard) — confirmed functionally via smoke test
- `git diff package.json` — empty (no new dependency)
- `npx tsc --noEmit` — zero errors referencing `install-claude-command.ts` or `cli.ts` (all
  other reported errors are pre-existing, unrelated test-file issues elsewhere in the repo, out
  of this plan's scope)
- Scoped residual grep (`src/cli/commands/install-claude-command.ts` + `src/cli/cli.ts`) for
  `design-game`/`generate-ai` = 0
- Ad-hoc temporary smoke test (written, run, then deleted before commit — not part of the
  committed diff, since Plan 03 owns the permanent test file): full real-fs install to a
  `mkdtempSync` temp dir with `{local:true, skipLink:true}`, asserting all 5 `SKILL.md` files
  exist, all 4 shared dirs + `state-machine.md` exist, `../aspects/index.md` resolves relative to
  `ingest/`, zero `.test.ts` files present anywhere in the installed tree, then a full
  `uninstallClaudeCommand({local:true})` leaving the directory clean — all assertions passed.

## Self-Check: PASSED

Verified on disk / in git log:
- `src/cli/commands/install-claude-command.ts` — FOUND, contains `fs.cp`, `skipLink`,
  `bs-generate-ai`
- `src/cli/cli.ts` — FOUND, contains no `design-game`/`generate-ai`
- Commit `9e040e48` — FOUND in `git log --oneline`
- Commit `761a2c9c` — FOUND in `git log --oneline`
