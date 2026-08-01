---
phase: 179-source-free-verification-mode
plan: 04
subsystem: cli
tags: [verify-game, source-free, provenance, chunk-check, skill-prose, vitest]

requires:
  - phase: 179-source-free-verification-mode
    plan: 03
    provides: "boardsmith verify-close-record --project <dir> [--run <run-id>] [--json]"
  - phase: 179-source-free-verification-mode
    plan: 02
    provides: "boardsmith verify-source-free-check --json / VERIFY_PIPELINE_STEPS in verify-source-free.ts"
provides:
  - "verify/source-free-mode.md — the reduced sequence a source-free project runs, dispatched automatically from source-resolution.md's negative case"
  - "Both /bs-verify-game Closes (full-scope Step 9, source-free's own Close) dispatch verify-close-record, so a verify pass durably records what it verified against"
affects: [179-05-pre-registration]

tech-stack:
  added: []
  patterns:
    - "Reference-file-by-pointer, never by copy: source-free-mode.md cites verify-game.md's Step 7/8 by reference for CHECK-04/CHECK-06 rather than restating their dispatch sequences — same discipline repair-dispatch.md and adjudication-gate.md already hold."
    - "Section-scoped regression pins, not whole-file toContain: the Close-dispatch pins extract '## Step 9: Close' (up to '## Reference Files') and source-free-mode.md's '## Close' section before asserting — a dispatch that drifted into the Reference Files list still fails the pin, which a whole-file toContain would not catch."
    - "Cross-file negation pin across the code/prose boundary: imports VERIFY_PIPELINE_STEPS from verify-source-free.ts and scans every .md under src/cli/slash-command/ for a hardcoded defectClass string, enforcing decision 5's single-definition rule at the code/prose seam rather than only within skill prose."

key-files:
  created:
    - src/cli/slash-command/bs/verify/source-free-mode.md
  modified:
    - src/cli/slash-command/bs/verify/source-resolution.md
    - src/cli/slash-command/bs/verify-game.md
    - src/cli/commands/install-claude-command.ts
    - src/cli/slash-command/bs/verify.test.ts
    - src/cli/commands/install-claude-command.test.ts

key-decisions:
  - "source-free-mode.md's Close dispatch omits --run entirely (never an empty-string or placeholder value) because source-free mode never allocates a staging run — there is no ledger id to name, matching 179-03's own SUMMARY guidance verbatim."
  - "verify-game.md's Step 9 gained exactly ONE new bullet (the verify-close-record dispatch), placed immediately before the commit bullet, plus one trailing paragraph stating the source-free variant (no --run, code-conformance-only scope) — kept as an addition to the existing Close rather than a forked second Close, so a reader sees both call sites' shared identity (same command, same JSON contract) rather than two independently-evolving write paths."
  - "ALL_VERIFY_FILES (verify.test.ts) gained 'verify/source-free-mode.md' as a new entry, which automatically pulled the new file into three pre-existing cross-file sweeps (no --apply/promote/cutover, no staleness-derivation prose, every verify-* mention registered in cli.ts) at zero additional authoring cost — those sweeps needed no change themselves."

requirements-completed: [VERIFY-09, PROV-02]

duration: ~40min
completed: 2026-07-31
---

# Phase 179 Plan 04: The Behavioural Change — Source-Free Mode Entry + Both Closes Write Provenance Summary

**`source-resolution.md`'s negative case now dispatches into the new `verify/source-free-mode.md` instead of stopping the session, and both `/bs-verify-game` Closes — the full-scope Step 9 and source-free mode's own — now dispatch `verify-close-record`, so a verify pass durably records `## Verified Against` for the first time in this pipeline's history.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3
- **Files modified:** 6 (1 created)

## Accomplishments

- **Task 1 — `verify/source-free-mode.md` (96 lines).** New reference file, cited by pointer only — no fork of `verify-game.md` Step 7/8's dispatch sequences, no hand-authored defect-class list. States the entry condition as a consequence of disk state ("there is no flag anywhere in this skill that enters this file"), names why Steps 2-6 have no input (each consumes a fresh re-transcription; none exists), lists the four checks that still run (`trace-check`, `drift-check`, Step 7 CHECK-04, Step 8 CHECK-06) in order, formats `uncheckedDefectClasses[]` from `verify-source-free-check --json` rather than restating `VERIFY_PIPELINE_STEPS`'s prose, and closes by dispatching `boardsmith verify-close-record --project <dir>` with no `--run` — stating explicitly this write is what makes SC-3 true for the source-free path.
- **Task 2 — the negative case's consequence changed at exactly one place; Step 9 gained the durable write.** `source-resolution.md`'s Negative case body was replaced in place: detection unchanged, the two retired "does not exist yet" / "do not improvise" sentences deleted per No Backward Compatibility, replaced with a dispatch to `source-free-mode.md`. `verify-game.md` gained: a Step 1 sentence naming the source-free continuation, a Step 2 opener stating Steps 2-6 do not run source-free and why, a new Close bullet (before the commit bullet) dispatching `verify-close-record --project <project> --run <run-id>` with the "why this bullet exists at all" sentence the plan required, a trailing Close paragraph covering the source-free variant (no `--run`, `code-conformance-only` scope, unchecked classes formatted from the same command), and a new `## Reference Files` entry. `install-claude-command.ts`'s `SHARED_LEAF_PROBES` gained `source-free-mode.md`.
- **Task 3 — regression pins + two live falsifiability demonstrations.** Added `describe('verify/source-free-mode.md — the reduced pass (decisions 1-8) (179-04)')` (7 assertions) and `describe('the durable Close write — both Closes dispatch it (179-04)')` (3 assertions) to `verify.test.ts`; added `source-free-mode.md` assertions at all three pre-existing `source-resolution.md` install-test sites in `install-claude-command.test.ts`. Also added `verify/source-free-mode.md` to `ALL_VERIFY_FILES`, pulling the new file into three pre-existing cross-file sweeps for free. Both falsifiability demonstrations were run against the REAL files on disk (not just simulated in-test), captured verbatim below, and reverted byte-identical (confirmed by `diff`).

## Task Commits

1. **Tasks 1+2+3 combined** — `73b689eb` (feat)

All three tasks landed in one commit: Task 3's pins directly assert against Task 1's and Task 2's prose (extracted Close sections, exact sentences), so an intermediate commit after Task 1 or Task 2 alone would have left either an unpinned new file or an unpinned prose change — not a meaningful standalone state, mirroring 179-03's own combined-commit rationale.

## Files Created/Modified

- `src/cli/slash-command/bs/verify/source-free-mode.md` — new, 96 lines: entry condition, Steps-2-6-have-no-input, the four-check reduced sequence, the formatted unchecked-classes report, the Close (dispatches `verify-close-record` with no `--run`).
- `src/cli/slash-command/bs/verify/source-resolution.md` — Negative case body replaced: STOP → dispatch to `source-free-mode.md`; the two retired sentences deleted.
- `src/cli/slash-command/bs/verify-game.md` — Step 1 sentence, Step 2 opener sentence, Step 9 Close gained a `verify-close-record` bullet + source-free-variant paragraph, `## Reference Files` gained an entry.
- `src/cli/commands/install-claude-command.ts` — `SHARED_LEAF_PROBES` gained `join(SHARED_ROOT, 'verify', 'source-free-mode.md')`.
- `src/cli/slash-command/bs/verify.test.ts` — `ALL_VERIFY_FILES` gained the new file; two new `describe` blocks (10 new tests total).
- `src/cli/commands/install-claude-command.test.ts` — `source-free-mode.md` assertions added at the empty-shared-dir-repair, partial-verify-dir-repair, and uninstall-no-orphan sites.

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

None — the plan's tasks, read_first list, and acceptance criteria mapped directly onto the work with no auto-fixes, no architectural questions, and no scope changes. All 22 acceptance-criteria greps across both tasks passed on first check.

## Falsifiability Demonstration 1 — the cross-file negation pin (decision 5's single-definition rule)

Per task 3's instruction, `rulebook-fidelity drift between the live rules text and the source rulebook` (the first `defectClass` string in `VERIFY_PIPELINE_STEPS`) was pasted verbatim into the REAL `source-free-mode.md` on disk:

```bash
printf '\n\n<!-- regression probe: rulebook-fidelity drift between the live rules text and the source rulebook -->\n' >> src/cli/slash-command/bs/verify/source-free-mode.md
npx vitest run src/cli/slash-command/bs/verify.test.ts -t "single-definition rule"
```

Verbatim failure:

```
 ❯ src/cli/slash-command/bs/verify.test.ts:1393:26
    1391|       const text = readFileSync(file, 'utf-8');
    1392|       for (const defectClass of defectClasses) {
    1393|         expect(text).not.toContain(defectClass);
       |                          ^
    1394|       }
    1395|     }

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 145 skipped (146)
```

Reverted via `cp` from a pre-edit backup in the scratchpad; `diff` confirmed byte-identical; re-run of the same test returned to green (`1 passed | 145 skipped`).

## Falsifiability Demonstration 2 — the Close-dispatch pin on verify-game.md (decision-required per T-179-19)

Per task 3's instruction, the `verify-close-record` dispatch bullet (the full 9-line bullet, including its trailing "Place this bullet before the commit bullet" sentence) was deleted verbatim from the REAL `verify-game.md` on disk via a Python script matching the exact string:

```bash
python3 -c "... text.replace(dispatch_bullet, '') ..."
npx vitest run src/cli/slash-command/bs/verify.test.ts -t "Step 9's Close section"
```

Verbatim failure:

```
 ❯ src/cli/slash-command/bs/verify.test.ts:1429:19
    1427|   it('verify-game.md Step 9\'s Close section (extracted, not the whole…
    1428|     const step9 = verifyGameStep9Close();
    1429|     expect(step9).toContain('boardsmith verify-close-record --project …
       |                   ^
    1430|     const dispatchIdx = step9.indexOf('verify-close-record');
    1431|     const commitIdx = step9.indexOf('Commit per');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 145 skipped (146)
```

Reverted via `cp` from a pre-edit backup; `diff` confirmed byte-identical; full `verify.test.ts` re-run returned to `146 passed`.

A third, in-suite (not disk-mutating) test proves the extraction is load-bearing in the opposite direction: it constructs a mutated copy of `verify-game.md`'s text where the dispatch bullet has moved OUT of the Close section into a trailing comment, shows a whole-file `toContain` STILL passes on that mutated text (the substring is still present somewhere in the file), and shows the section-scoped extraction of `## Step 9: Close` correctly does NOT contain it — the exact "dispatch drifted into the Reference Files list" failure mode T-179-19 names.

## Both Closes confirmed dispatching the write

- `verify-game.md` Step 9's Close: `boardsmith verify-close-record --project <project> --run <run-id>`, placed before the `Commit per` bullet (both position and content pinned).
- `verify/source-free-mode.md`'s Close: `boardsmith verify-close-record --project <dir>` — no `--run` anywhere near the dispatch (pinned by a negative regex asserting `verify-close-record` is never followed by `--run` before the next newline).

## Test Counts

- **Before (baseline, per plan's stated figure, confirmed against 179-03's own reported after-count):** 4358 tests / 249 files, 0 failing.
- **After (`npx vitest run`, full suite):** 4368 tests / 249 files, 0 failing.
- **Delta:** +10 tests (all in `verify.test.ts`'s two new `describe` blocks — `install-claude-command.test.ts` gained assertions inside existing `it` blocks, not new tests), +0 files.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

**For plan 179-05 (pre-registration, committed alone before the run):**
- This plan's behavioural change is fully live: a project with no candidate source anywhere now enters `verify/source-free-mode.md` automatically and completes a reduced pass rather than stopping.
- The four source-free checks source-free mode runs are, in dispatch order: `trace-check --json` (CHECK-03), `drift-check --json` (CHECK-05), `verify-game.md` Step 7 unchanged (CHECK-04), `verify-game.md` Step 8 unchanged (CHECK-06).
- The Close dispatches `boardsmith verify-close-record --project <dir>` (no `--run`) and writes `scope: code-conformance-only` + a `Reason:` line into each evaluated chunk's `CHUNK.md`, inside the fenced `## Verified Against` block — 179-05's pre-registered expectations for "(c) the provenance block records `code-conformance-only`" should assert against that literal fenced text, read back from disk, matching 179-03's own on-disk-read discipline.
- Decision 11(d) — "the checks that DID run produced real findings" — is NOT proven by this plan; this plan is skill-prose wiring only, verified by structural/regression pins against the prose, not by a live run against a staged source-free project. 179-05/06's proof is the live-session evidence this plan's own file-header caveat (borrowed from `verify.test.ts`'s own top-of-file note) says these structural pins cannot substitute for.
- No CLI changes were needed or made in this plan, confirming 179-03's own "179-04 needs no further CLI changes, only skill-prose wiring" prediction.

## Self-Check: PASSED

- FOUND: `src/cli/slash-command/bs/verify/source-free-mode.md` (created, 96 lines)
- FOUND: `src/cli/slash-command/bs/verify/source-resolution.md` (modified, Negative case dispatches to `source-free-mode.md`)
- FOUND: `src/cli/slash-command/bs/verify-game.md` (modified, Step 1/2/9/Reference Files all updated)
- FOUND: `src/cli/commands/install-claude-command.ts` (modified, `SHARED_LEAF_PROBES` gained the new leaf)
- FOUND: `src/cli/slash-command/bs/verify.test.ts` (modified, 146 tests, +10 from baseline)
- FOUND: `src/cli/commands/install-claude-command.test.ts` (modified, 20 tests, assertions added at 3 sites)
- FOUND commit `73b689eb` in `git log --oneline --all`

---
*Phase: 179-source-free-verification-mode*
*Completed: 2026-07-31*
