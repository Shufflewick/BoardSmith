---
phase: 105
slug: annotation-overlay-ui-parity
status: draft
shadcn_initialized: false
preset: none
created: 2026-06-25
---

# Phase 105 — UI Design Contract: Tutorial Annotation Overlay

> Visual + interaction contract for the `TutorialOverlay` layer (text bubble + targeted
> highlight) mounted in GameShell `.boardregion`. Identical in custom UI and AutoUI because
> targeting routes through the shared anchor set once in the board/selectable layer.
> All colors/spacing reference `--bsg-*` Slate tokens (raw hex is forbidden by `color-no-hex`).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (established `--bsg-*` Slate token engine — `src/ui/theme.ts`) |
| Preset | not applicable (Vue 3 library, not React/Next/Vite shadcn) |
| Component library | none — in-house Slate primitives (`BoardMessage`, `GameOverlay`) |
| Icon library | inline SVG / glyph (no icon dep — do not add one, per CLAUDE.md) |
| Font | `var(--bsg-font)` (Hanken Grotesk, system-ui fallback) |

This phase adds **no new tokens**. It composes existing ones. Anchor attribute name, rect
measurement strategy, and file names are Claude's discretion per 105-CONTEXT.md.

### Token reference (consumed, not redefined)

| Concern | Token(s) |
|---------|----------|
| Spacing | `--bsg-s1` 4 · `--bsg-s2` 8 · `--bsg-s3` 12 · `--bsg-s4` 16 · `--bsg-s5` 24 (8-pt aligned) |
| Type | `--bsg-text-sm` .875rem (bubble body) · `--bsg-text-base` 1rem (bubble title) · `--bsg-line-normal` 1.5 · `--bsg-line-tight` 1.2 |
| Weight | 400 body · 600 bubble title (the two Slate weights) |
| Surface | `--bsg-surface-2` (bubble bg) · `--bsg-line-2` (bubble border) |
| Ink | `--bsg-ink` (bubble text) · `--bsg-ink-2` (secondary line) |
| Accent (10%) | `--bsg-accent` (ring stroke) · `--bsg-accent-2` (glow) · `--bsg-accent-ink` (marker glyph) |
| Radius | `--bsg-r-md` 11px (bubble + ring default) · `--bsg-r-pill` (marker chip) |
| Elevation | `--bsg-shadow` (bubble lift) · `--bsg-ring` (selection precedent) |
| Motion | `--bsg-dur-base` 200ms · `--bsg-dur-slow` 360ms · `--bsg-ease` |

---

## 1. Text Bubble (extends `BoardMessage.vue`)

Reuse `BoardMessage` for `role="status"` + `aria-live="polite"` + reduced-motion for free.
The annotation bubble is a **content variant** of that primitive — same fade/positioning
contract, richer body. Add a `variant="annotation"` (or an `:anchor-rect` prop) rather than
forking the component.

| Property | Value | Rationale |
|----------|-------|-----------|
| Body type | `--bsg-text-sm`, weight 400, `--bsg-line-normal` (1.5) | Tutorial text is multi-line prose, so 1.5 not the pill's tight 1.2 |
| Optional title line | `--bsg-text-base`, weight 600, `--bsg-line-tight` | First-line emphasis when a step has a heading |
| Padding | `var(--bsg-s3) var(--bsg-s4)` (12 / 16) | Roomier than the pill's `s2/s4` for paragraph text |
| Max-width | `min(320px, 90%)` | Readable measure; clamps to board width on compact |
| Background | `var(--bsg-surface-2)` | Matches BoardMessage; lifts off the board surface |
| Border | `1px solid var(--bsg-line-2)` | Same hairline as BoardMessage |
| Radius | `var(--bsg-r-md)` (11px) | Rounded card, NOT the pill — distinguishes from transient turn prompt |
| Elevation | `var(--bsg-shadow)` | Heavier than BoardMessage's `--bsg-shadow-sm` so the bubble reads above selection chrome |
| Text align | `left` (override BoardMessage center) | Prose reads left-aligned |

### Connection to target

- **Connector caret** — an 8px caret (CSS triangle: `--bsg-surface-2` fill, `--bsg-line-2`
  edge) on the bubble side facing the target. Points from the bubble toward the ring so the
  pairing is unambiguous **by shape, not color**.
- When there is **no resolvable target** (fallback), the caret is hidden and the bubble
  behaves exactly as stock BoardMessage (centered horizontally, top/bottom anchored).

### Placement rules

1. `placement` omitted or `'auto'` → measure target rect; **prefer below** the target with a
   `var(--bsg-s2)` gap. If the bubble's bottom would exceed the `.boardregion` content box,
   **flip above**. Horizontally center on the target, then **clamp** within the boardregion
   inset so the bubble never clips off-edge (recompute caret offset after clamping).
2. `'top'` / `'bottom'` / `'center'` → force the BoardMessage anchor (no target math, no caret).
3. `'center'` overlays the board center — use only for "welcome / no specific target" steps.

### Multiple annotations

`step.content` is an array. Render in array order. Bubbles **stack** with a `var(--bsg-s2)`
vertical gap and never overlap their own ring; if two `auto` bubbles resolve to the same
region, offset each subsequent one by `var(--bsg-s5)` (24px) along the cross axis. Each
`target` draws its own independent ring. A step may legitimately carry one ring-only
annotation (no `text`) plus one bubble-only annotation (no `target`).

---

## 2. Targeted Highlight (ring / glow)

A single absolutely-positioned overlay box drawn **outside** the measured target rect, so it
reads identically over a board cell, a piece, the action panel, or an action button —
contrast never depends on the target's own background.

| Property | Value |
|----------|-------|
| Stroke | `3px solid var(--bsg-accent)` — **wider than the 2px selection outline** so a tutorial ring out-ranks normal selection chrome |
| Offset | sits 3px **outside** the target rect (positioned box, `inset: -3px` over the rect; never an inner `outline-offset` so it can't be clipped by the cell) |
| Radius | `var(--bsg-r-md)` default; for pill targets (action buttons) match `var(--bsg-r-pill)` — the overlay reads the target's computed `border-radius` and falls back to `--bsg-r-md` |
| Glow | `box-shadow: 0 0 0 3px color-mix(in srgb, var(--bsg-accent) 35%, transparent), 0 0 16px color-mix(in srgb, var(--bsg-accent-2) 30%, transparent)` |
| Pointer events | `none` (decorative; never blocks the underlying control) |

### Non-color cue (WCAG 2.2 AA — 1.4.1 Use of Color)

Color is **never** the sole signal. Three redundant, shape-based cues:

1. **Marker chip** — a small `--bsg-r-pill` chip pinned to the ring's top-left corner
   containing a glyph (e.g. an "i" / lightbulb), `var(--bsg-accent)` fill, `var(--bsg-accent-ink)`
   glyph. Identifies the ring as a *tutorial* highlight independent of hue.
2. **Connector caret** (from §1) physically linking bubble → ring.
3. **Ring weight + glow** form a thicker, haloed double-edge shape distinct from the thin
   single 2px selection outline — distinguishable in grayscale.

The marker chip + caret guarantee the highlight is legible to colorblind users and at the
selection/drop-target accent hue it shares.

---

## 3. States & Motion

| State | Behavior |
|-------|----------|
| Appear | Ring: fade + one-shot emphasis (scale 1.05 → 1.0, opacity 0 → 1) over `--bsg-dur-base` `--bsg-ease`. Bubble: BoardMessage fade. |
| Emphasis pulse | **Calm, not a disco** (GridBoard precedent): a **2-iteration** glow breathe over `--bsg-dur-slow`, then settle to the static ring. No infinite attract loop. |
| Update (step → step) | Re-measure target; ring/bubble tween to new rect over `--bsg-dur-base` (FLIP-consistent). aria-live re-announces the new bubble text. |
| Disappear | Reverse fade over `--bsg-dur-base`; on `v-if` removal the overlay leaves zero markup. |

**`prefers-reduced-motion: reduce`** — no scale, no pulse, no rect tween: ring appears/updates
instantly; bubble fade already disabled by BoardMessage. (Mirror BoardMessage's media query.)

### Target not on screen / not yet mounted (graceful, never throws)

- Target anchor `querySelector` returns **null** → render the **bubble only** in fallback
  top/bottom placement, **no ring**, no error. Re-attempt measurement on the next
  ResizeObserver / mutation tick so the ring appears once the element mounts.
- Target measured but **outside the boardregion viewport** (scrolled away) → keep the bubble
  pinned/clamped at the nearest boardregion edge so guidance stays visible; the ring is
  drawn at the true rect and naturally clipped by `.boardregion` overflow. Never auto-scroll
  or steal the viewport.
- Re-measure on: ResizeObserver(target + boardregion), boardregion `scroll`, and zoom-level
  change (`--zoom-level` on `.game-shell__zoom-container`).

### Z-index layering

`.boardregion` stack (literal z-index — not colors, lint-safe; mirrors BoardMessage's `z-index: 5`):

| Layer | z-index |
|-------|---------|
| Board content / cells | base |
| `BoardMessage` (turn prompt) | 5 |
| **`TutorialOverlay` (ring layer + bubble)** | **20** |
| `GameOverCard` scrim / `GameOverlay` modal | 50 |
| `.actionbar` (sibling of `.stage`, below boardregion) | unaffected |

Tutorial chrome sits **above** the always-on turn prompt (it is the active teaching focus)
but **below** modal/game-over surfaces. The ring sub-layer is `pointer-events: none`; the
bubble keeps `pointer-events: auto` only on its own content box (BoardMessage precedent).

---

## 4. Accessibility

- **Announcement** — bubble text is announced via BoardMessage's `role="status"` /
  `aria-live="polite"`. On step change the text node updates and is re-announced. Do **not**
  use `assertive` (tutorial guidance is not an alert).
- **Focus** — the overlay **MUST NOT steal focus**: no autofocus, no focus trap (unlike the
  `GameOverlay` modal). The player's keyboard position on the board/action panel is preserved
  so a keyboard user can act on the highlighted control directly.
- **Keyboard dismiss/advance** — **out of scope here**; step advance/dismiss is Phase 104
  lifecycle. This overlay is pure presentation and adds no key handlers. (Note for 106:
  predicate auto-advance; any manual "Next" affordance is a later phase.)
- **Screen-reader description of the target** — the ring is decorative: `aria-hidden="true"`.
  The *authored bubble text* is the accessible description and SHOULD name the target in prose
  (e.g. "Tap the centre cell to place your stone"). Content authoring is game-side; the spec
  requires the bubble carry a human description rather than relying on the visual ring. The
  marker chip glyph is also `aria-hidden` (decorative).

---

## 5. Parity Note (structural, not opt-in)

The visual is produced by **ONE** `TutorialOverlay` layer that locates targets via the
**shared anchor attribute set exactly once** in the shared selectable/board layer
(`useBoardInteraction` / `useSelectable` — discretion), then positions ring + bubble by
measuring DOM rects. Consequences the executor must honor:

- The overlay selects targets through the **shared anchor only** (e.g. `data-bs-el-id` /
  `data-bs-el-notation` / `data-bs-el-name` mirroring `matchesRef` precedence;
  `data-bs-action="<name>"` on action controls; `data-bs-panel` on the ActionPanel root).
  It **MUST NOT** query renderer-specific selectors (`.grid-cell`, `.board-grid`, AutoUI
  class names). A custom UI that uses the shared interaction layer gets annotations for free
  and **cannot "forget"** to support them — parity is structural.
- No `isAnnotationHighlighted()` method is added to the 8 renderers or to any custom UI. The
  ring is drawn by the overlay over the measured rect, not by the target component styling
  itself.
- Verified in **both** paths (criterion #3): an AutoUI renderer fixture **and** a custom-UI
  fixture render the same annotation from the same `step.content`, asserting the ring rect +
  bubble text match. The spec assumes **no AutoUI-only DOM**.

---

## 6. Six-Dimension Self-Check

| Dimension | Verdict | Notes |
|-----------|---------|-------|
| Visual hierarchy | PASS | Tutorial ring is 3px vs selection's 2px and sits at z-20 above the turn prompt (z-5); bubble uses heavier `--bsg-shadow` + `--bsg-r-md` card vs the pill prompt — the teaching focus clearly out-ranks ambient chrome without hiding it. |
| Consistency w/ Slate | PASS | Reuses `BoardMessage`, `--bsg-accent`/`--bsg-accent-2` (same interaction hue as selection/drop), `--bsg-surface-2`/`--bsg-line-2`, `--bsg-r-md`, `--bsg-shadow`, `--bsg-dur-*`/`--bsg-ease`. Zero new tokens, zero raw hex. |
| Accessibility | PASS | `role=status`/`aria-live=polite` announce; no focus steal / no trap; ring `aria-hidden`; non-color cue via marker chip + connector caret + ring-weight shape (WCAG 2.2 AA 1.4.1). |
| Motion | PASS | Appear fade + 2-iteration emphasis (calm, not a disco), `dur-base`/`dur-slow`; full `prefers-reduced-motion` path (instant, no pulse/scale/tween). |
| Responsive / compact | PASS | Bubble `max-width: min(320px, 90%)` clamps to board; auto-placement flips/clamps within `.boardregion`; re-measures on resize/scroll/zoom; degrades to centered top/bottom when no target. |
| State coverage | PASS | appear · update (step→step) · disappear · multiple annotations · target-null (bubble-only) · target-offscreen (clamped bubble + clipped ring) · reduced-motion all specified. |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS — annotation *copy* is game-authored per step; spec mandates target-naming prose in the bubble (no fixed CTA/empty/error strings owned by this layer).
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS — accent (10%) reserved here for the tutorial ring/glow + marker chip only.
- [ ] Dimension 4 Typography: PASS — 2 sizes (`text-sm` body, `text-base` title), 2 weights (400/600).
- [ ] Dimension 5 Spacing: PASS — `s2`/`s3`/`s4`/`s5`, all 8-pt aligned.
- [ ] Dimension 6 Registry Safety: PASS — not applicable (no shadcn / no third-party registry).

**Approval:** pending
