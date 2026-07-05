---
phase: 148-distribution-installer-bs-generate-ai
verified: 2026-07-05T22:45:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
---

# Phase 148: Distribution — Installer & `/bs-generate-ai` Verification Report

**Phase Goal:** Installing BoardSmith's Claude tooling gives a designer the complete,
self-consistent `bs-` skill family with no dead `/design-game` path left behind.
**Verified:** 2026-07-05
**Status:** passed
**Re-verification:** No — initial verification

## Important note on SUMMARY.md staleness

The three plan SUMMARY.md files (148-01/02/03) describe the shared reference tree as
flat siblings directly under `.claude/skills/` (`build/`, `ingest/`, `templates/`,
`aspects/`, `state-machine.md`). **This is stale.** A post-execution code-review loop
(148-REVIEW.iter2.md → 148-REVIEW-FIX.md, iteration 3, commit `8c7bfb3f`) found this flat
layout was a genuine data-loss hazard (WR-01a/WR-01b: a `--force` reinstall or uninstall
could recursively delete an unrelated user skill/dir at the skills root literally named
`build`, `ingest`, `templates`, `aspects`, or `state-machine.md`) and fixed it by
namespacing the entire shared tree under `bs-shared/`. The actual, current, tested,
committed codebase reflects the `bs-shared/` layout — verified directly below, not from
the SUMMARY narrative.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Installer installs all 5 `bs-<name>/SKILL.md` skills in one pass | ✓ VERIFIED | `SKILL_ENTRY_POINTS` in `install-claude-command.ts:30-36`; test `installs bs- skill family... under bs-shared/` passes |
| 2 | Shared reference tree (build/ingest/templates/aspects/state-machine.md) installs alongside, at correct relative depth for skill references | ✓ VERIFIED | `SHARED_ROOT='bs-shared'`, copied via `fs.cp`/`fs.copyFile` into `<targetDir>/bs-shared/*`; entry-point refs anchored `${CLAUDE_SKILL_DIR}/../bs-shared/<dir>` (33/80/19/15 occurrences across the 4 authored entry points); test `no dangling references` passes |
| 3 | `.test.ts` files excluded from the installed tree | ✓ VERIFIED | `excludeTestFiles` filter applied to all 4 `SHARED_DIRS` copies; test `test files excluded: zero *.test.ts anywhere in the installed tree` passes |
| 4 | `/design-game` fully removed: source files deleted, zero residual in installer/cli.ts source | ✓ VERIFIED | `instructions.md`, `design-game.template.md`, `generate-ai.template.md` absent from disk; `grep -rn design-game src/cli/commands/install-claude-command.ts src/cli/cli.ts` = 0; ingest skill's legitimate migration-detection references (`bs/ingest-rules.md`, `bs/ingest/interview-fallback.md`, `bs/ingest/scaffold.md`) correctly preserved as documented, out-of-scope, shipped Phase 142 content |
| 5 | `/generate-ai` renamed to `bs-generate-ai`, preserving all 5 AI hooks + late-sketch-chunk framing | ✓ VERIFIED | `generate-ai-instructions.md` carries `name: bs-generate-ai`; installed as `bs-generate-ai/SKILL.md`; `generate-ai/` dir absent from installed tree; test asserts all 5 hooks (`objectives`/`threatResponseMoves`/`playoutPolicy`/`moveOrdering`/`uctConstant`) + late-sketch-chunk language present |
| 6 | `skipLink:true` gates the npm-link block — no global side-effect from tests | ✓ VERIFIED | `if (!options.skipLink) { execSync('npm link --force', ...) }` in source; test installs run with `skipLink:true` and structurally assert the installed tree lives entirely under the temp dir |
| 7 | Collision-safety: an unrelated `~/.claude/skills/templates` (and `build`/`ingest`/`aspects`/`state-machine.md`) dir survives a `--force` reinstall | ✓ VERIFIED | `ownedPaths()`/`itemsToRemove` only ever reference `bs-<name>/` + `bs-shared/`; test `installClaudeCommand — reinstall never deletes an unrelated user skill (WR-01a)` seeds unrelated dirs/files at those generic names and asserts they survive a `--force` reinstall — passes |
| 8 | Zero new npm dependency | ✓ VERIFIED | `git diff --stat package.json package-lock.json` empty; `fs.cp`/`fs.copyFile`/`fs.rm` are Node built-ins on the already-imported `node:fs` promises API |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/commands/install-claude-command.ts` | Agent Skills copy-tree installer, bs-shared/ namespaced, skipLink gate, collision-safe uninstall | ✓ VERIFIED | Read in full; matches all must-haves; `fs.cp`, `SHARED_ROOT`, `ownedPaths`, `isFullyInstalled`, `SHARED_LEAF_PROBES` all present and correct |
| `src/cli/commands/install-claude-command.test.ts` | Real install-to-temp-dir test, DIST-01/DIST-02 + WR-01/WR-01a/WR-02/WR-03/WR-03a regression coverage | ✓ VERIFIED | 12 tests, all pass; includes the collision-safety test (WR-01a) explicitly seeding and asserting survival of unrelated `templates`/`build`/`ingest`/`aspects`/`state-machine.md` |
| `src/cli/slash-command/bs/{ingest-rules,build-chunk,check-status,insert-chunk}.md` | Frontmatter + `${CLAUDE_SKILL_DIR}/../bs-shared/...`-anchored refs | ✓ VERIFIED | All 4 files carry `name: bs-*` frontmatter and bs-shared/-anchored refs (grep counts: 33/80/15/19) |
| `src/cli/slash-command/generate-ai-instructions.md` | `bs-generate-ai` frontmatter, 5 hooks, late-sketch-chunk framing | ✓ VERIFIED | Confirmed via installed-tree test assertions |
| `src/cli/cli.ts` | No design-game/generate-ai wording in uninstall description | ✓ VERIFIED | grep confirms 0 hits |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `install-claude-command.ts` `copySkillTree` | `<targetDir>/bs-shared/aspects` | `fs.cp` sibling-of-ingest placement | ✓ WIRED | Test `aspects/index.md resolves via ingest/interview-fallback.md-style ../aspects/ reference within bs-shared/` passes |
| Entry-point SKILL.md bodies | `<targetDir>/bs-shared/<dir>/<file>` | `${CLAUDE_SKILL_DIR}/../bs-shared/...`-anchored refs | ✓ WIRED | Reference-resolve test walks all backtick-quoted anchored refs in the 5 installed SKILL.md files and asserts `existsSync` for each (skip list documented and scoped correctly per prior code review) |
| `installClaudeCommand` | `npm link --force` | `if (!options.skipLink)` guard | ✓ WIRED | Verified by source read; tests always pass `skipLink:true` |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Installer + bs/ drift suites | `npx vitest run src/cli/commands/install-claude-command.test.ts src/cli/slash-command/bs/` | 5 files, 249 tests, all passed | ✓ PASS |
| Full accumulated suite | `npm test` | 184 files, 2647 tests, all passed | ✓ PASS |
| TypeScript compile | `npx tsc --noEmit -p tsconfig.json` (filtered to install-claude-command) | zero errors | ✓ PASS |
| No new dependency | `git diff --stat package.json package-lock.json` | empty | ✓ PASS |
| design-game residue in installer/cli.ts | `grep -rn design-game src/cli/commands/install-claude-command.ts src/cli/cli.ts` | 0 | ✓ PASS |
| Dead design-game/generate-ai template files | `test ! -e instructions.md / design-game.template.md / generate-ai.template.md` | all absent | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|--------------|------------|--------------|--------|----------|
| DIST-01 | 148-01, 148-02, 148-03 | `install-claude-command.ts` installs all five bs- skills + shared reference files (aspects, doc lists, templates) and removes the design-game template | ✓ SATISFIED | Verified installer source + real install test, above |
| DIST-02 | 148-01, 148-02, 148-03 | `/generate-ai` is renamed `/bs-generate-ai` and positioned as a late sketch chunk after game-end exists | ✓ SATISFIED | Verified `bs-generate-ai/SKILL.md` install + 5-hooks + late-sketch-chunk framing test |

No orphaned requirements found in REQUIREMENTS.md mapped to Phase 148 beyond DIST-01/DIST-02.

### Anti-Patterns Found

None blocking. No TBD/FIXME/XXX markers found in the phase's modified files. No stub
patterns, no empty handlers, no hardcoded-empty data flowing to output.

### Human Verification Required

None. This phase's goal (installer file-copy correctness, reference resolution,
collision safety) is fully verifiable via automated tests, and those tests were run
directly (not just cited from SUMMARY.md). Live-in-Claude-Code behavioral proof of the
installed skills actually running is explicitly deferred to Phase 149 per the phase's own
scope boundary, which is appropriate — Phase 148 only claims installer correctness.

### Gaps Summary

None. All 8 derived truths verified directly against the current codebase (not
SUMMARY.md narrative). Notably, the SUMMARY.md files for all 3 plans describe an earlier
(now-superseded) flat-sibling shared-tree layout; the actual shipped code reflects a later
`bs-shared/`-namespaced layout produced by a 3-iteration post-execution code-review loop
(148-REVIEW.md → 148-REVIEW-FIX.md iteration 1, then 148-REVIEW.iter2.md →
148-REVIEW-FIX.iter2.md... wait — file-naming note: despite the `.iter2` suffix, the
`148-REVIEW-FIX.iter2.md` file's own frontmatter says `iteration: 1` and its "Iteration 2"
review counterpart is `148-REVIEW.md` (frontmatter `depth: standard`, no iteration
field but titled "Code Review Report" reviewing all files); the truly final fix pass
is `148-REVIEW-FIX.md` with frontmatter `iteration: 3`, which introduces `bs-shared/`.
Verification re-derived the true chronology directly from file content (git commit
references `3ec91dd4`/`fbb12309`/`8c7bfb3f` in increasing order) rather than trusting
filenames, and confirmed `8c7bfb3f` (the `bs-shared/` fix) is the tip of
`install-claude-command.ts`'s history and matches the file's on-disk content exactly.
This is a documentation/file-naming quirk in the review artifacts, not a code gap — no
action needed.

---

_Verified: 2026-07-05_
_Verifier: Claude (gsd-verifier)_
