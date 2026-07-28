---
phase: 171-provenance-recording
plan: 03
subsystem: cli
tags: [provenance, verification-scope, citation-resolution, chunk-provenance]

# Dependency graph
requires:
  - phase: 171-provenance-recording
    plan: 01
    provides: "normalizeEdition() / EDITION_UNKNOWN sentinel — used to normalize INDEX.md's Edition: value when read back"
  - phase: 171-provenance-recording
    plan: 02
    provides: "hashSkillsTree() / readBoardsmithVersion() (not consumed by this plan directly — will be consumed by plan 04's ## Verified Against writer)"
provides:
  - "computeVerificationScope(projectDir) — disk-only, single-parameter, five-reason-code scope computation"
  - "resolveCitedSlices(chunkText, sliceFilenames) — citation recovery from existing CHUNK.md prose, with visible unresolved citations"
  - "SCOPE_FULL, SCOPE_CODE_ONLY, SCOPE_REASONS, ScopeReason, VerificationScope exported from chunk-provenance.ts"
affects: ["171-04 (chunk-check writer)", "171-05 (chunk-provenance-status aggregation)", "PROV-01", "PROV-02"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single top-to-bottom early-return precedence chain for a 5-way enumerated classification (no nested conditionals) — the order itself is part of the contract"
    - "Regex character-class exclusion as the stripping mechanism: excluding markdown/punctuation characters from the citation-token character class means most trailing-punctuation variants never need explicit stripping code"
    - "Unresolvable-input-recorded-verbatim rather than silently dropped or guessed — same shape as Phase 170's fenced machine-owned sections, applied to a parsing problem instead of a write problem"

key-files:
  created:
    - src/cli/commands/chunk-provenance.ts
    - src/cli/commands/chunk-provenance.test.ts

key-decisions:
  - "computeVerificationScope() takes ONE parameter (projectDir); VerificationScope's edition/sourcePath/sourceHash fields are optional since no-rulebook-project and index-missing states have no INDEX.md to read them from at all."
  - "resolveCitedSlices()'s citation-token regex (`rulebook/[A-Za-z0-9._-]+`) deliberately excludes `*`, `}`, `,`, and `'` from its character class. This means the plan's listed trailing-punctuation variants (**, }, possessive) resolve correctly with NO explicit stripping code — the regex boundary does the work. Only a trailing '.' needed explicit stripping, because '.' is also the legitimate .md extension separator and can't be excluded from the class."
  - "Unresolved citations are recorded as the post-period-stripped token (e.g. 'rulebook/01' not 'rulebook/01.') — the sentence-ending period is not part of the citation itself, so stripping it produces a more accurate 'verbatim' record than keeping accidental trailing punctuation that was never part of the reference."
  - "Fixed one test assertion during GREEN: the API-shape test's grep for a scope-override parameter used a substring match on `scope:` that false-failed against the function's own legitimate `scope: SCOPE_CODE_ONLY` return-object properties. Replaced with the plan's own literal acceptance-criteria pattern (`scope:.*param`, applied after stripping comment lines) — the actual contract this test is meant to pin."

requirements-completed: [PROV-02, PROV-01]

# Metrics
duration: ~20min
completed: 2026-07-28
---

# Phase 171 Plan 03: computeVerificationScope + resolveCitedSlices Summary

**Two pure functions in a new `chunk-provenance.ts`: `computeVerificationScope()` computes a five-reason-code verification scope from disk state alone (never a caller-declared value), and `resolveCitedSlices()` recovers a chunk's cited rulebook slices from its existing prose, recording anything unresolvable verbatim rather than dropping it — including the genuinely ambiguous two-`01-`-slice collision in `seven`.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-28T~12:58:00Z (approx)
- **Completed:** 2026-07-28T~13:18:00Z (approx)
- **Tasks:** 2 (RED for both functions' tests together, GREEN for both implementations together — plan's Task 1/2/3 boundary was collapsed into a single RED commit and a single GREEN commit since both functions live in one file and were driven together; see Deviations)
- **Files modified:** 2 (both created)

## Task Commits

1. **RED — pin five reason codes, full-requires-both invariant, API shape, and citation resolution (all in one test file)** — `8d0e2c80` (test)
2. **GREEN — computeVerificationScope + resolveCitedSlices, both implemented and passing** — `8f9879ed` (feat)

## RED Observation (mandatory per 171-VALIDATION.md)

Command: `npx vitest run src/cli/commands/chunk-provenance.test.ts -t "scope"` (before `chunk-provenance.ts` existed)

```
 RUN  v2.1.9 /Users/jtsmith/BoardSmith

 ❯ src/cli/commands/chunk-provenance.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/cli/commands/chunk-provenance.test.ts [ src/cli/commands/chunk-provenance.test.ts ]
Error: Failed to load url ./chunk-provenance.js (resolved id: ./chunk-provenance.js) in
/Users/jtsmith/BoardSmith/src/cli/commands/chunk-provenance.test.ts. Does the file exist?
 ❯ loadAndTransform node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

 Test Files  1 failed (1)
      Tests  no tests
```

This confirms `computeVerificationScope` and `resolveCitedSlices` were both unresolved before Task 2's implementation landed — the whole test file failed to even load.

## GREEN Result

Command: `npx vitest run src/cli/commands/chunk-provenance.test.ts`

```
 RUN  v2.1.9 /Users/jtsmith/BoardSmith

 ✓ src/cli/commands/chunk-provenance.test.ts (21 tests) 26ms

 Test Files  1 passed (1)
      Tests  21 passed (21)
```

Full suite: `npm test` → **229 test files / 3365 tests passed** (baseline at phase-03 start was 228 files / 3344 tests, carried in from 171-02's SUMMARY; net **+21** from this plan's new cases — 12 in the `computeVerificationScope — scope` describe block, 9 in `cited slices — resolveCitedSlices` — 0 regressed).

`npx tsc --noEmit` reports one pre-existing, out-of-scope error (`docs/seed-to-state.test.ts` rootDir mismatch, logged by 171-02's `deferred-items.md`, introduced in phase 168) — confirmed unrelated by grepping for `chunk-provenance` in the tsc output (no match).

## The ambiguous-`01-` case

`seven/rulebook/` has two slices beginning `01-`: `01-definitions-and-components.md` and `01-overview-setup-and-play.md`. A test fixture citing `rulebook/01, Setup section` against `seven`'s real directory listing asserts:
- `unresolved` contains `'rulebook/01'`
- `resolved` contains NEITHER `01-definitions-and-components.md` NOR `01-overview-setup-and-play.md`
- `resolved` is empty for that fixture

This is enforced structurally, not by convention: `resolveCitedSlices`'s shorthand branch treats `candidates.length === 1` as the only resolvable case — zero or two-or-more candidates both fall through to `unresolved`. There is no tie-breaking logic (no "pick the first", no "pick lexicographically first") anywhere in the implementation, so this behavior cannot silently regress into a guess.

## Files Created/Modified

- `src/cli/commands/chunk-provenance.ts` — new. `SCOPE_FULL`, `SCOPE_CODE_ONLY`, `SCOPE_REASONS`, `ScopeReason`, `VerificationScope`, `computeVerificationScope()`, `resolveCitedSlices()`.
- `src/cli/commands/chunk-provenance.test.ts` — new. `describe('computeVerificationScope — scope')` (12 tests: one per reason code, two invariants, API-shape, edition-anchor, edition-normalization-in-reduced-scope, and a `SCOPE_REASONS` contents check) and `describe('cited slices — resolveCitedSlices')` (9 tests, fixtures copied verbatim from real `one-two-punch` chunk prose and `seven`'s real slice listing).

## Decisions Made

- `VerificationScope`'s `edition`/`sourcePath`/`sourceHash` fields are optional (not always present) — `no-rulebook-project` and `index-missing` states have no `INDEX.md` at all to read them from. The plan's interface description (`{ scope, reason?, edition, sourcePath, sourceHash }`) is read as describing the fields that exist once an `INDEX.md` is present, not as mandating non-optional types across every reason code — making `edition` non-optional would force a fabricated value for the two earliest-precedence reasons, which the project's no-fallback-data rule forbids.
- Citation-token stripping relies on regex character-class exclusion rather than explicit post-match trimming wherever possible: `*`, `}`, `,`, and `'` are simply not in the token character class, so `rulebook/02-x.md**`, `{rulebook/01-...md}`, and `rulebook/02's` all produce a clean token by construction. Only the trailing sentence-period case (`rulebook/01.`) needed an explicit strip loop, because `.` must remain in the class for `.md` extensions to match at all.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] API-shape test's substring grep false-failed against the function's own legitimate code**
- **Found during:** GREEN run (`npx vitest run src/cli/commands/chunk-provenance.test.ts`)
- **Issue:** The RED-phase test asserted `source).not.toMatch(/\bscope\s*:/)` against the whole file — but `computeVerificationScope`'s own return statements legitimately contain `scope: SCOPE_CODE_ONLY` and `scope: SCOPE_FULL` as object-literal properties. The test as originally written could never pass against any correct implementation.
- **Fix:** Replaced the substring check with the plan's own literal acceptance-criteria expression — `grep -v '^\s*[*/]' ... | grep -c "assumeFull\|forceScope\|scope:.*param"` — reimplemented in the test as a comment-stripped-then-pattern-matched assertion (`scope:.*param`, `assumeFull`, `forceScope`). This is the actual contract the plan specifies; the substring version I wrote first was stricter than the plan intended.
- **Files modified:** `src/cli/commands/chunk-provenance.test.ts`
- **Verification:** Full suite green afterward; `computeVerificationScope.length === 1` still asserted and still passes; the corrected pattern still fails if a real `assumeFull`/`forceScope`/scope-typed-parameter were introduced (verified by temporarily adding `function foo(scope: string)` to a scratch copy and confirming the test failed, then discarding the scratch edit).
- **Committed in:** `8f9879ed`

**2. [Deviation from plan's task-boundary structure, not a Rule 1-4 fix] Tasks 1–3 executed as two commits, not three**
- **Found during:** planning the execution sequence
- **Issue:** The plan's Task 1 (RED for scope only) / Task 2 (GREEN for scope only) / Task 3 (RED+GREEN for `resolveCitedSlices`) split would have required either (a) a second RED observation cycle for Task 3's citation tests running against an already-existing `chunk-provenance.ts` with a real `computeVerificationScope`, or (b) writing the citation tests into a separate temporary file first. Both functions live in one file per the plan's own `<action>` text ("Add to `src/cli/commands/chunk-provenance.ts`"), and the plan's Wave 0 / RED-First table already lists both functions' RED obligations under the same single quick-run command.
- **Resolution:** Wrote all scope tests AND all citation tests into `chunk-provenance.test.ts` before any implementation existed, observed the single combined RED (whole file fails to load — a stronger RED than function-not-found, since it also proves `resolveCitedSlices` doesn't exist), then implemented both functions together and observed the single combined GREEN. This satisfies the RED-FIRST discipline (171-VALIDATION.md) for both functions equally — neither implementation existed when its tests were written — while producing two commits instead of three. No task's acceptance criteria were skipped; all are verified in the test file as written.
- **Impact:** None on scope or verification depth — every `<behavior>` bullet from all three tasks has a corresponding test, and every acceptance-criteria check (arity, grep pattern, `pre-provenance-project` count, ambiguous-shorthand assertions) is present and passing.

---

**Total deviations:** 1 auto-fixed test bug (Rule 1), 1 task-boundary consolidation (documented above, not a Rule 1-4 category — no plan instruction was worked around silently, the RED-FIRST discipline was preserved for both functions).

## Issues Encountered

None beyond the two items above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `computeVerificationScope()` and `resolveCitedSlices()` are both exported and ready for plan 04's `chunk-check` writer to import directly — neither performs any file write, per this plan's explicit scope boundary.
- `~/BoardSmithGames/seven` confirmed unmodified: `git status --porcelain` empty, HEAD still `a03f38d4792af9dfc7c798be69686fc3230f54dd` (verified after this plan's execution — this plan only read `seven`'s and `one-two-punch`'s real files to build test fixtures, via `ls`/`cat`/`grep`, never wrote to either).
- `~/BoardSmithGames/one-two-punch` was also read-only throughout (same commands).
- No blockers for 171-04.

## Self-Check: PASSED

- `src/cli/commands/chunk-provenance.ts` — FOUND (`export function resolveCitedSlices` and `export async function computeVerificationScope` both present)
- `src/cli/commands/chunk-provenance.test.ts` — FOUND (`describe('cited slices — resolveCitedSlices')` present, `grep -c "pre-provenance-project"` → 3, ≥ 1 required)
- Commit `8d0e2c80` — FOUND (`git log --oneline` confirms)
- Commit `8f9879ed` — FOUND (`git log --oneline` confirms)

---
*Phase: 171-provenance-recording*
*Completed: 2026-07-28*
