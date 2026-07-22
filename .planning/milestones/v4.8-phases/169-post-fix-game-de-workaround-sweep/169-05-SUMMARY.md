---
phase: 169-post-fix-game-de-workaround-sweep
plan: 05
subsystem: game-repo-sweep
tags: [doom-machine, boardsmith-bugs-ledger, multiSelect, space-lifecycle, art-paths]

# Dependency graph
requires:
  - phase: 169-01-crosswalk-foundation
    provides: Dxx <-> repo-bug-id crosswalk + library fix-present checklist gating every removal
provides:
  - doom-machine's BOARDSMITH-BUGS.md reconciled for BS-5 (deferred, comment-refreshed), BS-9 (kept-and-noted), BS-10 (reclassified game-side-handled), BS-3/D12 (kept-and-noted)
  - sweep/v4.8-dework branch in doom-machine with a single file-scoped commit, suite unchanged
  - 169-CROSSWALK.md updated with doom's per-target outcomes + a scaffold-default `<base href>` recommendation
affects: [169-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Comment-refresh-only deviation: when a fix closes a bug's ORIGINAL gap but the game-side workaround is also independently useful (random-sim enumeration, click-driven board UX), refresh the stale bug-citation comment without rewriting the workaround itself."
    - "Reclassify-not-refix: a bug filing whose game-side resolution already fully addresses the reported symptom (BS-10's absolute /cards/ paths) gets reclassified in the ledger, with any residual library-side gap folded into a forward-looking recommendation rather than an in-scope fix."

key-files:
  created: []
  modified:
    - ~/BoardSmithGames/doom-machine/src/rules/actions.ts
    - ~/BoardSmithGames/doom-machine/src/rules/roll-conditions.ts
    - ~/BoardSmithGames/doom-machine/src/ui/App.vue
    - ~/BoardSmithGames/doom-machine/BOARDSMITH-BUGS.md
    - .planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md
    - .planning/phases/169-post-fix-game-de-workaround-sweep/deferred-items.md

key-decisions:
  - "D9/BS-5 single-select-enumeration rewrite DEFERRED per plan mandate — comment-only refresh, no behavior change."
  - "BS-9/D23 one-slot-one-pile spare-slot model KEPT — not purely a workaround (Decisions 18+31 baked in, load-bearing for reseat()/slideRight() and rulebook adjacency reads); tearing it down would be an architectural change out of scope for a conservative sweep."
  - "BS-3/D12-adjacent board-height cap KEPT — not a stale-fit compensator; it enforces a 220px legibility floor by construction (zoom=1), independent of whether the shell re-fits on resize."
  - "BS-10 RECLASSIFIED as game-side art-path fix already handled (commit 6949fde) — the scaffold <base href> gap folded into a recommendation, not implemented."
  - "D32/DRAWDROP re-confirmed absent from doom-machine src/."
  - "6 pre-existing doom-machine test failures (deck-secrecy/anonymous-entry assertions) found on the untouched baseline BEFORE any sweep edit — logged to deferred-items.md, left unmodified, confirmed unchanged after every sweep task."

patterns-established:
  - "Baseline-first vitest capture on a freshly-branched, zero-edit tree is the authoritative 'no new failures' oracle even when that baseline is not itself green."

requirements-completed: [SWEEP-01, PROC-01]

# Metrics
duration: 30min
completed: 2026-07-22
---

# Phase 169 Plan 05: doom-machine De-Workaround Sweep Summary

**Deferred the risky D9/BS-5 native-multiSelect rewrite with comment-only refresh, kept D12/D23 targets as load-bearing (not pure workarounds), and reclassified BS-10 as a game-side art-path fix already handled — one file-scoped commit on `sweep/v4.8-dework`, doom-machine's suite unchanged at 399/405.**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-07-21 (session)
- **Completed:** 2026-07-22T04:55:15Z
- **Tasks:** 3/3
- **Files modified:** 4 in doom-machine (1 commit) + 2 in the library repo's `.planning/`

## Accomplishments
- Recorded doom-machine's pre-sweep state: `git status --porcelain` was empty (no pre-existing dirty tree) before branching `sweep/v4.8-dework` off `master` (`c8472f1`).
- Captured the TRUE baseline via `npx vitest run` on the freshly-branched, zero-edit tree: **399/405 passing, 6 pre-existing failures** (deck-secrecy/anonymous-entry assertions in `machine-phase.test.ts`, `machine-phase.board.test.ts`, `roll-condition-symbology.test.ts`) — NOT green, contrary to the plan's "record the green baseline" wording, but confirmed unrelated to any sweep edit (present before any edit, unchanged after every task). Logged in full to `deferred-items.md`.
- Deferred the D9/BS-5 single-select→native-multiSelect rewrite. Refreshed the stale BS-5-citing comments in `actions.ts`, `roll-conditions.ts`, and `App.vue` to record that boardsmith now supports function-valued `multiSelect` natively end-to-end (D9/AI-01, confirmed PRESENT) — closing BS-5's original panel gap upstream — while explicitly deferring the rewrite as a risky change to the game's central interaction, not a bug fix. `flow.ts`'s `actionStep({maxMoves})` untouched.
- Assessed both gated removal candidates and kept both, with rationale recorded in the crosswalk and ledger:
  - **BS-9/D23** (one-slot-one-pile spare-slot model): D23/SPACE-02 confirmed PRESENT (`Space.remove()`/`reparent()`), but the `MachineRow` spare-slot model is Decision 18 + Decision 31 baked together, load-bearing for `reseat()`/`slideRight()`'s renumbering and rulebook adjacency-read effects — not purely a compensating workaround. Tearing it down for the now-available API would be an architectural change; kept.
  - **BS-3/D12-adjacent** (board-height cap): D12/ZOOM-01 confirmed PRESENT (`ResizeObserver` re-fit), but `board-height.ts`'s cap enforces DESIGN.md's 220px legibility floor by construction (zoom=1 regardless of dynamic re-fit) — not a stale-fit compensator. Kept.
- Reclassified BS-10: verified by inspection that `src/rules/cards.ts` (20 refs) and the two tracker components already use absolute `/cards/*.png` paths (commit `6949fde`, 2026-07-20) — a game-side fix already handled, not an open library bug. Updated `BOARDSMITH-BUGS.md` to record the reclassification and folded the dev host's `<base href="/">` gap into a scaffold-default recommendation (recorded in `169-CROSSWALK.md`, not implemented as an engine change).
- Confirmed D32/DRAWDROP absent from doom-machine `src/` (`grep -rn "DRAWDROP" src/` → no hits) — recorded no-op.
- Committed all four sweep-touched files in one FILE-SCOPED commit (`git add BOARDSMITH-BUGS.md src/rules/actions.ts src/rules/roll-conditions.ts src/ui/App.vue`, never `-A`/`-a`); `git show --stat HEAD` proves exactly those 4 files, no deletions.
- Re-ran `npx vitest run` after every task (Task 1 comment edits, Task 2 no-op assessment, Task 3 ledger reconciliation) — identical 399/405 result each time, confirming the sweep introduced zero new failures.
- Updated `.planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md` Section 1 (doom-machine table: BS-3/BS-5/BS-9/BS-10 rows updated with 169-05 OUTCOME) and Section "No-op/withdrawn" (D32 re-confirmation + new scaffold-recommendation row).

## Task Commits

1. **Task 1: Record pre-existing dirty tree + baseline + DEFER D9 rewrite (comment-only)** — no separate commit (rolled into Task 3's single file-scoped commit per the plan's Task 3 instruction to commit all sweep-touched files together)
2. **Task 2: Gate D12/D23, verify green** — no code change (both kept-and-noted); no commit needed
3. **Task 3: Reclassify BS-10, record D32 no-op, reconcile ledgers** — `4cd3a95` (sweep: defer D9/BS-5 rewrite, reclassify BS-10, note D23/D12 kept) — doom-machine repo, `sweep/v4.8-dework` branch, not pushed

**Plan metadata:** library-repo commit for this SUMMARY + STATE/ROADMAP (see final commit below)

## Files Created/Modified

**doom-machine repo (`sweep/v4.8-dework` branch, commit `4cd3a95`):**
- `src/rules/actions.ts` - refreshed stale BS-5 comment on the damage action's dice pick; D9/AI-01 closure noted, rewrite deferred
- `src/rules/roll-conditions.ts` - same refresh on `encodeDiceCombo`'s doc comment
- `src/ui/App.vue` - same refresh on the action-panel-parity comment
- `BOARDSMITH-BUGS.md` - BS-5 deferral note, BS-9 kept-and-noted note, BS-10 reclassification, BS-3 kept-and-noted note (via crosswalk cross-reference)

**Library repo (`.planning/`):**
- `.planning/phases/169-post-fix-game-de-workaround-sweep/169-CROSSWALK.md` - doom's per-target outcomes (BS-3, BS-5, BS-9, BS-10), scaffold-default `<base href>` recommendation row, D32 re-confirmation
- `.planning/phases/169-post-fix-game-de-workaround-sweep/deferred-items.md` - doom-machine's 6 pre-existing baseline test failures, logged in full

## Decisions Made
- D9 rewrite deferred exactly as the plan mandated — comment-refresh only, verified via re-reading the edited comments and re-running the suite.
- Both D12 and D23 removal candidates assessed as genuinely load-bearing beyond their originally-cited workaround role, so kept rather than forced to a removal the "extra conservative" instruction warned against.
- BS-10 reclassified using the ledger's own recorded evidence (commit `6949fde`) rather than re-deriving the fix from scratch — the game-side resolution predates this sweep and was simply mis-filed as an open bug.
- Baseline treated as "record it and don't regress it" rather than "must be green" when the plan's wording and the actual repo state diverged — consistent with CLAUDE.md's "never leave debug/investigation half-done, but also never mask problems" posture: the failures are documented, not hidden, and left for a dedicated follow-up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical documentation] Logged 6 pre-existing doom-machine test failures the plan assumed would be a green baseline**
- **Found during:** Task 1 (baseline `npx vitest run` on the freshly-created `sweep/v4.8-dework` branch, before any edit)
- **Issue:** The plan's Task 1 action says "run `npx vitest run`; record the green baseline" — but the actual baseline on `master`/the fresh branch was 399/405, not green. Silently treating a red baseline as "the green baseline" (or worse, attempting to fix it as in-scope) would have violated both the plan's conservative-sweep intent and this session's CLAUDE.md "never mask problems" rule.
- **Fix:** Recorded the exact failing test names, symptom pattern (deck-secrecy/anonymous-entry assertions, same surface family as the library's own D24/WR-01 hidden-zone fix at `713cc644`, confirmed via `git merge-base --is-ancestor` that the fix IS an ancestor of the library commit this sweep ran against, so it is either a residual gap or an unrelated staleness), and disposition (left unmodified, confirmed unchanged after every task) in `deferred-items.md`. Did not investigate or fix — genuinely out of scope for a plan whose task set never touches the machine-deck/removed-pile visibility code path.
- **Files modified:** `.planning/phases/169-post-fix-game-de-workaround-sweep/deferred-items.md`
- **Verification:** Re-ran `npx vitest run` after every subsequent task; identical 6-failure set (same test names) each time, confirming these are pre-existing and the sweep introduces no new failures.
- **Committed in:** library-repo final metadata commit (see below); doom-machine's own commit `4cd3a95` does not touch these test files.

---

**Total deviations:** 1 auto-fixed (Rule 2 - missing critical documentation of a baseline mismatch)
**Impact on plan:** No scope creep — the deviation is documentation-only (recording a state discrepancy), not a code fix. All plan gates (D9 defer, D12/D23 gate, BS-10 reclassify, D32 no-op) executed exactly as specified.

## Issues Encountered
Task 1's plan wording ("record the green baseline") assumed a green suite; the actual baseline was 6-failures-red on a completely untouched tree. Resolved by treating "record the baseline, don't regress it" as the operative gate (matching the plan's own `<verification>` section: "doom-machine `npx vitest run` green on the sweep branch" was re-read as "no worse than baseline" given the empirical mismatch) — documented in `deferred-items.md` rather than silently reinterpreted.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 169-06 (final crosswalk/ledger close-out across all 5 repos) can proceed; doom-machine's BS-5/BS-9/BS-10/BS-3(D12)/D32 rows are all reconciled in `169-CROSSWALK.md`.
- Doom-machine's `sweep/v4.8-dework` branch exists locally with one commit, not pushed, ready for the repo owner's own review/merge decision.
- Follow-up recommended (not blocking): investigate the 6 pre-existing deck-secrecy test failures against the current library D24 serializer branch, independent of this sweep.

---
*Phase: 169-post-fix-game-de-workaround-sweep*
*Completed: 2026-07-22*

## Self-Check: PASSED
- FOUND: doom-machine commit `4cd3a95` (`git log --oneline --all | grep 4cd3a95`)
- FOUND: `.planning/phases/169-post-fix-game-de-workaround-sweep/169-05-SUMMARY.md`
- FOUND: `~/BoardSmithGames/doom-machine/BOARDSMITH-BUGS.md`
- doom-machine working tree clean post-commit (`git status --porcelain` empty)
