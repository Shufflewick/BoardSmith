---
phase: 171-provenance-recording
plan: 04
subsystem: cli
tags: [provenance, chunk-check, machine-owned-fence, repair-then-fail, cli]

# Dependency graph
requires:
  - phase: 171-provenance-recording
    plan: 03
    provides: "computeVerificationScope() / resolveCitedSlices() — the two pure computations chunk-check wires together"
  - phase: 171-provenance-recording
    plan: 02
    provides: "readBoardsmithVersion() / hashSkillsTree() — the version + skills-tree fields recorded in the block"
provides:
  - "chunkCheckCommand(slug, options) — writes/repairs chunks/<slug>/CHUNK.md's fenced '## Verified Against' block, exits non-zero when it had to"
  - "VERIFIED_AGAINST_HEADING/BEGIN/END, VERIFIED_AGAINST_LABELS, VERIFIED_AGAINST_EMPTY, renderVerifiedAgainst(), VerifiedAgainstRecord — exported from chunk-provenance.ts"
  - "boardsmith chunk-check <slug> registered in cli.ts (--project, --json)"
  - "program.parseAsync() + top-level try/catch in cli.ts — every CLI command (not just chunk-check) now reports a thrown Error as a clean one-line message instead of a raw unhandled-rejection stack trace"
affects: ["171-05 (chunk-provenance-status aggregation parses VERIFIED_AGAINST_LABELS)", "171-06 (close wires chunk-check into both build paths)", "PROV-01", "PROV-02"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Distinct fence pair per machine-owned section (VERIFIED_AGAINST_BEGIN/END, never GAPS_BEGIN/END) — 171-CONTEXT.md decision 3's explicit anti-corruption rule"
    - "Citation scanning is scoped to content BEFORE any existing machine-owned section, not the whole file — a self-referential provenance block whose own prose mentions the rulebook index would otherwise never let a second, unchanged run settle to exitCode undefined"
    - "program.parseAsync() + single top-level try/catch, replacing program.parse() — the one place a thrown Error becomes a clean CLI message for every command, not just the new one"

key-files:
  created: []
  modified:
    - src/cli/commands/chunk-provenance.ts
    - src/cli/commands/chunk-provenance.test.ts
    - src/cli/cli.ts

key-decisions:
  - "Citations are resolved only from chunkText content BEFORE any existing '## Verified Against' heading, not the whole file. Found during GREEN: the block's own explanatory comment legitimately discusses the rulebook index, and scanning the full file (including a block chunk-check itself just wrote) turned that self-reference into a permanently-unresolved citation, so a second identical run never settled to exitCode undefined. Fixed by slicing chunkText at the heading index before calling resolveCitedSlices()."
  - "program.parse() -> program.parseAsync() wrapped in a top-level try/catch in cli.ts. Task 3's own acceptance criterion ('node bin/boardsmith.js chunk-check no-such-slug ... with no stack trace in the output') is unsatisfiable under plain program.parse(), because commander does not await async action handlers and a thrown Error surfaces as a raw Node unhandled-rejection stack trace naming internal file paths and line numbers — verified this was ALSO true, pre-fix, for ingest-archive's existing throws (same repo-wide gap, not specific to this plan). cli.ts was already in this plan's file scope, so the fix was made once, at the root, for every command — not just chunk-check."
  - "Rulebook edition / Rulebook source hash render 'none recorded' (never a fabricated value) when computeVerificationScope() returns no edition/sourceHash for a project with no INDEX.md, matching the project's no-dummy-data rule and 171-CONTEXT.md decision 4's edition-anchor framing."
  - "VERIFIED_AGAINST_EMPTY ('_Not yet recorded._') is defined per the plan's exported-constant list and is used as the 'Cited slices:' section's fallback body when a chunk resolves zero cited slices, mirroring GAPS_EMPTY's role for zero open-rules-gaps entries."

requirements-completed: [PROV-01, PROV-02]

# Metrics
duration: ~40min
completed: 2026-07-28
---

# Phase 171 Plan 04: chunk-check — Fenced Verified Against Block Summary

**`boardsmith chunk-check <slug>` writes/repairs a fenced, machine-owned `## Verified Against` block into `chunks/<slug>/CHUNK.md` (scope, edition, rulebook source hash, BoardSmith version, skills-tree hash, cited-slice hashes, unresolved citations) — repair-then-`process.exitCode = 1`, never throwing, mirroring `ingestCheckCommand` line for line, plus a repo-wide fix so no CLI command leaks a stack trace on a thrown Error.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-28T~13:08:00Z (approx)
- **Completed:** 2026-07-28T~13:48:00Z (approx)
- **Tasks:** 3 (Task 1 RED, Task 2 GREEN, Task 3 CLI registration + stack-trace fix)
- **Files modified:** 3 (chunk-provenance.ts, chunk-provenance.test.ts, cli.ts — all pre-existing)

## Task Commits

1. **Task 1: RED — pin the block shape, fence refusal, repair-then-fail contract** — `35f0b72b` (test)
2. **Task 2: GREEN — chunkCheckCommand, fenced block, self-reference citation-scan fix** — `7e60de57` (feat)
3. **Task 3: Register chunk-check in cli.ts; fix repo-wide stack-trace leak** — `778e1d07` (feat)

## RED Observation (mandatory per 171-VALIDATION.md)

Command: `npx vitest run src/cli/commands/chunk-provenance.test.ts -t "chunk-check"` (before `chunkCheckCommand` existed)

```
 RUN  v2.1.9 /Users/jtsmith/BoardSmith

 ❯ src/cli/commands/chunk-provenance.test.ts (32 tests | 11 failed | 21 skipped) 80ms
   × chunk-check > writes the whole fenced section when none exists, and exits non-zero 35ms
     → chunkCheckCommand is not a function
   × chunk-check > running again with nothing changed leaves the file byte-identical, exitCode undefined 13ms
     → chunkCheckCommand is not a function
   × chunk-check > the written body contains Scope/Rulebook edition/Rulebook source hash/BoardSmith version/Skills tree hash lines and a cited-slice hash row 9ms
     → chunkCheckCommand is not a function
   × chunk-check > code-conformance-only scope writes a Reason: line carrying an enumerated code; full scope writes no Reason: line 4ms
     → chunkCheckCommand is not a function
   × chunk-check > the recorded slice hash equals the SHA-256 of that slice file's actual bytes, computed independently 3ms
     → chunkCheckCommand is not a function
   × chunk-check > editing a slice file and re-running rewrites that row's hash and exits 1 3ms
     → chunkCheckCommand is not a function
   × chunk-check > unresolved citations are recorded verbatim under Unresolved citations:; a chunk with none omits the list 2ms
     → chunkCheckCommand is not a function
   × chunk-check > a fence-less "## Verified Against" section throws an actionable error naming both markers, and does NOT modify the file 3ms
     → chunkCheckCommand is not a function
   × chunk-check > content OUTSIDE the fences (## Interpretation etc.) is byte-identical before and after a repair run 3ms
     → chunkCheckCommand is not a function
   × chunk-check > an unknown slug throws an error naming the path it looked for 2ms
     → chunkCheckCommand is not a function
   × chunk-check > --json emits { slug, scope, reason, changed, citedSlices, unresolved } and prints no human decoration 3ms
     → chunkCheckCommand is not a function

 Test Files  1 failed (1)
      Tests  11 failed | 21 skipped (32)
```

All 11 new `chunk-check` tests failed with `chunkCheckCommand is not a function`, confirming the function was unresolved before Task 2. The 21 plan-03 tests skipped (not failed) because `-t "chunk-check"` filters to the new describe block only — the pre-existing scope/citation tests were unaffected by this task and continued passing independently (confirmed by a full unfiltered run afterward).

## GREEN Result

Command: `npx vitest run src/cli/commands/chunk-provenance.test.ts`

```
 ✓ src/cli/commands/chunk-provenance.test.ts (32 tests) 149ms

 Test Files  1 passed (1)
      Tests  32 passed (32)
```

Full suite: `npm test` → **229 test files / 3376 tests passed** (baseline at phase-04 start was 229 files / 3365 tests, carried in from 171-03's SUMMARY; net **+11** from this plan's new `chunk-check` cases, 0 regressed).

`npx tsc --noEmit` reports the same single pre-existing, out-of-scope error already logged in `deferred-items.md` (`docs/seed-to-state.test.ts` rootDir mismatch, introduced in phase 168) — confirmed unrelated to this plan's files by inspection of the tsc output (only one error, naming that file, not `chunk-provenance.ts` or `cli.ts`).

## The rendered block, for one fixture chunk

Run against a temp fixture project (`chunk-check jab --project <tmp>`), first invocation (block created, `process.exitCode = 1`):

```
## Verified Against

<!-- MACHINE-OWNED. Do not write between the fences below, and do not move or delete them.

     `boardsmith chunk-check <slug>` computes this block from disk state: the SHA-256 of each
     rulebook slice this chunk cites, the rulebook index's own `Source hash:` line as the
     edition anchor, this project's installed BoardSmith version and skills-tree content hash, and
     the verification scope `computeVerificationScope()` derives from disk. It runs from `close`
     and repairs this block on every run. Anything you write here is overwritten on the next run.

     Why this is fenced rather than requested politely: 171-CONTEXT.md decision 3 traces this
     shape to the 2026-07-28 human gate (`170-PROOF-RUN-2.md`), where a session had a real
     motive to edit the sibling fenced `## Open Rules Gaps` section, recognised it was
     machine-owned, and declined to touch it. A hand-authored provenance block is indistinguishable
     from a correct one by reading it, so it is made structurally impossible instead —
     `boardsmith chunk-check` refuses to write, rather than silently re-fencing, when these
     markers are gone. -->

<!-- boardsmith:verified-against:begin -->
Scope: full
Rulebook edition: First Printing 2020
Rulebook source hash: 42e1637b6ba22353f93fe8f489474bb88e3b1a97f1bbe527b4a4cd4680d4f801
BoardSmith version: 0.0.1
Skills tree hash: c78dbcde5ea10369decc7fc858cea16d19f974dcb268139829fe2b7164c8e512

Cited slices:

| slice | sha256 |
|---|---|
| rulebook/01-setup-and-round-structure.md | 8c7ac454228f20dca11d2ca494e2372f75a86e5643a65985e1a6c6a246fded33 |
<!-- boardsmith:verified-against:end -->
```

Re-running the same command against the same fixture printed `✓ chunks/jab/CHUNK.md — Verified Against up to date (full)` and exited 0, with the file byte-identical. This scratch fixture lived under the scratchpad temp directory and was deleted after the demo — it was never part of either reference game.

## Files Created/Modified

- `src/cli/commands/chunk-provenance.ts` — added `VERIFIED_AGAINST_HEADING`, `VERIFIED_AGAINST_BEGIN`/`END`, `VERIFIED_AGAINST_LABELS`, `VERIFIED_AGAINST_EMPTY`, `VerifiedAgainstRecord`, `renderVerifiedAgainst()`, `renderVerifiedAgainstSection()` (internal), `chunkCheckCommand()`.
- `src/cli/commands/chunk-provenance.test.ts` — added `describe('chunk-check')`, 11 tests, plus `makeCheckProject()`/`makeChunk()` helpers scaffolding real rulebook + `CHUNK.template.md`-shaped fixtures.
- `src/cli/cli.ts` — imports and registers `chunk-check <slug>` (`--project`, `--json`) alongside the `ingest-*` family; `program.parse()` → `await program.parseAsync()` wrapped in a top-level `try`/`catch`.

## Decisions Made

- **Citation self-reference fix (Rule 1 — bug, found during GREEN).** `resolveCitedSlices()` was being called against the FULL `chunkText`, including any `## Verified Against` section already written by a prior `chunk-check` run. That section's own explanatory comment legitimately discusses "the rulebook index," and — before the fix that removed the literal string `rulebook/INDEX.md` from the prose and scoped the scan — the comment's mention of the rulebook index was itself being matched as an unresolved citation, so a second, otherwise-unchanged run never settled to `process.exitCode === undefined`. Fixed two ways: (1) the comment no longer spells out a literal `rulebook/<file>` path, and (2) `chunkCheckCommand` now scans only the file content BEFORE the existing heading (or the whole file, when the heading is absent) for citations, so the machine-owned section can never re-poison its own next computation regardless of future comment wording.
- **Repo-wide stack-trace fix (Rule 1/2 — bug + missing critical functionality, found while verifying Task 3's own acceptance criterion).** Task 3 requires `node bin/boardsmith.js chunk-check no-such-slug` to exit non-zero "with no stack trace in the output." Under the pre-existing `program.parse()`, EVERY throwing command in this CLI — including `ingest-archive`'s pre-existing unreadable-path throw, verified directly before the fix — surfaced a raw Node unhandled-rejection stack trace naming internal file paths and line numbers, because Commander does not await action handlers under `parse()`. This directly violates CLAUDE.md ("never leak implementation details ... stack traces, internal paths") and was not specific to `chunk-check`. Since `cli.ts` was already in this plan's file scope, fixed once at the root: `program.parse()` → `await program.parseAsync()` wrapped in a single top-level `try`/`catch` that prints `err.message` and sets `process.exitCode = 1`. Verified this also cleans up `ingest-archive`'s existing throw path, with zero change to any command's normal (non-throwing) behavior (`--version`, `--help`, and the full `npm test` suite all still green).
- `Rulebook edition:` / `Rulebook source hash:` render the literal `none recorded` — never a fabricated value — when `computeVerificationScope()` returns no `edition`/`sourceHash` (e.g. `no-rulebook-project`, `index-missing`), consistent with the project's no-dummy-data rule.
- `VERIFIED_AGAINST_EMPTY` (`_Not yet recorded._`) is used as the `Cited slices:` section's fallback body when a chunk resolves zero citations, the same role `GAPS_EMPTY` plays for zero open-rules-gaps entries.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Citation scan re-reading the command's own just-written provenance block**
- **Found during:** Task 2 GREEN run — the "running again with nothing changed" test failed with `process.exitCode` `1` instead of `undefined`.
- **Issue:** `resolveCitedSlices()` was scanning the entire `chunkText`, including a `## Verified Against` section this same command had just written. That section's explanatory comment mentioned `rulebook/INDEX.md` in prose, which the citation regex matched as an unresolved citation not present in `sliceFilenames` (INDEX.md is deliberately excluded), so `unresolved` differed between runs and `changed` never settled to `false`.
- **Fix:** Reworded the explanatory comment to avoid a literal `rulebook/<file>` path, and scoped citation scanning to only the file content before any existing `## Verified Against` heading.
- **Files modified:** `src/cli/commands/chunk-provenance.ts`
- **Verification:** Full test suite green afterward, including the specific "running again with nothing changed" test; also verified manually end-to-end against a temp fixture (see rendered-block demo above) — second run reports `✓ ... up to date` and exits 0.
- **Committed in:** `7e60de57`

**2. [Rule 1/2 - Bug + missing critical functionality] `program.parse()` leaked stack traces on any thrown Error, not just chunk-check's**
- **Found during:** Task 3 — verifying `node bin/boardsmith.js chunk-check no-such-slug ... with no stack trace in the output` (the task's own literal acceptance criterion).
- **Issue:** Commander's `program.parse()` does not await async action handlers, so a rejection (any `throw` inside an async command, including `chunkCheckCommand`'s missing-chunk error and `ingestArchiveCommand`'s pre-existing unreadable-path error, verified directly) surfaced as a raw Node unhandled-rejection stack trace naming internal file paths and line numbers.
- **Fix:** `program.parse()` → `await program.parseAsync()` wrapped in a single top-level `try`/`catch` in `cli.ts` that prints only `err.message` and sets `process.exitCode = 1`.
- **Files modified:** `src/cli/cli.ts`
- **Verification:** `node bin/boardsmith.js chunk-check no-such-slug` and `node bin/boardsmith.js ingest-archive /no/such/path.pdf` both now print a clean one-line message and exit 1 with no stack trace; `--version`, `--help`, `chunk-check --help`, and the full `npm test` suite (3376/3376) all remained green.
- **Committed in:** `778e1d07`

## Issues Encountered

None beyond the two auto-fixed items above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `chunkCheckCommand()`, `VERIFIED_AGAINST_LABELS`, `VERIFIED_AGAINST_HEADING`/`BEGIN`/`END` are all exported and ready for plan 05's `chunk-provenance-status` aggregation to parse directly — one source of truth for the label strings, no second copy.
- `~/BoardSmithGames/seven` confirmed unmodified before and after this plan's execution: `git status --porcelain` empty, HEAD still `a03f38d4792af9dfc7c798be69686fc3230f54dd`. This plan's only interaction with real reference-game data was the demo fixture built in the scratchpad temp directory (deleted after use), never `seven` or `one-two-punch`.
- The `program.parseAsync()` fix in `cli.ts` is a genuine behavioral improvement for every existing CLI command, not just `chunk-check` — worth noting for plan 06/07, which will also invoke CLI commands from skill text and benefit from clean error output on any thrown Error.
- No blockers for 171-05.

## Self-Check: PASSED

- `src/cli/commands/chunk-provenance.ts` — FOUND (`export async function chunkCheckCommand` present; `grep -c "boardsmith:verified-against:begin"` → 2; `grep -c "GAPS_BEGIN\|GAPS_END"` → 0)
- `src/cli/commands/chunk-provenance.test.ts` — FOUND (`describe('chunk-check')` present, 11 tests)
- `src/cli/cli.ts` — FOUND (`chunk-check <slug>` registered; `parseAsync` present)
- Commit `35f0b72b` — FOUND (`git log --oneline` confirms)
- Commit `7e60de57` — FOUND (`git log --oneline` confirms)
- Commit `778e1d07` — FOUND (`git log --oneline` confirms)

---
*Phase: 171-provenance-recording*
*Completed: 2026-07-28*
