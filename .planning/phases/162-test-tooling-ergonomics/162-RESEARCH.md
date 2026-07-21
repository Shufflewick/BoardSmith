# Phase 162: Test-Tooling Ergonomics - Research

**Researched:** 2026-07-21
**Confidence:** HIGH (all four defects pinned to exact loci via codebase scout)

## Summary

Four contained tooling fixes. Three are single-file (D17 asset-scan, D19 matchMedia, D20 dom-leak);
D18 is a one-line barrel export.

## D17 — asset-scan comment false-FAIL
- `BARE_IMG_TAG = /<img[\s/>]/i` (`asset-scan.ts:50`) tested per-line (`:76`) with no comment
  stripping. `/* <img */`, `// <img`, `<!-- <img -->` all false-FAIL. **Fix:** strip all three comment
  styles (block-comment state across lines) before the test (`:73-83`).

## D18 — export surface
- `scanAssetReachability` (`asset-scan.ts:61`) exported from its module but no published barrel
  re-exports it. `package.json` exports (`:9-59`) has no `./cli`. **Fix:** re-export from
  `src/testing/index.ts` (`boardsmith/testing`, already published).

## D19 — module-scope matchMedia (Blocking)
- `useElementAnimation.ts:36-40` (`window.matchMedia(...).matches` in a ref initializer) + `:43-48`
  (addEventListener) run at import. Guard is `typeof window !== 'undefined'` — jsdom HAS window,
  NOT matchMedia, so it throws. Exported via `src/ui/index.ts:90-93`. **Fix:** guard `typeof
  window.matchMedia === 'function'` + defer into a lazy getter (import side-effect-free).

## D20 — symmetric-deck leak detection
- `assertNoHiddenInfoLeak` (`dom-leak.ts:458`); markers `{value, attribute, elementId, elementLabel}`
  from identity strings (`:334`,`:354`); detection is a substring match on `value` (`:495-497`) and
  value-only survivor compare (`:362`). Symmetric deck: two cards, same `name` → identical marker
  `value`; a hidden card and a permitted same-named sibling are indistinguishable. `elementId` is
  carried but never used for matching. **Fix:** key detection on `elementId`/identity, not the name
  string.

## Pitfalls
- D17: don't strip `<img` inside genuinely-live string literals (only comments).
- D19: preserve the reactive reduced-motion behavior for real consumers (useFLIP, AutoRenderer) — only
  the IMPORT must be side-effect-free.
- D20: all existing dom-leak.test.ts cases (:108,:120,:206,:240,:336,:370) must still pass.
- D18: additive export must not break internal relative-path importers.

## Validation Architecture

| Req | Defect | Layer | Validation | File |
|-----|--------|-------|-----------|------|
| TOOL-01 | D17 | build tooling | RED: a commented-out `<img>` fixture false-FAILs pre-fix, passes post-fix. | asset-scan.test.ts + new fixture |
| TOOL-02 | D18 | export | RED: `import {scanAssetReachability} from 'boardsmith/testing'` resolves. | new import test |
| TOOL-03 | D19 | ui import | RED: import `boardsmith/ui` under jsdom with NO matchMedia stub → throws pre-fix, clean post-fix. | new barrel-import test |
| TOOL-04 | D20 | test helper | RED: symmetric deck (2 same-named cards, 1 hidden 1 visible) → assertion mis-fires pre-fix, correct post-fix. | dom-leak.test.ts |
| PROC-01 | — | process | Each: fix at correct layer + RED proving the old failure mode is gone. | git RED→GREEN |

### Wave 0 gaps
- No commented-`<img>` fixture; no no-stub barrel-import test; no symmetric-deck leak case; no
  export-surface import test — all net-new.
