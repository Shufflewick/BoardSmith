# Phase 134 — UI Review

**Audited:** 2026-07-03
**Baseline:** `134-UI-SPEC.md` (design contract)
**Screenshots:** not captured (no dev server running at :3000 or :5173 — code-only audit)

**Phase type note:** This is a guardrails/fix phase. The only genuinely rendered visual surface is the UIX-01 action-failure toast (reusing the existing v4.0 `Toast.vue`/`useToast()`). SESS-01, UIX-02, UIX-04, UIX-05 are composable API contracts (no rendered surface); UIX-03 is a dev-only `console.error` + docs section. Scoring below is proportionally weighted toward that one visual surface and the copy/state contracts that actually shipped.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 4/4 | Every string (fallback toast text, devWarn copy, `fill()` multiSelect rejection, UIX-03 console.error) matches the UI-SPEC contract verbatim |
| 2. Visuals | 3/4 | Single toast chokepoint correctly enforced (no duplicate paths), but the error toast still relies on `--bsg-danger` color alone with no icon/shape cue — WCAG 1.4.1 gap on the phase's one visual surface (correctly flagged, not silently fixed) |
| 3. Color | 4/4 | `--bsg-danger` used exclusively for the failure toast and 0×0 dev warning box; `--bsg-accent` never touched by error paths; zero hardcoded hex/rgb in phase-134 files |
| 4. Typography | 4/4 | No new sizes/weights introduced; phase adds zero new toast markup |
| 5. Spacing | 3/4 | `Toast.vue` (untouched by this phase) hardcodes literal px values (`12px 16px`, `8px` gap) that happen to match the `--bsg-s2/s3/s4` scale numerically but don't reference the custom properties — token-drift risk, not phase-134-introduced |
| 6. Experience Design | 4/4 | `errorTick` (not `lastError`) chokepoint correctly re-fires on identical consecutive failures; assertive live region wired; hooks isolated/snapshot-iterated/auto-unregistered; ActionPanel's direct toast calls cleanly removed with chokepoint comments |

**Overall: 22/24**

---

## Top 3 Priority Fixes

1. **Error toast has no non-color visual cue** — Colorblind/low-vision users cannot distinguish an error toast from success/info/warning toasts by anything other than background hue (`--bsg-danger` vs `--bsg-ok`/`--bsg-accent`/`--bsg-warn`); `role="alert"` only helps assistive-tech users, not sighted ones. This is the *only* rendered surface this phase ships, so the gap is fully in scope for user impact even though it's pre-existing v4.0 code. Concrete fix: add a small leading icon/glyph (e.g. a triangle/exclamation for `type: 'error'`) to `Toast.vue`'s markup, matching the "text/emoji-free status icons" note in the UI-SPEC's Design System section — this was correctly flagged rather than silently expanded in scope during 134-03, so it's a known, ready-to-schedule follow-up rather than a missed catch.
2. **`Toast.vue` spacing uses literal px, not `--bsg-sN` tokens** — `.toast-container { gap: 8px }` and `.toast { padding: 12px 16px; gap: 12px; }` (`src/ui/components/Toast.vue:44,52` and `:51`) numerically match `--bsg-s2`/`--bsg-s3`/`--bsg-s4` but don't consume them, so a future spacing-scale rename or value change silently desyncs the toast from every other `--bsg-*`-driven component. Concrete fix: swap the literals for `var(--bsg-s2)`/`var(--bsg-s3)`/`var(--bsg-s4)` next time `Toast.vue` is touched (out of scope to force here, since phase 134 adds zero new toast markup by design).
3. **No live-render verification** — no dev server was available during this audit, so the toast's actual on-screen appearance, the assertive live-region announcement, and the 0×0 dev console.error path were verified by code inspection only, not by rendering. Concrete fix: before merging, run `npx boardsmith dev` against a game with an intentionally-failing action (e.g. click a disabled selection) and confirm the toast fires exactly once, uses `--bsg-danger`, and the assertive live region text matches; kill the dev server afterward per project convention.

---

## Detailed Findings

### Pillar 1: Copywriting (4/4)

- Fallback toast text matches spec exactly: `` `${actionController.currentAction.value ?? 'Action'} failed — try again or check the current selection.` `` (`GameShell.vue:1814`) vs spec's `"{actionName} failed — try again or check the current selection."`
- `start()` devWarn matches spec verbatim, including the exact wording about checking `availableActions` (`useActionController.ts:1308-1313`).
- `fill()` multiSelect-scalar rejection matches spec verbatim, including min/max interpolation and the `toggleMultiSelect()`/`confirmMultiSelect()` guidance (`useActionController.ts:1412-1417`).
- UIX-03 `console.error` text matches spec verbatim, including the CSS selector reference and the docs pointer (`GameShell.vue:1853-1858`).
- `setBeforeAutoExecute` JSDoc updated per contract: "registers an additional hook; hooks run in registration order; call the returned function to unregister this hook." (`useActionController.ts:963-964`) — the old "REPLACES the previous hook" language is gone.
- No `undefined`/`[object Object]`/`.stack` leakage risk: `lastError` is only ever set from server error strings or the two hardcoded fallback strings; no raw exception objects are interpolated into user-facing text (`executeCurrentAction`, `execute()` both do `err instanceof Error ? err.message : 'Action failed'`).

### Pillar 2: Visuals (3/4)

- **Chokepoint discipline is correct:** `GameShell.vue:1809-1818` is the single `watch(actionController.errorTick, ...)` that calls `toast.error()`. `ActionPanel.vue:684-690` and `:739-747` explicitly do NOT call `toast.error()` directly, with comments pointing back to the GameShell chokepoint — this satisfies the "one chokepoint, not two" contract and CLAUDE.md's cross-surface parity rule.
- **Icon-only dismiss button is labeled:** `Toast.vue:22-28`'s `✕` dismiss button carries `aria-label="Dismiss"` and `aria-hidden="true"` on the glyph — correct pattern.
- **Gap:** `Toast.vue`'s `error`/`success`/`info`/`warning` variants (`Toast.vue:84-102`) differ ONLY by background color (`--bsg-danger`/`--bsg-ok`/`--bsg-accent`/`--bsg-warn`); no icon, shape, or border differentiates them for sighted users. `role="alert"` vs `role="status"` is an assistive-tech-only cue. This was explicitly named FLAG #1 in the UI-SPEC and confirmed-but-deferred in `134-03-SUMMARY.md:94` ("pre-existing v4.0-era gap, out of scope for this plan; flagged here per the plan's instruction rather than silently fixed") — correct process, but the actual toast a player sees today still has the gap, and this phase's only chance to touch it was this one call site.

### Pillar 3: Color (4/4)

- `--bsg-danger` used exclusively for: the toast error background (`Toast.vue:90`, pre-existing) and the UIX-03 dev-only 0×0 warning box (`GameShell.vue:2952-2953`, `color-mix(in srgb, var(--bsg-danger) 90%, transparent)` + `1px solid var(--bsg-danger)`) — the dev warning box is not shown to players (dev-mode gated), so it does not compete with the danger token's player-facing semantics.
- Zero occurrences of `--bsg-accent` in any error/failure path across `GameShell.vue`, `ActionPanel.vue`, `useActionController.ts`, `useDragDrop.ts`.
- `grep` for hardcoded hex/`rgb(` across all four phase-134 files: zero matches. All color is token-driven.

### Pillar 4: Typography (4/4)

- No `text-*` Tailwind-style utility classes exist in this codebase's font-size convention (BoardSmith uses `--bsg-text-*` custom properties, not Tailwind) — confirmed no new font-size or font-weight declarations were added in any of the four phase-134 files. `Toast.vue` (untouched by this phase) still uses its pre-existing `font-size: 0.9rem`, which is not a phase-134 regression.

### Pillar 5: Spacing (3/4)

- Zero new spacing values introduced by phase-134 files (confirmed via grep — no arbitrary `[Npx]`/`[Nrem]` patterns in any of the four files).
- Pre-existing gap (not introduced by this phase, since phase 134 "adds zero new toast markup" per its own spec): `Toast.vue:44` (`gap: 8px`), `:52` (`padding: 12px 16px`), `:51` (`gap: 12px`) all hardcode literal pixel values that numerically match `--bsg-s2`(8px)/`--bsg-s3`(12px)/`--bsg-s4`(16px) but don't reference the custom properties directly — the UI-SPEC's claim that "`Toast.vue` already implements this scale" is true in *value* but not in *mechanism*.

### Pillar 6: Experience Design (4/4)

- **Retry-safety:** the chokepoint watches `errorTick` (monotonic counter), not `lastError` (string) — correctly avoids the Vue reactivity trap where two identical consecutive failure strings would fail to re-trigger a value-based watcher (`GameShell.vue:1803-1806` comment explicitly documents this as CR-01).
- **Live region:** failure text routes into the existing `assertiveMessage`/`role="alert" aria-live="assertive"` region (`GameShell.vue:1816-1817`), not a new third region — matches the "do not create a third live region" contract.
- **Hook safety (WR-02/WR-03/WR-04):** `beforeAutoExecuteHooks` iteration wraps each hook in try/catch so one throwing hook can't wedge the auto-execute watcher permanently (`useActionController.ts:879-885`); iterates a snapshot (`[...beforeAutoExecuteHooks.value]`) so a self-unregistering hook can't skip a sibling; auto-unregisters via `onScopeDispose` when registered inside a component scope, preventing stale-hook accumulation across HMR/seat-switch/dev-UI-switcher remounts (`useActionController.ts:981-983`).
- **Drag inert-props safety (WR-06):** `dragProps()`/`drag()`'s inert branch retains `onDragend` (not fully empty props) so a `when` flip mid-drag still ends the drag and clears hover/highlight state (`useDragDrop.ts:242-251`, `366-369`).
- **Docs parity:** `docs/custom-ui-guide.md:158-160` documents the `start()` return-value contract, the automatic-toast-parity guarantee, and explicitly warns custom UIs against adding a second toast for the same failure — reduces the risk of a future custom UI reintroducing a duplicate-toast bug.

---

## Files Audited

- `.planning/phases/134-ui-session-interaction-guardrails/134-UI-SPEC.md`
- `src/ui/components/GameShell.vue` (lines 276, 339-340, 656-938, 1750-1862, 1915-1916, 2952-2953)
- `src/ui/components/auto-ui/ActionPanel.vue` (lines 670-750)
- `src/ui/composables/useActionController.ts` (full read, 1-1492 of 2097; targeted grep for remainder)
- `src/ui/composables/useDragDrop.ts` (full read)
- `src/ui/components/Toast.vue` (full read)
- `src/ui/composables/useToast.ts` (existence confirmed, not modified this phase)
- `docs/custom-ui-guide.md` (Board Sizing section lines 750-796; Step 3 Executing Actions lines 110-238)
- `src/ui/theme.ts` (token grep for `--bsg-danger`/`--bsg-accent`/`--bsg-ok`/`--bsg-warn`)
- `.planning/phases/134-ui-session-interaction-guardrails/134-03-SUMMARY.md` (FLAG #1 disposition cross-check)
- `git log` for phase-134 commits touching the four audited source files
