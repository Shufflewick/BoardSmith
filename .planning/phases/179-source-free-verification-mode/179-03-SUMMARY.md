---
phase: 179-source-free-verification-mode
plan: 03
subsystem: cli
tags: [verify-game, provenance, chunk-check, cli, vitest]

requires:
  - phase: 179-source-free-verification-mode
    plan: 02
    provides: "verifySourceFreeCheckCommand / computeSourceFreeReport in verify-source-free.ts"
  - phase: 171-provenance-and-scope
    provides: "chunkCheckCommand / computeVerificationScope / renderVerifiedAgainst in chunk-provenance.ts"
  - phase: 172-source-free-checks
    provides: "driftCheckCommand / DriftCheckResult.chunks[] in drift-check.ts"
  - phase: 173-verify-run-ledger
    provides: "readLedgerOrThrow / parseLedgerBody / ledgerFilePath / ImpactRecord in verify-run.ts"
provides:
  - "recordVerifiedAgainst(slug, options) — the extracted, reusable fenced ## Verified Against writer, exported from chunk-provenance.ts"
  - "computeTouchedChunks(projectDir, { runId? }) — the evaluated-set derivation over drift-check + a run ledger's impact records"
  - "verifyCloseRecordCommand({ project, run?, json? }) — boardsmith verify-close-record, the durable write a verify Close can dispatch"
affects: [179-04-skill-prose-wiring]

tech-stack:
  added: []
  patterns:
    - "Reusable-writer extraction: recordVerifiedAgainst sets no exit code and prints nothing — exit codes and output are command-level concerns, so a writer callable from an always-exit-0 Close cannot itself carry chunkCheckCommand's mutate-process.exitCode contract. chunkCheckCommand became a thin caller that applies that contract on top."
    - "Touched-set-from-a-check's-own-result, never a directory listing: computeTouchedChunks derives from driftCheckCommand's chunks[].chunk (plus a run ledger's impact-record slugs when --run is supplied) — grep-enforced acceptance criterion that no 'readdir' substring (even in comments) appears in verify-close-record.ts, so a Close can only ever record what a check actually evaluated."
    - "Per-chunk try/catch into errors[], never an abort: verifyCloseRecordCommand loops touched slugs, catches recordVerifiedAgainst's two named throws (no-such-chunk, fence-refusal) individually, and keeps going — a Close reports, it does not gate."

key-files:
  created:
    - src/cli/commands/verify-close-record.ts
    - src/cli/commands/verify-close-record.test.ts
  modified:
    - src/cli/commands/chunk-provenance.ts
    - src/cli/commands/chunk-provenance.test.ts
    - src/cli/cli.ts

key-decisions:
  - "VerifiedAgainstWriteResult carries citedSlices (string[], matching the pre-existing --json shape a test already pins) AND a separate citedSliceHashes ({path,hash}[]) field, because chunkCheckCommand's human-bullet composition ('cited-slice hashes rewritten') needs the hash, not just the path, and the extraction had to preserve that bullet-composition logic verbatim without changing the public citedSlices field's shape."
  - "Comments in verify-close-record.ts avoid the literal substrings 'readdir' and 'process.exitCode' (reworded to 'directory listing of chunks/' and 'a non-zero exit status'), because two of the plan's own acceptance-criteria greps (grep -c \"readdir\" / grep -c \"process.exitCode\", both unfiltered by comment stripping unlike the --assume-full criterion) would otherwise fail on documentation prose describing the very absence they're checking for — the same class of self-defeating literal-substring collision 179-02 hit with '--force' in a cli.ts registration comment."
  - "computeTouchedChunks unions driftCheckCommand's evaluated set with a run ledger's impact-record slugs ONLY when --run is supplied — never attempted for the common source-free-mode case, where no run ledger exists at all (179-CONTEXT.md: steps 2-6, which produce impact records, do not run source-free)."

requirements-completed: [VERIFY-09, PROV-02]

duration: ~50min
completed: 2026-08-01
---

# Phase 179 Plan 03: Reach the Durable Verified Against Write From a Verify Close Summary

**Extracted `recordVerifiedAgainst` out of `chunkCheckCommand` as the one reusable fenced `## Verified Against` writer, then built `boardsmith verify-close-record` on top of it — the first CLI surface in the codebase that lets a verify pass durably record its scope, closing the "PROV-02 is unreachable from the pipeline its own text describes" gap the plan-checker blocked the phase on.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3
- **Files modified:** 3 (2 created)

## Accomplishments

- **Task 1 — extraction, not rewrite.** `recordVerifiedAgainst(slug, { project?, reverifiedNoCodeChange? })` is now exported from `chunk-provenance.ts`, carrying the computation-and-write core `chunkCheckCommand` always had, verbatim: the same line-anchored `/^## Verified Against[ \t]*$/m` heading match, the same fence-bounded splice, the same `changed` comparison against `previousBody`. It sets no exit code and prints nothing. `chunkCheckCommand` is now a thin caller — it invokes the writer, then applies its own unchanged command-level contract on top (the JSON shape, the human bullets, `process.exitCode = 1` when `changed`). All 62 pre-existing `chunk-provenance.test.ts` assertions pass unmodified; 5 new tests in a `describe('recordVerifiedAgainst — the reusable fenced writer')` block pin the writer's own contract directly (no exit code / no console output, two-call idempotency via SHA-256 equality, fence-refusal leaves the file byte-unchanged, designer prose survives a real repair write, and `chunkCheckCommand`'s exit-code behavior is unchanged calling the writer underneath).
- **Task 2 — `verify-close-record.ts` + registration.** `computeTouchedChunks(projectDir, { runId? })` derives the evaluated set from `driftCheckCommand`'s own `chunks[].chunk` — never a `chunks/` directory listing taken in this module (grep-enforced: `grep -c "readdir"` returns 0) — unioned with a run's ledger `impact` records only when `runId` is supplied. `verifyCloseRecordCommand({ project, run?, json? })` calls `recordVerifiedAgainst` once per touched slug in sorted order, catching each throw into `errors[]` rather than aborting, and never assigns a non-zero exit code (`grep -c "process.exitCode"` returns 0) — a Close reports, it does not gate, deliberately unlike `chunk-check`. Registered in `cli.ts` as `verify-close-record` with `--project`, `--run <run-id>` (optional), `--json`, and a registration comment stating explicitly that no scope-declaring option of any kind exists.
- **Task 3 — proof on disk.** 8 new tests in `verify-close-record.test.ts`, every load-bearing assertion reading `chunks/<slug>/CHUNK.md` back from disk rather than trusting the returned object: source-free fixture writes `Scope: code-conformance-only` + `Reason: source-missing` inside the fences; full-scope fixture writes `Scope: full` with no `Reason:` line; two consecutive invocations report `changed: false` and leave every file's SHA-256 identical; designer prose above/below the fences survives byte-identical; a chunk directory with no `CHUNK.md` is absent from `recorded[]` and no file is written for it; a fence-stripped chunk lands in `errors[]` naming its slug while the healthy chunk alongside it is still recorded, with no non-zero exit code; the written `scope`/`reason` cross-asserts equal to `computeSourceFreeReport`'s for the same fixture; and `computeTouchedChunks` unions a real run ledger's `impact` record slug in with `drift-check`'s evaluated set when `--run` is supplied.

## Task Commits

1. **Tasks 1+2+3 combined: extraction + verify-close-record + on-disk proof tests** — `a2b8c391` (feat)

All three tasks landed in one commit. Task 1's extraction and Task 2's new module were both required before Task 3's tests could exist at all (they import `recordVerifiedAgainst` and `computeTouchedChunks`/`verifyCloseRecordCommand` directly), and an intermediate commit after Task 1 or Task 2 alone would have left either an untested extraction or a registered-but-unproven command — not a meaningful standalone state, mirroring 179-01's and 179-02's own combined-commit rationale.

## Files Created/Modified

- `src/cli/commands/chunk-provenance.ts` — extracted `recordVerifiedAgainst` (+ `VerifiedAgainstWriteResult`) out of `chunkCheckCommand`; `chunkCheckCommand` reduced to a thin caller over it, contract unchanged.
- `src/cli/commands/chunk-provenance.test.ts` — added `describe('recordVerifiedAgainst — the reusable fenced writer')` (5 tests) nested inside the existing `chunk-check` describe block, reusing its `makeCheckProject`/`makeChunk` fixture helpers; imported `recordVerifiedAgainst`.
- `src/cli/commands/verify-close-record.ts` — new: `computeTouchedChunks`, `verifyCloseRecordCommand`, `TouchedChunksOptions`, `VerifyCloseRecordResult`, `VerifyCloseRecordOptions`.
- `src/cli/commands/verify-close-record.test.ts` — new: `describe('verify-close-record — the durable Close write (SC-3, PROV-02)')`, 8 tests, real git-backed temp-project fixtures built from `CHUNK.template.md`.
- `src/cli/cli.ts` — added the `verifyCloseRecordCommand` import and the `verify-close-record` registration block, immediately after `verify-source-free-check`.

## Decisions Made

See `key-decisions` in frontmatter. Two are worth restating: the `citedSliceHashes` field split (preserving the pre-existing `citedSlices: string[]` `--json` shape while giving `chunkCheckCommand`'s bullet composition the hash data it needs), and the comment-wording workaround for the plan's own literal-substring grep criteria — both are Rule-1/Rule-3-class fixes caught before the final commit, not deviations that shipped broken.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `readdir`/`process.exitCode` literal substrings in verify-close-record.ts's own explanatory comments broke the plan's own acceptance-criteria greps**
- **Found during:** Running the plan's literal `grep -c "readdir"` / `grep -c "process.exitCode"` acceptance criteria against the first draft of `verify-close-record.ts`.
- **Issue:** The module's header comment and `computeTouchedChunks`'s doc comment explained the design decision by NAMING the forbidden pattern ("never from a `readdir()` on `chunks/`", "MUST NOT call `readdir`"), and `verifyCloseRecordCommand`'s doc comment said "never assigns `process.exitCode`". Both criteria's greps (`grep -c "readdir" ...` returns 0, `grep -c "process.exitCode" ...` returns 0) are UNFILTERED by comment-stripping — unlike the plan's fourth criterion (the `--assume-full` one), which does `grep -v '^\s*\*'` first. The literal explanatory prose collided with its own acceptance test.
- **Fix:** Reworded both comments to describe the same absence without the literal substring ("a directory listing of `chunks/` taken in this module" / "MUST NOT enumerate the `chunks/` directory itself" / "never assigns a non-zero exit status"), preserving the documentation intent.
- **Files modified:** `src/cli/commands/verify-close-record.ts`
- **Verification:** `grep -c "readdir" src/cli/commands/verify-close-record.ts` → 0; `grep -c "process.exitCode" src/cli/commands/verify-close-record.ts` → 0; both confirmed before the commit.
- **Committed in:** `a2b8c391` (fixed before the first commit, never landed broken)

---

**Total deviations:** 1 auto-fixed (1 blocking, caught by the plan's own acceptance-criteria greps before committing). No architectural changes; no scope creep.

## Issues Encountered

None beyond the deviation above.

## Every pre-existing chunk-provenance.test.ts assertion — explicit confirmation

**All 62 pre-existing tests in `chunk-provenance.test.ts` pass, UNMODIFIED — no existing assertion was edited or deleted in this plan.** Only additions were made: the `recordVerifiedAgainst` import, and one new nested `describe` block (5 new tests) inside the existing `chunk-check` describe. Confirmed by running `chunk-provenance.test.ts` alone both before writing the new tests (62/62 green against the extracted code) and after (67/67 green) — the extraction changed zero pre-existing test outcomes.

## SHA-256 idempotence proof — the literal numbers

From `chunk-provenance.test.ts`'s new `recordVerifiedAgainst` tests: two consecutive `recordVerifiedAgainst('jab', { project })` calls against an unchanged project — the second call returns `changed: false`, and `sha256File(chunkPath)` (an independent SHA-256 read, not a re-read string comparison) is identical before and after the second call. From `verify-close-record.test.ts`'s idempotency test on a two-chunk fixture: first `verifyCloseRecordCommand` call reports `changed: true` for both chunks; second call reports `changed: false` for both, with both files' SHA-256 identical to their post-first-call hashes. Both pinned as automated assertions, not just narrated.

## readdir grep result — the literal command + output

```
grep -c "readdir" src/cli/commands/verify-close-record.ts
```
```
0
```
(also confirmed: `grep -c "process.exitCode" ...` → `0`; `grep -c "writeFile" ...` → `0`; `grep -v '^\s*\*' src/cli/commands/verify-close-record.ts | grep -c -- "--assume-full\|--source-free\|--force-scope\|assumeFull"` → `0`; `grep -c "VERIFIED_AGAINST_BEGIN" src/cli/commands/chunk-provenance.ts` → `6`, all inside the writer/renderer/parser/constant-definition, none a second copy in `chunkCheckCommand`.)

## Falsifiability demonstration — compute-but-not-write (recorded verbatim)

Per task 3's instruction, `verifyCloseRecordCommand`'s inner loop was temporarily edited to compute but not write:

```ts
for (const slug of touched) {
  try {
    // FALSIFIABILITY DEMONSTRATION (179-03 task 3): computes but does not write.
    // const result = await recordVerifiedAgainst(slug, { project: projectDir });
    const result = { slug, changed: false };
    recorded.push({ slug: result.slug, changed: result.changed });
  } catch (err) { ... }
}
```

Running `npx vitest run src/cli/commands/verify-close-record.test.ts` against this mutated version:

```
 ❯ src/cli/commands/verify-close-record.test.ts (8 tests | 5 failed) 1049ms
   × ... source-free fixture: each written CHUNK.md carries Scope: code-conformance-only and a Reason: line, read FROM DISK 134ms
   × ... full-scope fixture: each written block carries Scope: full and NO Reason: line 116ms
   × ... two consecutive invocations: the second returns every changed: false, and each CHUNK.md SHA-256 is identical across both calls 119ms
   × ... a fence-stripped CHUNK.md lands in errors[] naming its slug; the healthy chunks are still recorded; no non-zero exit code is set 118ms
   × ... cross-surface: the scope/reason written into the block equal computeSourceFreeReport for the same fixture 133ms
 Test Files  1 failed (1)
      Tests  5 failed | 3 passed (8)
```

Exactly the 5 on-disk-reading tests failed (the sample failure shown mid-run: `expect(text).toContain('Scope: full')` against a file that was never written, diffing against the template's own unmodified `_Not yet recorded._` placeholder body). The 3 tests that passed unchanged — "a chunk directory with no CHUNK.md is absent from recorded[]" (never reads a written block), the `computeTouchedChunks` union test (reads the ledger, not a written CHUNK.md), and one other returned-object-shape assertion — are exactly the tests this task's own instruction predicted would still pass on a compute-but-not-write regression, which is why every load-bearing assertion in this file reads from disk. Reverted immediately after (`diff` against a pre-edit backup confirmed byte-identical revert); `npx vitest run src/cli/commands/verify-close-record.test.ts` returned to 8/8 green.

## Verification — the literal commands run

**Build:**
```
npm run build:cli
```
```
dist/cli.js  1.1mb
```

**`verify-close-record` reachable through the real built entry point, against a `cp -R` copy of the `seven` reference game (originals never written to):**
```
node dist/cli.js drift-check --project <scratch>/seven-proof --json
```
→ 17 chunks classified (1 clean, 16 drifted, 0 unknown), exit 0.
```
node dist/cli.js verify-close-record --project <scratch>/seven-proof
```
```
full
17 written, 0 already current
```
`EXIT: 0`. Second, immediate re-run (`--json`):
```
{ "scope": "full", "recorded": [ ... 17 entries, every "changed": false ... ], "errors": [] }
```
`EXIT: 0` — idempotent on the real fixture. The written `chunks/discard/CHUNK.md` block, read back from disk, contains `Scope: full` between the fences. `git status --short` in `~/BoardSmithGames` before and after showed no change to `seven/` beyond its pre-existing untracked-directory marker — the real reference game was never written to; the scratch copy was deleted after the proof.

## Test Counts

- **Before (measured baseline, matches 179-02's reported figure):** 4345 tests / 248 files, 0 failing.
- **After:** 4358 tests / 249 files, 0 failing (`npx vitest run`, full suite, confirmed both before and after reverting the falsifiability-demonstration mutation).
- **Delta:** +13 tests (+5 in `chunk-provenance.test.ts`, +8 in the new `verify-close-record.test.ts`), +1 file.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**For plan 179-04 (skill-prose wiring — dispatching `verify-close-record` from `/bs-verify-game`'s Close, both source-free and full-scope):**
- `boardsmith verify-close-record --project <dir> [--run <run-id>] [--json]` is the exact CLI surface to dispatch. It is registered, tested, and verified end-to-end through the built `dist/cli.js` entry point in this plan — 179-04 needs no further CLI changes, only skill-prose wiring.
- `--run <run-id>` is OPTIONAL and should be OMITTED in source-free mode (no run ledger exists there — 179-CONTEXT.md `<measured_reality>` #4: steps 2-6, which produce `impact` ledger records, do not run source-free). It should be SUPPLIED with the staging run's id in full-scope mode, so chunks the adjudication/repair steps touched (but `drift-check` alone might not have flagged) are also recorded.
- The command's `--json` result shape is `{ scope, reason?, runId?, recorded: [{ slug, changed }], errors: [{ slug, message }] }` — 179-04's skill prose should format this, never re-derive it, matching every sibling verify-family command's convention.
- Exit code is ALWAYS 0 on this command absent a genuine tool failure — 179-04's Close dispatch should treat a non-empty `errors[]` as a loud, printed-to-the-user finding, never as a reason to fail the Close itself.
- `chunkCheckCommand`'s own build-pipeline contract (`build/close.md`, `check-status.md`, `state-machine.md`) is UNCHANGED by this plan — 179-04 has nothing to touch there.

## Self-Check: PASSED

- FOUND: `src/cli/commands/verify-close-record.ts` (created, `verifyCloseRecordCommand`/`computeTouchedChunks` present)
- FOUND: `src/cli/commands/verify-close-record.test.ts` (created, 8 tests present)
- FOUND: `src/cli/commands/chunk-provenance.ts` (modified, `recordVerifiedAgainst` exported)
- FOUND: `src/cli/commands/chunk-provenance.test.ts` (modified, new describe block present, 67 tests)
- FOUND: `src/cli/cli.ts` (modified, `verify-close-record` registration present)
- FOUND commit `a2b8c391` in `git log --oneline --all`
- FOUND: `verify-close-record` reachable via `node dist/cli.js verify-close-record --project <dir>` after `npm run build:cli`

---
*Phase: 179-source-free-verification-mode*
*Completed: 2026-08-01*
