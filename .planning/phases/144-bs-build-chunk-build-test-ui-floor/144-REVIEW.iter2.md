---
phase: 144-bs-build-chunk-build-test-ui-floor
reviewed: 2026-07-04T18:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/cli/slash-command/bs/build/build.md
  - src/cli/slash-command/bs/build/test.md
  - src/cli/slash-command/bs/build/design-ask.md
  - src/cli/slash-command/bs/build/ask.md
  - src/cli/slash-command/bs/build-chunk.md
  - src/cli/slash-command/bs/build-chunk.test.ts
  - src/cli/lib/project-scaffold.ts
  - src/cli/lib/project-scaffold.test.ts
findings:
  critical: 2
  warning: 4
  info: 0
  total: 6
status: issues_found
---

# Phase 144: Code Review Report

**Reviewed:** 2026-07-04T18:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 144 authored the `build` + `test` step-group reference files, the first-UI-chunk
`design-ask.md` gate, and a real scaffold-template change (axe-core + @vue/test-utils devDeps +
a generated `tests/a11y.example.test.ts`).

The markdown skill files hold up well against the plan and the shared templates: every cited API
name (`simulateRandomGames` and its `count`/`playerCounts`/`timeout`/`seed` options,
`results.crashed`/`results.stuck`), all seven sandbox rule names, `sandbox-scan.ts` as the SSOT
for `validate`+`lint`, the precedent files (`CardRenderer.a11y.test.ts`,
`interaction-integration.test.ts`), and the reactive-chain names (`fetchChoicesForPick`,
`snapshotVersion`) all resolve to real code. Template section names cited by `design-ask.md`
(DESIGN.template.md's 6 headings), `build.md` (`| File | Status |` Build Manifest), and `ask.md`
(ASSETS 5-column ledger) are byte-consistent. Both test suites pass (78 tests green).

The serious problems are in the **real generated code**. The centerpiece deliverable — the
a11y example test every UI chunk is meant to copy — **cannot run** for two independent reasons,
and the documented axe pattern in `test.md` carries the same defect, so it propagates to every
future UI chunk. The test suite passes green only because its a11y assertions are string-greps
that never compile or execute the generated test — which is exactly why it caught neither defect.

## Critical Issues

### CR-01: Generated a11y test throws on every run — `axe.run()` on a detached element

**File:** `src/cli/lib/project-scaffold.ts:463-486` (`generateA11yExampleTestTs`); same defect in `src/cli/slash-command/bs/build/test.md:91-98`

**Issue:** The generated test mounts the component with `mount(GameTable, { props: {...} })`
and then calls `await axe.run(wrapper.element)`. `@vue/test-utils` `mount` **without** `attachTo`
renders into a **detached** DOM node (not connected to `document`). `axe.run()` on a detached
node throws — I verified this empirically under jsdom 29 + axe-core 4.12:

```
DETACHED: axe.run THREW -> No elements found for include in page Context
ATTACHED: axe.run succeeded, violations = 0
```

So `tests/a11y.example.test.ts` fails unconditionally in every freshly scaffolded game. This is
not a hypothetical: BoardSmith's own only-working a11y precedent, `Toast.a11y.test.ts:57`, mounts
with `attachTo: document.body` precisely for this reason — the scaffold and `test.md` diverged
from the one pattern that works. `test.md`'s item-2 code block (`mount(SomeComponent, {...})` then
`axe.run(wrapper.element)`) has the identical omission, so every `ui: touches|major` chunk that
copies the documented pattern inherits a test that always throws.

**Fix:** Attach on mount and detach after, in both the generator and `test.md`:

```typescript
const wrapper = mount(GameTable, {
  attachTo: document.body,          // axe.run requires the node be in the document
  props: { gameView: null, playerSeat: 0, isMyTurn: true, availableActions: [], actionController: {} as never },
});
try {
  const results = await axe.run(wrapper.element);
  expect(results.violations).toEqual([]);
} finally {
  wrapper.unmount();                // detach so the node doesn't leak into the next test
}
```

### CR-02: `jsdom` is missing from the generated project's devDependencies

**File:** `src/cli/lib/project-scaffold.ts:139-145` (`generatePackageJson`); consumed at `:464` (`// @vitest-environment jsdom`)

**Issue:** The generated a11y test opens with `// @vitest-environment jsdom`, but the scaffold's
`devDependencies` list only `@vitejs/plugin-vue`, `typescript`, `vitest`, `axe-core`, and
`@vue/test-utils` — **no `jsdom`**. Vitest v2 does not bundle jsdom; requesting the `jsdom`
environment without the package installed fails with `Cannot find package 'jsdom'`. BoardSmith's
own `package.json` carries `"jsdom": "^29.1.1"` for exactly this reason (`@vue/test-utils` + axe
both need a DOM). In a published game (`boardsmith: '^0.0.1'`) jsdom is unambiguously absent; even
in local-dev (`file:` link) it is not guaranteed to hoist from BoardSmith's own node_modules. Net
effect: `npm test` in a fresh scaffold is red out of the box — a direct Pit-of-Success violation
(the generated project should start green).

**Fix:** Add jsdom to the generated devDependencies alongside the axe/test-utils additions:

```typescript
devDependencies: {
  '@vitejs/plugin-vue': '^5.0.0',
  typescript: '^5.7.0',
  vitest: '^2.0.0',
  jsdom: '^29.1.1',            // required by the `@vitest-environment jsdom` a11y example
  'axe-core': '^4.12.1',
  '@vue/test-utils': '^2.4.11',
},
```

## Warnings

### WR-01: a11y-example test coverage in `project-scaffold.test.ts` is superficial

**File:** `src/cli/lib/project-scaffold.test.ts:170-187`

**Issue:** For the rules module, the suite does a **real** tsc compile against the live engine
(`generateRulesIndexTs` CR-01 regression, lines 110-148) — that is exactly the right rigor. But
the new a11y-example coverage only string-greps the generated output (`toContain("from 'axe-core'")`,
`toContain('axe.run(')`). It never compiles the generated test, never mounts `GameTable`, never
runs axe. That is why the suite is green while both CR-01 and CR-02 ship broken. The test name at
line 176 ("imports axe-core and calls axe.run(") overstates what is actually verified. The whole
point of shipping an a11y example is that it *runs*; the test proves only that a string is present.

**Fix:** Mirror the rules-module approach — actually execute the generated harness in a jsdom
vitest env (mount a trivial fixture component, add `attachTo`, assert `axe.run` resolves and
`violations` is an array), or at minimum type-check the generated `.test.ts` the way the rules
module is type-checked. A grep-only assertion cannot catch a detached-node throw or a missing
environment dependency.

### WR-02: `test.md` random-sim gate misses timeout / max-action deadlocks

**File:** `src/cli/slash-command/bs/build/test.md:50-62`

**Issue:** The random-sim step asserts only `results.crashed === 0` and `results.stuck === 0`.
`SimulationResults` also exposes `timedOut` and `exceededMaxActions` (see
`src/testing/random-simulation.ts:100-118`). A flow that loops forever while still producing
*valid* moves is not `crashed` and not `stuck` (stuck = "could not produce a valid move") — it
surfaces as `exceededMaxActions` or `timedOut`. Those are precisely the "flow deadlock" class the
plan (§build-chunk step 5) says this step exists to catch ("catches flow deadlocks a 5-minute
human playtest never reaches"). As written, an infinite-loop flow passes this gate.

**Fix:** Assert the full failure set:

```typescript
expect(results.crashed).toBe(0);
expect(results.stuck).toBe(0);
expect(results.timedOut).toBe(0);
expect(results.exceededMaxActions).toBe(0);
```

### WR-03: Generated components hardcode `#888` — violates the token-discipline rule this phase codifies

**File:** `src/cli/lib/project-scaffold.ts:277` (App.vue shared styles) and `:434` (GameTable.vue)

**Issue:** `design-ask.md` (Token Discipline) makes this a verbatim hard rule: "color literals
live ONLY in the Theme Block; ... a literal color anywhere outside the Theme Block is a
pit-of-failure that silently breaks that [WCAG AA] guarantee." Yet the same phase's scaffold emits
`.stat-label { color: #888; }` and `.waiting { color: #888; }` in the generated `App.vue` and
`GameTable.vue` — raw hex outside any theme block. Worse, `GameTable.vue` is the exact component
the a11y example test mounts as the copyable reference, and it is the "start here" custom-UI stub,
so the generated starting point models the wrong path. (axe-core will not flag this — `test.md`
item 3 acknowledges color literals are caught by grep, not axe — so nothing in the pipeline
catches the scaffold's own violation.)

**Fix:** Replace the `#888` literals with a `--bsg-*` muted/secondary text token (e.g.
`var(--bsg-text-muted)` or the nearest existing Slate token), so the generated components model
the token discipline every downstream chunk is held to.

### WR-04: `design-ask` is a prepended pre-check, not "the ask" — drift from the plan

**File:** `src/cli/slash-command/bs/build/ask.md:10-16` and `src/cli/slash-command/bs/build/design-ask.md:1-7`

**Issue:** The plan (§UI, "Visual identity") states "The first UI chunk's `ask` **is** the design
ask." The implementation instead makes `design-ask.md` a pre-check that "runs to completion ...
before ask.md's 4-part gate proceeds" — and both files independently mandate their own
explicit-approval Gate-Before-Write. The result is **two sequential "explicit yes" gates inside a
single `ask` step** for the first UI chunk (direction approval, then the 4-part interpretation
gate). This is a defensible elaboration, but it is a real divergence from the plan's wording and a
heavier human-gate load than "the ask is the design ask" implies. If the double-gate is intended,
say so explicitly in `ask.md` so a resuming session doesn't treat the design-ask approval as
having satisfied the 4-part gate (or vice-versa); if not, collapse them.

**Fix:** Reconcile the wording — either update the plan/`ask.md` to state the first-UI-chunk `ask`
runs two nested gates by design, or fold the direction choice into part (b) of the 4-part gate so
there is a single approval boundary as the plan describes.

---

_Reviewed: 2026-07-04T18:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
