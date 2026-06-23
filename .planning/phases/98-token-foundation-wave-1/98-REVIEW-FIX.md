---
phase: 98-token-foundation-wave-1
fixed_at: 2026-06-23T01:07:00Z
review_path: .planning/phases/98-token-foundation-wave-1/98-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 98: Code Review Fix Report

**Fixed at:** 2026-06-23T01:07:00Z
**Source review:** `.planning/phases/98-token-foundation-wave-1/98-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (CR-01, WR-01, WR-02)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### CR-01: postMessage origin validation + corrected security comments

**Files modified:** `src/ui/components/GameShell.vue`, `src/ui/components/GameShellInit.ts`, `src/ui/components/GameShell.theme.test.ts`
**Commit:** `1880e5c`
**Applied fix:**

- Added `trustedOrigins?: string[]` prop to `GameShellProps` in GameShell.vue. When non-empty, any `event.origin` not in the list causes an early return before the payload is inspected. When empty/unset the existing permissive behavior is retained so the embed flow is unbroken (HOST-02 locks this down for production).
- Extracted `isOriginAllowed(origin, trustedOrigins)` as a pure exported function in `GameShellInit.ts` so it can be unit-tested without mounting the full Vue component. GameShell.vue imports and calls it.
- Corrected the misleading comment on the `data.source` check in GameShell.vue — it is now accurately described as a "lightweight message-shape filter" not a security control.
- Corrected the misleading JSDoc on `consumeInitMessage` in GameShellInit.ts — it no longer overstates that "no extra validation is needed here (T-98-04)".
- Added six tests in `GameShell.theme.test.ts` covering: permissive default (undefined), permissive default (empty array), rejection of non-listed origin, acceptance of listed origin, and end-to-end applyTheme call/no-call behavior for trusted vs. untrusted origins.

### WR-01: Seat→color formula off-by-one (HexBoardRenderer)

**Files modified:** `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue:111`
**Commit:** `20ba9ef`
**Applied fix:**

Changed `(player.seat % 6) + 1` to `((player.seat - 1) % 6) + 1`. Seats are 1-indexed per `src/session/types.ts`. The old formula produced a cyclic shift (seat 1 → token 2, ..., seat 6 → token 1). The corrected formula maps seat 1 → token 1 through seat 6 → token 6, with correct wraparound for more than 6 players. Added an inline comment citing the 1-indexed invariant.

### WR-02: Pending-block `.skip-btn` explicit text color (ActionPanel)

**Files modified:** `src/ui/components/auto-ui/ActionPanel.vue:1532`
**Commit:** `0673903`
**Applied fix:**

Added `color: var(--bsg-ink-2);` to the animation-pending `.skip-btn` rule (Rule B, line ~1527). The rule previously had no `color` property and silently inherited `color: #999` from the selection-skip `.skip-btn` (Rule A) via the cascade. Rule B is now self-contained so Phase 99 can sweep Rule A independently without breaking the pending-block button's text color. ActionPanel.vue is in the stylelint ignore list, so using `var(--bsg-ink-2)` there is correct.

---

_Fixed: 2026-06-23_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
