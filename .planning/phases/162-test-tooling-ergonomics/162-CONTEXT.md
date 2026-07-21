# Phase 162: Test-Tooling Ergonomics - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix four test/build-tooling defects so the tooling stops producing false FAILs / jsdom throws and
exposes the helpers games need:
- **D17/TOOL-01 (Lanternfall):** `scanAssetReachability` matches `<img` inside code comments → false
  build FAIL.
- **D18/TOOL-02 (OTP):** `scanAssetReachability` is not on the published export surface.
- **D19/TOOL-03 (OTP, Blocking):** `boardsmith/ui` reads `window.matchMedia` at MODULE scope → throws
  under jsdom on import.
- **D20/TOOL-04 (OTP):** `assertNoHiddenInfoLeak` uses name-based markers → unusable for symmetric
  decks (identical-named cards indistinguishable).

IN SCOPE: `src/cli/lib/asset-scan.ts`, `src/testing/index.ts` (export), `src/ui/composables/
useElementAnimation.ts`, `src/testing/dom-leak.ts`, and their tests.

OUT OF SCOPE: removing the ~15 defensive `matchMedia` stubs from existing UI tests (a cleanup, not
this phase — the fix just makes them unnecessary), and Phase 169 game workarounds.
</domain>

<decisions>
## Implementation Decisions

### D17 — asset-scan comment stripping
- Strip comment spans — JS line (`//`), JS block (`/* */`), and Vue HTML (`<!-- -->`) — before the
  `BARE_IMG_TAG` (`asset-scan.ts:50`) test, **tracking block-comment state across lines** (a `/* ... */`
  can span multiple lines). Only live markup reaches the regex. Fix locus: the per-line loop
  (`asset-scan.ts:73-83`).

### D18 — export surface
- Export `scanAssetReachability` from **`boardsmith/testing`** (`src/testing/index.ts`) — it is a
  build/test gate helper, `boardsmith/testing` is already a published barrel, and this is the
  lowest-friction placement (no new `./cli` export/barrel needed).

### D19 — module-scope matchMedia
- Make `useElementAnimation.ts` import side-effect-free: guard on `typeof window.matchMedia ===
  'function'` AND defer the `matchMedia` read + `addEventListener` (`:36-48`) into a lazy
  getter/function so nothing executes at module import. Importing `boardsmith/ui` under jsdom must not
  throw without a shim. Validate with a test that imports the barrel with NO matchMedia stub.

### D20 — symmetric-deck leak detection
- Key `assertNoHiddenInfoLeak` detection on the marker's **`elementId` / element identity**, not the
  bare name-string substring match (`dom-leak.ts:362,497`). The marker already carries `elementId` —
  it's just unused for matching today. Identical-named symmetric-deck cards must be distinguishable so
  a hidden card A and a legitimately-visible same-named card B don't false-positive/false-negative.

### Test & Verification Strategy (PROC-01)
- **D17 RED:** a fixture with a commented-out `<img>` (`src/cli/lib/__fixtures__/asset-scan/`) →
  pre-fix false FAIL, post-fix pass.
- **D18 RED:** an import test `import { scanAssetReachability } from 'boardsmith/testing'` → resolves
  post-fix.
- **D19 RED:** import the `boardsmith/ui` barrel under jsdom with NO matchMedia stub → throws pre-fix,
  imports clean post-fix.
- **D20 RED:** a symmetric-deck scenario (two identical-named cards, one hidden one visible) → the
  assertion mis-fires pre-fix (false positive or missed leak), correct post-fix.

### Claude's Discretion
- The exact comment-stripping implementation (a small state machine vs a tokenizer) — provided block
  comments spanning lines and all three comment styles are handled without stripping `<img` inside
  string literals that are genuinely live.
- The exact lazy-getter shape for the reduced-motion singleton (a function vs a lazily-initialized
  ref) provided the reactive behavior for real consumers is unchanged.
- How `elementId`-keyed detection scopes the surface match (per-element region vs global id set),
  provided symmetric-deck cards are distinguishable and the existing leak cases still pass.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets / Loci
- D17: `BARE_IMG_TAG` (`asset-scan.ts:50`), `scanAssetReachability` (`:61`), `collectSourceFiles`
  (`:28`), per-line loop (`:73-83`). Fixtures `src/cli/lib/__fixtures__/asset-scan/{bare-img,wrapped}`.
- D18: `package.json` exports (`:9-59`, no `./cli`); `src/testing/index.ts` is `boardsmith/testing`.
- D19: `useElementAnimation.ts:36-40` (matchMedia init) + `:43-48` (addEventListener), both module
  scope; exported via `src/ui/index.ts:90-93` (`useElementAnimation`, `prefersReducedMotion`).
  `GameShell.vue:1089` reads matchMedia too but inside a function — NOT the defect.
- D20: `assertNoHiddenInfoLeak` (`dom-leak.ts:458`), `deriveForbiddenMarkers` (`:334`),
  `extractIdentityCandidates` (`:297/:354`), value-only compare (`:362`), surface match (`:495-497`).
  `elementId` on the marker is carried but unused for matching.

### Established Patterns
- `boardsmith/testing` already publishes `assertNoHiddenInfoLeak` (`src/testing/index.ts:92`) — add
  `scanAssetReachability` alongside.
- ~15 UI test files carry defensive `vi.stubGlobal('matchMedia', ...)` (e.g.
  `useElementAnimation.test.ts:19-21`, `useFLIP.test.ts:21-23`) — the D19 fix makes them unnecessary
  (don't remove them this phase; just stop REQUIRING them).

### Integration Points
- `scanAssetReachability` internal importers: `asset-scan.test.ts`, `build-chunk` skill (relative
  path) — the export is additive, won't break them.
- `dom-leak.test.ts` cases (negative :108, positive :120, static-playerView :206, allowlist :240,
  aria/alt/title :336, outside-jsdom :370) must all still pass after the elementId-keying change.

</code_context>

<specifics>
## Specific Ideas

- D17 Lanternfall, D18/D19/D20 OTP. D19 is Blocking (games can't test UI under jsdom without the shim).
  All library-layer; Phase 169 removes game workarounds.
- D17's RED must be a genuinely-commented `<img>` (a real false-FAIL repro), not a contrived string.
- D20's RED must use a real symmetric deck (two same-named cards) — the whole point is that name-based
  markers can't tell them apart.

</specifics>

<deferred>
## Deferred Ideas

- Removing the ~15 defensive matchMedia stubs from UI tests — a cleanup pass, not this phase.
- A dedicated `./cli` published barrel — not needed; `boardsmith/testing` is the right home for D18.
- Broader tokenizer-based asset scanning — the comment-strip fix is sufficient for D17.

</deferred>
