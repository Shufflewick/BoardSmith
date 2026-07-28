---
phase: 171-provenance-recording
plan: 06
subsystem: bs-skills
tags: [provenance, close, playtest, check-status, skill-text, drift-guard, ordinal-citation]

# Dependency graph
requires:
  - phase: 171-provenance-recording
    plan: 04
    provides: "chunkCheckCommand() — the command close.md's Bookkeeping Sequence now invokes"
  - phase: 171-provenance-recording
    plan: 05
    provides: "chunkProvenanceStatusCommand() + projectProvenanceState — the aggregation check-status.md item 8 formats"
provides:
  - "CHUNK.template.md's scaffolded, machine-owned `## Verified Against` fence, byte-identical to the writer's exported constants"
  - "close.md's Bookkeeping Sequence item 3, 'Record what this chunk was verified against' — invokes `boardsmith chunk-check <slug>`"
  - "playtest.md's light-path bookkeeping still cites the sequence by name, never duplicating the chunk-check text"
  - "a derived-numbering drift guard (build-chunk.test.ts) that parses close.md's real Bookkeeping Sequence numbering and validates every ordinal citation under src/cli/slash-command/bs/ against it"
  - "check-status.md item 8, 'Verification provenance and drift' — formats `boardsmith chunk-provenance-status --json`, consuming its `projectProvenanceState` field rather than re-deriving severity"
affects: ["171-07 (real-reference-game proof exercises both chunk-check and chunk-provenance-status through this wiring)", "PROV-01", "PROV-03"]

tech-stack:
  added: []
  patterns:
    - "Ordinal citations to a numbered skill-text sequence are drift-checked by PARSING the source sequence at test time, not by a second hand-maintained count pin — a renumber now fails the suite automatically instead of depending on someone remembering to grep."
    - "Reuse-by-citation (playtest.md cites close.md's Bookkeeping Sequence BY NAME) is enforced negatively: a test asserts the citing file does NOT contain the cited file's own literal instruction text, so a future edit that duplicates the text instead of citing it fails loudly."

key-files:
  created: []
  modified:
    - src/cli/slash-command/bs/templates/CHUNK.template.md
    - src/cli/slash-command/bs/templates.test.ts
    - src/cli/slash-command/bs/build/close.md
    - src/cli/slash-command/bs/build/playtest.md
    - src/cli/slash-command/bs/state-machine.md
    - src/cli/slash-command/bs/build-chunk.test.ts
    - src/cli/slash-command/bs/check-status.md
    - src/cli/slash-command/bs/status-tools.test.ts
    - .planning/phases/171-provenance-recording/deferred-items.md

key-decisions:
  - "The drift guard's overlap heuristic had to be tuned twice during RED-first observation, both times because a fixed-size text window swept up vocabulary from a NEIGHBORING duty in the same long enumerating sentence, producing a false PASS on stale citations: (1) a 400-char lookback captured 'ledger'/'ledgers' from three unrelated duties in the same document (the DECISIONS.md ledger, the filings ledger, the asset-debt ledger, the waived-chunk ledger) — fixed by adding 'ledger'/'ledgers' to the stopword list, since the word is structurally overloaded in THIS document and does not discriminate between items; (2) a 30-char trailing buffer reached past the citation's own closing paren into the FOLLOWING sentence's vocabulary ('...re-touches that ruling entry' leaking the word 'entry', which also appears in the correct item's own text) — fixed by shrinking the trailing buffer to 10 chars, just enough to close the citation's own parenthesis. Both fixes are recorded inline as code comments so a future reader does not widen the windows back to something that reintroduces the false-pass."
  - "The clause-boundary narrowing (walk back from the citation's enclosing '(' to the nearest comma/semicolon/period) exists because these citing sentences enumerate SEVERAL duties before citing an ordinal for only the nearest one — a naive fixed-width window would pick up every enumerated duty's vocabulary and defeat the discriminative check entirely, exactly the failure mode both bugs above hit before the fix."
  - "check-status.md item 8 explicitly states it consumes projectProvenanceState rather than re-deriving severity from the raw verifiedWithoutProvenance count — both reference games are pre-provenance (100% of their chunks flagged, expected) and the honesty_requirement in this plan's brief specifically forbids presenting that as an alarm."

requirements-completed: [PROV-01, PROV-03]

# Metrics
duration: ~70min
completed: 2026-07-28
---

# Phase 171 Plan 06: Wire chunk-check and chunk-provenance-status into the pipeline Summary

**Scaffolds the machine-owned `## Verified Against` fence into new chunks, wires `boardsmith chunk-check <slug>` into both close paths via one cited (never duplicated) Bookkeeping Sequence item, adds a self-verifying ordinal-citation drift guard, and gives `/bs-check-status` an eighth item that formats `boardsmith chunk-provenance-status --json` without recomputing its severity classification.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-07-28 (approx)
- **Completed:** 2026-07-28
- **Tasks:** 3
- **Files modified:** 9 (8 code/skill-text + 1 deferred-items.md discovery log)

## Task Commits

1. **Task 1: Scaffold the fenced `## Verified Against` section into CHUNK.template.md** — `4680fd56` (feat)
2. **Task 2: Invoke chunk-check from both close paths; fix the ordinal-citation drift trap; add the derived-numbering drift guard** — `fc073b83` (feat)
3. **Task 3: `/bs-check-status` reports verification drift as item 8** — `0d0ceccd` (feat)

## RED Observation — ordinal-citation drift guard (mandatory per 171-VALIDATION.md)

Per this plan's RED-first obligation, the guard had to be shown failing against a tree where
close.md's Bookkeeping Sequence was renumbered but the ordinal citations were not yet updated —
the exact drift this test exists to catch. This was reproduced directly (not simulated) by
applying only close.md's renumbering hunk and leaving `state-machine.md`'s two `item 4` citations
stale, then running:

```
npx vitest run src/cli/slash-command/bs/build-chunk.test.ts -t "Bookkeeping Sequence ordinal citations resolve"
```

**First RED (before the overlap-heuristic tuning below) — false PASS, not yet a usable guard:**
An early version of the heuristic (400-char lookback window, no stopword exclusion for
"ledger"/"ledgers") did not fail here — it is documented under Deviations below because the
guard's own design needed correcting before it could do its job.

**Final RED, observed against the genuinely stale tree (close.md renumbered, citations still
saying "item 4"):**

```
 ❯ src/cli/slash-command/bs/build-chunk.test.ts (182 tests | 1 failed | 180 skipped) 11ms
   × Bookkeeping Sequence ordinal citations resolve to the item they describe > every "Bookkeeping Sequence ... item N" citation under this directory names an N that exists and describes that item's actual duty 9ms
     → state-machine.md: cites "item 4" but the citing text shares no significant vocabulary with close.md's item 4 ("4. **Roll up decisions.** Append this chunk's settled house-rule/adaptation choi..."). Either the citation is stale (item 4 was renumbered) or this test's overlap heuristic needs updating for genuinely new wording.
state-machine.md: cites "item 4" but the citing text shares no significant vocabulary with close.md's item 4 ("4. **Roll up decisions.** Append this chunk's settled house-rule/adaptation choi..."). Either the citation is stale (item 4 was renumbered) or this test's overlap heuristic needs updating for genuinely new wording.: expected [ …(2) ] to deeply equal []

- Expected
+ Received

- Array []
+ Array [
+   "state-machine.md: cites \"item 4\" but the citing text shares no significant vocabulary with close.md's item 4 (\"4. **Roll up decisions.** Append this chunk's settled house-rule/adaptation choi...\"). Either the citation is stale (item 4 was renumbered) or this test's overlap heuristic needs updating for genuinely new wording.",
+   "state-machine.md: cites \"item 4\" but the citing text shares no significant vocabulary with close.md's item 4 (\"4. **Roll up decisions.** Append this chunk's settled house-rule/adaptation choi...\"). Either the citation is stale (item 4 was renumbered) or this test's overlap heuristic needs updating for genuinely new wording.",
+ ]

 ❯ src/cli/slash-command/bs/build-chunk.test.ts:1562:43
    1560|     }
    1561|
    1562|     expect(failures, failures.join('\n')).toEqual([]);
       |                                           ^
    1563|   });
    1564| });

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed | 180 skipped (182)
```

Both stale ordinal citations (state-machine.md:46 and :113, both naming "item 4" for the
ledger-reconciliation duty that had shifted to item 5) are caught — the guard genuinely fires on
the exact drift class this task exists to prevent.

## GREEN Result

After applying the real fix — close.md's item 3 insertion + renumbering, playtest.md's/close.md's
count-pin updates, and state-machine.md's two ordinal citations moved to "item 5":

```
npx vitest run src/cli/slash-command/bs/build-chunk.test.ts

 ✓ src/cli/slash-command/bs/build-chunk.test.ts (182 tests) 33ms

 Test Files  1 passed (1)
      Tests  182 passed (182)
```

## Full-Suite Verification

- `npx vitest run src/cli/slash-command/bs/` (build-chunk, status-tools, templates, ingest) —
  **395/395 passed**.
- `grep -rn "five-item\|five item" src` — **no output** (confirmed after Task 2).
- `npm test` — **3400/3406 passed**. The 6 failures are in `src/cli/commands/chunk-provenance.test.ts`'s
  `chunk-check` describe block and are **pre-existing, unrelated to this plan** — see "Deviations"
  below and `deferred-items.md`.
- `npx tsc --noEmit` — the same single pre-existing, out-of-scope error already logged in
  `deferred-items.md` before this plan (`docs/seed-to-state.test.ts` rootDir mismatch, phase 168).
- Task-specific acceptance-criteria greps all pass: `boardsmith chunk-check` present exactly once
  in close.md and zero times in playtest.md; `six-item` present once in each of close.md and
  playtest.md; no remaining `item 4` Bookkeeping Sequence citation anywhere in `src`; two `item 5`
  citations in state-machine.md; `consistency-check item 4` still present exactly once (correctly
  untouched); `chunk-provenance-status --json` present in check-status.md; `seven items` absent,
  `eight items` present twice.

## What This Plan CANNOT Prove (honesty requirement, verbatim per the plan's brief)

Per `171-VALIDATION.md`'s tiering table, every test added in this plan proves an instruction
**EXISTS** in the installed skill text. None of them prove a live `/bs-build-chunk` session
actually **invokes** `boardsmith chunk-check` at close, or that a live `/bs-check-status` session
actually runs `boardsmith chunk-provenance-status --json`. Phase 170 established this distinction
across fourteen live runs: `/bs-build-chunk` Step 0's `ingest-check` call from that phase has
still never been exercised by a live session, and this plan adds a second skill-text-to-command
invocation (`close` → `chunk-check`) that carries the identical, unproven risk. Neither this
plan's tests nor its SUMMARY can close that gap — only a real live session run can, and none has
run yet for either invocation.

**The two things that actually are load-bearing, both landed in prior plans, not this one:**

1. **The machine-owned `## Verified Against` fence** (this plan's Task 1) — a session declines to
   hand-author a fenced, machine-owned section, per the 2026-07-28 evidence cited directly in the
   template's own comment (a session filled `## Open Rules Gaps` by hand and the result looked
   entirely healthy while being wrong). This does not force `chunk-check` to run, but it removes
   the alternative of quietly faking the block by hand.
2. **`chunk-provenance-status`'s `verifiedWithoutProvenance` flag** (plan 05) — surfaces any
   chunk whose `Status:` claims `verified` with no valid block behind it, regardless of *why* the
   invocation was skipped. This is the compensating control this whole phase is actually staked
   on; the skill-text wiring in this plan is deliberately not the guarantee.

## Deviations from Plan

### Auto-fixed / found-during-execution

**1. [Rule 1 — design bug in the drift guard's own test, caught and fixed before it ever shipped]
The overlap heuristic gave two consecutive false PASSES during RED-first observation, both from
the same root cause: a text window wide enough to sweep in a NEIGHBORING duty's vocabulary in the
same enumerating sentence.**
- **Found during:** RED-first observation for Task 2's drift guard (the plan's own mandated
  discipline caught this — the test was required to be shown failing against a genuinely-stale
  tree, and it did not fail on the first two attempts).
- **Issue A:** A 400-char lookback window captured the word "ledger"/"ledgers" from a DIFFERENT
  duty in the same sentence (the decisions-rollup item's own "DECISIONS.md's append-only ledger"
  phrase), producing a false match against the ledger-reconciliation citation even when it cited
  the wrong item.
- **Fix A:** Added "ledger"/"ledgers" to the significant-word stopword list — the word is
  structurally overloaded across four distinct duties in this document set and does not
  discriminate between them.
- **Issue B:** A 30-char trailing buffer past the citation's own closing parenthesis reached into
  the FOLLOWING, unrelated sentence ("...re-touches that ruling entry"), picking up the word
  "entry," which coincidentally also appears in the correct item's own text ("one entry per
  decision"), again producing a false match.
- **Fix B:** Shrunk the trailing buffer to 10 characters — just enough to close the citation's own
  parenthesis, not to reach the next sentence.
- **Verification:** Re-ran the RED scenario after each fix; the guard now genuinely fails on both
  stale citations (see RED transcript above) and genuinely passes once the fix is applied (see
  GREEN transcript above).
- **Files modified:** `src/cli/slash-command/bs/build-chunk.test.ts`.
- **Commit:** `fc073b83`.

### Out-of-scope discovery, logged not fixed (per SCOPE BOUNDARY)

**2. `src/cli/commands/chunk-provenance.test.ts` has 6 pre-existing `chunk-check` test failures,
unrelated to this plan.** Confirmed via `git stash` (identical 6 failures reproduce with every
171-06 edit removed) and bisected further back to `6fd875ef` ("docs(171-04): complete chunk-check
plan," several commits before plan 05 or 06 touched anything) — the failures predate both this
plan and plan 05. `chunk-provenance.ts` and its test file are not in this plan's
`files_modified` frontmatter. Logged in full detail, including the bisection evidence, to
`.planning/phases/171-provenance-recording/deferred-items.md` rather than fixed here. `npm test`'s
reported pass count for this plan's own verification (3400/3406) is net of these 6 known,
unrelated failures.

## Issues Encountered

None beyond the drift-guard design bug documented above, which was caught and fixed by the plan's
own RED-first discipline before any commit landed, and the pre-existing unrelated `chunk-check`
test failures, which are logged, not fixed, per scope boundary.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `chunk-check` and `chunk-provenance-status` are now wired into both close paths and
  `/bs-check-status` respectively, at the skill-text layer. Plan 07's real-reference-game proof
  (`~/BoardSmithGames/seven`, read-only, and `~/BoardSmithGames/one-two-punch`) is the next thing
  that actually exercises these commands against messy, pre-contract project data — this plan's
  tests do not.
- The still-open question from `171-VALIDATION.md`'s "Known Unvalidated" list stands unchanged:
  whether a live `/bs-build-chunk` session actually invokes `chunk-check` at `close`. That
  settles only on a real live run, not in this plan or the next.
- `deferred-items.md` now carries two unrelated, pre-existing defects for a future phase to pick
  up: the `tsc --noEmit` rootDir mismatch (logged in 171-02) and the 6-test `chunk-check` failure
  bisected in this plan.

## Self-Check: PASSED

- `src/cli/slash-command/bs/templates/CHUNK.template.md` — FOUND (`grep -c "boardsmith:verified-against:begin"` → 1, `:end` → 1)
- `src/cli/slash-command/bs/build/close.md` — FOUND (`grep -c "boardsmith chunk-check"` → 1)
- `src/cli/slash-command/bs/build/playtest.md` — FOUND (`grep -c "boardsmith chunk-check"` → 0, confirmed cited not duplicated)
- `src/cli/slash-command/bs/state-machine.md` — FOUND (`grep -c 'Bookkeeping Sequence.*item 5'` → 2, `grep -n 'item 4'` for Bookkeeping Sequence → none, `consistency-check item 4` → 1, untouched)
- `src/cli/slash-command/bs/check-status.md` — FOUND (`grep -c "chunk-provenance-status --json"` → 2, `"eight items"` → 2, `"seven items"` → 0)
- Commit `4680fd56` — FOUND (`git log --oneline` confirms)
- Commit `fc073b83` — FOUND (`git log --oneline` confirms)
- Commit `0d0ceccd` — FOUND (`git log --oneline` confirms)

---
*Phase: 171-provenance-recording*
*Completed: 2026-07-28*
