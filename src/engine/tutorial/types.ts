/**
 * Tutorial system types.
 *
 * These are the load-bearing contracts for Phases 104–110. Downstream plans
 * implement against these types; fields marked RESERVED are typed `unknown`
 * now and populated by later phases so the type does not churn mid-milestone.
 *
 * Placement rationale:
 *   - `TutorialGate` / `TutorialStep` / `TutorialDefinition` live here (engine)
 *     because gate evaluation runs in `getChoices()` / `getAvailableActions()`,
 *     which have access only to the engine layer.
 *   - `TutorialProgress` (serialized durable state) lives here so it can be used
 *     as the `Map` value type in `Game.tutorialProgress`.
 *   - `TutorialStepView` (projected read-only client shape) is the named contract
 *     for `PlayerGameState.tutorial` so that the producer (Plan 104-04) and all
 *     consumers (Plan 104-03 `suppressAutoFill`, UI) bind to one definition.
 */

import type { Game } from '../element/game.js';

// ============================================
// Gate types
// ============================================

/**
 * Context passed to a predicate-style TutorialGate.
 *
 * Intentionally narrow: the predicate is evaluated inside the engine's
 * `getChoices()` / `isActionAvailable()` hot path and must NOT mutate state.
 */
export interface TutorialGateContext {
  /** The current game instance. Read-only; do NOT mutate. */
  game: Game;
  /** The seat number of the tutorial learner (1-indexed). */
  seat: number;
}

/**
 * Declarative static allow-list gate.
 *
 * The pit-of-success path for simple on-rails tutorial steps:
 *   - `action` – the only action name allowed on this step.
 *   - `from`   – (RESERVED, Phase 109) restrict the "from" element/choice.
 *   - `to`     – (RESERVED, Phase 109) restrict the "to" element/choice.
 *
 * When an element-targeted step must leave multiple elements enabled for a
 * teaching beat, use the predicate form (`TutorialGatePredicate`) instead.
 */
export interface TutorialGateAllowList {
  /** The single action name the learner must perform on this step. */
  action: string;
  /**
   * RESERVED (Phase 109): restrict the source element / choice value.
   * Type is `unknown` to avoid type churn; Phase 109 will narrow it.
   */
  from?: unknown;
  /**
   * RESERVED (Phase 109): restrict the destination element / choice value.
   * Type is `unknown` to avoid type churn; Phase 109 will narrow it.
   */
  to?: unknown;
}

/**
 * Predicate gate: full escape hatch for complex multi-condition gates.
 *
 * Return `true` to permit the current action/choice, `false` to block it.
 * The predicate MUST NOT mutate game state.
 */
export type TutorialGatePredicate = (ctx: TutorialGateContext) => boolean;

/**
 * A tutorial gate restricts which actions / choices the learner may perform
 * on a given step. Either a declarative allow-list (pit-of-success) or a
 * predicate escape hatch.
 */
export type TutorialGate = TutorialGateAllowList | TutorialGatePredicate;

// ============================================
// Step types
// ============================================

/**
 * A single step in a tutorial sequence.
 *
 * Game authors declare steps in their `TutorialDefinition.steps` array. Each
 * step carries a `gate` that restricts the learner's action space for that
 * step. Content (annotation overlay) and predicate auto-advance are reserved
 * for later phases.
 *
 * @example
 * ```typescript
 * {
 *   id: 'move-piece-c3',
 *   gate: { action: 'move', from: 'c3', to: 'd4' },
 * }
 * ```
 */
export interface TutorialStep {
  /**
   * Unique step identifier within this tutorial. Used as the key in
   * `TutorialProgress.stepId` and surfaced to the client in
   * `TutorialStepView.stepId`.
   */
  id: string;

  /**
   * Gate restricting the learner's legal action set on this step.
   * Either an allow-list shape or a predicate function.
   */
  gate: TutorialGate;

  /**
   * RESERVED (Phase 105): Annotation overlay content shown during this step.
   * Typed `unknown` to avoid type churn across phases; Phase 105 will narrow.
   */
  content?: unknown;

  /**
   * RESERVED (Phase 106): Predicate or event that automatically advances the
   * tutorial to the next step when satisfied. Typed `unknown` to avoid type
   * churn; Phase 106 will narrow.
   */
  advanceWhen?: unknown;

  /**
   * When `true`, the substrate suppresses the engine's single-enabled-choice
   * auto-fill for selections on this step.
   *
   * Use when the teaching goal is for the learner to explicitly click a
   * piece/choice — if auto-fill resolves it before the learner interacts,
   * the teaching beat is skipped.
   *
   * Phase 103 research (auto-fill deep-dive): `useActionController`
   * `tryAutoFillSelection` fills exactly-one-enabled choices automatically;
   * this flag is the substrate's suppression signal wired by Plan 104-03.
   */
  suppressAutoFill?: boolean;
}

// ============================================
// Definition type
// ============================================

/**
 * A tutorial definition attached to a `GameDefinition`.
 *
 * Thread-safe static config: defined once at startup, never serialized. The
 * engine holds it on the `Game` instance as `tutorialDefinition` (in
 * `unserializableAttributes`) so gate evaluation can reach it in
 * `getChoices()` / `isActionAvailable()` without a session-layer round-trip.
 *
 * @example
 * ```typescript
 * const definition: GameDefinition = {
 *   gameClass: CheckersGame,
 *   gameType: 'checkers',
 *   minPlayers: 2,
 *   maxPlayers: 2,
 *   tutorial: {
 *     steps: [
 *       { id: 'intro', gate: { action: 'move', from: 'c3', to: 'd4' } },
 *       { id: 'capture', gate: { action: 'move', from: 'd4', to: 'f6' } },
 *     ],
 *   },
 * };
 * ```
 */
export interface TutorialDefinition {
  /** Ordered list of tutorial steps. */
  steps: TutorialStep[];
}

// ============================================
// Progress types (serialized, durable)
// ============================================

/**
 * Per-seat tutorial progress stored in the serialized game state.
 *
 * This type is intentionally JSON-plain (no functions, no element refs) so it
 * round-trips through `toJSON()` → `loadSerializedState()` without any
 * special handling.
 *
 * Stored in `Game.tutorialProgress: Map<number, TutorialProgress>` (seat →
 * progress). The Map encoding preserves numeric seat keys (via `__map`
 * tagging in `serializeValue`) unlike a plain `Record<number, …>`.
 */
export interface TutorialProgress {
  /**
   * ID of the currently active step. `null` means the tutorial has been
   * started but no step has been set yet (unusual edge case; prefer a
   * concrete first step on `start`).
   */
  stepId: string | null;

  /**
   * Lifecycle status of the tutorial for this seat.
   *   - `'running'`   – tutorial active, gate enforcement applies.
   *   - `'completed'` – learner finished all steps; gate is lifted.
   *   - `'exited'`    – learner explicitly skipped/exited; gate is lifted.
   */
  status: 'running' | 'completed' | 'exited';
}

// ============================================
// Client projection type (read-only, NOT durable)
// ============================================

/**
 * The tutorial field projected into `PlayerGameState` for the client.
 *
 * This is the single named contract that:
 *   - Plan 104-04 (`buildPlayerState`) writes into
 *   - Plan 104-03 (`useActionController`) reads `suppressAutoFill` from
 *   - Phase 105 reads `content` from when rendering annotation overlays
 *
 * Pinned as a distinct export so parallel plans cannot drift from each other.
 * It is NOT the same as `TutorialProgress` (which is durable engine state);
 * this is a snapshot of the currently-active step's authored properties plus
 * the resolved step id.
 */
export interface TutorialStepView {
  /** ID of the currently active tutorial step. */
  stepId: string;

  /**
   * RESERVED (Phase 105): Annotation overlay content for this step.
   * Carried from `TutorialStep.content`; `undefined` until Phase 105 fills it.
   */
  content?: unknown;

  /**
   * Whether the substrate should suppress single-enabled-choice auto-fill for
   * selections on this step. Carried from `TutorialStep.suppressAutoFill`.
   * Phase 104-03 wires this into `tryAutoFillSelection`.
   */
  suppressAutoFill?: boolean;
}
