# Phase 104: Tutorial Lifecycle & Action Gating - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the foundational tutorial substrate in the engine + session: a tutorial can be **started, advanced, skipped, and exited** (lifecycle), its **progress serializes with game state** (checkpoint/replay/undo-safe), and a tutorial step can **gate the legal action set** for the learner's seat — out-of-step actions are blocked and **surface a reason**, reusing the v2.8 disabled-selection mechanism with **no parallel validation path**.

Delivers requirements **TUT-02** (action gating) and **TUT-05** (lifecycle + serialization). This is the load-bearing layer for Phases 105–110; annotation content (105), predicate auto-advance (106), and checkers content (109) plug into the slots defined here.

**In scope:** tutorial definition type on `GameDefinition`, per-seat tutorial progress in game state, `TutorialController` (session) for lifecycle, action/target gating via the existing disabled-with-reason path.
**Out of scope (later phases):** annotation overlay rendering (105), predicate triggers / auto-advance (106), AI teaching (107), tooltips (108), checkers tutorial content (109), browser demo (110).
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Action-gating model
- **Disabled-with-reason, not silent filter.** Gated actions and gated choices/targets remain visible but are reported disabled with a mandatory reason string, reusing the v2.8 `AnnotatedChoice<T>`/`disabled?: string` wire semantics at BOTH the action level and the choice/element level. Out-of-step actions must surface a reason, never silently vanish (success criterion #3).
- **Gate is declared on the tutorial step, declaratively.** Game authors do NOT modify their action definitions or conditions. Tutorials are orthogonal to game rules — adding a tutorial never touches the rules layer. The gate is applied centrally by the substrate.
- **Both action-level and target-level granularity.** A step can restrict to a specific action AND to specific element/choice values (e.g. "only `move`, only piece c3 → square d4"). Required by CHK-01's guided selection→destination.
- **Per-seat gating.** The gate applies only to the tutorial learner's seat. Opponent/AI seats are unaffected by gating; scripting the opponent is a separate content concern handled in Phase 109.
- **Reuse, don't duplicate.** Enforcement routes through the existing `disabled` selection path + available-actions computation (`getAvailableActions` / `availableActionsForSeat`). No new or parallel validation pipeline (success criterion #4).

### Area 2 — Progress storage & lifecycle (TUT-05)
- **Progress lives in game state, serialized via `toJSON()`.** Tutorial progress is a serialized game attribute so it round-trips automatically through `GameStateSnapshot` and per-action `ActionCheckpoint` — making it checkpoint/replay-safe and undo-synced for free. No session-layer `StoredGameState` mutation, no separate persistence path. (Scout's Option A.)
- **Per-seat keyed progress** (`Record<seat, TutorialProgress>`), consistent with how `availableActions`/`disabled` are already per-seat. Typically one active learner, but the shape is multiplayer-correct.
- **Explicit lifecycle now; auto-advance hook reserved.** Phase 104 ships explicit `start / advance / skip / exit`. A reserved `advanceWhen` slot on the step lets Phase 106 wire predicate-driven auto-advance without changing the type.
- **`TutorialController` in the session layer** owns the lifecycle (start/advance/skip/exit + broadcast), analogous to `PendingActionManager`; the durable progress state stays in the game (engine). Clean engine/session split — engine holds state, session orchestrates.

### Area 3 — Author-facing definition API (pit of success)
- **Optional `tutorial` field on `GameDefinition`**, mirroring the existing `ai` / `presets` fields — declarative and discoverable.
- **Step shape defined once with reserved slots:** `{ id, gate, content?, advanceWhen? }`. `content` is filled by Phase 105 (annotation), `advanceWhen` by Phase 106 (predicate). Defining the full shape now avoids type churn across phases.
- **Gate accepts a static allow-list OR a predicate.** The allow-list (`{ action, from, to }`-style) is the pit-of-success path for simple on-rails steps; a predicate escape hatch covers complex gates.
- **Gating is active only while a tutorial is running for that seat.** Zero behavior or overhead change in normal (non-tutorial) play. Not a general always-on scripted-constraint primitive (deferred to avoid scope creep).

### Claude's Discretion
- Exact type names, file placement within `src/engine/` vs `src/session/`, and the precise `TutorialProgress`/`TutorialStep`/`TutorialDefinition` field names are at implementation discretion, consistent with codebase conventions.
- How the lifecycle is surfaced to the client (session op vs message type) follows existing session-command patterns.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from integration scout)
- **v2.8 disabled mechanism** — `src/engine/action/types.ts:15-23` (`AnnotatedChoice<T>` with `disabled: string | false`); `src/engine/action/action.ts:320-441` (`getChoices()`), `:642-824` (`validateSelection()` checks disabled first at :678-680), `:1121-1245` (`hasValidSelectionPath()` filters `disabled === false`). Wire: `src/types/protocol.ts:468-487` (`ChoiceWithRefs`/`ValidElement` `disabled?: string`). Session: `src/session/pick-handler.ts:210-244`, `:336-389`.
- **Available-actions computation** — `src/engine/element/game.ts:837-845` (`getAvailableActions`), `src/engine/action/action.ts:947-960` (`isActionAvailable`), `src/engine/flow/seat-activity.ts:69-100` (`availableActionsForSeat`).
- **Serialization/checkpoint** — `src/engine/utils/snapshot.ts:10-67` (`GameStateSnapshot`), `:78-90` (`ActionCheckpoint`), `:130-149` (`createSnapshot`). `src/runtime/runner.ts:62-170` (`GameRunner`, `captureCheckpoint` at :104-105). Game attributes ride in `game.toJSON()`.
- **Session layer** — `src/session/game-session.ts:168-251` (`GameSession`), `src/session/utils.ts:342-448` (`buildPlayerState`; `availableActions` at :360, `actionMetadata` at :422), `src/session/types.ts:360-386` (`PlayerGameState`), `:64-78` (`GameDefinition`).
- **Precedent for non-rules state that serializes** — v3.0 recorded animation events on the command stack; tutorial progress instead rides as a game attribute (simpler, undo-synced).

### Established Patterns
- Per-seat state is the norm (availableActions, disabled reasons are computed per seat).
- Managers live alongside `GameSession` (`#lobbyManager`, `#pickHandler`, `PendingActionManager`) — `TutorialController` fits this pattern.
- `GameDefinition` already carries optional capability fields (`ai`, `presets`, `gameOptions`) — `tutorial` is a natural peer.

### Integration Points
- Gate filter: extend the `disabled` evaluation + `getAvailableActions`/`availableActionsForSeat` to consult the active tutorial step for the seat.
- Progress: add a serialized attribute to the Game base (or a mixin) so `toJSON()`/snapshot carry it.
- Lifecycle: `TutorialController` in `src/session/`, wired into `GameSession` action-completion flow and broadcast.
- Definition: extend `GameDefinition` (`src/session/types.ts`) with optional `tutorial`, threaded through `GameSession.create()` → game constructor/options.
</code_context>

<specifics>
## Specific Ideas

- Success criterion #4 ("no parallel or duplicate validation path") is the hard architectural constraint — gating MUST reuse the disabled-selection evaluation and the existing available-actions path, not a new validator.
- Tutorials orthogonal to rules: an author must be able to add a tutorial to checkers (Phase 109) without editing any existing checkers action/flow/rules file.
- Undo-sync is a desired feature: undoing a move should rewind the tutorial step in lockstep (falls out naturally from storing progress in game state).
</specifics>

<deferred>
## Deferred Ideas

- Annotation/overlay rendering of step content → Phase 105 (the `content` slot is reserved here).
- Predicate-driven auto-advance → Phase 106 (the `advanceWhen` slot is reserved here).
- General always-on "scripted constraint" primitive (gating outside an active tutorial) → out of scope; revisit only if a real use case appears.
</deferred>
