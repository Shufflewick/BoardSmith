# Phase 169 Plan Check — Post-Fix Game De-Workaround Sweep

**Verdict: CONCERNS** (2 blockers, 2 warnings — fix before execution)

## Scope reviewed
- ROADMAP.md Phase 169 goal + 5 success criteria
- REQUIREMENTS.md SWEEP-01, PROC-01
- 169-CONTEXT.md (locked conservative/gated posture)
- 169-VALIDATION.md
- 169-01..06-PLAN.md
- Spot-checks: grep verification of D1/D8/D9/D28/D29 fix-present anchors in this repo's `src/`; `git status`/`git branch` in all 5 game repos; file/line existence of cited targets (`.notUndoable()`, `concealFromEverySeat`, one-two-punch undo re-guard, one-two-punch `ai.ts`); ledger file existence in all 5 repos.

## What's solid
- SWEEP-01 + PROC-01 present in every plan's `requirements` frontmatter; all 5 success criteria have covering tasks.
- Gating is real: every removal task in 02-06 is explicitly conditioned on (a) a PRESENT verdict cited from 169-CROSSWALK.md (grep-backed, built in 169-01 against the live symlinked `boardsmith` source) and (b) `npx vitest run` green immediately after, with an explicit revert-on-red / keep-and-noted fallback. Spot-checked D1 (`assertUndoAllowed`/`hasNonUndoableAction`), D8 (`toJSONForPlayer`), D9 (`resolveMultiSelect`/`buildPickMetadata`), D28 (`suppressFromDock`), D29 (`unbounded`) — all genuinely PRESENT in `src/`, so 169-01's crosswalk premises are sound.
- "Cannot safely remove → keep + note" is explicitly stated as a valid, non-failure outcome in every per-repo plan's objective/success_criteria (not just acceptance_criteria).
- Every per-repo plan checks out `sweep/v4.8-dework` off master, never `git push`, and explicitly instructs "never touch master" — confirmed all 5 repos are currently on `master` locally.
- doom's D9/BS-5 rewrite is explicitly DEFERRED (comment-refresh only, `actionStep({maxMoves})` untouched); `.notUndoable()` re-guard removals in seven/one-two-punch/BSG2-seven are explicitly gated on D1 verified server-side, with the calls themselves preserved (only redundant re-guard logic/stale docblocks removed).
- D32/DRAWDROP and MERC are explicitly recorded as no-op/out-of-scope (169-01 Task 1, 169-05 Task 3).
- 169-01 (wave 1) builds the crosswalk before any per-repo plan; 02-06 all `depends_on: ["169-01"]` and cite it. Each per-repo plan sits alone in its own wave (2,3,4,5,6) — matches the executor's actual wave-grouping mechanism (`execute-phase.md` groups/serializes by the `wave` frontmatter field, not a recomputation from `depends_on`), so the shared `169-CROSSWALK.md` file is safe from intra-wave parallel-write races despite `depends_on` only listing `169-01` for plans 02-05.
- BS-10 reclassify assigned to 169-05 Task 3 with the correct rationale (game-side art-path, not a library bug) and the `<base href>` gap correctly folded into a scaffold-default recommendation rather than left as an open defect.
- Every task has concrete `read_first` (specific files/line ranges), a specific `action`, an `<automated>` `<verify>`, and measurable `<done>`/`acceptance_criteria`.

## Blockers

**1. [requirement_coverage / scope_reduction] BSR-12 AI re-verification is not tasked for 2 of the 4 AI-bearing repos, but the final verdict (169-06 Task 3) presumes it was.**
- 169-CONTEXT.md `<decisions>` names all four AI-bearing repos as BSR-12-relevant: "Priority: one-two-punch... lanternfall/seven/BoardSmithGames2-seven also have `src/rules/ai.ts`."
- Confirmed on disk: `lanternfall/src/rules/ai.ts` + `lanternfall/tests/ai-smoke.test.ts` exist; `seven/src/rules/ai.ts` exists; `BoardSmithGames2/seven/src/rules/ai.ts` exists.
- 169-02 (lanternfall) has exactly 2 tasks, neither reads nor verifies `ai.ts`/AI tests — only `flow.ts` maxIterations and `GardenBoard.vue` metadata guard.
- 169-03 (seven) has exactly 2 tasks, neither reads nor verifies `ai.ts` — only `.notUndoable()` re-guards and `concealFromEverySeat`.
- Only 169-04 Task 2 (one-two-punch) and 169-06 Task 2 (BoardSmithGames2/seven) actually re-verify `ai.ts` builds + AI tests pass against AI-01/AI-02.
- 169-06 Task 3 is scoped as "THIS-repo doc edit only" and reads only `169-CROSSWALK.md` + the 02-05 `SUMMARY.md` files — it has no task-level mechanism to obtain lanternfall's or seven's AI disposition, yet its action requires writing "BSR-12... CLOSED if every AI-bearing repo (one-two-punch priority, plus lanternfall/seven/BoardSmithGames2-seven) builds + passes its AI tests." As written, this verdict cannot be honestly rendered — it will either be asserted without evidence (violating PROC-01's adversarial-verification discipline) or the plan set silently drops lanternfall/seven from the phase's own AI closeout scope.
- Fix: add an AI re-verify+ledger-refresh task (or task step) to 169-02 and 169-03 mirroring 169-04 Task 2 / 169-06 Task 2, so 169-06 Task 3 has a grounded input for all four AI-bearing repos.

**2. [key_links_planned / scope_sanity] Dirty working tree on `master` in two target repos is not addressed by any task — risks committing unrelated WIP into the sweep branch.**
- `~/BoardSmithGames/lanternfall` is currently on `master` with uncommitted changes: modified `src/rules/index.ts` (+43/-1 lines) and untracked `src/rules/ai.ts` + `tests/ai-smoke.test.ts` — i.e., in-progress, uncommitted AI work sitting on the branch that 169-02 will fork `sweep/v4.8-dework` from.
- `~/BoardSmithGames/one-two-punch` is currently on `master` with uncommitted deletions: `.boardsmith/runtime-bundle.mjs`, `.boardsmith/runtime-entry.ts`.
- `git checkout -b sweep/v4.8-dework` carries uncommitted changes forward onto the new branch. Neither 169-02's nor 169-04's Task 1 instructs verifying a clean working tree before branching, nor does either plan scope the later "commit the source + ledger changes" step to only the files the plan itself touched (no `git add <specific files>` instruction — only "commit"). An executor following the plan literally (`git commit -a` or `git add -A`) would fold this pre-existing, unrelated, possibly-incomplete WIP into the audited sweep commit, corrupting the "narrow, verified, revert-on-red" removal record the whole gating discipline depends on. It would also make the Task 1 "green baseline" for lanternfall non-representative of `master`'s actual last-known-good state (the untracked `ai.ts`/`ai-smoke.test.ts` may or may not be exercised by `npx vitest run`, but they are indistinguishable from in-scope sweep work once committed together).
- one-two-punch's plan (169-04 Task 1) already shows awareness of dirty-tree hazards ("do NOT stage the repo's `_*_tmp.mjs` / `_dbg*.mjs` scratch files") but that instruction doesn't cover the currently-deleted `.boardsmith/runtime-bundle.mjs`/`runtime-entry.ts`, which is a different, uninstructed-for dirty condition.
- Fix: add an explicit "if `git status` is not clean before branching, stop and report — do not silently branch off a dirty master" gate to 169-02 Task 1 and 169-04 Task 1 (and ideally all per-repo Task 1s as a standard precondition), and scope every "commit" instruction to the specific files the task touched, never a blanket `-a`/`-A`.

## Warnings

**1. [dependency_correctness, minor] `depends_on` under-declares real ordering for 03/04/05/06.**
Plans 03, 04, 05 list `depends_on: ["169-01"]` only, even though they write to the same `169-CROSSWALK.md` file that the prior per-repo plan also appended to, and the phase's own design note ("shared crosswalk doc forces serial") requires 02 before 03 before 04 before 05. Execution safety is preserved in practice only because each plan is pinned to its own unique `wave` number and the executor groups/serializes by `wave`, not by a recomputed dependency graph — but the `depends_on` field itself is inconsistent with the `wave = max(deps)+1` convention and would mis-schedule under a stricter or different executor. Recommend `depends_on` chain to the immediately-prior repo plan (e.g., 03 → `["169-01","169-02"]`) so the graph is self-consistent, not just wave-pinned.

**2. [scope_sanity, minor] Stale ROADMAP.md progress table.**
The bottom "Progress" table in ROADMAP.md shows phases 156-163 and 165 as "0/? Not started," directly contradicting the checked-off `[x]` phase list and per-phase `Plans:` bullets (all `[x]`) immediately above it, and contradicting 169's own `depends_on` premise ("ALL fix phases (155–165) verified in the shipped library"). This is very likely a stale/unmaintained table rather than a real gap (164/166/167/168 show correct "Complete" status, and 169-01's own grep-verification independently confirms the D1/D8/D9/D28/D29 fixes are live in `src/`), but it should be corrected so future phase-audits don't get a false "not started" signal from this table.

## Recommendation
Fix Blockers 1 and 2 before execution:
1. Add explicit AI-re-verify tasks (mirroring 169-04 Task 2) to 169-02 (lanternfall) and 169-03 (seven) so 169-06's BSR-12 verdict is grounded for all four AI-bearing repos.
2. Add a clean-working-tree precondition to every per-repo Task 1 (stop-and-report if `git status` isn't clean before branching), and scope every "commit" action to the specific files the task touched (no blanket `-a`/`-A`), particularly for lanternfall (169-02) and one-two-punch (169-04).

Warnings are non-blocking; fix opportunistically.
