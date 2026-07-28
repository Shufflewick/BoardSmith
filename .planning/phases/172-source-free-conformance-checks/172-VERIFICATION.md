---
phase: 172-source-free-conformance-checks
verified: 2026-07-28T16:20:00Z
status: passed
score: 3/3 must-haves verified
overrides_applied: 0
---

# Phase 172: Source-Free Conformance Checks Verification Report

**Phase Goal:** The two checks that need neither the ingest changes nor re-transcription exist and
are proven immediately against real games, de-risking everything downstream.
**Verified:** 2026-07-28
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `trace-check` reports every Interpretation claim's test coverage, every test's claim linkage, and every ruling's test coverage, with zero rulebook/source access | ✓ VERIFIED | Read `src/cli/commands/trace-check.ts` end to end. All three directions are implemented as distinct code paths: `claim-untested` (line 396-407, every live claim not in `claimCoverage`), citation resolution via the three-rung ladder `resolveClaimCitation` (lines 146-165, feeding `ambiguous-claim-ref`/`unresolved-claim-ref`), and `ruling-untested` (lines 418-428, every parsed `RULINGS.md` entry not in `citedRulings`, respecting supersession). Grepped the file for any read of a rulebook path — only `CHUNK.md`, `*.test.ts` files, and `RULINGS.md` are ever read (confirmed no `rulebook/` reference anywhere); this is enforced by construction (the module has no code path that opens a rulebook file), not by a flag. Confirmed via my own fresh-fixture invocation (`boardsmith trace-check --project <fixture> --json`) which correctly reported an untested claim. |
| 2 | `drift-check` reports every chunk whose Build Manifest files changed since its recorded verified commit hash, with `clean`/`drifted`/`drift-unknown` as three genuinely distinct, never-collapsed states | ✓ VERIFIED | Read `src/cli/commands/drift-check.ts` end to end. `state` is computed per chunk as one of `'clean' \| 'drifted' \| 'unknown'` (line 151); `unknown` is set via `markUnknown()` for four distinct triggers (non-tabular manifest, no recorded hash, malformed hash shape, hash not an ancestor of HEAD, or hash unresolvable by git) and is never conflated with `clean` or `drifted` anywhere in the function. Decision 12 (manifest file absent from disk is drift) is implemented unconditionally (lines 317-322) independent of the git diff. Confirmed via my own fresh-fixture invocation: a chunk whose manifest-listed test file was deleted after the verified hash correctly reported `state: "drifted"`, `missingFiles: ["tests/foo.test.ts"]`. |
| 3 | Both checks are demonstrated end-to-end against at least one reference game, surfacing real findings (not a dry no-op run) | ✓ VERIFIED | `172-PROOF.md` records 8 real invocations (4 `--json` + 4 human) against `cp -R` copies of BOTH `seven` and `one-two-punch`, all exiting 0 with substantial non-trivial findings (157/165 and 212/212 untested claims; 10/12 and 16/17 drifted chunks). Every claim/ruling/manifest/drift count is independently cross-checked by a from-scratch second computation (Python claim-count parse, `grep -c '^### Ruling '`, hand-reimplemented manifest-path extraction + `git diff`, hand-walked resolution-ladder rungs) — not the tool validating its own arithmetic. The proof is non-circular: it caught a bug in its OWN first-draft cross-check script (unscoped manifest-path regex over-counting `jab`'s manifest) and a real, narrow-impact parser defect in the tool itself (`AUTHORING_VERBS` matching "written" mid-prose), both documented prominently rather than papered over. Both reference-game originals are proven byte-identical before/after via whole-tree SHA-256 manifests (not just `git status`), satisfying the read-only requirement. |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/commands/build-manifest.ts` | Shared parser: manifest, claims, hash, rulings, `resolveManifestPath` | ✓ VERIFIED | Exists, 8 exported functions confirmed by grep, imported by both `trace-check.ts` and `drift-check.ts`. `resolveManifestPath` consolidated here post-review (was duplicated, WR-01 fixed by `a1bdb339`). |
| `src/cli/commands/trace-check.ts` | `traceCheckCommand`, citation scanner, resolution ladder | ✓ VERIFIED | Exists, read in full, all 9 `FINDING_KINDS` reachable, no mutating `fs` call. |
| `src/cli/commands/drift-check.ts` | `driftCheckCommand`, git plumbing, 3-state classification | ✓ VERIFIED | Exists, read in full, `execFile` argv-array (no shell string), `HASH_SHAPE` validated before every git call, no mutating git subcommand. |
| `src/cli/cli.ts` registration | `trace-check`/`drift-check` reachable from `node bin/boardsmith.js` | ✓ VERIFIED | `grep` confirms both `.command(...)` registrations and both imports; exercised directly against a fresh fixture with real output. |
| `src/cli/cli-conformance-commands.test.ts` | Real spawned-process exit-code proof | ✓ VERIFIED | 4 tests, all passing, spawns the real `bin/boardsmith.js` entry point. |
| `172-PROOF.md` | SC-3 real-data record against both reference games | ✓ VERIFIED | 660-line artifact, read in full; independent cross-checks, honest "what is still unproven" section, read-only invariant proven by byte-hash diff. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `trace-check.ts` | `build-manifest.ts` | `import { parseBuildManifest, parseInterpretationClaims, parseRulings, resolveManifestPath, FINDING_KINDS }` | ✓ WIRED | Confirmed import at top of file, all named imports used in the function body. |
| `drift-check.ts` | `build-manifest.ts` | `import { parseBuildManifest, extractVerifiedCommitHash, resolveManifestPath }` | ✓ WIRED | Confirmed import, all used. |
| `cli.ts` | `trace-check.ts` / `drift-check.ts` | `.command('trace-check')` / `.command('drift-check')` calling `traceCheckCommand`/`driftCheckCommand` | ✓ WIRED | Confirmed at `cli.ts:188,195`; exercised end-to-end against a live fixture in this verification. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `trace-check` surfaces a real `claim-untested` finding on a minimal fixture | `node bin/boardsmith.js trace-check --project <fixture> --json` | Correctly reported claim 2 untested, claim 1 covered via citation resolution | ✓ PASS |
| `drift-check` surfaces real drift on a minimal fixture (deleted manifest file post-verify) | `node bin/boardsmith.js drift-check --project <fixture> --json` | Correctly reported `state: "drifted"`, `missingFiles: ["tests/foo.test.ts"]` | ✓ PASS |
| `drift-check` correctly reports `clean` when nothing changed | `node bin/boardsmith.js drift-check --project <fixture> --json` (before drift commit) | `state: "clean"` | ✓ PASS |
| Full test suite green | `npm test` | 233 files, 3510 tests passed | ✓ PASS |
| Targeted phase test files green | `npx vitest run build-manifest.test.ts trace-check.test.ts drift-check.test.ts cli-conformance-commands.test.ts chunk-provenance.test.ts` | 5 files, 152 tests passed | ✓ PASS |
| `eslint` clean on all phase files | `npx eslint src/cli/commands/{trace-check,drift-check,build-manifest}.ts src/cli/cli.ts` | No output (clean) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|--------------|--------|----------|
| CHECK-03 | 172-01, 172-02 | Traceability sweep — every Interpretation claim has a citing test, every test traces to a live claim, every ruling has a test; gaps reported as findings; runs with no source present | ✓ SATISFIED | `trace-check.ts` implements all three directions; `REQUIREMENTS.md` marks `[x]`, matching implementation. |
| CHECK-05 | 172-03 | Code drift — Build Manifest files diffed against verified commit hash; drifted chunks reported | ✓ SATISFIED | `drift-check.ts` implements the diff + 3-state classification; `REQUIREMENTS.md` marks `[x]`. |

No orphaned requirements found for Phase 172 in `REQUIREMENTS.md`.

### Anti-Patterns Found

None. Scanned `trace-check.ts`, `drift-check.ts`, `build-manifest.ts`, `cli.ts` for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/empty-return stubs — none found. `172-REVIEW.md`'s two Warnings (WR-01 duplicated `resolveManifestPath`, WR-02 bolded-verb misclassification) were both closed by commit `a1bdb339`, confirmed by reading the current code: `resolveManifestPath` now lives solely in `build-manifest.ts`, and `leadingVerb()` strips `**`/`*`/`_`/backtick emphasis before matching. The two Info items (IN-01 markdown-link double-count, IN-02 hash-token truncation) remain open as documented low-risk latent gaps — neither observed on real data, both explicitly scoped as optional in the review, not blockers to this phase's goal.

The post-review defect found by the proof itself (`AUTHORING_VERBS` matching "written" mid-prose, a real false-authoring bug found via hand-walking the resolution ladder on live `seven` data) was fixed same-day by commit `dd439af3`, with a failing regression test committed first, and the fix was re-verified by re-running the full real-data proof against fresh copies of both games — every finding count identical, confirming the fix changed no verdict on live data (the affected citation was already `ambiguous-claim-ref` for other reasons).

### Human Verification Required

None. All three success criteria are objectively verifiable from code, tests, and the proof
artifact's independently cross-checked counts. The proof's own "what is still unproven" section
notes that whether the human-readable report's grouping/truncation is genuinely legible to a first-
time human reader is a judgement call the proof cannot measure — but this is not one of the phase's
stated success criteria (which concern finding coverage and demonstration against real games, not
UX legibility), so it does not block a `passed` status. It is worth a human's attention before
Phase 173 builds `/bs-verify-game` on top of these reports, but does not gate this phase's goal.

### Gaps Summary

None. All three success criteria hold under independent code reading, fresh-fixture behavioral
testing, and scrutiny of the proof's cross-check methodology. The two code-review Warnings were
real and have been closed with tests; the one defect the proof itself surfaced (parser
misclassification) was fixed same-day with a committed regression test and the real-data proof was
re-run to confirm zero verdict change. `REQUIREMENTS.md` correctly marks CHECK-03/CHECK-05 complete,
matching the implementation. The full suite is green (3510/3510, excluding an unrelated concurrent
agent's uncommitted `src/session/stateless-ops.*` changes as instructed).

---

_Verified: 2026-07-28_
_Verifier: Claude (gsd-verifier)_
