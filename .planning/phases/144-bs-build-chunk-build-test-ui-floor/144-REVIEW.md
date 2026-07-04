---
phase: 144-bs-build-chunk-build-test-ui-floor
reviewed: 2026-07-04T18:15:00Z
depth: standard
iteration: 2
files_reviewed: 9
files_reviewed_list:
  - src/cli/slash-command/bs/build/build.md
  - src/cli/slash-command/bs/build/test.md
  - src/cli/slash-command/bs/build/design-ask.md
  - src/cli/slash-command/bs/build/ask.md
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/bs/build-chunk.test.ts
  - src/cli/lib/project-scaffold.ts
  - src/cli/lib/project-scaffold.test.ts
  - src/cli/lib/project-scaffold.a11y.test.ts
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
status: issues_found
---

# Phase 144: Code Review Report (Iteration 2)

**Reviewed:** 2026-07-04T18:15:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found (0 blockers — all iteration-1 findings verified resolved)

## Summary

Re-review of the fix commits `be90d7ed..fc590cee`. All six iteration-1 findings are genuinely
resolved, and I verified each empirically rather than trusting the diff:

- **CR-01 (detached-node axe throw) — RESOLVED, verified.** `generateA11yExampleTestTs`
  now emits `mount(GameTable, { attachTo: document.body, ... })` with an unconditional
  `wrapper.unmount()` in a `finally`. `build/test.md`'s documented axe pattern carries the same
  `attachTo: document.body` + `finally`/unmount shape, so the fix propagates to every future UI
  chunk. I generated the real `GameTable.vue` to a temp dir and mounted it under jsdom with the
  exact harness props (`availableActions: []`, `isMyTurn: true`, `actionController: {} as never`)
  using BoardSmith's installed `@vue/test-utils` + `@vitejs/plugin-vue`: it renders, attaches to
  `document.body` (`document.body.contains(wrapper.element) === true`), and unmounts cleanly. The
  precondition `axe.run()` requires is met by the real component.
- **CR-02 (missing jsdom devDep) — RESOLVED, verified.** `jsdom: '^29.1.1'` is in the generated
  `devDependencies`. All three new devDeps resolve on the registry and are coherent together:
  `jsdom 29.1.1`, `@vue/test-utils 2.4.11`, `axe-core 4.12.1` (confirmed via `npm view` and
  against BoardSmith's own installed `node_modules`), all compatible with the pinned
  `vitest ^2.0.0`.
- **WR-02 (flow-deadlock gate) — RESOLVED, verified.** `build/test.md` now asserts all four of
  `results.crashed/stuck/timedOut/exceededMaxActions === 0`. Confirmed `timedOut` and
  `exceededMaxActions` are real numeric fields on `SimulationResults`
  (`src/testing/random-simulation.ts:104-110`).
- **WR-03 (hardcoded `#888`) — RESOLVED, verified.** Replaced with `var(--bsg-ink-2)`; a full
  color-literal grep of `project-scaffold.ts` returns zero hex/rgb/hsl literals.
- **WR-04 / WR-01 single design-ask gate — RESOLVED, consistent.** `ask.md` and `design-ask.md`
  now agree: "the ask IS the design ask", one human-approval boundary, one explicit "yes"
  authorizing `DESIGN.md` (write step 0) before the interpretation-gate writes, `Status: approved`
  written last, SKETCH.md mirror second. This matches `bs-skills-plan.md` §UI (lines 117-119, "the
  first UI chunk's `ask` is the **design ask**") exactly. No two-gate residue remains.

All 85 tests across the three suites pass (`project-scaffold.test.ts` 24, `.a11y.test.ts` 3,
`build-chunk.test.ts` 58), including the real `tsc` compile of the generated rules module.

The remaining findings are quality gaps around how much of the generated a11y harness is actually
exercised in-repo — none is a blocker.

## Warnings

### WR-01: Generated a11y harness's `axe.run()` path is never executed anywhere in-repo

**File:** `src/cli/lib/project-scaffold.a11y.test.ts:1-61`; `src/cli/lib/project-scaffold.test.ts:177-215`

**Issue:** The iteration-1 CR-01 fix is proven two ways, and both stop short of running the
generated harness end-to-end:
1. `project-scaffold.test.ts` asserts only *strings* in the emitted source (`attachTo:
   document.body`, `wrapper.unmount()`, `finally`) — it never compiles or runs the generated
   test.
2. `project-scaffold.a11y.test.ts` genuinely executes the attach/detach invariant with the real
   `@vue/test-utils` + jsdom stack, but against a hand-written `Fixture` component and it
   deliberately does **not** import `axe-core` (with an accurate comment explaining axe-core is
   only the generated project's devDep). So it proves "attachTo yields an attached node", not
   "`axe.run(wrapper.element)` succeeds against the real `GameTable.vue`."

Net: no test in this repo imports the real generated `GameTable.vue` and calls `axe.run()` on it.
If `axe.run()` were to throw under jsdom for a reason unrelated to attachment (a future axe/jsdom
incompatibility, an axe rule needing a layout box jsdom can't provide), nothing here catches it —
the failure would first surface in a downstream generated game.

This is defensible (adding `axe-core` as a BoardSmith devDep purely to test generated-project code
is a real cost), and `project-scaffold.a11y.test.ts` is a *real* proof of the narrow invariant it
claims — not superficial. But it is narrower than "the generated a11y harness is proven runnable."

**Fix:** Either (a) accept the boundary and add a one-line comment at the top of
`generateA11yExampleTestTs` noting the emitted `axe.run()` path is validated only in generated
projects, not in BoardSmith CI; or (b) add `axe-core` as a BoardSmith devDependency and extend
`project-scaffold.a11y.test.ts` with one case that mounts the real generated `GameTable.vue`
(reuse the temp-dir + generator pattern already in `project-scaffold.test.ts`'s CR-01 compile
test) and runs `axe.run(wrapper.element)` — closing the gap the string-greps leave.

### WR-02: The a11y example scans a near-empty render, giving shallow example coverage

**File:** `src/cli/lib/project-scaffold.ts:466-498` (`generateA11yExampleTestTs`)

**Issue:** The harness mounts `GameTable` with `availableActions: []`. In `GameTable.vue`,
`canTakeAction = availableActions.length > 0` is therefore `false`, so the
`v-if="canTakeAction && isMyTurn"` action `<button>` never renders. The axe scan runs over just
`div.game-board > div.turn-status > span "Your Turn"` — no interactive control, no aria-label, no
focusable element. The one element in `GameTable.vue` that a11y actually cares about (the action
button with its keyboard path and label) is never in the scanned tree. As the copy-me template
for "every UI chunk's a11y floor", this teaches a pattern that passes green while never scanning a
real control — false confidence for authors who copy it verbatim.

**Fix:** Give the example non-empty `availableActions` (e.g. `['draw']`) so the action button
renders and axe scans a real interactive control, exercising the label/role path the a11y floor
exists to protect. Update the prop in `generateA11yExampleTestTs` (and the matching
`project-scaffold.a11y.test.ts` fixture if you want the executed proof to cover a control too).

## Info

### IN-01: Generated `test` script is `vitest` (watch) rather than `vitest run`

**File:** `src/cli/lib/project-scaffold.ts:131` (`generatePackageJson`, `scripts.test: 'vitest'`)

**Issue:** A freshly scaffolded game's `npm test` runs bare `vitest`, which enters interactive
watch mode in a TTY and never exits. The a11y floor (`build/test.md`) is meant to be driven as
`npm test` in generated games; in an agent/CI (non-TTY) context vitest v2 auto-runs once and
exits, so this usually works, but it is fragile and inconsistent with BoardSmith's own
`"test": "vitest run"` (`package.json:64`). Not touched by this phase's change, but relevant to
the a11y-floor workflow this phase ships.

**Fix:** Change the generated script to `"test": "vitest run"` (optionally add
`"test:watch": "vitest"`) so `npm test` is deterministic and exits.

---

_Reviewed: 2026-07-04T18:15:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (iteration 2)_
