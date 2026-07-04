---
phase: 144-bs-build-chunk-build-test-ui-floor
fixed_at: 2026-07-04T18:10:00Z
review_path: .planning/phases/144-bs-build-chunk-build-test-ui-floor/144-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 144: Code Review Fix Report

**Fixed at:** 2026-07-04T18:10:00Z
**Source review:** .planning/phases/144-bs-build-chunk-build-test-ui-floor/144-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (2 critical + 4 warning; `fix_scope: critical_warning`)
- Fixed: 6
- Skipped: 0

**Verification (post-fix):**
- `npx vitest run src/cli/slash-command/bs/ src/cli/lib/project-scaffold.test.ts` — 166/166 green.
- `npm test` (full suite) — 182 files, 2540/2540 green.
- `git status --short package.json package-lock.json` — empty (axe-core/jsdom live ONLY in the generated template, never BoardSmith's own manifest).
- End-to-end proof: emitted the REAL scaffold `GameTable.vue` + `tests/a11y.example.test.ts`, `npm install`ed the pinned test devDeps, and ran the generated test in a fresh jsdom env — 1/1 green (proves CR-01 attachTo + CR-02 jsdom together). Temp dir and symlink removed; no stray processes.

## Fixed Issues

### CR-01: Generated a11y test throws on every run — `axe.run()` on a detached element

**Files modified:** `src/cli/lib/project-scaffold.ts`, `src/cli/slash-command/bs/build/test.md`
**Commit:** be90d7ed
**Applied fix:** `generateA11yExampleTestTs()` now mounts with `attachTo: document.body` (so `axe.run()` scans an attached node) and unmounts in a `finally` so the node never leaks into the next test — mirroring the working `Toast.a11y.test.ts` precedent. Applied the identical change to `test.md`'s item-2 documented axe pattern so every `ui: touches|major` chunk that copies it inherits the correct, runnable shape. Verified end-to-end: the generated test now passes under jsdom.

### CR-02: `jsdom` is missing from the generated project's devDependencies

**Files modified:** `src/cli/lib/project-scaffold.ts`
**Commit:** 3dd5c5f1
**Applied fix:** Added `jsdom: '^29.1.1'` to `generatePackageJson()`'s generated `devDependencies` (the `@vitest-environment jsdom` a11y example needs it; vitest v2 does not bundle jsdom). Confirmed it lands ONLY in the generated template — BoardSmith's own `package.json`/`package-lock.json` are untouched.

### WR-01: a11y-example test coverage in `project-scaffold.test.ts` is superficial

**Files modified:** `src/cli/lib/project-scaffold.test.ts`, `src/cli/lib/project-scaffold.a11y.test.ts` (new)
**Commit:** fc590cee
**Applied fix:** Replaced the grep-only coverage with regression-pinning assertions: the generated harness must contain `attachTo: document.body` (CR-01), an unconditional `finally { ... wrapper.unmount() }` (CR-01 leak), and `// @vitest-environment jsdom`; the generated `package.json` must list `jsdom` (CR-02). Added a new **executable** jsdom test file (`project-scaffold.a11y.test.ts`) that proves the invariant `axe.run` depends on using the real `@vue/test-utils` + jsdom stack BoardSmith already ships: `mount` without `attachTo` yields a detached node, `attachTo: document.body` yields an attached node, and `unmount()` detaches it. A revert of the CR-01 fix now turns this red. Note: axe-core is deliberately NOT imported here (it belongs only in the generated project's devDeps, never BoardSmith's), so this proves the precondition axe requires; the full axe run is proven separately by the end-to-end scaffold install above.

### WR-02: `test.md` random-sim gate misses timeout / max-action deadlocks

**Files modified:** `src/cli/slash-command/bs/build/test.md`
**Commit:** 68cb664a
**Applied fix:** The random-sim gate now asserts all four failure fields — `crashed`, `stuck`, `timedOut`, and `exceededMaxActions` — must be `0`, with prose explaining that an infinite-loop flow producing valid moves surfaces as `timedOut`/`exceededMaxActions`, not `crashed`/`stuck`. Verified these are the real fields on `SimulationResults` in `src/testing/random-simulation.ts`.

### WR-03: Generated components hardcode `#888` — violates the token-discipline rule this phase codifies

**Files modified:** `src/cli/lib/project-scaffold.ts`
**Commit:** cfa047cc
**Applied fix:** Replaced both `#888` literals (`.stat-label` in the generated `App.vue` shared styles and `.waiting` in `GameTable.vue`) with `var(--bsg-ink-2)`, the Slate secondary/muted foreground token (WCAG-tuned for both themes in `src/ui/theme.ts`). The scaffold's own starting point now models the token discipline every downstream chunk is held to. Confirmed no hex literals remain in `project-scaffold.ts`.

### WR-04: `design-ask` is a prepended pre-check, not "the ask" — drift from the plan

**Files modified:** `src/cli/slash-command/bs/build/ask.md`, `src/cli/slash-command/bs/build/design-ask.md`
**Commit:** d18aaf3c
**Applied fix:** Reconciled toward the milestone plan's "the first UI chunk's ask IS the design ask": `ask.md` now frames the visual-identity direction menu as the opening of a **single** ask presented together with the 4-part interpretation gate under one human-approval boundary, with `DESIGN.md` written as Step 0 of that gate's single write sequence (authorized by the same explicit "yes"). `design-ask.md`'s header and Gate-Before-Write were updated to state its direction choice is surfaced into that one ask rather than running a separate earlier approval turn. UIQ-01 and BUILD-04 tests remain green (they assert the three directions, Derive default, `DESIGN.md` write, and the pre-check hook — all preserved).

---

_Fixed: 2026-07-04T18:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
