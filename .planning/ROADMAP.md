# Roadmap — v3.1 Dynamic Auto-UI

**Milestone:** v3.1 Dynamic Auto-UI
**Goal:** Replace the current Auto UI with a dynamically-generated UI good enough to play a basic game (Hex, Go Fish, Checkers) before any custom UI is written. Reuse the interaction substrate; replace the renderer via archetype templates; keep presentation out of the engine; migrate every game; delete the old paths.
**Requirements source:** `.planning/REQUIREMENTS.md`
**Research source:** `docs/auto-ui-redesign-research.md` (§0 authoritative) and `.planning/research/SUMMARY.md`
**Phase numbering:** Continues from v3.0 (Phases 85–90). This milestone: Phases 91–96.

---

## Phases

- [x] **Phase 91: Security Leak Fix** — Filter `$images.face` and audit the `$`-whitelist in `toJSONForPlayer` so no value-bearing data reaches unauthorized players. (completed 2026-06-21)
- [x] **Phase 92: Piece & Grid Rendering Fixes** — Pieces render with images/labels; labeled-token fallback for no-image pieces; grid boards size from declared coordinates; hardcoded 8×8 fallback removed. (completed 2026-06-21)
- [ ] **Phase 93: Renderer Rebuild** — Replace `AutoElement.vue` + `AutoGameBoard.vue` with a ranked-tester dispatcher, archetype templates (grid-board/card/tableau), closed-form grid/hex layout, and animation event wiring — reusing the interaction substrate unchanged.
- [ ] **Phase 94: Interaction, Presentation & Playability Gate** — Wire board-centric interaction (suppressible ActionPanel, multi-ref highlight, protocol extension), implement the per-UI presentation overlay, then prove Hex + Go Fish + Checkers are playable end-to-end in the browser.
- [ ] **Phase 95: Ship & Reframe** — Auto-UI as a shippable production peer; single-UI production export via static-import removal; scaffold reframed away from split-screen.
- [ ] **Phase 96: Migration & Cleanup** — Migrate all 9 `~/BoardSmithGames/` games + MERC canary verification; delete old renderer + scaffold; docs updated; `npm run audit` clean.

---

## Phase Details

### Phase 91: Security Leak Fix
**Goal**: Hidden card face image refs and other value-bearing `$`-data are never sent to players who cannot see the element.
**Depends on**: Nothing (independent, no architectural prerequisites)
**Requirements**: SEC-01, SEC-02
**Success Criteria** (what must be TRUE):
  1. In a game with face-down cards (e.g. Go Fish), intercepting another player's serialized game state reveals no face image URLs for cards that player cannot see — only the hidden count/presence indicator.
  2. The `$`-attribute whitelist in `toJSONForPlayer` is constrained to genuine abstract topology descriptors (`$type`, `$layout`, coords, `$zone` as validated enum); any test or inspection confirms no value-bearing key (e.g. `$images.face`, `$stats`, `$label`) is present on hidden/owner-only/count-only elements for unauthorized players.
  3. A unit test directly covers the filtered `$images` path on a visibility-restricted element.
**Plans**: 2 plans
- [x] 91-01-PLAN.md — Wave 0: failing leak test proving $images.face / $image / unknown-$-key leak (SEC-01, SEC-02)
- [x] 91-02-PLAN.md — Wave 1: redactHiddenElementAttrs helper + three branch swaps; suite green (SEC-01, SEC-02)

---

### Phase 92: Piece & Grid Rendering Fixes
**Goal**: Pieces render with meaningful visuals by default and grid boards use their declared coordinate system — no silent fallbacks.
**Depends on**: Nothing (can run in parallel with Phase 91; no architectural prerequisites)
**Requirements**: PIECE-01, PIECE-02, PIECE-03
**Success Criteria** (what must be TRUE):
  1. A game piece that has `$image`/`$images` configured renders as an image in the auto-UI — not as a text-label box.
  2. A game piece with no configured image renders as a labeled token using the owning player's color/shape — distinguishable without text alone.
  3. A grid board with `$rowCoord`/`$colCoord` declared lays out using those coordinates; the hardcoded 8×8 default no longer exists.
  4. Attempting to render a grid board whose coordinates are missing or undeclared produces a loud, actionable error message (not a silent fallback to 8×8).
**Plans**: 3 plans
- [x] 92-01-PLAN.md — Wave 1 (TDD): extract resolvePieceVisual + resolveGridSize pure helpers with unit tests (PIECE-01, PIECE-02, PIECE-03)
- [x] 92-02-PLAN.md — Wave 2: wire helpers into AutoElement.vue (piece dispatch, gridResult layout, error panel, CSS); 8×8 fallback removed (PIECE-01, PIECE-02, PIECE-03)
- [x] 92-03-PLAN.md — Wave 3: browser verification of image/token pieces, declared grid, and error panel (PIECE-01, PIECE-02, PIECE-03)
**UI hint**: yes

---

### Phase 93: Renderer Rebuild
**Goal**: `AutoElement.vue` and `AutoGameBoard.vue` are replaced by a renderer that selects a hierarchy-bearing archetype template by introspection, uses closed-form math for grid/hex layout, dispatches element rendering via a ranked-tester registry, and wires animation events — all while leaving the interaction substrate and its tests untouched.
**Depends on**: Phase 92 (correct piece rendering baseline; new renderer builds on it)
**Requirements**: RENDER-01, RENDER-02, RENDER-03, RENDER-04, RENDER-05
**Success Criteria** (what must be TRUE):
  1. The ranked-tester registry dispatches each element to the highest-priority registered renderer; a consumer can register a custom renderer for a specific element type and it takes precedence over the auto-UI default without touching core files.
  2. A grid game's board is laid out using an introspection-selected archetype template (grid-board / card / tableau) with visual hierarchy (focal board, docked hand, peripheral chrome) rather than equal-space subdivision.
  3. Grid and hex boards calculate cell positions via `useGameGrid`/`useHexGrid` closed-form math; pieces snap to correct logical cells.
  4. All existing `useActionController`, `useBoardInteraction`, drag-drop, FLIP, and flying-element tests remain green — the interaction substrate is provably unchanged.
  5. Animation events (deal, flip, reveal) fire and play during an auto-UI game session; the old auto path's silence on animations is gone.
**Plans**: 7 plans
- [ ] 93-01-PLAN.md — Wave 1: ranked-tester registry + archetype selector + ElementRenderer dispatch (RENDER-02, RENDER-03, RENDER-04)
- [ ] 93-02-PLAN.md — Wave 2: card-family renderers — Card/Hand/Deck (RENDER-01)
- [ ] 93-03-PLAN.md — Wave 2: board-family renderers — GridBoard/HexBoard/Piece via closed-form math (RENDER-01, RENDER-04)
- [ ] 93-04-PLAN.md — Wave 2: leaf renderers — Die/Space (RENDER-01)
- [ ] 93-05-PLAN.md — Wave 2: archetype templates + honest-fail panel (RENDER-03, RENDER-04)
- [ ] 93-06-PLAN.md — Wave 3: AutoRenderer host + animation wiring + AutoUI swap + DELETE old renderer (RENDER-01, RENDER-05)
- [ ] 93-07-PLAN.md — Wave 4: browser smoke-test gate games (render + animation) (RENDER-03, RENDER-05)
**UI hint**: yes

---

### Phase 94: Interaction, Presentation & Playability Gate
**Goal**: Board-centric interaction is wired (suppressible ActionPanel, protocol extension for multi-ref, animation re-wired), the per-UI presentation overlay is live, and Hex + Go Fish + Checkers are verified playable end-to-end in the browser.
**Depends on**: Phase 93 (new renderer must exist; interaction and presentation are wired into it)
**Requirements**: INTERACT-01, INTERACT-02, INTERACT-03, PRESENT-01, PRESENT-02, PRESENT-03
**Success Criteria** (what must be TRUE):
  1. Action choices with a board anchor are actioned directly on the board; the footer ActionPanel is absent (not merely hidden) when all active choices have board anchors.
  2. The footer ActionPanel is suppressible by the board UI via an explicit prop/slot — `GameShell.vue` no longer mounts it unconditionally.
  3. `protocol.ts` and `buildActionMetadata` support multi-element highlight metadata (`boardRefs` plural); a multi-step action (e.g. a multi-jump in Checkers) highlights all relevant source/target cells simultaneously.
  4. A UI can declare a presentation overlay (sibling file) mapping element class/name/attribute to image URL, label, and stat block; the auto-UI reads and applies the overlay, and custom UIs supply their own without modifying the engine.
  5. The presentation overlay is resolved after engine visibility filtering — overlay data for a hidden element is never present in the payload the unauthorized player receives.
  6. **Playability Gate — Hex**: A complete game of Hex (place stones, claim territory, win detection) is played from start to finish in the browser using only the auto-UI, with no custom UI code.
  7. **Playability Gate — Go Fish**: A complete game of Go Fish (deal, ask, draw, collect sets, end game) is played from start to finish in the browser using only the auto-UI, with no custom UI code.
  8. **Playability Gate — Checkers**: A complete game of Checkers (move pieces, single capture, multi-jump, king promotion) is played from start to finish in the browser using only the auto-UI, with no custom UI code.
**Plans**: TBD
**UI hint**: yes

---

### Phase 95: Ship & Reframe
**Goal**: The auto-UI is a legitimate, shippable production peer; a production build emits only the chosen UI; new game scaffolds open in a single UI without a split-screen comparison.
**Depends on**: Phase 94 (playability must be proven before "shippable" is credible)
**Requirements**: SHIP-01, SHIP-02, SHIP-03
**Success Criteria** (what must be TRUE):
  1. Docs, CLI output, and scaffold READMEs frame the auto-UI as a valid production choice for simple games — no "debug/reference aid" language.
  2. Removing the scaffold's static `import { AutoUI }` from a production build results in the auto-UI bundle being dropped by ordinary tree-shaking (no registry or `rollupOptions.input` manipulation needed).
  3. A freshly scaffolded game project opens in its chosen UI immediately; there is no split-screen "Custom vs Auto-Generated" comparison panel.
  4. A developer who chooses the auto-UI as their sole production UI encounters no framework-level friction — `boardsmith dev` and `boardsmith build` just work.
**Plans**: TBD
**UI hint**: yes

---

### Phase 96: Migration & Cleanup
**Goal**: Every game in `~/BoardSmithGames/` is migrated to the new auto-UI and browser-verified playable; MERC is green on shared-plumbing changes; old renderer and split-screen scaffold are deleted; `npm run audit` is clean.
**Depends on**: Phase 95 (final renderer + scaffold decisions locked before cross-repo migration)
**Requirements**: MIGRATE-01, MIGRATE-02, MIGRATE-03, MIGRATE-04
**Success Criteria** (what must be TRUE):
  1. Each of the 9 games in `~/BoardSmithGames/` (hex, checkers, cribbage, go-fish, polyhedral-potions, floss-bitties, demo-action-panel, demo-animation, demo-complex-ui) is re-vendored against the new BoardSmith, migrated to the new auto-UI, and verified playable by actually playing it in the browser.
  2. MERC (`~/Dropbox/MERC/BoardSmith/MERC`) is re-vendored and its test suite is green — the canary confirming the "custom renderer in a shared mandatory shell" boundary is intact.
  3. `AutoElement.vue`, `AutoGameBoard.vue`, and the split-screen scaffold template are deleted; no references to the old auto-UI renderer remain in the codebase — zero deprecation cycle.
  4. `npm run audit` (dead-code + duplication checks) returns clean after deletion.
  5. Docs (`custom-ui-guide.md`, `ui-components.md`, `component-showcase.md`, scaffolded game READMEs) reflect the new auto-UI API with no stale references to the old renderer.
**Plans**: TBD
**UI hint**: yes

---

## Progress Table

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 91. Security Leak Fix | 2/2 | Complete   | 2026-06-21 |
| 92. Piece & Grid Rendering Fixes | 3/3 | Complete    | 2026-06-21 |
| 93. Renderer Rebuild | 0/7 | Planned | - |
| 94. Interaction, Presentation & Playability Gate | 0/? | Not started | - |
| 95. Ship & Reframe | 0/? | Not started | - |
| 96. Migration & Cleanup | 0/? | Not started | - |

---

## Coverage

**Total v3.1 requirements:** 23
**Mapped:** 23/23

| Requirement | Phase |
|-------------|-------|
| SEC-01 | 91 |
| SEC-02 | 91 |
| PIECE-01 | 92 |
| PIECE-02 | 92 |
| PIECE-03 | 92 |
| RENDER-01 | 93 |
| RENDER-02 | 93 |
| RENDER-03 | 93 |
| RENDER-04 | 93 |
| RENDER-05 | 93 |
| INTERACT-01 | 94 |
| INTERACT-02 | 94 |
| INTERACT-03 | 94 |
| PRESENT-01 | 94 |
| PRESENT-02 | 94 |
| PRESENT-03 | 94 |
| SHIP-01 | 95 |
| SHIP-02 | 95 |
| SHIP-03 | 95 |
| MIGRATE-01 | 96 |
| MIGRATE-02 | 96 |
| MIGRATE-03 | 96 |
| MIGRATE-04 | 96 |

---

## Cross-cutting Constraint

The engine remains UI-agnostic throughout. No value-bearing `$`-props (`$image`, `$stats`, `$label`, `$render`, `$owner`) are added to engine elements in any phase. Presentation lives exclusively in the `ui` layer. The headless AI/test/replay paths are never broken by UI work.
