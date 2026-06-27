---
phase: 108
slug: lightweight-action-help
audit_type: retroactive
status: advisory
audited_at: 2026-06-26
baseline: 108-UI-SPEC.md (approved)
screenshots: not captured (code-only audit; dev host at :5173 is a game board, not the Phase 108 component surface in isolation)
---

# Phase 108 — UI Review

**Audited:** 2026-06-26
**Baseline:** 108-UI-SPEC.md
**Screenshots:** Not captured — no isolated component route for the Phase 108 feature surface; audit is code-only.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | "Note:" in code vs "Why disabled:" in spec — known WR-03 drift, spec not updated |
| 2. Visuals | 3/4 | All structural contracts met; absolute-positioned "?" overlap on short labels unverifiable without screenshots |
| 3. Color | 3/4 | ActionHelpPopover is fully token-clean; pre-existing rgba() literals in ControlsMenu toggle pill are a project rule violation (not Phase 108 additions) |
| 4. Typography | 4/4 | All four spec type roles correctly mapped to exact tokens |
| 5. Spacing | 2/4 | FLIP_THRESHOLD = 8px vs spec's --bsg-s4 (16px); 2px non-token margin on disabled label; 5px off-scale horizontal padding on affordance |
| 6. Experience Design | 3/4 | All a11y contracts met; parity gap: #game-board slot does not pass disabledActions as a named prop |

**Overall: 18/24**

---

## Top 3 Priority Fixes

1. **FLIP_THRESHOLD = 8 vs spec's --bsg-s4 = 16px (ActionHelpPopover.vue:79)** — on short-viewport devices a popover whose bottom edge is only 8px from the edge will not flip but will still visually clip; the spec required 16px clearance precisely to prevent this. Fix: change `const FLIP_THRESHOLD = 8` to `const FLIP_THRESHOLD = 16` and update the right-edge constant at line 93–94 to align with the intended `--bsg-s2` value (8px is correct there; add a named constant `EDGE_MARGIN = 8` to document intent).

2. **UI-SPEC.md Copywriting Contract still reads "Why disabled:" (108-UI-SPEC.md:206, 306–329)** — the implementation uses "Note:" (WR-03 fix), which is the correct authoritative surface, but the spec document was never updated. Any future developer reading the spec will encounter the wrong label and may attempt to "fix" the code back to "Why disabled:". Fix: update §Copywriting Contract and §Content layout in the spec to replace every occurrence of "Why disabled:" with "Note:" and add a parenthetical explaining the semantic reason (gated actions remain clickable, so the label must not assert non-functionality).

3. **`#game-board` slot and dev-switcher component do not pass `disabledActions` as a named prop (GameShell.vue:1863–1879, 1844–1862)** — custom UIs using `ActionHelpPopover` directly must independently cast `state?.state?.disabledActions` from the raw `state` slot prop. The AutoUI path (`ActionPanel`) receives `disabledActions` as a clean named prop. This violates the Pit of Success parity rule: the easy path for a custom UI author is to use the named prop that IS provided (`isActionHelpVisible`), but `disabledActions` requires knowing internal `PlayerGameState` schema. Fix: add `:disabled-actions="disabledActions"` to both the `#game-board` slot at line 1879 and the `selectedUiComponent` component at line 1862.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**Pass — with one open spec/impl drift.**

| Element | Spec | Code | Status |
|---------|------|------|--------|
| Toggle label | "Show action help" | "Show action help" (ControlsMenu.vue:195) | PASS |
| Affordance aria-label | "Help for {action prompt}" | `Help for ${triggerLabel}` (ActionHelpPopover.vue:181) | PASS |
| Disabled-reason label | "Why disabled:" | "Note:" (ActionHelpPopover.vue:247) | DRIFT — see below |
| Empty state | not applicable (affordance hidden) | v-if gates visibility correctly | PASS |

**WR-03 label drift (WARNING — reconcile, not a code defect):**

The implementation uses `"Note:"` at ActionHelpPopover.vue:247 instead of the spec's `"Why disabled:"`. This is correct per WR-03 analysis: tutorial-gated actions appear in `disabledActions` but remain fully clickable (they are in `availableActions`, only `:disabled="isExecuting"`), so the old label falsely implied non-functionality. The code is the authoritative surface. The spec document is stale. Flag for spec update, not a code regression.

No `v-html` found anywhere in the new component surface. No generic CTAs ("Submit", "OK", "Cancel") in new elements. Text interpolation only throughout.

---

### Pillar 2: Visuals (3/4)

**Pass — structural and motion contracts met. One unverifiable overlap concern.**

**Non-color glyph affordance (PASS):**
- ActionHelpPopover.vue:197–206: inline SVG `viewBox="0 0 14 14"` renders a circled question mark using `stroke="currentColor"`, `aria-hidden="true"`. Distinguishable in grayscale without color.
- ControlsMenu.vue:191–193: matching circled "?" at `viewBox="0 0 24 24"` in the Play group toggle.

**Trigger states (PASS):**
- Idle: `color: var(--bsg-ink-3)` (ActionHelpPopover.vue:271)
- Hover: `color: var(--bsg-ink-2)` (line 277)
- Open: `color: var(--bsg-accent)` via `[aria-expanded="true"]` selector (line 281)
- All three states differ in ink density only; no color-only signal — the aria-expanded state also drives the toggle icon's open visual.

**Motion (PASS):**
- Enter/leave transition: `opacity` + `translateY(-2px)` over `var(--bsg-dur-fast) var(--bsg-ease)` (lines 379–389)
- `@media (prefers-reduced-motion: reduce)`: `transition: none` applied to both enter-active and leave-active (lines 391–397). Instant show/hide confirmed.

**Caret tracking (PASS after WR-02):**
- `--ahp-caret-left` CSS custom property computed from `triggerMidX - left` after right-edge clamping (line 100), clamped to `[12, POPOVER_MAX_WIDTH - 12]`. Applied via inline style on caret span (line 232). Both `.ahp-caret--top` and `.ahp-caret--bottom` use `left: var(--ahp-caret-left, 50%)` (lines 311, 331).

**Absolute-position overlap concern (WARNING — unverifiable without screenshots):**
- `.action-help-btn` is `position: absolute; top: 0; right: 0` within `.action-btn-group`. For action buttons with short label text (e.g., single-word prompts like "Draw"), the "?" sits flush at the top-right corner where button text may render adjacent to it. There is no padding-right compensation on `.action-btn` to create clear separation from the absolute-positioned affordance. Cannot confirm or deny visual overlap without live renders.

**Focal point (PASS):**
- ControlsMenu "Show action help" placement is in the Play group, after "Auto end turn", before "Undo last action" — matches spec §4 exactly.

---

### Pillar 3: Color (3/4)

**Pass on new component. Pre-existing violation in ControlsMenu toggle pill.**

**ActionHelpPopover.vue — zero literal colors (PASS):**

All color values in the new component use `var(--bsg-*)` tokens:

| CSS rule | Token used | Spec role |
|----------|-----------|-----------|
| `.action-help-btn` color | `var(--bsg-ink-3)` | Idle affordance |
| `.action-help-btn:hover` color | `var(--bsg-ink-2)` | Hover affordance |
| `[aria-expanded="true"]` color | `var(--bsg-accent)` | Open affordance (accent reserved) |
| `.action-help-popover` background | `var(--bsg-surface-3)` | Secondary (30%) popover surface |
| `.action-help-popover` border | `var(--bsg-line-2)` | Popover border |
| Caret fill (::after) | `var(--bsg-surface-3)` | Caret body |
| Caret outer border | `var(--bsg-line-2)` | Caret border |
| `.ahp-disabled-label` color | `var(--bsg-ink-3)` | Label ink |
| `.ahp-help-body`, `.ahp-disabled-body` | `var(--bsg-ink-2)` | Body ink |

Accent usage is correctly limited to the open/active state and the toggle ON state — not applied to idle affordances or decorative borders. 60/30/10 distribution respected.

**Pre-existing rgba() literals in ControlsMenu.vue (WARNING — not Phase 108 additions):**
- ControlsMenu.vue:441: `.toggle::after { background: rgba(255, 255, 255, 0.95) }`
- ControlsMenu.vue:443: `.toggle::after { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3) }`

These are in the pre-existing toggle pill shared by all three `menuitemcheckbox` items (Auto end turn, Show action help, Show move quality). Phase 108 did not introduce these; they were present in v4.0 Slate. They are literal color values outside `theme.ts` in violation of the project rule. Not a Phase 108 regression, but flagged as pre-existing debt carried forward.

---

### Pillar 4: Typography (4/4)

**Full pass — all spec type roles correctly implemented.**

| Spec role | Expected | Implemented |
|-----------|----------|-------------|
| Help text body | `var(--bsg-text-sm)`, weight 400, `var(--bsg-line-normal)` | `.ahp-help-body` lines 349–352 ✓ |
| Disabled-reason label | `var(--bsg-text-xs)`, weight 400, `var(--bsg-line-normal)` | `.ahp-disabled-label` lines 364–368 ✓ |
| Disabled-reason text | `var(--bsg-text-sm)`, weight 400, `var(--bsg-line-normal)` | `.ahp-disabled-body` lines 371–375 ✓ |
| ControlsMenu item label | `var(--bsg-text-sm)`, weight 400 | `.mi { font-size: var(--bsg-text-sm) }` line 371 ✓ |

No new font sizes or weights introduced. The "?" glyph is SVG-rendered with no text node, consistent with spec note.

Minor observation: the spec declares ControlsMenu item `line-height: var(--bsg-line-tight) = 1.2` but ControlsMenu.vue's `.mi` class has no explicit `line-height`. The "Show action help" item inherits from body. This is pre-existing behavior shared with all other `.mi` items (Auto end turn, Undo, etc.) and not a Phase 108 regression; deducting would penalize the phase for inherited Slate debt.

---

### Pillar 5: Spacing (2/4)

**Two real deviations from spec, plus one minor off-scale padding.**

**BLOCKER-class deviation — FLIP_THRESHOLD mismatch:**

The spec declares `--bsg-s4 = 16px` as the "Min space above/below popover before flip threshold triggers" (UI-SPEC.md:44). The implementation uses:

```ts
// ActionHelpPopover.vue:79
const FLIP_THRESHOLD = 8;
```

and

```ts
// ActionHelpPopover.vue:93–94
if (left + POPOVER_MAX_WIDTH > window.innerWidth - 8) {
    left = window.innerWidth - POPOVER_MAX_WIDTH - 8;
```

Both vertical and horizontal edge margins use `8` (matching `--bsg-s2`, not `--bsg-s4`). The spec's 16px vertical threshold means a dual-section popover would be forced to flip above the trigger when it's 16px from the bottom, preventing any clipping. At 8px the popover can visually clip into the edge. This was not addressed in REVIEW-FIX.md, suggesting it was not flagged during code review.

**WARNING — non-token margin on disabled label:**

```css
/* ActionHelpPopover.vue:368 */
.ahp-disabled-label {
  margin-bottom: 2px;
}
```

`2px` is not on the `--bsg-s*` scale (smallest defined token is `--bsg-s1 = 4px`). No token covers `2px`. This could be `0` (relying on the `line-height: 1.5` gap between label and body) or replaced with `--bsg-s1 = 4px` if visible separation is needed.

**WARNING — off-scale horizontal padding on affordance:**

```css
/* ActionHelpPopover.vue:267 */
padding: 4px 5px;
```

Vertical `4px` = `--bsg-s1` (on-scale ✓). Horizontal `5px` is not a scale value (scale jumps from 4 to 8). The spec says "padding: 4px 5px achieves this around a 14px icon" (UI-SPEC.md:149) as an exception note, but `5px` is still an off-scale raw value. Result: minimum tap target is achieved (`14 + 5*2 = 24px`), but the mechanism is a magic number.

**Passing items:**

| Spec item | Expected | Implemented | Status |
|-----------|----------|-------------|--------|
| Popover padding | `var(--bsg-s2) var(--bsg-s3)` | `padding: var(--bsg-s2) var(--bsg-s3)` (line 296) | PASS |
| Caret size | 8px CSS triangle | `border-*: 8px` (lines 313–315, 333–335) | PASS |
| Caret above-anchor offset | `4px` from trigger bottom | `rect.bottom + 4` (line 81, line 119) | PASS |
| Affordance min tap target | 24x24px | `min-width: 24px; min-height: 24px` (lines 265–266) | PASS |
| Divider bleed margin | `var(--bsg-s2) calc(-1 * var(--bsg-s3))` | line 359 | PASS |
| Caret pseudo offset | 2px inset for border-trick layering | `top: 2px` / `bottom: 2px` on `::after` (lines 320, 340) | PASS (visual artifact, not layout spacing) |
| Popover max-width | 240px | `max-width: 240px` (line 288) | PASS |
| Popover min-width | 120px | `min-width: 120px` (line 289) | PASS |

---

### Pillar 6: Experience Design (3/4)

**Accessibility: full pass. One parity gap in the custom UI surface.**

**WCAG 2.2 AA — PASS:**

| Requirement | Implementation |
|-------------|---------------|
| role=tooltip on popover | `role="tooltip"` (ActionHelpPopover.vue:220) |
| aria-live="polite" | `aria-live="polite"` (line 221) |
| aria-expanded on trigger | `:aria-expanded="isOpen"` (line 183) |
| aria-controls linking | `:aria-controls="\`${actionName}-help-tip\`"` (line 184) |
| aria-describedby (open only) | `:aria-describedby="isOpen ? ... : undefined"` (line 184) — correctly absent when closed |
| aria-label on trigger | `:aria-label="\`Help for ${triggerLabel}\`"` (line 182) |
| SVG aria-hidden | `aria-hidden="true"` on all SVGs in new components |
| Min 24x24 tap target | `min-width/min-height: 24px` enforced on affordance button |
| No v-html | Confirmed — all user content via text interpolation only (`{{ }}`) |
| Escape dismiss | `handleKeydown` registered on mount (lines 155–158) |
| Outside-click dismiss | `handleOutsideClick` on `mousedown` (lines 144–152) |
| Reduced motion | `@media (prefers-reduced-motion: reduce) { transition: none }` (lines 391–397) |

**localStorage persistence — exceeds spec:**

GameShell.vue:102–115: both `getActionHelpEnabled()` and `setActionHelpEnabled()` wrap localStorage calls in `try/catch`. The spec (§5) did not require defensive wrapping; the code adds graceful degradation for private-browsing / SSR contexts. This is strictly better than the spec.

**Default ON — PASS:**

`getActionHelpEnabled()` returns `true` when key is absent (line 105). `isActionHelpVisible` initialised from this (GameShell.vue:356). ✓

**ControlsMenu `isActionHelpVisible` default — PASS (WR-04 fix):**

`withDefaults(..., { isActionHelpVisible: false })` at ControlsMenu.vue:44–48 ensures `aria-checked` is always a boolean, never absent due to `undefined`. ✓

**IN-02 parity fix — PASS:**

`.action-help-btn` styles are self-contained in ActionHelpPopover.vue (lines 261–282). No `.action-help-btn` CSS class remains in ActionPanel.vue (confirmed via grep). `.action-btn-group { position: relative }` remains in ActionPanel.vue:1172–1176, which is correct (layout container, not affordance styles).

**Parity gap — `disabledActions` not exposed as named slot prop (WARNING):**

The `#game-board` slot (GameShell.vue:1863–1879) and the dev-switcher `<component>` (lines 1844–1862) both receive `isActionHelpVisible` but neither receives `:disabled-actions`. A custom UI author importing `ActionHelpPopover` directly would:
- Have `isActionHelpVisible` as a clean named prop ✓
- Need to independently extract `disabledActions` via `state?.state?.disabledActions` — which requires casting through `as any` or knowing the internal `PlayerGameState` shape

This conflicts with the parity contract ("No per-renderer opt-in") and the Pit of Success principle. The AutoUI (ActionPanel) receives `disabledActions` as a typed named prop; the custom UI must rediscover it from raw state. The data is accessible (`:state` is passed), but the ergonomic gap is real.

**Interaction state table — PASS:**

All six spec scenarios verified in template logic (ActionPanel.vue:814–820):
```html
v-if="isActionHelpVisible && (action.help || disabledActions?.[action.name])"
```
Correctly handles: toggle OFF → no affordance; toggle ON but no content → no affordance; content exists → affordance visible. Both single-section and dual-section popover layouts are gated correctly via `v-if` on the `<hr>` divider (ActionHelpPopover.vue:240).

---

## Registry Safety

Registry audit: 0 third-party blocks — shadcn not initialized, no third-party registries declared. No audit required.

---

## Files Audited

- `/Users/jtsmith/BoardSmith/.planning/phases/108-lightweight-action-help/108-UI-SPEC.md`
- `/Users/jtsmith/BoardSmith/.planning/phases/108-lightweight-action-help/108-REVIEW-FIX.md`
- `/Users/jtsmith/BoardSmith/src/ui/components/helpers/ActionHelpPopover.vue`
- `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/ActionPanel.vue`
- `/Users/jtsmith/BoardSmith/src/ui/components/ControlsMenu.vue`
- `/Users/jtsmith/BoardSmith/src/ui/components/GameShell.vue` (lines 1–150, 340–360, 700–760, 1830–1980)
