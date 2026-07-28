---
phase: 171-provenance-recording
plan: 02
subsystem: cli
tags: [cli, provenance, version, skills-install, hashing]

# Dependency graph
requires:
  - phase: 171-provenance-recording
    plan: 01
    provides: "normalizeEdition() / EDITION_UNKNOWN sentinel (unrelated file, same phase — no direct code dependency)"
provides:
  - "readBoardsmithVersion() — the real BoardSmith package version, walked up from module location, cached, throws rather than fabricating"
  - "hashSkillsTree() / resolveSkillsRoot() / SKILLS_TREE_ABSENT — content hash over the installer-owned bs- skills tree"
  - "boardsmith --version reports the real package version instead of a hardcoded literal"
affects: ["PROV-01 (## Verified Against block's BoardSmith version + skills version fields)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Walk-up package.json resolution (not a fixed hop count) to survive both the dev-repo tsx runtime shape and the published dist/cli.js bundle shape — precedent already used by install-claude-command.ts"
    - "Path-and-content hashing (relPath + '\\0' + bytes + '\\0' fed into one running SHA-256) so a moved file cannot collide with an unmoved one"
    - "Honest-absence sentinel (SKILLS_TREE_ABSENT = 'not installed') rather than a fallback hash, matching the project's no-dummy-data rule"

key-files:
  created:
    - src/cli/lib/boardsmith-version.ts
    - src/cli/lib/boardsmith-version.test.ts
    - src/cli/lib/skills-tree-hash.ts
    - src/cli/lib/skills-tree-hash.test.ts
    - .planning/phases/171-provenance-recording/deferred-items.md
  modified:
    - src/cli/cli.ts

key-decisions:
  - "readBoardsmithVersion() reads synchronously (readFileSync) because Commander's .version() call site in cli.ts is synchronous — an async walk cannot be awaited there without restructuring cli.ts's whole registration flow, which is out of this plan's scope."
  - "resolveSkillsRoot() test isolation required overriding $HOME per-test: this dev machine has a real dogfooded ~/.claude/skills install with real bs- entries, so the absence-path tests would silently pass by falling through to the real global install unless $HOME is pointed at an empty temp dir for the duration of that test."
  - "Per CONTEXT.md decision 9, package.json's version field was read but never bumped or touched — git diff package.json is empty after every task."

requirements-completed: [PROV-01]

# Metrics
duration: ~25min
completed: 2026-07-28
---

# Phase 171 Plan 02: Real BoardSmith Version + Skills-Tree Hash Summary

**`readBoardsmithVersion()` fixes `boardsmith --version`'s hardcoded `.version('0.0.1')` lie by walking up to the repo's own package.json, and `hashSkillsTree()` adds the content hash (per installer-owned bs- paths) that actually discriminates two `--local` installs sharing that same unmoving version.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-28T~12:47:00Z (approx)
- **Completed:** 2026-07-28T~13:12:00Z (approx)
- **Tasks:** 3 (Task 1 RED+GREEN version fix, Task 2 RED+GREEN hash, Task 3 full-suite regression)
- **Files modified:** 6 (5 created, 1 modified) + 1 deferred-items doc

## Accomplishments

- `readBoardsmithVersion()` (`src/cli/lib/boardsmith-version.ts`): walks up from its own module
  location (`fileURLToPath(import.meta.url)`) to the first `package.json` whose `name` is
  `boardsmith`, returns its `version`, and caches the result. Throws an Error naming the start
  directory when no owning `package.json` is found — no fallback string, ever. Handles both real
  runtime shapes (`bin/boardsmith.js`'s dev-repo-via-tsx vs. published-`dist/cli.js` dispatch)
  because it walks rather than hops a fixed distance.
- `src/cli/cli.ts` now calls `.version(readBoardsmithVersion())` — zero hardcoded semver literals
  remain in the file.
- `hashSkillsTree()` (`src/cli/lib/skills-tree-hash.ts`): reduces the installed `bs-` skills tree
  (5 `bs-<name>/` dirs + `bs-shared/`, exactly `installClaudeCommand`'s ownership boundary) to one
  SHA-256 hex digest. Each file's root-relative POSIX path is hashed alongside its bytes (so a
  file moved between skill dirs — which changes which skill reads it — cannot collide with an
  unmoved file), entries are sorted by path before hashing (so write order never affects the
  result), and a non-`bs-`-prefixed sibling at the skills root is excluded entirely.
- `resolveSkillsRoot()`: mirrors `installClaudeCommand`'s own `--local`-then-global `targetDir`
  choice (project-local `.claude/skills` first, then `~/.claude/skills`), gated on the candidate
  containing at least one `bs-`-prefixed entry.
- `SKILLS_TREE_ABSENT = 'not installed'` returned — never a placeholder hash — when no skills root
  can be found under either candidate.

## Task Commits

1. **Task 1: readBoardsmithVersion() and a cli.ts that stops lying** — `c568f613` (fix)
2. **Task 2: hashSkillsTree() over the installer-owned paths** — `ed204d6d` (feat)
3. **Task 3: Full-suite regression check for the cli.ts edit** — `40152915` (docs — no code change; recorded the run + one deferred pre-existing tsc issue)

## RED Observations (mandatory per 171-VALIDATION.md)

### Task 1 — real `--version`

Command: `npx vitest run src/cli/lib/boardsmith-version.test.ts` (before `boardsmith-version.ts` existed)

```
 RUN  v2.1.9 /Users/jtsmith/BoardSmith

 ❯ src/cli/lib/boardsmith-version.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/cli/lib/boardsmith-version.test.ts [ src/cli/lib/boardsmith-version.test.ts ]
Error: Failed to load url ./boardsmith-version.js (resolved id: ./boardsmith-version.js) in
/Users/jtsmith/BoardSmith/src/cli/lib/boardsmith-version.test.ts. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

Independently confirmed the hardcode this RED is pinned against: `grep -n "version('0.0.1')"
src/cli/cli.ts` → `27:  .version('0.0.1');` — the exact literal decision 9 identifies, present
before the fix.

### Task 2 — `hashSkillsTree()`

Command: `npx vitest run src/cli/lib/skills-tree-hash.test.ts` (before `skills-tree-hash.ts` existed)

```
 RUN  v2.1.9 /Users/jtsmith/BoardSmith

 ❯ src/cli/lib/skills-tree-hash.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/cli/lib/skills-tree-hash.test.ts [ src/cli/lib/skills-tree-hash.test.ts ]
Error: Failed to load url ./skills-tree-hash.js (resolved id: ./skills-tree-hash.js) in
/Users/jtsmith/BoardSmith/src/cli/lib/skills-tree-hash.test.ts. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

## GREEN Results

Task 1: `npx vitest run src/cli/lib/boardsmith-version.test.ts` → 3/3 passed.
Task 2: `npx vitest run src/cli/lib/skills-tree-hash.test.ts` → 9/9 passed.

Acceptance criteria checked directly:
- `node bin/boardsmith.js --version` → `0.0.1`, matches `node -e "console.log(require('./package.json').version)"` → `0.0.1`.
- `grep -c "version('0.0.1')" src/cli/cli.ts` → `0`.
- `git diff --stat package.json` → empty (untouched, both tasks).
- `grep -c "SKILLS_TREE_ABSENT" src/cli/lib/skills-tree-hash.ts` → `3` (≥ 2 required).

Full suite (Task 3): `npm test` → **228 test files / 3344 tests passed** (baseline at phase-02
start was 226 files / 3332 tests, carried in from 171-01's SUMMARY; net **+12** from this plan's
new cases — 3 in `boardsmith-version.test.ts`, 9 in `skills-tree-hash.test.ts` — 0 regressed).

`node bin/boardsmith.js --help` still lists `ingest-archive`, `ingest-gaps`, `ingest-check`,
`ingest-relabel` — confirmed the `cli.ts` import/version edit disturbed nothing else on the
command surface.

## The version string BoardSmith now reports

`boardsmith --version` reports **`0.0.1`** — the real, honest value of `package.json`'s `version`
field, read live rather than hardcoded. Per 171-CONTEXT.md decision 9, this plan deliberately does
**not** bump that field or invent a release-versioning convention; that is a milestone-level
decision explicitly out of scope here. The package version has apparently never moved off `0.0.1`
in this repo's history (verified in 171-01 via full `git log -p`), so on its own it carries close
to zero discriminating signal for provenance purposes today — that is the correct, honest thing to
record, per decision 9 and 171-RESEARCH.md Pitfall 2. The **content hash** (`hashSkillsTree()`)
is what actually does the discrimination PROV-01/PROV-03 need: two `--local` installs sharing the
identical `0.0.1` version but different skill text now produce different hashes, which is exactly
the case that broke Phase 170 fourteen times over.

## Files Created/Modified

- `src/cli/lib/boardsmith-version.ts` — new. `readBoardsmithVersion()`, module-level cache, walk-up resolution, throw-not-fallback.
- `src/cli/lib/boardsmith-version.test.ts` — new. 3 tests: equals package.json's own version, matches semver shape, no hardcoded literal remains in cli.ts.
- `src/cli/lib/skills-tree-hash.ts` — new. `SKILLS_TREE_ABSENT`, `resolveSkillsRoot()`, `hashSkillsTree()`.
- `src/cli/lib/skills-tree-hash.test.ts` — new. 9 tests across `resolveSkillsRoot` (project-local, home fallback, absence) and `hashSkillsTree` (64-char hex shape, content-change sensitivity, path-change sensitivity, non-`bs-` sibling exclusion, write-order independence, honest absence).
- `src/cli/cli.ts` — modified. Imports `readBoardsmithVersion`; `.version('0.0.1')` → `.version(readBoardsmithVersion())`.
- `.planning/phases/171-provenance-recording/deferred-items.md` — new. Logs the pre-existing, out-of-scope `tsc --noEmit` rootDir error for `docs/seed-to-state.test.ts` (from phase 168), not caused by this plan.

## Decisions Made

- Synchronous file read (`readFileSync`) in `readBoardsmithVersion()`, not the promises API —
  Commander's `.version()` call site in `cli.ts` is synchronous, and restructuring that flow to
  await a version lookup was out of this plan's scope.
- Test isolation for `resolveSkillsRoot`/`hashSkillsTree`'s absence paths required temporarily
  overriding `process.env.HOME` per-test, because this dev machine already has a real, populated
  `~/.claude/skills` (this repo's own dogfood install) — without the override, "no skills root
  found" tests would silently pass by falling through to that real global install instead of
  proving the absence branch.
- `package.json`'s `version` field was read directly (never modified) in both tasks; `git diff
  --stat package.json` confirmed empty after each commit.

## Deviations from Plan

None — plan executed as written. Task 3 found one out-of-scope, pre-existing issue
(`tsc --noEmit`'s rootDir mismatch on `docs/seed-to-state.test.ts`, introduced in phase 168) and
logged it to `deferred-items.md` per the scope boundary rule rather than fixing it, since it is not
caused by this plan's files.

## Issues Encountered

- `npx tsc --noEmit` fails on an unrelated, pre-existing `rootDir` config issue (see
  `deferred-items.md`). This is not a regression from this plan — confirmed via `git log --follow`
  that the offending file (`docs/seed-to-state.test.ts`) was added in phase 168, well before this
  plan's changes, and via `npm test` (vitest, not tsc) passing 3344/3344 clean.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `readBoardsmithVersion()` and `hashSkillsTree()` are both ready for PROV-01's `## Verified
  Against` block (plan 03+) to import and call directly.
- `~/BoardSmithGames/seven` was never touched by this plan (no command in this plan reads or
  writes any path under it) — untouched by construction, not separately re-verified.
- No blockers for subsequent 171 plans.

## Self-Check: PASSED
- `src/cli/lib/boardsmith-version.ts` — FOUND
- `src/cli/lib/boardsmith-version.test.ts` — FOUND
- `src/cli/lib/skills-tree-hash.ts` — FOUND
- `src/cli/lib/skills-tree-hash.test.ts` — FOUND
- `.planning/phases/171-provenance-recording/deferred-items.md` — FOUND
- Commit `c568f613` — FOUND (`git log --oneline` confirms)
- Commit `ed204d6d` — FOUND (`git log --oneline` confirms)
- Commit `40152915` — FOUND (`git log --oneline` confirms)

---
*Phase: 171-provenance-recording*
*Completed: 2026-07-28*
