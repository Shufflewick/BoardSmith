# Requirements — v3.1 Dynamic Auto-UI

**Goal:** Replace the current Auto UI with a dynamically-generated UI good enough to *play* a basic game (Hex, Go Fish, Checkers) before any custom UI is written, plus fix an information leak surfaced during research. Reuse the interaction substrate; replace the renderer; ship via templates (not a general solver); keep presentation out of the engine; migrate every game and delete the old paths.

Source research: `docs/auto-ui-redesign-research.md` (§0 authoritative) and `.planning/research/SUMMARY.md`.

## v3.1 Requirements

### Security (SEC)
- [ ] **SEC-01**: A face-down / hidden card's face image refs (`$images.face`) are not sent to players who cannot see the card — `toJSONForPlayer` filters image refs by visibility.
- [ ] **SEC-02**: The `$`-attribute whitelist in `toJSONForPlayer` is audited and constrained to genuine layout descriptors, so no value-bearing data can ride the `$`-prefix to unauthorized players.

### Piece & Element Rendering (PIECE)
- [x] **PIECE-01**: A piece renders its `$image`/`$images` as an image rather than a text label.
- [x] **PIECE-02**: A piece with no image renders as a labeled token with owner color/shape — not a bare text box.
- [x] **PIECE-03**: Grid boards size from declared coordinates (`$rowCoord`/`$colCoord`); the hardcoded 8×8 fallback is removed and missing coordinates fail loudly with an actionable message.

### Renderer Rebuild (RENDER)
- [ ] **RENDER-01**: A new renderer replaces `AutoElement.vue` + `AutoGameBoard.vue` while reusing the interaction substrate (`useActionController`, `useBoardInteraction`, drag orchestration, FLIP/flying primitives) unchanged except where INTERACT requires.
- [ ] **RENDER-02**: Element renderers are dispatched via a ranked-tester registry (replacing the brittle `elementType` if/else cascade); a higher-priority renderer can be registered to upgrade the auto-UI in place.
- [ ] **RENDER-03**: The board is laid out by an introspection-selected archetype template (grid-board / card / tableau) that encodes visual hierarchy (focal board, docked hand, peripheral chrome) — not equal-space subdivision.
- [ ] **RENDER-04**: Grid and hex layouts use closed-form math (`useGameGrid`/`useHexGrid`); the auto-UI's scope is bounded to coordinate-addressable topologies (grid/hex/stack/hand) and fails honestly outside it.
- [ ] **RENDER-05**: The new renderer consumes `useAnimationEvents` so deal/flip/reveal choreography plays (the old auto path never did).

### Board-Centric Interaction (INTERACT)
- [ ] **INTERACT-01**: Action choices that carry a board anchor are actioned directly on the board by default; the footer panel is the fallback when there is no anchor.
- [ ] **INTERACT-02**: The footer ActionPanel is suppressible by the board UI (GameShell no longer mounts it unconditionally).
- [ ] **INTERACT-03**: An action choice can express multiple source/target board elements (multi-ref highlight metadata) — `protocol.ts` and `buildActionMetadata` extended beyond singular `sourceRef`/`targetRef`/`ref`.

### Presentation Overlay (PRESENT)
- [ ] **PRESENT-01**: A UI declares a presentation overlay (a sibling file it imports) mapping element class/name/attribute → visuals (image, label, stat block, render hint).
- [ ] **PRESENT-02**: The overlay is resolved *after* engine visibility filtering, so it cannot expose data the viewer is not allowed to see.
- [ ] **PRESENT-03**: The auto-UI reads the overlay for visuals beyond defaults; custom UIs supply their own; engine elements carry no value-bearing `$`-presentation props (`$image`/`$stats`/`$label`/`$render`/`$owner` rejected — ownership stays on `.player`).

### Shippable Peer & Single-UI Export (SHIP)
- [ ] **SHIP-01**: The auto-UI is a selectable, shippable production UI (a fine choice for simple games), not merely a dev/debug panel.
- [ ] **SHIP-02**: A production build emits a single UI — removing the scaffold's static `import { AutoUI }` lets ordinary tree-shaking drop unselected UIs (no registry/`rollupOptions.input` required for this).
- [ ] **SHIP-03**: The scaffold generates a game that opens in its chosen UI with the custom-UI slot empty/ready — no split-screen "Custom vs Auto-Generated" comparison.

### Migration & Cleanup (MIGRATE) — milestone exit criterion
- [ ] **MIGRATE-01**: Every game in `~/BoardSmithGames/` is migrated to the new auto-UI and is *playable* (browser-verified, not just unit-test green).
- [ ] **MIGRATE-02**: MERC is verified green against any shared-plumbing changes (the canary for the "custom renderer in a shared shell" boundary).
- [ ] **MIGRATE-03**: The old auto-UI renderer and the split-screen scaffold template are deleted — no deprecation cycle (No Backward Compatibility).
- [ ] **MIGRATE-04**: Docs updated (`custom-ui-guide.md`, `ui-components.md`, `component-showcase.md`, scaffolded READMEs) and `npm run audit` (dead-code + duplication) is clean.

## Future Requirements (deferred)

- General percentage-relative layout solver — only when a real game's topology can't be templated.
- Responsive container-query / breakpoint layout primitives (viewport-measured reflow beyond what templates give).
- Phase-surface and structured scoring-summary renderers (Cribbage/MERC-class complexity).
- N-UI registry + live dev-time UI switcher (multiple UIs per game, switch against one session).
- Auto-generate-then-eject (dump the generated UI as editable components).
- Engine model additions: spatial adjacency/connection graph, free-form positioning, z-order.

## Out of Scope

- General layout solver upfront — see decision; templates first.
- Value-bearing `$`-annotations on engine elements — security leak + not per-UI.
- Touch/mobile polish, accessibility (screen-reader/keyboard/colorblind-safe identity), i18n of author strings — named gaps for a future milestone.
- Backward compatibility / deprecation cycles — clean break per project rule.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 91 | Pending |
| SEC-02 | Phase 91 | Pending |
| PIECE-01 | Phase 92 | Complete |
| PIECE-02 | Phase 92 | Complete |
| PIECE-03 | Phase 92 | Complete |
| RENDER-01 | Phase 93 | Pending |
| RENDER-02 | Phase 93 | Pending |
| RENDER-03 | Phase 93 | Pending |
| RENDER-04 | Phase 93 | Pending |
| RENDER-05 | Phase 93 | Pending |
| INTERACT-01 | Phase 94 | Pending |
| INTERACT-02 | Phase 94 | Pending |
| INTERACT-03 | Phase 94 | Pending |
| PRESENT-01 | Phase 94 | Pending |
| PRESENT-02 | Phase 94 | Pending |
| PRESENT-03 | Phase 94 | Pending |
| SHIP-01 | Phase 95 | Pending |
| SHIP-02 | Phase 95 | Pending |
| SHIP-03 | Phase 95 | Pending |
| MIGRATE-01 | Phase 96 | Pending |
| MIGRATE-02 | Phase 96 | Pending |
| MIGRATE-03 | Phase 96 | Pending |
| MIGRATE-04 | Phase 96 | Pending |
