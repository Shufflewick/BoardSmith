# Requirements — v4.2 Tutorial Primitives — Go Fish & Docs

**Milestone goal:** Prove the v4.1 tutorial substrate generalizes beyond a grid board by applying it to go-fish (a hidden-information card game), and write the developer documentation for authoring tutorials and teaching features.

**Reuses (already built in v4.1, BoardSmith `src/`):** tutorial lifecycle + action gating, annotation overlay (`useBoardInteraction` / `anchorAttrs`), predicate triggers, CI-verifiable authoring (`testing` DSL), AI teaching (hint/demo/heatmap), action help, host lockout (`teachingDisabled`). This milestone authors go-fish content cross-repo + verifies parity + documents the substrate; it does NOT rebuild the substrate.

---

## v1 Requirements

### Go-Fish Tutorial Content (GFT) — cross-repo in `~/BoardSmithGames/go-fish`

- [x] **GFT-01**: A new player can complete a guided *ask-for-a-rank* step — action gating restricts the choice to a legal ask (an opponent + a rank the player holds), and an annotation overlay anchors to the relevant cards/action.
- [x] **GFT-02**: A predicate-triggered tip explains the *Go Fish!* draw the first time an ask misses and the player must draw from the deck.
- [x] **GFT-03**: The tutorial teaches *forming a book* — completing four of a rank scores it and removes it from the hand.
- [x] **GFT-04**: The tutorial teaches *turn continuation* — a successful ask lets the same player go again (the turn does not end on a hit).
- [x] **GFT-05**: The go-fish tutorial is launchable from the game in both GameShell and the `boardsmith dev` host.
- [x] **GFT-06**: The go-fish tutorial is authored as a CI-verifiable artifact (the `testing` DSL) that fails a test when a go-fish rule change breaks it.

### Go-Fish AI Teaching (GFAI)

- [x] **GFAI-01**: A player can request a move hint on their turn; go-fish's existing MCTS bot returns a legal ask and its target is highlighted via the annotation overlay (anchored to cards/hand, not a board cell).
- [x] **GFAI-02**: A player can watch a narrated AI-vs-AI go-fish demo in which each move is announced before it executes.

> The evaluation heatmap (v4.1 AI-03) is intentionally **out of scope** for go-fish — it shades board cells and go-fish has no grid. It remains available for grid games and is documented as board-only (see DOC-03).

### Go-Fish Action Help (GFHELP)

- [x] **GFHELP-01**: Each go-fish action has help text revealed on hover/tap, governed by the global "Show action help" toggle.

### Go-Fish Host Lockout (GFLOCK)

- [x] **GFLOCK-01**: When the host teaching-lockout is set, go-fish's hint, AI-demo, and tutorial affordances are hidden and the corresponding ops are rejected fail-loud, while action help stays enabled — verifying the v4.1 `teachingDisabled` substrate generalizes to a card game.

### Developer Documentation (DOC) — BoardSmith `docs/`

- [x] **DOC-01**: A developer guide documents authoring a tutorial — `TutorialDefinition`, the start/advance/skip/exit lifecycle, action gating, and the annotation overlay (targets: cell/piece/card/panel/action).
- [x] **DOC-02**: The guide documents predicate triggers and CI-verifiable authoring via the `testing` DSL (how a rule change is made to fail a test).
- [x] **DOC-03**: The guide documents the AI teaching features (move hint, narrated AI-vs-AI demo, evaluation heatmap) and the host teaching-lockout (`teachingDisabled`) + action help, noting the heatmap is board-only.
- [x] **DOC-04**: The guide uses both checkers (grid) and go-fish (cards) as worked examples, showing the parity path (e.g. `anchorAttrs` on board squares vs. on cards/hands).

---

## Future Requirements (deferred)

- Card-game move-quality visualization (a non-grid analog of the heatmap) — deferred; the heatmap stays board-only for now.
- Cribbage tutorial showcase (rules-dense, 5-phase) — the deferred phase-3 stretch bed.
- Carried v4.1 backlog: suppress-Undo-during-tutorial (R-05), strategy tutorial track (R-12), `anchorAttrs`-missing dev-warning/lint.

## Out of Scope

- Rebuilding or changing the tutorial substrate — v4.2 consumes the v4.1 primitives as-is (changes only if a real go-fish-driven gap is found).
- New AI training/weights — reuses go-fish's existing MCTS bot.
- The evaluation heatmap for go-fish — board-specific; documented as board-only rather than forced onto a gridless card game.

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| GFT-01 | Phase 112 | Complete |
| GFT-02 | Phase 112 | Complete |
| GFT-03 | Phase 112 | Complete |
| GFT-04 | Phase 112 | Complete |
| GFT-05 | Phase 112 | Complete |
| GFT-06 | Phase 112 | Complete |
| GFAI-01 | Phase 113 | Complete |
| GFAI-02 | Phase 113 | Complete |
| GFHELP-01 | Phase 114 | Complete |
| GFLOCK-01 | Phase 114 | Complete |
| DOC-01 | Phase 115 | Complete |
| DOC-02 | Phase 115 | Complete |
| DOC-03 | Phase 115 | Complete |
| DOC-04 | Phase 115 | Complete |
