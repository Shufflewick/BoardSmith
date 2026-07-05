---
phase: 148-distribution-installer-bs-generate-ai
plan: 03
subsystem: cli
tags: [claude-code, agent-skills, cli, installer, integration-test, vitest]

requires: [148-01, 148-02]
provides:
  - Real install-to-temp-dir integration test proving DIST-01 + DIST-02 against the actual
    post-Plan-02 installer output (not a smoke test deleted before commit)
  - Permanent regression guard for the 5 bs-<name>/SKILL.md + shared reference tree layout,
    entry-point reference resolution, .test.ts exclusion, design-game absence, and the
    bs-generate-ai rename
affects: []

tech-stack:
  added: []
  patterns:
    - "mkdtempSync + beforeAll/afterAll(process.chdir + rmSync) real-fs temp-dir integration
      test, mirroring project-scaffold.test.ts's try/finally idiom at suite scope"
    - "Anchored-reference regex extraction (`${CLAUDE_SKILL_DIR}/../` or leading `../`) with an
      explicit skip list for game-project artifacts, glob/placeholder pointers, and
      documented-nonexistent references"

key-files:
  created: []
  modified:
    - src/cli/commands/install-claude-command.test.ts

key-decisions:
  - "Used beforeAll/afterAll (not a fresh mkdtempSync/rmSync per test) to run the real install
    exactly once for the whole describe block — the installer's file-copy layer is expensive to
    invoke seven times over and every assertion reads the same immutable output tree, so a
    shared temp dir is functionally equivalent to the plan's literal try/finally-per-test
    pattern while running an order of magnitude faster."
  - "Regex-extracted anchored references are whitespace-collapsed (`ref.replace(/\\s+/g, '')`)
    before resolution, because markdown line-wraps long inline code spans across a newline
    (e.g. insert-chunk.md's `${CLAUDE_SKILL_DIR}/../templates/\\nSKETCH.template.md`) --
    without collapsing, the literal newline inside the backtick span produces a false dangling-
    reference failure even though the cited file exists and installs correctly."
  - "Added an explicit KNOWN_NONEXISTENT_REFS skip entry for `build/light.md`: build-chunk.md's
    own Light Path section documents that this file deliberately does NOT exist ('no
    .../build/light.md file exists or is needed... the light path is a routing decision over
    build.md/test.md/playtest.md, not a fourth ceremony'). This is a negative reference the
    author explicitly declares absent, not a dangling one -- treating it as dangling would be a
    false-positive test failure that punishes the plan's own load-bearing routing decision
    (BUILD-12)."
  - "Placeholder/glob-form pointers (`templates/<file>`, `${CLAUDE_SKILL_DIR}/../build/...`,
    `${CLAUDE_SKILL_DIR}/../templates/...`) are skipped via a `<` / `*` / trailing `/...` check
    -- these name a category of files in prose, not one concrete resolvable sibling."
  - "The 'no npm link side-effect' assertion is a structural proof (installed tree lives
    entirely under tempDir, and tempDir's skillsRoot is never equal to the real
    homedir()/.claude/skills path) rather than an execSync spy, since the installer module is
    imported directly (not mocked) and skipLink:true already short-circuits the entire
    npm-link code block before any child_process call would occur -- the structural check is
    sufficient and avoids adding test-only mocking machinery to a production module."
  - "Task 2 required no code changes: npm test, the bs/ drift suites, and the design-game/
    dependency gates were all already green from Plans 01/02's prior work plus this plan's new
    test file -- so Task 2 is a verification-only task with no incremental commit."

requirements-completed: [DIST-01, DIST-02]

duration: ~30min
completed: 2026-07-05
---

# Phase 148 Plan 03: Real Install-to-Temp-Dir Integration Test Summary

**Authored the phase's verification-gate test — a real `installClaudeCommand({ local: true, force: true, skipLink: true })` invocation against a scratch temp directory — asserting the full DIST-01/DIST-02 installed layout, every SKILL.md entry-point reference resolves, `.test.ts` exclusion, zero design-game residue, and the `bs-generate-ai` rename with all 5 AI hooks; then proved the full 184-file/2642-test suite green with zero new dependencies.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2/2 completed
- **Files modified:** 1 (`install-claude-command.test.ts`, new file)

## Accomplishments

- `src/cli/commands/install-claude-command.test.ts` created: a `beforeAll`-scoped real install
  into `mkdtempSync(join(tmpdir(), 'bs-install-'))`, with `process.chdir(tempDir)` before the
  install (so the installer's `local: true` / `process.cwd()`-based path resolution targets the
  temp dir) and `process.chdir(origCwd)` + `rmSync(tempDir, {recursive:true, force:true})` in
  `afterAll`. **`skipLink: true` is passed on every invocation** — the installer's `npm link
  --force` block is never reached, so this test performs zero global side-effects.
- 7 tests across two `describe` blocks selectable by `-t "DIST-01"` / `-t "DIST-02"`:
  - **DIST-01** (5 tests): full layout (5 `bs-<name>/SKILL.md` + `build/`/`ingest/`/`templates/`/
    `aspects/`/`state-machine.md`); every entry-point SKILL.md's anchored relative reference
    resolves to a real installed file; `aspects/index.md` resolves via the
    `ingest/interview-fallback.md` `../aspects/index.md` citation; zero `*.test.ts` anywhere in
    the installed tree; zero `design-game` residue in the installed tree and in the installer
    source file; and a structural no-npm-link-side-effect proof (installed tree lives entirely
    under `tempDir`, never `homedir()/.claude/skills`).
  - **DIST-02** (1 test): `generate-ai/` absent, `bs-generate-ai/SKILL.md` present and contains
    all 5 AI hooks (`objectives`, `threatResponseMoves`, `playoutPolicy`, `moveOrdering`,
    `uctConstant`) plus late-sketch-chunk framing language.
- The references-resolve check is explicitly scoped (documented in a code comment) to the 5
  SKILL.md **entry points** only — not the internal `build/*.md`/`ingest/*.md` cross-refs, which
  are prose citations resolved by the orchestrating entry point's already-established
  `${CLAUDE_SKILL_DIR}` context, per the plan's locked scope note.
- Full-suite gate (Task 2): `npm test` — **184 test files, 2642 tests, all green**. The
  `src/cli/slash-command/bs/` drift suites (`ingest.test.ts`, `status-tools.test.ts`,
  `templates.test.ts`, `build-chunk.test.ts`) — 237/237 tests — unaffected by this plan's
  additions, confirming Plan 01's edits remain substring-preserving.
- `git diff --stat package.json package-lock.json` — empty. Zero new npm dependencies.
- `grep -c design-game src/cli/commands/install-claude-command.ts src/cli/cli.ts` — both `0`.
  A repo-wide `grep -rc design-game src/cli` still finds 4 non-zero files: the same 3
  already-documented legitimate Phase 142 migration-prose files (`bs/ingest-rules.md`,
  `bs/ingest/interview-fallback.md`, `bs/ingest/scaffold.md`, unchanged by this plan) plus this
  plan's own new test file (which necessarily contains the literal string `design-game` in its
  assertions and comments to test for its absence in the *installed* tree and *installer
  source*) — matching the scoping decision Plans 01/02 already established and documented.

## Task Commits

1. **Task 1: Write the real install-to-temp-dir integration test (skipLink, no npm link)** -
   `672f5866` (test)
2. **Task 2: Full-suite green + zero-dep + zero-residual gate** - verification only, no code
   change, no incremental commit (all gates were already green after Task 1's commit).

## Files Created/Modified

- `src/cli/commands/install-claude-command.test.ts` - new file: real install-to-temp-dir
  integration test, 7 tests across DIST-01/DIST-02 `describe` blocks, 213 lines.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Naive anchored-reference regex over-matched a line-wrapped inline code span
as a dangling reference**
- **Found during:** Task 1, first `npx vitest run` pass
- **Issue:** `insert-chunk.md` line-wraps a long inline code span across a newline
  (`` `${CLAUDE_SKILL_DIR}/../templates/\nSKETCH.template.md` ``). The extraction regex's
  `[^`]*` correctly captured the full span including the embedded newline, but the un-normalized
  string (with a literal `\n` inside it) never matched the real installed path
  `templates/SKETCH.template.md`, producing a false "dangling reference" failure for a citation
  that resolves correctly in practice (an agent reading the rendered markdown sees one
  continuous inline code span, not two).
- **Fix:** Collapse all whitespace (`ref.replace(/\s+/g, '')`) before resolving, since a real
  file path never legitimately contains whitespace.
- **Files modified:** `src/cli/commands/install-claude-command.test.ts`
- **Commit:** `672f5866`

**2. [Rule 1 - Bug] Glob/placeholder-form pointers and a documented-nonexistent reference
initially misclassified as dangling**
- **Found during:** Task 1, iterative `npx vitest run` passes
- **Issue:** Three categories of anchored citations are not concrete resolvable sibling files:
  (a) `templates/<file>` (placeholder naming a category), (b) `${CLAUDE_SKILL_DIR}/../build/...`
  and `${CLAUDE_SKILL_DIR}/../templates/...` (literal ellipsis meaning "and so on"), and (c)
  `${CLAUDE_SKILL_DIR}/../build/light.md` (build-chunk.md's own Light Path section explicitly
  documents this file does NOT exist by design — BUILD-12's routing decision, not a fourth
  ceremony). All three would fail the references-resolve check as written.
- **Fix:** Added an `isGameProjectArtifact()` skip predicate covering `<`/`*`-containing refs,
  trailing `/...` ellipsis pointers, and an explicit `KNOWN_NONEXISTENT_REFS = ['build/light.md']`
  list with an inline comment explaining why it's a documented negative reference, not a
  dangling one.
- **Files modified:** `src/cli/commands/install-claude-command.test.ts`
- **Commit:** `672f5866`

No architectural changes (Rule 4) were needed; all issues were resolved within the test file
itself per Rules 1-3.

## Threat Model Verification

- T-148-08 (test leaving a global `~/.claude/skills` or npm-link side-effect): confirmed —
  `skipLink: true` on every invocation; the installed tree's `skillsRoot` is asserted to live
  entirely under `tempDir` and never equal `homedir()/.claude/skills`; `rmSync` in `afterAll`
  cleans up unconditionally.
- T-148-04 (`.test.ts` leaking into the installed set): confirmed — recursive `walk()` over the
  full installed tree finds zero `.test.ts` files.
- T-148-05 (design-game residue): confirmed — zero hits in the installed tree and in the
  installer source file (`install-claude-command.ts`); scoping documented above matches Plans
  01/02.
- T-148-SC (package installs): N/A — no package-manager commands run; `package.json`/
  `package-lock.json` diff confirmed empty.
- T-148-09: N/A — local test harness only, no auth/session/network surface.

## Verification Results

- `npx vitest run src/cli/commands/install-claude-command.test.ts` — **7/7 passing**
- `npx vitest run src/cli/commands/install-claude-command.test.ts -t "DIST-01"` — green (5/5
  DIST-01-tagged tests select and pass)
- `npx vitest run src/cli/commands/install-claude-command.test.ts -t "DIST-02"` — green (1/1
  DIST-02-tagged test selects and passes; note vitest `-t` still runs the shared `beforeAll`
  install, so all 7 tests execute but only the DIST-02-named one is asserted-reported — this
  matches the plan's selector requirement)
- `grep -c "skipLink" src/cli/commands/install-claude-command.test.ts` → `6` (>= 1)
- `grep -n "mkdtempSync\|rmSync("` → both present, `rmSync` called with
  `{ recursive: true, force: true }` inside `afterAll`
- `npm test` — **184 test files, 2642 tests passing**, 0 failing
- `npx vitest run src/cli/slash-command/bs/` — **237/237 passing** (4 drift-suite files
  unaffected)
- `grep -rc design-game src/cli/commands/install-claude-command.ts src/cli/cli.ts` — both `0`
- `git diff --stat package.json package-lock.json` — empty (zero new dependencies)
- No lingering temp directories or global `~/.claude/skills`/npm-link artifacts left behind by
  this plan's execution.

## Self-Check: PASSED

Verified on disk / in git log:
- `src/cli/commands/install-claude-command.test.ts` — FOUND, contains `mkdtempSync`, `skipLink`,
  `DIST-01`, `DIST-02`
- Commit `672f5866` — FOUND in `git log --oneline`
