---
phase: 91-security-leak-fix
fixed_at: 2026-06-20T23:58:00Z
review_path: .planning/phases/91-security-leak-fix/91-REVIEW.md
iteration: 3
findings_in_scope: 1
fixed: 1
skipped: 0
status: all_fixed
---

# Phase 91: Code Review Fix Report

**Fixed at:** 2026-06-20T23:58:00Z
**Source review:** .planning/phases/91-security-leak-fix/91-REVIEW.md
**Iteration:** 3

**Summary:**
- Findings in scope: 1
- Fixed: 1
- Skipped: 0

## Fixed Issues

### WR-01: Standalone hidden-element branch drops `$type` and `$images.back`, breaking face-down rendering

**Files modified:** `src/engine/element/game.ts`, `src/engine/element/image-leak.test.ts`
**Commit:** 1f67759
**Applied fix:** Made the standalone individually-hidden branch in `toJSONForPlayer`
(`game.ts:2306`) consistent with the three zone branches. The branch previously
returned `attributes: { __hidden: true }` only, stripping `$type` (AutoUI renderer
dispatch) and `$images.back` (face-down card-back graphic). Changed it to spread
`...redactHiddenElementAttrs(json.attributes ?? {})` into the attributes, preserving
safe layout/back keys while still dropping `$image` and narrowing `$images` to
`{ back }` only — so `$images.face` continues to never leak. Kept the intentional
stable `id` (WR-02 FLIP accept decision) and added an explanatory comment alongside
the existing rationale block.

Extended the WR-02 lock-in test (`image-leak.test.ts`) to assert the standalone
placeholder now retains `$type === 'card'` and `$images.back === '/cards/back.svg'`
while still NOT leaking `$images.face`.

**Verification:**
- Tier 1: re-read both modified sections; fix text present, surrounding code intact.
- Tier 2: `npx tsc --noEmit` reports zero errors referencing `game.ts`. The
  test file's `$images`-in-`create()`-options errors are pre-existing (the same
  pattern repeats at 9 setup sites, lines 99–539; the added code is assertion-only).
- Suite: `npx vitest run src/engine/element/image-leak.test.ts` → 9/9 passing,
  including the extended WR-02 lock-in assertions.

## Skipped Issues

None — the single in-scope Warning was fixed. (IN-01 and IN-02 are Info-tier and
out of the `critical_warning` fix scope; both are explicitly tracked/accepted in
REVIEW.md.)

---

_Fixed: 2026-06-20T23:58:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
