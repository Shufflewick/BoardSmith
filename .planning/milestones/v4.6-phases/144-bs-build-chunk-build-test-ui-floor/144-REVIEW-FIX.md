---
phase: 144-bs-build-chunk-build-test-ui-floor
fixed_at: 2026-07-04T18:20:00Z
review_path: .planning/phases/144-bs-build-chunk-build-test-ui-floor/144-REVIEW.md
iteration: 3
findings_in_scope: 3
fixed: 2
skipped: 1
status: partial
---

# Phase 144: Code Review Fix Report

**Fixed at:** 2026-07-04T18:20:00Z
**Source review:** .planning/phases/144-bs-build-chunk-build-test-ui-floor/144-REVIEW.md
**Iteration:** 3

**Summary:**
- Findings in scope: 3 (2 warning + 1 info; IN-01 included per explicit fix instruction)
- Fixed: 2 (WR-02, IN-01)
- Skipped: 1 (WR-01 — accepted limitation, see below)

## Fixed Issues

### WR-02: The a11y example scanned a near-empty render

**Files modified:** `src/cli/lib/project-scaffold.ts`
**Commit:** a3944d98
**Applied fix:** Changed `generateA11yExampleTestTs`'s mount props from
`availableActions: []` to `availableActions: ['draw']`, so `GameTable`'s
`canTakeAction` is true and the action `<button>` renders — putting a real
focusable interactive control into the tree axe scans (previously axe only saw
`div.game-board > div.turn-status > span "Your Turn"`, no control at all). Also
added a game-semantic `:aria-label="\`Take the ${firstAction} action\`"` to the
button in `generateGameTableVue` so the copy-me template teaches the
label/role path the a11y floor exists to protect (the accessible name contains
the visible text "draw", satisfying axe's label-content-name-mismatch rule).
Added an explanatory comment in the emitted test so authors know to swap 'draw'
for one of their own action names.

**End-to-end proof (per fix instruction):** Generated the real `GameTable.vue`
and the a11y test to a temp project with the exact pinned scaffold devDeps
(`vue ^3.4.0`, `@vitejs/plugin-vue ^5.0.0`, `vitest ^2.0.0`, `jsdom ^29.1.1`,
`axe-core ^4.12.1`, `@vue/test-utils ^2.4.11`), `npm install`ed, and ran it.
The generated `axe.run(wrapper.element)` scan passes green, and a supplementary
assertion confirmed a `button.action-button` with `aria-label="Take the draw
action"` is actually attached to `document.body` in the scanned tree. The temp
dir was deleted and no test processes were left running.

### IN-01: Generated `test` script was bare `vitest` (watch mode)

**Files modified:** `src/cli/lib/project-scaffold.ts`
**Commit:** 9a663b64
**Applied fix:** Changed `generatePackageJson`'s `scripts.test` from `'vitest'`
to `'vitest run'` (matching BoardSmith's own `package.json` convention and the
no-hanging-process hard rule) and added `'test:watch': 'vitest'` for interactive
watch mode. Audited the other generated scripts for the same footgun: `dev`
(`npx boardsmith dev`) is an intentional long-running dev server; `build`,
`lint`, and `validate` are one-shot commands — none enters watch mode, so no
further changes were needed.

## Skipped Issues

### WR-01: Generated a11y harness's `axe.run()` path is never executed in-repo

**File:** `src/cli/lib/project-scaffold.a11y.test.ts:1-61`; `src/cli/lib/project-scaffold.test.ts:177-215`
**Reason:** Accepted limitation — skipped intentionally. axe-core is deliberately
NOT a BoardSmith dependency; it belongs only in the generated project's
devDependencies. Adding it to BoardSmith's own deps purely to test
generated-project code is an unwarranted cost. The actual `axe.run()` path
against the real generated `GameTable.vue` was proven end-to-end via the
iteration-1 scaffold-install scaffold (and re-proven this iteration in the WR-02
temp-project run above: real component, real axe-core, green scan with a real
button in the tree). `project-scaffold.a11y.test.ts` remains a genuine proof of
the narrow attach/detach invariant axe requires. No source change made.
**Original issue:** The in-repo proofs stop short of running the generated
harness end-to-end (string-greps + a hand-written fixture rather than importing
the real `GameTable.vue` and calling `axe.run()`), so a future axe/jsdom
incompatibility would first surface in a downstream generated game.

## Verification

- `npx vitest run src/cli/lib/project-scaffold.test.ts src/cli/lib/project-scaffold.a11y.test.ts src/cli/slash-command/bs/` — 169 passed (5 files).
- `npm test` (full suite) — 2540 passed (182 files).
- `git status --short package.json package-lock.json` — empty (no dependency drift).
- WR-02 temp-project end-to-end proof — green, real button + real axe-core scan, temp dir removed, no leftover processes.

---

_Fixed: 2026-07-04T18:20:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
