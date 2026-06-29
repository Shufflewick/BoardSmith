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
// Annotation content model (Phase 105)
// ============================================

/**
 * Engine-local element reference for annotation targeting.
 *
 * Structurally identical to `useBoardInteraction.ElementRef` from the UI layer
 * (kept in sync by convention — both carry `{id?, name?, notation?}`). The
 * engine must not import upward from the UI layer; this re-declaration preserves
 * the correct dependency direction (engine → never → ui).
 *
 * Match precedence (parity contract, mirrors `matchesRef` in useBoardInteraction):
 *   id wins, else notation, else name.
 *
 * At least one field must be set to form a meaningful ref.
 */
export interface ElementRef {
  /** Engine-assigned numeric element id. Takes precedence over notation + name. */
  id?: number;
  /** Logical element name (e.g. 'queen'). Matched after id, before notation. */
  name?: string;
  /** Board notation (e.g. 'd4'). Matched after id; beats name when both present. */
  notation?: string;
}

/**
 * Discriminated union describing what a tutorial annotation points at.
 *
 * Pit-of-Success: the `kind` discriminant makes invalid shapes unrepresentable
 * (T-105-01). Three variants:
 *   - `'element'` – a board element identified by `ElementRef` (id/notation/name).
 *   - `'action'`  – an action control (button) identified by action name.
 *   - `'panel'`   – the action panel as a whole.
 */
export type AnnotationTarget =
  | { kind: 'element'; ref: ElementRef }
  | { kind: 'action'; actionName: string }
  | { kind: 'panel' };

/**
 * Placement hint for an annotation bubble.
 *
 * `'auto'` (default): anchor near the target element when one is present;
 * fall back to a board-level top/bottom position when no target is set.
 */
export type AnnotationPlacement = 'auto' | 'top' | 'bottom' | 'center';

/**
 * A single annotation attached to a tutorial step.
 *
 * An annotation always carries explanatory `text` (required — a ring-only
 * highlight still provides describing prose per UI-SPEC §4). `target` and
 * `placement` are optional:
 *   - Without `target`: renders as a floating text bubble (no highlight ring).
 *   - Without `placement`: defaults to `'auto'` positioning.
 *
 * A step may carry multiple annotations — one annotation per target, plus an
 * optional untargeted prose bubble — so `TutorialStep.content` is an array.
 */
export interface Annotation {
  /** Explanatory text shown in the annotation bubble. Required. */
  text: string;
  /** What to highlight. Omit for a floating bubble with no highlight ring. */
  target?: AnnotationTarget;
  /** Bubble placement hint. Defaults to `'auto'`. */
  placement?: AnnotationPlacement;
}

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
 * Matches a single selection value against authored criteria.
 *
 * For element selections (type: 'element' | 'elements'): use ElementRef-style
 * fields — id takes precedence, then notation, then name. Match is field
 * equality: `{ id: 5 }` matches any element where `el.id === 5`.
 *
 * For choice selections (type: 'choice'): field equality on the choice object —
 * `{ toNotation: 'd4' }` matches any choice where `choice.toNotation === 'd4'`.
 *
 * Supply only the fields you care about; unspecified fields are ignored.
 *
 * **NOTE:** `SelectionMatcher` only matches object values (element refs, choice
 * objects). For `choice` selections with primitive string/number values, use
 * a `TutorialGateCondition` predicate instead — `SelectionMatcher` returns false
 * for every primitive value, silently blocking ALL choices rather than the
 * targeted one.
 */
export type SelectionMatcher = Record<string, unknown>;

/**
 * Declarative static allow-list gate.
 *
 * The pit-of-success path for simple on-rails tutorial steps:
 *   - `action`     – the only action name allowed on this step.
 *   - `selections` – optional per-selection value restrictions.
 *
 * When an element-targeted step must leave multiple elements enabled for a
 * teaching beat, use the labeled predicate form (`TutorialGateCondition`) instead.
 */
export interface TutorialGateAllowList {
  /** The single action name the learner must perform on this step. */
  action: string;
  /**
   * Optional per-selection value restrictions.
   *
   * Keys are selection names (matching `selection.name` in the action
   * definition). Values are `SelectionMatcher` objects: each field in the
   * matcher must equal the corresponding field on the value for a match.
   *
   * When absent (or a selection name has no entry), all values for that
   * selection are permitted.
   *
   * @example
   * // Gate the 'piece' selection to element id 42, destination to square e5:
   * { action: 'move', selections: { piece: { id: 42 }, destination: { toNotation: 'e5' } } }
   */
  selections?: Record<string, SelectionMatcher>;
}

/**
 * Labeled predicate gate: each key is a human-readable label describing the
 * condition, and each value is a predicate that returns `true` when permitted.
 *
 * All predicates must return `true` for the gate to pass. The failing label is
 * surfaced in disabled-reason strings (MR-02), mirroring action `ObjectCondition`.
 *
 * The predicate MUST NOT mutate game state.
 *
 * @example
 * ```typescript
 * { 'must be player turn': (ctx) => ctx.game.currentSeat === ctx.seat }
 * ```
 */
export type TutorialGateCondition = Record<string, (ctx: TutorialGateContext) => boolean>;

/**
 * A tutorial gate restricts which actions / choices the learner may perform
 * on a given step. Either a declarative allow-list (pit-of-success) or a
 * labeled predicate condition (escape hatch).
 */
export type TutorialGate = TutorialGateAllowList | TutorialGateCondition;

/**
 * Labeled predicate record for `advanceWhen` on a tutorial step.
 *
 * Shares the same shape as `TutorialGateCondition` and is evaluated by the
 * same `evaluateConditionWithTrace` — one evaluator for all tutorial predicates.
 */
export type TutorialAdvanceCondition = Record<string, (ctx: TutorialGateContext) => boolean>;

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
   * Annotation overlay content shown during this step (Phase 105).
   *
   * An array of annotations, each describing a text bubble and an optional
   * element/action/panel highlight. An array lets a single step combine a
   * targeted highlight ring with an independent floating prose bubble.
   *
   * When absent the step shows no annotation overlay.
   */
  content?: Annotation[];

  /**
   * Labeled predicate record that automatically advances the tutorial to the
   * next step when all predicates return `true`.
   *
   * Keys are human-readable labels (surfaced in debug traces when a predicate
   * fails to fire). Values are predicates that MUST NOT mutate game state.
   *
   * Mirrors action `ObjectCondition` and shares the same `evaluateConditionWithTrace`
   * evaluator, giving consistent debug traces across gates and advance triggers.
   *
   * @example
   * ```typescript
   * { 'first capture forced': (ctx) => getForcedCaptures(ctx.game, ctx.seat).length > 0 }
   * ```
   */
  advanceWhen?: TutorialAdvanceCondition;

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

  /**
   * When set, scopes `suppressAutoFill` to a single named selection.
   *
   * If `suppressAutoFill` is `true` and this field is set to a selection name,
   * only that selection's auto-fill is suppressed. Other selections in the same
   * action still auto-fill normally.
   *
   * If `suppressAutoFill` is `true` and this field is absent, ALL selections
   * in the step are suppressed (step-wide).
   *
   * Example: a two-step move (select piece → select destination) where only
   * the piece selection is taught. Set `suppressAutoFillFor: 'piece'` so the
   * destination still auto-fills to the single valid square.
   */
  suppressAutoFillFor?: string;
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
   * Annotation overlay content for this step (Phase 105).
   *
   * Carried verbatim from `TutorialStep.content` by `getActiveTutorialStepView`.
   * Each entry describes a text bubble and an optional targeted highlight.
   * Absent when the step carries no annotations.
   */
  content?: Annotation[];

  /**
   * Whether the substrate should suppress single-enabled-choice auto-fill for
   * selections on this step. Carried from `TutorialStep.suppressAutoFill`.
   * Phase 104-03 wires this into `tryAutoFillSelection`.
   */
  suppressAutoFill?: boolean;

  /**
   * When set, scopes `suppressAutoFill` to the named selection only.
   * Carried from `TutorialStep.suppressAutoFillFor`.
   * Other selections in the same action still auto-fill normally.
   */
  suppressAutoFillFor?: string;
}
