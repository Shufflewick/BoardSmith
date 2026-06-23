---
phase: 98-token-foundation-wave-1
reviewed: 2026-06-23T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/ui/theme.ts
  - src/ui/theme.test.ts
  - src/ui/index.ts
  - src/ui/components/GameShell.vue
  - src/ui/components/GameShell.theme.test.ts
  - src/ui/components/GameShellInit.ts
  - src/ui/components/WaitingRoom.vue
  - src/ui/components/auto-ui/ActionPanel.vue
  - src/ui/animation/drag-drop.css
  - src/ui/components/auto-ui/renderers/HandRenderer.vue
  - src/ui/components/auto-ui/renderers/CardRenderer.vue
  - src/ui/components/auto-ui/renderers/GridBoardRenderer.vue
  - src/ui/components/auto-ui/renderers/SpaceRenderer.vue
  - src/ui/components/auto-ui/renderers/HexBoardRenderer.vue
  - .stylelintrc.cjs
  - scripts/check-no-hex.test.mjs
  - package.json
  - vitest.config.ts
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
status: resolved
---

# Phase 98: Code Review Report

**Reviewed:** 2026-06-23
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Phase 98 delivers the `--bsg-*` token engine (`theme.ts`), the `applyTheme()` knob, the `color-no-hex` stylelint guard, the `--bs-*` → `--bsg-*` namespace collapse across five renderer files and `drag-drop.css`, the `--bg-*/--text-*/--border-*` collapse in `ActionPanel.vue` and `WaitingRoom.vue`, and the GameShell iframe-init theme receiver. The architecture is sound and the scoping decisions (neon sweep deferred to Phase 99, temporary `ignoreFiles` documented) are coherent.

One blocker: the postMessage security claim is factually incorrect — `data.source` is not an origin check — and Phase 98 is precisely the phase that wires the new attack surface (theme injection via `consumeInitMessage`). One warning: the seat color formula in `HexBoardRenderer` has a confirmed off-by-one against 1-indexed seats (documented as 1-indexed in `src/session/types.ts`). One additional warning: the `pending-block .skip-btn` silently relies on cascade from an earlier same-class rule for its text color, which will silently break if Phase 99 sweeps one rule block but not the other.

---

## Critical Issues

### CR-01: `event.origin` not validated in GameShell postMessage handler — security claim is incorrect

**File:** `src/ui/components/GameShell.vue:616-617`

**Issue:** The postMessage handler guards with `if (!data || data.source !== 'shufflewick') return;`. The SUMMARY (Plan 04, Threat T-98-04) claims this "already filters foreign messages". This claim is **incorrect**: `data.source` is a field inside the message payload set by the **sender** — any cross-origin script that holds a reference to the game window can set `data.source = 'shufflewick'` and pass the check. `event.origin` is the only browser-enforced, non-forgeable indicator of the message's origin.

Phase 98 is specifically the phase that introduces the `consumeInitMessage` theme injection path (line 624). Before this phase, a spoofed `init` message could change `playerSeat` and `currentScreen`, but nothing else of significance. After this phase, a spoofed `init` message with a crafted `theme` payload can override **any** `--bsg-*` token — including `--bsg-danger`, `--bsg-ok`, `--bsg-ring`, and `--bsg-ink` — subject only to the key-name allowlist. Restyling the game chrome (e.g., making danger states look like success states, or suppressing focus rings) via a spoofed message is a real attack in an embedded-game context.

The key allowlist in `applyTheme` (`/^--bsg-[a-z0-9-]+$/`) is a **necessary but not sufficient** control: it prevents unknown CSS property injection but does not prevent overriding legitimate tokens with attacker-chosen values.

**Fix:**

```typescript
// In the platformMessageHandler setup block (GameShell.vue ~line 614):
platformMessageHandler = (event: MessageEvent) => {
  // REQUIRED: verify origin before trusting any message content.
  // Only ShufflewickPub (prod) and the local dev host are trusted.
  const TRUSTED_ORIGINS = [
    'https://shufflewick.pub',            // production host
    'http://localhost:5173',              // boardsmith dev host (default Vite port)
    'http://localhost:4173',              // boardsmith preview
  ];
  if (!TRUSTED_ORIGINS.includes(event.origin)) return;

  const data = event.data;
  if (!data || data.source !== 'shufflewick') return;
  // … rest of handler unchanged
};
```

The allowed origins should be made configurable (e.g., via a `trustedOrigins` prop on `GameShell`) so game authors embedding in non-ShufflewickPub hosts can extend the list without forking the component.

---

## Warnings

### WR-01: Seat→color formula off-by-one for 1-indexed seats (HexBoardRenderer)

**File:** `src/ui/components/auto-ui/renderers/HexBoardRenderer.vue:111`

**Issue:** `getPieceColor` maps a seated piece to a seat-palette token via:

```javascript
return `var(--bsg-seat-${(player.seat % 6) + 1})`;
```

`src/session/types.ts` line 124 documents seats as **1-indexed**: "Specific player seat (1-indexed)". With 1-indexed seats this formula produces:

| seat | `(seat % 6) + 1` | token used |
|------|-------------------|------------|
| 1    | 2                 | `--bsg-seat-2` |
| 2    | 3                 | `--bsg-seat-3` |
| 5    | 6                 | `--bsg-seat-6` |
| 6    | 1                 | `--bsg-seat-1` |

Every seat gets the wrong token — a cyclic shift of 1. The correct formula for 1-indexed seats is `((player.seat - 1) % 6) + 1`, which maps seat 1 → token 1, seat 6 → token 6.

GameShell.vue confirms 1-indexed: `playerSeat.value = 1; // Creator defaults to seat 1` (line 752) and `playerSeat.value = 1;` (line 918 in direct-join path). `src/session/types.ts` line 214 also documents `aiPlayers` as "1-indexed seat numbers".

**Fix:**

```javascript
// HexBoardRenderer.vue line 111
if (player?.seat !== undefined) return `var(--bsg-seat-${((player.seat - 1) % 6) + 1})`;
```

### WR-02: Pending-block `.skip-btn` inherits text color silently from earlier rule (fragile cascade)

**File:** `src/ui/components/auto-ui/ActionPanel.vue:1527-1534`

**Issue:** There are two separate `.skip-btn` CSS rule blocks in ActionPanel.vue:

- **Rule A** (line 1318): `background: rgba(128,128,128,.2); color: #999;` — the selection-skip button.
- **Rule B** (line 1527): `background: var(--bsg-surface); border: 1px solid var(--bsg-line);` — the animation-pending skip button. **No `color` property.**

Rule B's `.skip-btn` inherits `color: #999` from Rule A via the cascade. The Plan 04 SUMMARY states "bg+text renamed together" as the invisible-text-trap guard, but Rule B's text color was never explicitly set — it is silently coupled to Rule A's raw-literal `#999`.

This is safe today (gray text on `--bsg-surface` reads in both dark and light modes), but it is a latent Phase 99 trap: if a Phase 99 author sweeps Rule A and converts `color: #999` to `color: var(--bsg-ink-3)` without noticing that Rule B depends on it for its text color, the pending-skip button would get the token color — which might actually be fine. But if the rules are reordered or Rule A is deleted before Rule B is given an explicit color, the button's text could inherit from the component ancestor and become unreadable.

**Fix:** Add an explicit `color` to the pending-block `.skip-btn` now so its text color is self-contained and Phase 99 can be treated as an independent sweep:

```css
/* Line 1527 — action-panel-pending .skip-btn */
.skip-btn {
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--bsg-line);
  border-radius: 0.25rem;
  background: var(--bsg-surface);
  color: var(--bsg-ink-2);   /* explicit — do not rely on Rule A cascade */
  cursor: pointer;
  font-size: 0.875rem;
}
```

---

## Info

### IN-01: Redundant type assertion in `GameShellInit.ts`

**File:** `src/ui/components/GameShellInit.ts:39`

**Issue:** `data.scheme` is typed by the `InitMessageData` interface as `scheme?: 'light' | 'dark' | 'auto'`, making its inferred type `'light' | 'dark' | 'auto' | undefined`. The explicit cast on line 39 repeats that union unnecessarily:

```typescript
const scheme = data.scheme as 'light' | 'dark' | 'auto' | undefined;
```

**Fix:** Remove the cast:

```typescript
const scheme = data.scheme;
```

### IN-02: Generated CSS has inconsistent indentation in `themeCSS`

**File:** `src/ui/theme.ts:164-166`

**Issue:** The `split('\n').join('\n  ')` join pattern applied to `DARK_COLOR_TOKENS` (which itself already has `  ` leading whitespace on non-first lines after `trimStart()`) produces 2-space indentation on the first token and 4-space indentation on all subsequent tokens inside `:root { }`. The output is valid CSS and all tests pass, but the generated `<style id="bsg-tokens">` source is visually malformed if inspected in DevTools. The same applies to `STATIC_TOKENS`.

**Fix (optional):** Strip leading whitespace from each line before re-indenting:

```typescript
function indent(block: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return block.split('\n').map(line => line.trimStart() ? pad + line.trimStart() : '').join('\n');
}
```

Or, more simply, use a helper that trims each line before re-joining:

```typescript
${DARK_COLOR_TOKENS.split('\n').map(l => '  ' + l.trim()).join('\n')}
```

### IN-03: No unit test for non-string value guard in `applyTheme`

**File:** `src/ui/theme.test.ts`

**Issue:** `applyTheme` guards `typeof value === 'string'` before calling `setProperty` (theme.ts line 223), but `theme.test.ts` has no test that verifies non-string values (numbers, objects, `null`) are silently dropped. The TypeScript type `Record<string, string>` makes a caller-side mistake unlikely, but the guard exists specifically for the untyped `event.data` path (where `data.theme` is `any` from the postMessage payload). A test covering this path would close the gap.

**Fix:** Add a test:

```typescript
it('silently drops non-string values from overrides', () => {
  applyTheme({ '--bsg-accent': 42 as unknown as string });
  expect(document.documentElement.style.getPropertyValue('--bsg-accent')).toBe('');
});
```

---

_Reviewed: 2026-06-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

---

## Re-review (iteration 2)

**Reviewed:** 2026-06-23
**Scope:** CR-01, WR-01, WR-02 fixes only
**Files:** GameShell.vue, GameShellInit.ts, GameShell.theme.test.ts, HexBoardRenderer.vue, ActionPanel.vue

**CR-01 — Resolved correctly, no regression.**

`isOriginAllowed(origin, trustedOrigins)` is extracted into `GameShellInit.ts` (lines 37–40) and is correct on all three paths: returns `true` (permissive) when `trustedOrigins` is `undefined` or `[]`, returns `false` for unlisted origins when `trustedOrigins` is a non-empty array, and returns `true` for listed origins. In `GameShell.vue` (line 630) the `isOriginAllowed` call is the first statement in the handler — executed before `event.data` is accessed and before any payload routing — so the early-return position is correct. The `data.source` check remains (line 636) with an accurate inline comment explicitly disavowing it as a security control ("not a security control — use trustedOrigins for that"). The `trustedOrigins` prop is declared optional with no default, so it is `undefined` at runtime for any existing embed that does not supply it, preserving the pre-fix permissive behavior. The `GameShell.theme.test.ts` `isOriginAllowed` suite (lines 52–101) covers: permissive-default (undefined), permissive-empty-array, reject-unlisted, allow-listed, and an end-to-end simulation proving `applyTheme` is not reached from an untrusted origin. No new bug or regression introduced.

**WR-01 — Resolved correctly.**

`HexBoardRenderer.vue` line 113 now reads `((player.seat - 1) % 6) + 1` with an inline comment explaining the 1-indexed semantics. Seat 1 maps to `--bsg-seat-1`, seat 6 maps to `--bsg-seat-6`. Formula is correct.

**WR-02 — Resolved correctly.**

`ActionPanel.vue` line 1532 now has `color: var(--bsg-ink-2); /* explicit — do not rely on Rule A cascade */` in the pending-block `.skip-btn` rule. The rule is self-contained and no longer relies on cascade from Rule A.

**New findings: none.**

No new Critical or Warning issues were introduced by the applied fixes.
