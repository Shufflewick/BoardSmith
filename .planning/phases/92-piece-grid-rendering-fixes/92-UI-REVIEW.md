# UI Review — Phase 92: piece-grid-rendering-fixes

**Audited:** 2026-06-21
**Baseline:** 92-UI-SPEC.md (Phase 92 design contract)
**Screenshots:** Not captured — no dev server running; code-only audit
**Registry audit:** Skipped — no shadcn (`components.json` absent)
**Mode:** Advisory, non-blocking

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 3/4 | Panel hint wording diverges from D-03 exact string; panel and console use different phrasing |
| 2. Visuals | 2/4 | Double box-shadow stacking on piece-token; `.piece:hover` scale rule absent |
| 3. Color | 4/4 | All rgba/hex values match spec exactly; accent scoping correct |
| 4. Typography | 4/4 | 12/14/12px, 700/700/400 weights, all line-heights exact |
| 5. Spacing | 4/4 | 8px/16px/4px/8px border-radius all match spec scale; no arbitrary values |
| 6. Experience Design | 3/4 | Error-path browser trigger unachievable via well-formed game; hover interaction contract unimplemented |

**Overall: 20/24**

---

## Top 3 Priority Fixes

1. **Missing `.piece:hover { transform: scale(1.05) }` rule** — The Interaction Contract in UI-SPEC.md explicitly requires this hover state for piece tokens on non-hex boards. The transition property (`transform 0.2s ease`) is wired with no hover rule to trigger it. Users get no hover affordance on standard board pieces. Fix: add `.piece:hover:not(.is-dragging) { transform: scale(1.05); }` to the piece block in the scoped styles.

2. **Panel hint vs console.error string mismatch (D-03 violation)** — UI-SPEC D-03 requires "Both the panel heading and the `console.error` call use this same string" — only the heading may split at the em-dash. Panel hint (`AutoElement.vue:1105`) reads `Declare $rowCoord and $colCoord on this Grid element`; the console string derived from `auto-ui-helpers.ts:169` would produce `declare $rowCoord/$colCoord on the Grid element` as the hint fragment. Three divergences: capitalisation, `and` vs `/`, `this` vs `the`. Fix: change template hint to `declare $rowCoord/$colCoord on the Grid element` (matching what follows the em-dash in the helper's error string), or change the helper error string to match the table copy.

3. **Double box-shadow on piece-token variant** — `.piece` wrapper retains `box-shadow: 0 2px 8px rgba(0,0,0,0.3)` (`AutoElement.vue:1912`). Phase 92 correctly added the same shadow to `.piece-token` per spec (`AutoElement.vue:1938`). For the token variant, both shadows render stacked: the transparent-background `.piece` wrapper casts a shadow and the inner `.piece-token` casts a second identical shadow, visually approximately doubling shadow intensity. Fix: remove `box-shadow` from the `.piece` wrapper class (shadow is now owned by the three child classes `.piece-image`, `.piece-sprite`, `.piece-token` individually per their CSS).

---

## Detailed Findings

### Pillar 1: Copywriting — 3/4

**WARNING — Panel hint diverges from D-03 exact string.**
- `AutoElement.vue:1105`: `Declare $rowCoord and $colCoord on this Grid element`
- `auto-ui-helpers.ts:169` error string continuation (post-em-dash): `declare $rowCoord/$colCoord on the Grid element`
- D-03 requires same string split at the em-dash. Three word-level differences present.
- The Copywriting Contract table (`92-UI-SPEC.md:213`) matches the implementation, but contradicts D-03's exact string — an internal spec inconsistency. In a tie, D-03 (the source specification) outranks the derived table.

**PASS — Grid error heading.**
- `AutoElement.vue:1104`: `Grid "{{ element.name ?? element.id }}" can't render` — exactly matches spec.

**PASS — No generic labels introduced.**
- No Submit/OK/Cancel/Click Here introduced. Pre-existing "Empty" label at lines 1050 and 1332 is out-of-scope for Phase 92.

---

### Pillar 2: Visuals — 2/4

**WARNING — Double box-shadow on piece-token.**
- `.piece { box-shadow: 0 2px 8px rgba(0,0,0,0.3) }` at `AutoElement.vue:1912` (pre-existing, not removed by Phase 92)
- `.piece-token { box-shadow: 0 2px 8px rgba(0,0,0,0.3) }` at `AutoElement.vue:1938` (added by Phase 92 per spec)
- `.piece-token` (40×40 px, colored) sits inside `.piece` (40×40 px, transparent). Both cast the same shadow from the same element bounds. Combined visual effect is approximately 2× shadow intensity vs the `0 2px 8px rgba(0,0,0,0.3)` the spec declares.
- Note: `.piece-image` and `.piece-sprite` inner children have no shadow, so only the `.piece` wrapper shadow shows for those variants — the spec is satisfied for image/sprite.

**WARNING — `piece:hover` scale rule absent.**
- UI-SPEC Interaction Contract (`92-UI-SPEC.md:288–290`): `transform: scale(1.05)` on `:hover` when piece is not dragging.
- No `.piece:hover` rule exists in the file. `grep -n "\.piece:"` returns zero results; the `transition: transform 0.2s ease` on `.piece` has nothing to animate toward.
- `scale(1.05)` exists for `.hex-piece-circle:hover` (line 1870) and `.die-container.action-selectable:hover` (line 2274) — but not for standard pieces.

**PASS — piece-image CSS.**
- `AutoElement.vue:1916–1922`: width/height 100%, object-fit: cover, border-radius: 50%, display: block. Exact spec match.

**PASS — piece-sprite CSS.**
- `AutoElement.vue:1924–1929`: width/height 100%, background-repeat: no-repeat, border-radius: 50%. Exact spec match. (Redundant `backgroundRepeat: 'no-repeat'` in inline style is harmless.)

**PASS — grid-error-panel visual.**
- Renders inside board area, replaces board content (not alongside), other UI stays usable per v-if/v-else branching at lines 1103/1108.

---

### Pillar 3: Color — 4/4

All values are exact matches against spec:
- `.grid-error-panel { background: rgba(231, 76, 60, 0.12); border-color: rgba(231, 76, 60, 0.5) }` — `AutoElement.vue:2331–2332`
- `.grid-error-panel__heading { color: #e74c3c }` — `AutoElement.vue:2344`
- `.grid-error-panel__hint { color: rgba(255, 255, 255, 0.7) }` — `AutoElement.vue:2351`
- Neutral token color `#888888` in `auto-ui-helpers.ts:98`
- `.piece { background: transparent }` — red fill removed (`AutoElement.vue:1904`)
- Accent `#00d9ff` reserved to `.is-selected` (line 1356); `rgba(46,204,113,0.6)` reserved to `.action-selectable` (line 1367) — no accent bleed

---

### Pillar 4: Typography — 4/4

Phase 92 new typography — exact spec compliance:
- `.piece-token-label`: 12px / 700 / line-height 1 (`AutoElement.vue:1943–1946`)
- `.grid-error-panel__heading`: 14px / 700 / line-height 1.3 (`AutoElement.vue:2342–2345`)
- `.grid-error-panel__hint`: 12px / 400 / line-height 1.5 (`AutoElement.vue:2349–2350`)
- Phase 92 new CSS uses only weights 400 and 700

Pre-existing file uses `font-weight: bold` and rem-based font-sizes in other contexts (not introduced by Phase 92 — out of scope).

---

### Pillar 5: Spacing — 4/4

Phase 92 new spacing — all on-scale:
- `.grid-error-panel { padding: 8px 16px; gap: 4px; border-radius: 8px }` — `AutoElement.vue:2334,2337,2333` — 8px (sm), 16px (lg), 4px (xs), 8px border-radius all on spec
- `.piece-token { width: 40px; height: 40px }` — spec-acknowledged 40×40 exception
- `.piece-token-label { max-width: 36px }` — 36 = 9×4, on-grid
- No arbitrary `[px]` or `[rem]` values introduced by Phase 92

---

### Pillar 6: Experience Design — 3/4

**PASS — In-board error panel with dedup console.error.**
- `gridResult` computed guards on `elementType === 'board'` — no false triggers
- `watchEffect` with `_lastGridError` dedup ref: fires console.error exactly once per unique error string (`AutoElement.vue:621–626`)
- Error text contains only element id + prop name — no file paths, line numbers, stack fragments (T-92-01/03 mitigations confirmed)

**PASS — Piece visual dispatch.**
- `pieceVisual` computed guards on `elementType === 'piece'`
- Three branches (image → `<img>`, sprite → `<div>` with background, token → `<div class="piece-token">`) correctly handled at `AutoElement.vue:1263–1286`
- XSS: `:src` binding and `{{ pieceVisual.label }}` interpolation — no `v-html` (count confirmed 0)

**WARNING — PIECE-03 error path not live-browser-verified.**
- Accepted as a boundary (Plan 03 SUMMARY.md): Checkers always resolves its grid via explicit coords + inference backstop; forcing the error state requires breaking the game model
- Verified via 11 unit tests (Plan 01) and code wiring inspection only
- Risk is low given the test coverage but the live render path is untested against real DOM output

**WARNING — Hover interaction not implemented.**
- Interaction Contract specifies `transform: scale(1.05)` on piece hover. Not present. Covered under Visuals Pillar 2 above; contributes to experience degradation as well.

---

## Files Audited

- `/Users/jtsmith/BoardSmith/.planning/phases/92-piece-grid-rendering-fixes/92-UI-SPEC.md`
- `/Users/jtsmith/BoardSmith/.planning/phases/92-piece-grid-rendering-fixes/92-CONTEXT.md`
- `/Users/jtsmith/BoardSmith/.planning/phases/92-piece-grid-rendering-fixes/92-01-SUMMARY.md`
- `/Users/jtsmith/BoardSmith/.planning/phases/92-piece-grid-rendering-fixes/92-02-SUMMARY.md`
- `/Users/jtsmith/BoardSmith/.planning/phases/92-piece-grid-rendering-fixes/92-03-SUMMARY.md`
- `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/auto-ui-helpers.ts`
- `/Users/jtsmith/BoardSmith/src/ui/components/auto-ui/AutoElement.vue`

---

## Recommendation Count

- Priority fixes (BLOCKER/WARNING): 3
- Minor recommendations: 1 (redundant `backgroundRepeat` inline style in piece-sprite template, cosmetic)
