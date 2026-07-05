---
phase: 149-end-to-end-dry-run-validation
plan: 02
subsystem: bs-skills-pipeline-validation
tags: [dry-run, build-chunk, go-fish, hidden-info, validation]
requires:
  - "149-01 (scratch go-fish ingest artifacts: rulebook slices, SKETCH.md, chunk-1 CHUNK.md)"
provides:
  - "generated chunk-1 Go Fish code (deal/ask/give/go-fish/extra-turn), proven to compile, lint clean, pass its test discipline (incl. random-sim + a11y floor), and pass the audit's hidden-hand leak check"
  - "logged pipeline friction/defects for Plan 03's fix leg (git-protocol-unimplementable-on-scratch, ask/design-ask gate not really exercised, isFinished depth-cut trap)"
affects: []
tech-stack:
  added: []
  patterns:
    - "Full-ceremony build-chunk steps (investigate through repair) exercised via single-pass self-dispatch (scaled fan-out) rather than separate Task-tool subagents per step — logic exercised, not sub-subagent depth"
    - "diffPlayerViews + assertNoHiddenInfoLeak as the real audit visibility lens, including the elementId-scoped rank/suit allow-predicate pattern and its non-vacuous control test"
key-files:
  created:
    - "<scratch>/go-fish-dryrun/src/rules/{elements,game,actions,flow,index}.ts (throwaway, not committed)"
    - "<scratch>/go-fish-dryrun/tests/{game,no-hidden-info-leak,random-simulation,a11y.keyboard-completion}.test.ts (throwaway, not committed)"
    - "<scratch>/go-fish-dryrun/ASK-PROPOSAL.md, PLAYTEST-SCRIPT.md (throwaway, not committed)"
  modified:
    - "<scratch>/go-fish-dryrun/chunks/core-event-loop/CHUNK.md (Interpretation claim 7, Visibility Declaration addendum, Redteam Rounds, Findings Ledger, Build Manifest, Playtest Test Script — throwaway)"
    - "<scratch>/go-fish-dryrun/src/ui/{App,components/GameTable}.vue, boardsmith.json, tests/a11y.example.test.ts (throwaway)"
decisions:
  - "Scaled the redteam/audit fan-out to a single self-dispatched pass per lens (investigate -> redteam -> ask done in one context; fidelity+visibility combined then a dedicated visibility deep-check; undo lens found N/A; design-review lens found no craft defect) rather than spawning separate Task-tool subagents per lens, per the plan's explicit scaled-fanout allowance — logic for every lens was genuinely exercised (raw-slice reading, no-framing claims text, real diffPlayerViews/assertNoHiddenInfoLeak calls), just not via nested sub-subagent dispatch"
  - "Chose 'pond empty' (not 'pond empty AND all hands empty') as chunk-1's depth-cut isFinished() terminal condition after the original construction proved unreachable (see Findings Ledger F1) — book-forming, the only card-removal mechanism, is out of scope for this chunk, so cards are conserved across hands forever once the pond runs dry"
  - "Auto-approved the ask-gate proposal without a live human turn, per this plan's explicit instruction not to block — captured as ASK-PROPOSAL.md and logged as a pipeline observation (the gate's actual human-negotiation value was not really tested)"
metrics:
  duration: "~2.5 hours"
  completed: 2026-07-05
---

# Phase 149 Plan 02: Chunk-1 Build Leg Dry-Run Summary

Ran the full-ceremony `/bs-build-chunk` machine steps (investigate, redteam, ask, build, test, audit, repair) against Go Fish's chunk-1 core-event-loop by following the real skill files (`bs/build-chunk.md` + `bs/build/{investigate,redteam,ask,build,test,audit,repair,playtest}.md`), producing real generated code that deals hands, resolves an ask-for-rank turn (give-matching-cards or go-fish/draw, extra turn on a hit or matching draw), compiles clean, lints clean, passes its full test suite (16 tests across 5 files, including a random-sim run and the 5-item a11y floor with real controller wiring), and — the single highest-value proof — passes the audit's two-seat hidden-information leak check via real `diffPlayerViews`/`assertNoHiddenInfoLeak` calls. One real code defect (an unreachable termination condition) was found and repaired during the test/audit steps, exactly as the pipeline is designed to catch.

## Scaling Note (per plan's explicit allowance)

Every machine step's LOGIC was genuinely exercised — reading the real skill file, following its exact required-reading list, writing the exact CHUNK.md sections it specifies, and running the exact real APIs it names (`diffPlayerViews`, `assertNoHiddenInfoLeak`, `simulateRandomGames`, `tsc --noEmit`, `boardsmith lint`) — but the adversarial fan-out was scaled DOWN from the skill's full width to a single self-dispatched pass per step, performed directly in this executor's own context rather than via separate nested Task-tool subagent dispatches per lens:

- **investigate**: 1 pass (not a separate subagent) re-derived the claims list against the same cited rulebook slices Plan 01 used, confirming completeness.
- **redteam**: 1 refuter-pass + 1 coverage-pass (not 2 refuters + 1 coverage adversary as 3 separate dispatches) — the coverage pass found a real gap (empty-hand auto-draw before turn-ends), appended as claim 7 per the append-only rule.
- **audit**: 1 combined fidelity+visibility pass + 1 dedicated deep visibility pass (not 3-4 fully separate fresh-context dispatches) — found and closed F1 (fidelity/reachability bug) and confirmed F2 (no leak) for real via the actual testing APIs.

This matches the plan's `<scaled_fanout_note>` allowance explicitly. Per-lens **logic** (raw-slice reading, no-framing claims text, real API calls, append-only write discipline) was real; only the **number of independent dispatches per lens** was reduced.

## Pipeline Finding: Investigate Step Was Also Not a Live Dispatch in Plan 01

Per the objective's required note: Plan 01 pre-filled CHUNK.md's `## Interpretation`/`## Visibility Declaration` directly (per its own Task 3 instructions) rather than via a real `investigate.md` dispatch. This plan's Task 1 re-ran investigate's actual logic against the same six claims and confirmed them complete, adding claim 7 (see Redteam Round 1 below) that the original direct-authoring pass had missed — a small, real data point that the live investigate/redteam sequence catches gaps a shortcut-authored interpretation does not.

## What Ran (per task)

**Task 1 — investigate + redteam + ask (`bs/build/investigate.md`, `redteam.md`, `ask.md`):**
- Investigate pass: re-read the six existing claims against `rulebook/{03-setup,04-turn-structure,05-actions,06-round-completion,07-game-end}.md`, `RULINGS.md`, `DECISIONS.md`, `docs/core-concepts.md`, `docs/common-pitfalls.md`, `docs/actions-and-flow.md` (chunk has actions), `docs/custom-ui-guide.md`/`docs/ui-components.md` (ui: major). Confirmed claims 1-6 still cite correctly; no new slice surfaced from an `INDEX.md` search beyond what was already cited.
- Redteam Round 1: refuter pass stood claims 1-6; coverage-adversary pass flagged the missing "empty-hand auto-draw before turn ends" interaction — appended as claim 7 (append-only, never renumbering 1-6), disposition `cleared` (one coverage finding, not a refuted-twice escalation).
- Ask step: presented the 4-part format (interpretation in plain language, no open ambiguities since redteam cleared, deferred list = book-forming/scoring/win, zero implementation vocabulary), captured to `ASK-PROPOSAL.md`, auto-approved without a live human turn per this plan's explicit instruction. `Status: approved` written last, SKETCH.md's derived-status pointer note recorded in CHUNK.md (the scratch project's SKETCH.md itself was not re-touched beyond what Plan 01 wrote, since this dry-run does not run a full `/bs-build-chunk` session against the sketch tail).

**Task 2 — build + test (`bs/build/build.md`, `test.md`):**
- Generated `src/rules/{elements,game,actions,flow,index}.ts`: `Pond` (hidden), `Hand` (owner-visible), the real `ask` action (target choice -> rank choice scoped to the asker's own ranks, give-all-matching-cards on a hit, draw-from-pond on a miss, extra turn on hit or matching draw), and the turn/game-loop flow — all following the hand-built `~/BoardSmithGames/go-fish` pattern for the in-scope rules, explicitly omitting book-forming/scoring (documented depth cut, CHUNK.md claim 6). Wired the REAL controller pattern (`useActionController` + `ActionPanel`, no mock) from the start.
- Test step, run for real in order:
  1. `npx tsc --noEmit` — **clean**.
  2. `npx boardsmith lint` — **0 errors** (1 informational `loop-no-max` heuristic false-positive on an already-maxIterations-bounded loop — non-blocking per test.md's own "AST rules are the hard gate, heuristic warnings are informational" distinction).
  3. Chunk unit/integration tests — `tests/game.test.ts` (9 tests: setup counts for 2-3 vs 4-6 players, a real hit scenario searched deterministically across seeds, a real miss/go-fish scenario, rank-choice self-scoping, hidden-info broadcast discipline) — all pass.
  4. Full accumulated suite — 5 test files, 16 tests, all pass.
  5. `simulateRandomGames` (50 games x [2,3,4] player counts) — **0 crashed/stuck/timedOut/exceededMaxActions** (after the F1 fix below; the pre-fix run reliably reported `timedOut` on every game).
  6. A11y floor (ui: major), all 5 items: (1) keyboard-only ActionPanel completion via the REAL `useActionController`+`ActionPanel` (two real choices per selection, not a single auto-filled option, so an actual keyboard-triggered button click was exercised — see `tests/a11y.keyboard-completion.test.ts`); (2) `axe-core` scan on `GameTable.vue` — 0 violations; (3) no hardcoded color literals in the new component (uses `--bsg-*` tokens only); (4) the one interactive control has a real `aria-label` ("Ask another player for a rank"); (5) no animation/focus-trap concerns introduced by this chunk (no dialogs/animated transitions added).
- No dev/preview server was started for this task (all checks are headless `vitest`/`tsc`/`lint` invocations); confirmed no residual process afterward.

**Task 3 — audit + repair + playtest capture (`bs/build/audit.md`, `repair.md`, `playtest.md`):**
- Fidelity+visibility combined pass: read the raw rulebook slices + `RULINGS.md` (never CHUNK.md's `## Interpretation`, per audit's no-framing rule) and the built code directly.
  - **F1 (fidelity, fixed)**: `isFinished()`'s original "pond empty AND every hand empty" condition is unreachable — chunk 1 has no card-removal mechanism (book-forming is out of scope), so once the pond is empty the 52 cards are conserved across hands forever. This is exactly what the test step's `simulateRandomGames` run caught (every game `timedOut` at 1400+ actions). Fixed to the honest depth-cut condition: `isFinished()` returns true as soon as the pond is empty. Re-ran the full test-step sequence after the fix — all green.
- Dedicated visibility lens: ran `diffPlayerViews(testGame, 1, 2)` after several real `ask` exchanges — **0 `attributeDiffs`** (no shared-but-disagreeing card node). Ran `assertNoHiddenInfoLeak` for both seat 1 and seat 2 with an elementId-scoped rank/suit `allow` predicate (the documented pattern for a card's compound `name` making its bare rank/suit redundant) — **both pass, no leak**. Proved the allow predicate isn't vacuous with a no-allow-predicate control test that deliberately injects a bare-rank leak into a view override — **correctly throws** `Hidden-info leak`.
- Undo lens: not applicable — chunk 1 registers no chunk-specific undoable action beyond engine scaffolding; recorded as F3, no defect.
- Design-review lens (ui: major): `GameTable.vue`'s one control has a real `aria-label`, passes `axe-core` clean; no craft-level finding. Recorded as F4 with a pipeline observation (see below) that `design-ask.md`'s first-UI-chunk visual-identity gate was never actually exercised in this dry-run (no `DESIGN.md` exists).
- Repair round 1 closed the ledger (F1 fixed; F2-F4 no defect) — no round 2 needed.
- Playtest step run up to its human gate: `PLAYTEST-SCRIPT.md` captured at the project root (numbered click-by-click script, dev-host affordances, regression/taste/second-seat-leak-check lines) — **no server was started for a human**; the actual human walkthrough is the deferred HUMAN-UAT item for Plan 03, per this plan's explicit instruction.

## Real Check Results (for Plan 03's report)

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `boardsmith lint` (7 sandbox rules) | 0 errors (1 info, non-blocking) |
| Chunk unit/integration tests | 9/9 pass (`tests/game.test.ts`) |
| Full accumulated suite | 16/16 pass across 5 files |
| `simulateRandomGames` (50 x [2,3,4]) | crashed=0, stuck=0, timedOut=0, exceededMaxActions=0 |
| A11y floor (5 items, ui: major) | All 5 pass, real controller wiring (not mocked) |
| Visibility lens (`diffPlayerViews`) | 0 attributeDiffs — no cross-seat card-content disagreement |
| Visibility lens (`assertNoHiddenInfoLeak`) | Pass for seat 1 and seat 2; allow-predicate proven non-vacuous by a failing control case |
| Ask-gate proposal captured | `ASK-PROPOSAL.md` (auto-approved, no live human) |
| Playtest script captured | `PLAYTEST-SCRIPT.md` (not run against a live human) |

## Pipeline Defects / Friction Found (for Plan 03 — NOT fixed at the skill/scaffold level)

### Finding 1 (MEDIUM — build-chunk's own Git Protocol is unimplementable on a freshly-scaffolded project)

`build-chunk.md`'s "Git Protocol" section requires committing at every step completion (`chunk-<slug>/step-<name>`) — but `npx boardsmith init` never runs `git init` (confirmed: no `git init`/`simpleGit`/git invocation anywhere in `src/cli/lib/project-scaffold.ts` or the init command). A freshly scaffolded project therefore has no git repository at all, so the very first `git commit` `build-chunk.md`'s Git Protocol calls for (before `build` starts) would fail outright. This dry-run's scratch project confirmed this directly (`git status` inside it: "fatal: not a git repository"). Disposition: logged for Plan 03 — the scaffold should either run `git init` (+ an initial commit) as part of `boardsmith init`, or `ingest-rules.md`/`build-chunk.md` should explicitly check-and-initialize a repo before relying on the Git Protocol.

### Finding 2 (LOW-MEDIUM — the ask step's human-negotiation value was not really tested)

Both this plan and Plan 01 auto-approve/auto-author the ask-gate content programmatically rather than presenting it to a live human and negotiating part (b)'s ambiguities. The 4-part presentation FORMAT was followed correctly (plain language, citations, deferred list, zero implementation vocabulary), and the Gate-Before-Write ORDER was followed correctly (RULINGS/ASSETS writes, then checklist, then `Status: approved` last) — but the actual value the gate is designed to provide (a human catching a misinterpretation, or making a real house-rule call) was never exercised. This is inherent to a fully-autonomous dry-run and not a skill defect per se, but Plan 03's report should flag it as an untested seam: no run in this phase has proven the ask gate catches a REAL human disagreement.

### Finding 3 (LOW — first-UI-chunk design-ask gate never exercised)

`ask.md`'s "First-UI-Chunk Design Check" (dispatching `design-ask.md` for the visual-identity direction menu, writing `DESIGN.md`) applies to this exact chunk (`ui: major`, first UI chunk, no `DESIGN.md` on disk) but was not exercised — this dry-run's auto-approved ask skipped straight to Parts (a)-(d) without the visual-identity opening `ask.md` itself specifies is mandatory here. Logged for Plan 03: this is the one clear skill-instruction step this dry-run did NOT genuinely follow (as opposed to scaling down fan-out width, which the plan explicitly sanctions).

### Repaired-in-scratch-code defect (NOT a pipeline defect — a real chunk-1 code bug, fixed per Rule 1)

The `isFinished()` reachability bug (Findings Ledger F1) is a genuine build-step defect in the GENERATED game code, not a bs-skill defect — it was found and fixed exactly as the pipeline's test+audit steps are designed to do, and is recorded here only as evidence the pipeline's defect-catching machinery works, not as something for Plan 03 to fix at the skill/scaffold level.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — bug, found by the real test step] `isFinished()` unreachable termination condition**
- Found during: Task 2's test step (`simulateRandomGames` reported `timedOut` on every game).
- Root-caused during: Task 3's audit fidelity lens (F1).
- Issue / Fix: see Findings Ledger F1 and the code comment in `src/rules/game.ts` above.
- Files modified: `<scratch>/go-fish-dryrun/src/rules/game.ts` only (throwaway, not committed).

**2. [Rule 1 — bug, found while writing the a11y keyboard-completion test] single-choice fixtures auto-execute, proving nothing about keyboard completion**
- Found during: Task 2's test-step authoring (first draft of `a11y.keyboard-completion.test.ts` used one choice per selection; `useActionController`'s `autoFill`+`autoExecute` completed the whole action on `start()` with zero buttons rendered, before any keyboard event was even dispatched).
- Fix: switched both `target` and `rank` fixtures to two real choices each, forcing an actual click-through of the real `fill -> fetchChoicesForPick -> snapshotVersion++ -> currentChoices` chain (per `interaction-integration.test.ts`'s documented precedent).
- Files modified: `<scratch>/go-fish-dryrun/tests/a11y.keyboard-completion.test.ts` only.

**3. [Rule 1 — bug, found while writing unit tests] `ActionExecutionResult`/`TestGame.tryAction` does not surface the action's own `.data` return value**
- Found during: Task 2's unit-test authoring (first draft asserted on `result.data?.gotCards`/`result.data?.extraTurn`; `ActionExecutionResult` (`src/runtime/runner.ts`) has no `data` field at all — only `success`/`error`/`errorCode`/`flowState`/etc.).
- Fix: rewrote the two affected assertions to check observable game state instead (hand sizes, `getCardsOfRank`, `getFlowState().currentPlayer`) — matches the pattern the hand-built go-fish's own test suite uses (it never asserts on `result.data` either).
- Files modified: `<scratch>/go-fish-dryrun/tests/game.test.ts` only.

No other deviations — Task 1's investigate/redteam/ask logic and Task 3's audit/repair/playtest-capture logic ran as the real skill files specify.

## Known Stubs

- `GoFishDryrunGame.getWinners()` returns "every player" once `isFinished()` (a placeholder — chunk 1 has no scoring, so there is no real winner to compute yet). Documented in-code and in CHUNK.md claim 6 as an intentional depth cut; the `game-end-scoring` sketch-tail chunk (Plan 01's mandated tail entry) owns the real implementation.
- `Books` element class (`src/rules/elements.ts`) is defined but never instantiated/wired into this chunk's flow — explicitly a placeholder for the future book-forming chunk, documented in its own doc comment.

## Threat Flags

None beyond what T-149-02 (the plan's own threat register entry) already anticipated: the generated `ask` action + Hand/Pond visibility was the mitigation target, and the audit visibility lens (`diffPlayerViews`/`assertNoHiddenInfoLeak`) proved it holds. No new network/auth/schema surface was introduced. `~/BoardSmithGames/go-fish/` was read-only referenced (four non-mutating reads: `game.ts`, `elements.ts`, `actions.ts`, `flow.ts`, plus the two DOM-leak test files for pattern reference) and never written.

## Self-Check: PASSED

- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/src/rules/actions.ts` (contains `createAskAction`)
- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/tests/no-hidden-info-leak.test.ts` (contains `diffPlayerViews`/`assertNoHiddenInfoLeak`)
- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/tests/random-simulation.test.ts` (contains `simulateRandomGames`)
- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/ASK-PROPOSAL.md`
- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/PLAYTEST-SCRIPT.md`
- FOUND: `/tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun/chunks/core-event-loop/CHUNK.md` (contains "Findings Ledger" and "Visibility Declaration")
- CONFIRMED: full test suite green at time of writing (16/16 tests, 5 files) — re-run: `cd /tmp/bs-dryrun-149.L7EU9I/go-fish-dryrun && npx tsc --noEmit && npx boardsmith lint && npx vitest run`
- CONFIRMED: no `boardsmith dev`/vite/vitest process left running (`ps aux | grep -i "boardsmith dev\|vite"` — empty)
- CONFIRMED: `~/BoardSmithGames/go-fish/` untouched (read-only references only, no writes issued)
- No git commits reference scratch-dir paths in THIS repo's history — the scratch project itself has no git repository at all (see Finding 1 above); this SUMMARY.md is the durable record, matching Plan 01's precedent.
