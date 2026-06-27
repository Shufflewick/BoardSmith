# Requirements: BoardSmith — v4.1 Tutorial Primitives (Checkers)

**Defined:** 2026-06-25
**Core Value:** Make board game development fast and correct — the framework handles multiplayer, AI, and UI so designers focus on game rules.

## v1 Requirements

Requirements for milestone v4.1. Each maps to roadmap phases. The substrate (TUT) is the reusable contribution; the checkers tutorial (CHK) proves it; AI/HELP are the cheap-but-broadly-useful teaching layers; DEMO is the user-facing refinement gate.

### Tutorial Substrate (TUT)

The reusable engine/session/UI primitives. Design constraint: parity across custom UI and AutoUI through `useBoardInteraction` is mandatory — no primitive may work in only one UI path.

- [x] **TUT-01**: A game author can attach an annotation overlay (text bubble + a targeted highlight on a board cell, piece, panel, or action control) to a tutorial step, and it renders identically in a custom UI and AutoUI via `useBoardInteraction`.
- [x] **TUT-02**: A game author can gate a tutorial step to a restricted set of legal actions, reusing the engine's existing action validation; out-of-step actions are blocked and surface a reason (building on the v2.8 disabled-reason mechanism).
- [x] **TUT-03**: A game author can define triggers that fire tutorial content when a game-state predicate or engine event matches (e.g. before the player's first turn, after N turns, the first time a capture becomes forced).
- [x] **TUT-04**: A game author can author a tutorial as a CI-verifiable artifact using the `testing` DSL, so a game-rule change that breaks the tutorial fails a test rather than rotting silently.
- [x] **TUT-05**: A player can start, advance, skip a step, and exit a tutorial; tutorial progress serializes with the game state so it is checkpoint/replay safe.

### AI-Assisted Teaching (AI)

Leverages a game's existing MCTS bot. Authoring cost is near-zero and the value persists beyond the first play. (Checkers is perfect-information, so move suggestions do not leak hidden state.)

- [x] **AI-01**: A player can request a move hint at any decision point; the existing MCTS suggests a legal move and the suggested target is highlighted via the annotation overlay (TUT-01).
- [x] **AI-02**: A player can watch an AI-vs-AI narrated demo in which each move is announced before it executes.
- [x] **AI-03**: A player can toggle an evaluation heatmap that visualizes the AI's per-move evaluation across the board.

### Lightweight Help (HELP)

- [x] **HELP-01**: A game author can attach help text to each action; a player can reveal it on hover (pointer) or tap (touch).
- [ ] **HELP-02**: A player can toggle action help text on or off globally.

### Checkers Tutorial (CHK)

The showcase that proves the substrate end-to-end. Targets checkers' real teaching-difficulty points (mandatory capture, multi-jump) identified in this session's profiling.

- [ ] **CHK-01**: A new player can complete a guided checkers tutorial that teaches the two-step piece selection → destination move, using action gating (TUT-02) and annotation overlays (TUT-01).
- [ ] **CHK-02**: The checkers tutorial teaches the mandatory-capture rule via a predicate-triggered tip (TUT-03) shown the first time a capture becomes forced.
- [ ] **CHK-03**: The checkers tutorial walks the player through a forced multi-jump, teaching continuation (turn does not end while further jumps exist).
- [ ] **CHK-04**: The checkers tutorial is launchable from the game and runs inside GameShell and the `boardsmith dev` host.

### Demonstration & Refinement (DEMO)

- [ ] **DEMO-01**: The checkers tutorial and all teaching features (TUT/AI/HELP) are demonstrated end-to-end in the browser for hands-on review, so the primitives can be refined before a future milestone applies them to cribbage.

## v2 Requirements

Deferred to a future milestone (not in this roadmap).

### Cribbage Application (CRIB)

- **CRIB-01**: Apply the tutorial substrate to cribbage, teaching the rules-dense scoring (fifteens, runs, his nobs) and the 5-phase structure.
- **CRIB-02**: Validate that the substrate handles cribbage's post-hoc scoring-reveal teaching shape without substrate changes (the explicit phase-2 stress test).

### Goal/Puzzle Tutorials (GOAL)

- **GOAL-01**: A game author can define an objective-based tutorial step ("connect these edges", "capture a piece") with escalating hints, completed by a state predicate rather than scripted moves.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cribbage tutorial content | Deliberate next milestone — building it now risks letting cribbage's outlier scoring-reveal shape drive the substrate design |
| Polyhedral-potions tutorial | Its AI is an empty `objectives: () => ({})` placeholder; would silently amputate the AI-teaching features (AI-01..03) |
| Hex tutorial content | Rules are near-zero; useful only for the AI-narration/heatmap path, which checkers already exercises |
| Rule-book / video tutorials | Explicitly ruled out by the user — this milestone is the dynamic, engine-integrated path |
| LLM-generated tutorial narration | "AI" here means the built-in MCTS, not an LLM; no new external dependency |
| Universal tutorial authoring DSL designed up front | Build the four primitives against checkers first; let the second game (cribbage) reveal the real abstraction — avoids over-engineering |
| Backward compatibility / fallbacks | Project-wide rule: clean break, no deprecation cycles |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TUT-01 | Phase 105 | Complete |
| TUT-02 | Phase 104 | Complete |
| TUT-03 | Phase 106 | Complete |
| TUT-04 | Phase 106 | Complete |
| TUT-05 | Phase 104 | Complete |
| AI-01 | Phase 107 | Complete |
| AI-02 | Phase 107 | Complete |
| AI-03 | Phase 107 | Complete |
| HELP-01 | Phase 108 | Complete |
| HELP-02 | Phase 108 | Pending |
| CHK-01 | Phase 109 | Pending |
| CHK-02 | Phase 109 | Pending |
| CHK-03 | Phase 109 | Pending |
| CHK-04 | Phase 109 | Pending |
| DEMO-01 | Phase 110 | Pending |

**Coverage:**
- v1 requirements: 15 total
- Mapped to phases: 15 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-06-25*
*Last updated: 2026-06-25 — roadmap created, all 15 v1 requirements mapped to Phases 104–110*
