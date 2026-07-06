---
phase: 152-asset-completeness-in-bs-build-chunk
reviewed: 2026-07-06T15:29:40Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - src/cli/lib/project-scaffold.ts
  - src/ui/components/auto-ui/renderers/CardRenderer.vue
  - src/ui/components/auto-ui/renderers/PieceRenderer.vue
  - src/cli/lib/asset-scan.ts
  - src/cli/slash-command/bs/build/build.md
  - src/cli/slash-command/bs/build/test.md
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: resolved
resolution: "All findings fixed in commit after review — CR-01 (watch/reset on src change) + WR-01 (path-based exclusion) + WR-02 (case-insensitive regex, no kebab false-positive) + WR-03 (renderer src-change regression tests) + WR-04 (docstring softened). Full suite green (2675). IN-01/IN-02 left as noted (out of scope / pre-existing)."
---

# Phase 152: Code Review Report

**Reviewed:** 2026-07-06T15:29:40Z
**Depth:** deep
**Files Reviewed:** 6 (+ fixtures/tests inspected for corroboration)
**Status:** issues_found

## Summary

Phase 152 adds three cooperating pieces: a scaffolded `AssetImage.vue` component
(`generateAssetImageVue()`), load-guards on `CardRenderer.vue`/`PieceRenderer.vue`'s
own inline image branches, and a static `scanAssetReachability()` scanner that
build-blocks on bare `<img>` tags outside `AssetImage.vue`.

`CardRenderer.vue` and `PieceRenderer.vue` are implemented correctly: both add a
`watch()` that resets `loaded` to `false` whenever the resolved image src changes,
which is exactly the guard needed to prevent a stale `loaded=true` from flashing a
broken/blank image when a card or piece is reused for a different asset.

`generateAssetImageVue()` — the scaffolded component that ships into **every**
generated game and is the one sanctioned wrapper the whole phase's asset-gate
policy is built around — is missing that exact same reset. This is the phase's one
real (critical) defect; everything else is either a coarse-heuristic robustness gap
in `asset-scan.ts` or a test-coverage gap for a guard that is otherwise implemented
correctly. All existing tests (`asset-scan.test.ts`, `project-scaffold.test.ts`,
`CardRenderer.asset-fallback.test.ts`, `PieceRenderer.asset-fallback.test.ts`) pass
and do not exercise the missing-reset case or the scanner's edge cases below.

## Critical Issues

### CR-01: `AssetImage.vue`'s generated component never resets `loaded` when `src` changes

**File:** `src/cli/lib/project-scaffold.ts:543-653` (`generateAssetImageVue()`, emitted `<script setup>` at lines 554-590)
**Issue:**
The emitted component declares `const loaded = ref(false)`, sets it `true` on
`@load`, and `false` on `@error` — but never watches `props.src`. If the same
`AssetImage` component instance is reused for a different asset (the ordinary case
in any `v-for` over a hand/board that doesn't force a new instance per src — e.g.
`v-for="(card, i) in hand" :key="i"`, or any parent that just re-binds `:src` on a
stable instance), `loaded` carries over `true` from the previous image. The new
`<img>`'s `src` attribute updates immediately while `loaded` (and thus the
`is-loaded` opacity-1 class) is already `true`, so the overlay `<img>` is rendered
at full opacity *before* its own `@load`/`@error` for the new src has fired —
exactly the "broken/blank image flash" this phase's DEF-A guard exists to prevent.
If the new src then 404s, there is a visible flash of a broken-image icon at full
opacity before `@error` reverts it (rather than the intended "never visible while
unresolved" behavior).

This is not a hypothetical: the sibling fixes in the very same phase —
`CardRenderer.vue:287-292` and `PieceRenderer.vue:154-157` — each add exactly this
`watch(...) { loaded.value = false }` guard, explicitly commented `"Reset when the
resolved src changes so a card/piece reused for a different asset re-guards"`. The
phase's own test fixture at
`src/cli/lib/__fixtures__/asset-scan/wrapped/src/ui/components/AssetImage.vue`
(used only to prove the scanner treats a *correct* wrapper as a PASS) independently
implements the same reset via `watch(() => props.src, ... loaded.value = false ...)`
— i.e. the phase's own reference/fixture code demonstrates the fix is understood to
be required, yet the actual `generateAssetImageVue()` output that ships to real
generated projects lacks it.

**Fix:**
```ts
import { ref, watch } from 'vue';
...
const loaded = ref(false);

watch(
  () => props.src,
  () => {
    loaded.value = false;
  },
);

function onLoad() {
  loaded.value = true;
}

function onError() {
  loaded.value = false;
}
```
Add this to the string literal inside `generateAssetImageVue()` (import `watch`
alongside `ref`), and add a regression test in `project-scaffold.test.ts` (e.g.
`expect(out).toMatch(/watch\(\s*\(\)\s*=>\s*props\.src/)`) plus a
`@vue/test-utils` mount test that changes `src` via `setProps` and asserts
`loaded` (and the `is-loaded` class) resets to false before any new load/error
event.

## Warnings

### WR-01: `asset-scan.ts` excludes `AssetImage.vue` by basename only, not by path

**File:** `src/cli/lib/asset-scan.ts:59-61`
**Issue:** The exclusion is `basename(filePath) === 'AssetImage.vue'`, checked
regardless of directory. Any file anywhere under `src/ui` named `AssetImage.vue`
— including a copy-pasted or hand-rolled one that itself contains a real bare
`<img>` — is silently exempted from the gate. This defeats the "single sanctioned
wrapper" guarantee the scanner's own docstring claims ("the coarse ... heuristic
... flags any bare `<img` tag found outside `AssetImage.vue`'s own definition").
A stray or malicious second `AssetImage.vue` (e.g.
`src/ui/components/legacy/AssetImage.vue`) bypasses the build-blocking check
entirely.
**Fix:** Compare against the known scaffold-relative path, not just the basename:
```ts
const ASSET_IMAGE_RELATIVE_PATH = join('src', 'ui', 'components', 'AssetImage.vue');
...
if (relative(cwd, filePath) === ASSET_IMAGE_RELATIVE_PATH) continue;
```

### WR-02: `BARE_IMG_TAG` regex has both false-positive and false-negative gaps

**File:** `src/cli/lib/asset-scan.ts:46, 67`
**Issue:** `/<img\b/` (no `i` flag, one line at a time):
- **False negative:** HTML tag names are case-insensitive; `<IMG src=...>` or
  `<Img ...>` renders as a real `<img>` element in the browser but will never be
  flagged (no `i` flag).
- **False positive:** `\b` is a boundary between "word" and "non-word" characters
  in either direction, so `<img-` also matches (`g` is a word char, `-` is not).
  Any kebab-case custom element or component starting with "img" — e.g.
  `<img-carousel>`, `<img-frame-loader>` — is falsely flagged as a bare `<img>`
  violation and would incorrectly build-block a chunk that never rendered a real
  image tag.
- Additionally the scan also flags `<img` found inside an HTML comment
  (`<!-- <img src=... /> -->`) or a string/template literal
  (`const html = '<img ...>'`), since it is a naive per-line regex over raw file
  text, not a parsed template AST.
**Fix:** At minimum, add the `i` flag and tighten the boundary to require a
following whitespace/`/`/`>` (real HTML tags are always followed by one of those):
`/<img[\s/>]/i`. If false positives on commented/templated code become a real
problem in practice, consider parsing the `<template>` block only (e.g. via
`@vue/compiler-sfc`) rather than scanning raw file text — this is out of scope for
this review to require, but is worth flagging as the coarse heuristic's known
ceiling.

### WR-03: Missing regression test for `loaded` reset in `CardRenderer`/`PieceRenderer`

**File:** `src/ui/components/auto-ui/renderers/CardRenderer.asset-fallback.test.ts`, `src/ui/components/auto-ui/renderers/PieceRenderer.asset-fallback.test.ts`
**Issue:** Both files' implementations correctly add a `watch()`-based reset on
src change (see CR-01 for why this matters), but neither test file exercises it.
Both suites only test: (1) initial render hides the image, (2) `@load` reveals it,
(3) `@error` reverts it. There is no test that mounts, triggers `@load`, then
`wrapper.setProps({ element: <different image> })` and asserts `loaded` resets to
`false` (i.e. `is-loaded` class is removed) before the new image's own
load/error fires. This is precisely the scenario CR-01 shows is silently broken
in the sibling `AssetImage.vue` generator — the guard-rail here worked only
because someone remembered to write it, not because a test enforces it.
**Fix:** Add, in each file:
```ts
it('resets loaded to false when the resolved src changes (reused element re-guards)', async () => {
  const wrapper = mount(CardRenderer, { props: { element: makeCardElement(1), depth: 0 } });
  await wrapper.find('img.card-image').trigger('load');
  expect(wrapper.find('img.card-image').classes()).toContain('is-loaded');

  await wrapper.setProps({ element: { ...makeCardElement(1), attributes: { $images: { face: 'https://example.test/other.png' } } } });

  expect(wrapper.find('img.card-image').classes()).not.toContain('is-loaded');
});
```

### WR-04: `scanAssetReachability` gate is only invoked via skill prose, not wired into any real command

**File:** `src/cli/lib/asset-scan.ts` (whole file); `src/cli/slash-command/bs/build/test.md:74-82`
**Issue:** `scanAssetReachability` is exported but has zero production call sites
(`grep` across `src/` finds only the definition and its own test). It is invoked
only by an LLM agent following `test.md`'s prose instructions during the `bs-`
skill pipeline — there is no CLI subcommand (`boardsmith build`/`boardsmith
lint`) that actually runs it, despite the docstring's claim that "`boardsmith
build`/`boardsmith lint` ... all delegate here." This matches the project's
existing pattern for `sandbox-scan.ts` (cited alongside it in `test.md`), so it is
not a new anti-pattern introduced by this phase, but the docstring overstates what
is actually wired today — a human reading the docstring in isolation (rather than
`test.md`) would reasonably expect an automatic CLI gate that does not exist.
**Fix:** Soften the docstring claim to reflect reality (e.g. "the `bs-build-chunk`
skill's `test` step and any future caller...") or, better, add a real
`boardsmith lint`/`boardsmith build` wiring so the gate holds even outside the
skill-driven pipeline (out of scope to require in this review, but worth a
follow-up ticket).

## Info

### IN-01: `collectSourceFiles` symlink handling is platform-dependent

**File:** `src/cli/lib/asset-scan.ts:27-44`
**Issue:** `readdirSync(dir, { withFileTypes: true })` entries for a symlinked
directory report `isDirectory() === false` on platforms where dirent type
information isn't stat'd through the link, meaning a symlinked directory under
`src/ui` is silently skipped rather than traversed (or erroring). Unlikely in
practice for a generated game project, but worth a comment noting the scanner
does not guarantee traversal through symlinks.
**Fix:** No action required unless a future project structure relies on
symlinked source directories; if so, resolve entries with `statSync` instead of
relying on `Dirent` type flags.

### IN-02: `card-image-back` class has no corresponding CSS rule (pre-existing, adjacent to this diff)

**File:** `src/ui/components/auto-ui/renderers/CardRenderer.vue:400, 413`
**Issue:** The `card-image-back` class continues to be applied (now also on the
new load-guarded overlay `<img>` at line 400) but there is no `.card-image-back`
CSS rule anywhere in the file's `<style>` block — this is a no-op class,
predating this phase's diff (the binding existed before 152-02 and was just
carried into the new markup). Not a regression introduced by this phase; flagged
only because the new overlay `<img>` now also carries the same dead class.
**Fix:** Out of scope for this phase; consider a follow-up cleanup if the intent
was ever to visually distinguish card backs beyond the separate `.card-back`
branch (Baseline 4).

---

_Reviewed: 2026-07-06T15:29:40Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
