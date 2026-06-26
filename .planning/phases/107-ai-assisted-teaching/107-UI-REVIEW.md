---
phase: 107
slug: ai-assisted-teaching
reviewed_at: 2026-06-26
auditor: gsd-ui-reviewer
status: advisory
---

# Phase 107 — UI Review

**Audited:** 2026-06-26
**Baseline:** 107-UI-SPEC.md (approved design contract)
**Screenshots:** not captured (no dev server — code-only audit)

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Narration "AI Demo" prefix has no ink-2 color distinction; rendered as single-color block |
| 2. Visuals | 4/4 | Z-index stack, teleport, pointer-events, non-color cues all match spec exactly |
| 3. Color | 3/4 | ControlsMenu toggle pill uses two `rgba()` literals — violates project no-literals hard-rule |
| 4. Typography | 2/4 | `.grouplabel` class uses 10px/700/mono vs spec's --bsg-text-sm/400/--bsg-font; narration prefix/body colors not split |
| 5. Spacing | 3/4 | New overlay components use tokens correctly; ControlsMenu pre-existing literals inherited by Teaching items |
| 6. Experience Design | 3/4 | Reduced motion covered in all 3 new overlays; ControlsMenu `pop` animation lacks prefers-reduced-motion suppression |

**Overall: 18/24**

---

## Top 3 Priority Fixes

1. **Narration card "AI Demo" prefix has no ink-2 styling** — Users see the player name/source label and the move text in the same color (`--bsg-ink`). The spec requires the "AI Demo" prefix in `var(--bsg-ink-2)` and the move string in `var(--bsg-ink)` for visual hierarchy. Fix: add a `prefix` prop to `BoardMessage`'s narration variant (or a named `#prefix` slot) and style it `color: var(--bsg-ink-2)`. Update `GameShell.vue` to pass the player-name prefix through that prop/slot rather than baking it into the engine-formatted string.

2. **ControlsMenu `.grouplabel` typography conflicts with UI-SPEC contract** — The spec's typography table prescribes `--bsg-text-sm` (14px), weight 400, `var(--bsg-font)`, `--bsg-line-tight` for ControlsMenu section labels. The actual `.grouplabel` class renders at `font-size: 10px`, weight 700, `var(--bsg-mono)`, uppercase tracked text. The spec also says to "use the existing `.grouplabel` CSS class" — an internal spec contradiction. Resolution: either update the `.grouplabel` class to match the typography contract (affecting Play, Session, Teaching labels) or file a spec correction acknowledging the pre-existing style is intentional. Do not leave the contradiction unresolved.

3. **ControlsMenu toggle pill uses `rgba()` literal colors** — Lines 418 and 420 contain `rgba(255, 255, 255, 0.95)` (knob fill) and `rgba(0, 0, 0, 0.3)` (shadow). Project hard-rule: no color literals in component files. Phase 107 adds a second use of this toggle (heatmap). Fix: add `--bsg-toggle-knob` and `--bsg-toggle-shadow` tokens to `src/ui/theme.ts` STATIC_TOKENS and replace both literals.

---

## Detailed Findings

### Pillar 1: Copywriting (3/4)

**PASSING:**
- "Get a hint" — correct (ControlsMenu.vue:250)
- "Watch AI demo" — correct (ControlsMenu.vue:261)
- "Stop demo" — correct via `isDemoRunning ? 'Stop demo' : 'Watch AI demo'` (ControlsMenu.vue:261)
- "Show move quality" — correct (ControlsMenu.vue:271)
- "Teaching" group label — correct (ControlsMenu.vue:238)
- Demo label swaps on `isDemoRunning` as required ✓

**WARNING: Narration prefix/body color not differentiated (GameShell.vue:1794–1798)**
The spec says the narration card renders inline as: `[prefix in --bsg-ink-2][move text in --bsg-ink]`. The implementation renders `(state?.state as any)?.narration?.text` as a raw string into `<slot />` with no prefix/body split. `BoardMessage`'s narration variant styles the entire content block in `color: var(--bsg-ink)` (inherited). The "AI:" or player-name prefix is typographically indistinguishable from the move text. This weakens the narration's source attribution.

**UNVERIFIABLE: Hint bubble default text "Suggested move"**
The spec declares this default. HintOverlay renders `resolved.text` from `gameState.state.hint.annotation.text` — the default value is not set at the UI layer. It must be set by the session/AI layer when constructing the hint annotation. Cannot be confirmed from these files alone. Flagged for session-layer audit.

**UNVERIFIABLE: Error copy**
"Hint unavailable — the AI could not suggest a move." (toast) and "Demo stopped." (narration) are not in these UI files; they live in the session integration layer. Out of scope for this UI audit.

---

### Pillar 2: Visuals (4/4)

All visual/structural requirements confirmed:

**Z-index stack — matches spec exactly:**
- `BoardMessage variant="narration"`: `z-index: 10` (BoardMessage.vue:225) ✓
- `HeatmapOverlay`: `z-index: 15` (HeatmapOverlay.vue:264) ✓
- `HintOverlay`: `z-index: 20` (HintOverlay.vue:304) ✓

**Overlay architecture:**
- All three new components use `<Teleport to="body">` ✓
- All overlay roots are `position: fixed; inset: 0; pointer-events: none` ✓
- Narration card is `position: fixed` directly in `BoardMessage--narration` ✓

**Non-color cues (WCAG 2.2 AA 1.4.1):**
- Hint ring: "i" glyph chip (shape + letter) identifies AI hint source — HintOverlay.vue:281 ✓
- Heatmap: numeric `%` badge is primary signal; tint is secondary — HeatmapOverlay.vue:257 ✓
- Best-move chip: `2px solid var(--bsg-accent)` border distinct from 1px non-best — HeatmapOverlay.vue:112 ✓

**Parity (custom-vs-auto branching hard-rule):**
Both HintOverlay and HeatmapOverlay call `buildSelector` from overlay-utils.ts (shared with TutorialOverlay). Neither file contains any renderer-specific branching. The `data-bs-el-*` anchor system handles both custom UIs and AutoUI uniformly. ✓

**Security:**
- `v-html` not used anywhere in the new overlay files — only mentioned in comments as a negation ✓
- All text rendered via Vue slot interpolation or text interpolation ✓

---

### Pillar 3: Color (3/4)

**PASSING — new overlay files:**
- Zero hex literals (`#...`) or `rgb()` literals in HintOverlay.vue, HeatmapOverlay.vue, or overlay-utils.ts ✓
- HeatmapOverlay intensity formula: `15 + Math.round(normalizedValue * 70)` — matches spec range 15–85 exactly ✓
- Text color threshold: `chipIntensity >= 55 → var(--bsg-accent-ink); else var(--bsg-ink)` — matches spec ✓
- Best-move border: `2px solid var(--bsg-accent)` ✓; non-best: `1px solid color-mix(... intensity+15%, ...)` ✓
- Accent usage matches the spec's reserved list (items 1–5) with no off-list accent usage ✓
- BoardMessage narration background: `var(--bsg-surface-3)` ✓

**WARNING: ControlsMenu toggle pill — rgba() literals (ControlsMenu.vue:418, 420)**
```
background: rgba(255, 255, 255, 0.95);   /* knob fill */
box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3); /* knob shadow */
```
These are pre-Phase-107 CSS, but Phase 107 adds a second instance of the toggle (heatmap visibility) and the project hard-rule says "No literals in component files." No Slate token currently covers these values. The `rgba(255,255,255,0.95)` knob is also a problem in dark/light mode — the intent is presumably a light knob on dark track, but this literal hardcodes a white value that may not adapt if a future theme uses a non-dark background.

---

### Pillar 4: Typography (2/4)

**PASSING — new overlay components:**
- HeatmapOverlay chip badge: `font-size: var(--bsg-text-xs)`, weight 600, `line-height: var(--bsg-line-tight)` ✓ (HeatmapOverlay.vue:155–157)
- BoardMessage annotation variant content: `font-size: var(--bsg-text-sm)`, weight inherited (400), `line-height: var(--bsg-line-normal)` for annotation, `var(--bsg-line-normal)` for narration ✓
- All new elements use `font-family: var(--bsg-font)` ✓

**WARNING: ControlsMenu `.grouplabel` contradicts spec typography table**
The spec typography table (section "Typography") states:

| ControlsMenu section label | `--bsg-text-sm` | 14px | 400 | `--bsg-line-tight` |

The actual `.grouplabel` class (ControlsMenu.vue:326–334):
```css
font-family: var(--bsg-mono);   /* vs --bsg-font */
font-size: 10px;                /* vs --bsg-text-sm = 14px */
font-weight: 700;               /* vs 400 */
text-transform: uppercase;      /* not in spec */
letter-spacing: 0.14em;         /* not in spec */
```

The spec also says (Copywriting Contract section): "Group header label: 'Teaching' — uses the existing `.grouplabel` CSS class from ControlsMenu." These two statements are mutually contradictory — the existing class does not match the specified tokens. The Teaching label is rendered at 10px mono allcaps while the spec table says it should be 14px sans regular. Since the "Play" and "Session" headers already use `.grouplabel`, changing the class to match the spec would unify all section labels — an improvement, but a divergence from the current design system usage elsewhere in ControlsMenu.

**WARNING: Narration "AI Demo" prefix not styled in `--bsg-ink-2`**
Spec (Color section): "Text layout: inline — 'AI Demo' prefix in `var(--bsg-ink-2)` followed by the move string in `var(--bsg-ink)`."
Implementation (BoardMessage.vue narration variant): single slot renders as one color block — `.bsg-board-message__content--narration` inherits `color: var(--bsg-ink)` from `.bsg-board-message__content`. The spec's inline two-color requirement is unimplemented. GameShell.vue line 1798 passes the full formatted string to slot without a prefix/body split.

---

### Pillar 5: Spacing (3/4)

**PASSING — new overlay components:**
- HintOverlay.vue: bubble GAP constant `8` = `--bsg-s2` value, named in comment ✓
- BoardMessage narration card: `padding: var(--bsg-s2) var(--bsg-s4)` (8px × 16px) ✓
- BoardMessage narration position: `top: var(--bsg-s3)` (12px) ✓
- HeatmapOverlay chip size floor: `Math.max(24, ...)` matches spec's 24px legibility floor ✓
- Ring OFFSET = 3 literal — spec explicitly exempts this: "keep as literal per existing pattern" ✓

**ACCEPTABLE — geometric CSS literals (BoardMessage caret):**
The caret (CSS border-triangle) in BoardMessage uses `8px` and `7px` — these are CSS-triangle geometry values, not spacing tokens. Using spacing tokens for border-trick triangles would be semantically incorrect. Acceptable.

**ACCEPTABLE — HintOverlay ring chip pixel values (-10px, 18px):**
`.bsg-tutorial-ring__chip { top: -10px; left: -10px; width: 18px; height: 18px }` — identical to TutorialOverlay. These are geometric layout values for the chip positioning relative to the ring corner, not spacing values. Acceptable per existing pattern.

**WARNING: ControlsMenu Teaching group inherits pre-existing non-token spacing**
The `.grouplabel` class uses `padding: 10px 10px 5px` (not `--bsg-s3 --bsg-s3 ...`). The `.mi` class uses `padding: 10px`, `gap: 11px`. The `.sep` uses `margin: 6px 8px`. The `.menu` uses `padding: 8px`. None of these are `--bsg-s*` tokens. While these are pre-Phase-107 CSS, the spec's spacing table states `--bsg-s5 (24px)` for "Section spacing in ControlsMenu Teaching group" — this token is not referenced anywhere in ControlsMenu.

The section spacing is delivered via `.sep` (1px line, 6px margin) + `.grouplabel` (10px padding-top) = ~21px composite gap, vs. the spec's 24px `--bsg-s5`. A 3px discrepancy.

---

### Pillar 6: Experience Design (3/4)

**PASSING:**
- `prefers-reduced-motion: reduce` handled in all 3 new overlays:
  - HintOverlay.vue:370–374: `animation: none` on `.bsg-tutorial-ring` ✓
  - HeatmapOverlay.vue:283–287: `animation: none !important` on all chips ✓
  - BoardMessage.vue:349–353: `transition: none` on fade ✓
- `aria-hidden="true"` on ring + chip (decorative) — HintOverlay.vue:275, 281 ✓
- `aria-hidden="true"` on all heatmap chips — HeatmapOverlay.vue:252 ✓
- `role="status"` `aria-live="polite"` on BoardMessage content (all variants) — BoardMessage.vue:114 ✓
- `hintDisabled` correctly maps to `:disabled` + `:aria-disabled` on Get a hint button ✓
- `isDemoRunning` swap ("Watch AI demo" / "Stop demo") ✓
- `isHeatmapVisible` drives `aria-checked` on heatmap toggle menuitemcheckbox ✓
- HintOverlay + HeatmapOverlay ResizeObserver + scroll listener correctly observe boardregion and individual targets ✓
- Observers are torn down in `onUnmounted` with scroll listener removal — no leaks ✓
- Teaching keyboard navigation inherits ControlsMenu's `useFocusTrap` (focus trap + Escape + arrow keys) ✓

**WARNING: ControlsMenu `pop` animation has no `prefers-reduced-motion` suppression (ControlsMenu.vue:316–321)**
```css
.menu {
  animation: pop var(--bsg-dur-fast) var(--bsg-ease);
}
@keyframes pop {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
```
No `@media (prefers-reduced-motion: reduce)` block suppresses this. Pre-existing issue, but Phase 107 extends ControlsMenu usage. The vertical translate motion would be experienced by users with `reduce` preference each time the Teaching menu opens.

**MINOR: No visual pending/loading state for hint computation**
When a user clicks "Get a hint", the AI must run MCTS (potentially several hundred milliseconds). The `hintDisabled` prop disables the button at decision boundaries, but there is no in-UI spinner or "thinking" indicator in any of the new components. The hint appears when ready; if the AI is slow, the user sees nothing between click and ring appearance. This may be addressed in the session layer (e.g., the hint item is disabled while computing), but no loading indicator is present in the UI spec or implementation.

---

## Registry Safety

No shadcn initialized (`components.json` absent). No third-party component registries used. All Phase 107 components are custom Vue SFCs using the `--bsg-*` token system. Registry audit: not applicable.

---

## Files Audited

- `/Users/jtsmith/BoardSmith/.planning/phases/107-ai-assisted-teaching/107-UI-SPEC.md`
- `/Users/jtsmith/BoardSmith/src/ui/components/helpers/HintOverlay.vue`
- `/Users/jtsmith/BoardSmith/src/ui/components/helpers/HeatmapOverlay.vue`
- `/Users/jtsmith/BoardSmith/src/ui/components/helpers/BoardMessage.vue`
- `/Users/jtsmith/BoardSmith/src/ui/components/helpers/overlay-utils.ts`
- `/Users/jtsmith/BoardSmith/src/ui/components/ControlsMenu.vue`
- `/Users/jtsmith/BoardSmith/src/ui/components/GameShell.vue` (lines 1–100, 1783–1806)
- `/Users/jtsmith/BoardSmith/src/ui/components/helpers/TutorialOverlay.vue`
