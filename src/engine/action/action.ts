import { rulesErrorSentence } from './rules-error.js';
import type { GameElement } from '../element/game-element.js';
import { isElement } from '../element/game-element.js';
import type { Player } from '../player/player.js';
import type { Game } from '../element/game.js';
import type {
  ActionDefinition,
  ActionContext,
  ActionResult,
  Selection,
  ChoiceSelection,
  ElementSelection,
  ElementsSelection,
  TextSelection,
  NumberSelection,
  ValidationResult,
  ActionTrace,
  PickTrace,
  RepeatConfig,
  PendingActionState,
  ConditionConfig,
  ConditionDetail,
  AnnotatedChoice,
  LabelledChoice,
  DisabledRule,
  UnavailableRule,
  OnSelectContext,
} from './types.js';
import { wrapFilterWithHelpfulErrors } from './helpers.js';
import { isDevMode, devWarn, isDevThrowEnabled } from '../../utils/dev.js';
import { Action } from './action-builder.js';
import { PlayerFacingError, NotSimulableError } from '../errors.js';
import { getActiveStep, getGateReasonForValue } from '../tutorial/gate.js';
import { findMatchingChoice, trySmartResolveChoice, valuesEqual } from './choice-matching.js';
import { numberRuleErrors } from './number-rules.js';
import { textRuleErrors } from './text-rules.js';
import { resolveMultiSelect, resolveOrderedList } from '../utils/resolve-multiselect.js';

// Re-export Action class from action-builder
export { Action };

/**
 * What a player reads when the value they submitted is no longer among a
 * selection's choices and the game wrote no `unavailable` sentence (#393).
 */
const NO_LONGER_AVAILABLE =
  'That choice is no longer available. Things changed while you were choosing, so please choose again.';

/**
 * Turn a throw out of an action's `execute()` into a failure result.
 *
 * Two things happen here that did not before:
 *
 * - The full error, stack and all, is logged where the game runs and NOT put
 *   on the wire (#47). A raw `TypeError: Cannot read properties of undefined
 *   (reading 'suit')` reaching a player leaks implementation detail and tells
 *   them nothing they can act on.
 * - The result is marked `partiallyApplied`, so the runner knows the action may have
 *   applied part of its changes before it stopped and rolls the game back
 *   (#44). A clean refusal carries no such mark, because it mutated nothing.
 */
function failedExecute(actionName: string, error: unknown): ActionResult {
  // #31: a game saying "I cannot resolve this from the information state I
  // have" is an expected answer inside a bot's redacted sandbox, not a crash.
  // Logging it printed a stack per rollout — measured at 198 MB in 15 seconds
  // on one game — for a search that was working as designed.
  if (error instanceof NotSimulableError) {
    return { success: false, error: error.message, partiallyApplied: true, notSimulable: true };
  }
  console.error(`[BoardSmith] Action '${actionName}' execution failed:`, error);
  // WHERE THE SENTENCE WENT, said once and only where it is news (#191).
  //
  // A throw out of `execute` is one of two things and the log cannot tell them
  // apart, so it names the fork rather than guessing: an accidental `TypeError`
  // is a bug and its text must not reach a player, while "the hearth holds 3
  // logs and you offered 14" is a refusal the player can only discover by
  // trying, and a generic sentence is least useful for exactly that class.
  //
  // Not printed for a `PlayerFacingError`, which already did the right thing.
  if (!(error instanceof PlayerFacingError)) {
    console.error(
      `[BoardSmith] The player is told a generic sentence instead of the one above. ` +
        `If that throw was a REFUSAL you wrote for them to read, throw a PlayerFacingError ` +
        `(or a subclass) -- its message travels verbatim. Anything else is replaced, so an ` +
        `accidental error cannot leak implementation detail to a player.`,
    );
  }
  // An engine policy refusal was written to be read — its message IS the
  // actionable next step. Anything else is an arbitrary runtime error, and
  // goes no further than this log.
  const generic = `${rulesErrorSentence(actionName)} Nothing was changed.`;
  // A PlayerFacingError's text was written to be read, so it always travels.
  // Anything else travels only in a positively-labelled dev/test environment,
  // where the reader is the author who needs it and there is no player to leak
  // to. In production it goes no further than the log above.
  const message = error instanceof PlayerFacingError
    ? error.message
    : isDevThrowEnabled()
      ? `${generic} (${error instanceof Error ? error.message : String(error)})`
      : generic;
  return { success: false, error: message, partiallyApplied: true };
}

/**
 * Take what an action's `execute()` returned and make it mean what it says.
 *
 * `ActionResult` has two adjacent, equally plausible string fields, and only
 * one of them decides anything: `error` is the refusal, read by
 * `FlowEngine.resume` and by `GameRunner.performAction`, and `message` is a log
 * line. An action that refused with `message` therefore reported a SUCCESS that
 * happened to carry a sentence -- the flow advanced, the turn was consumed, and
 * the thing the rules refused to do was not done. Silently, and only in
 * production-shaped states (#90).
 *
 * So a `{ success: false }` with nothing readable in `error` is refused HERE,
 * at the one boundary the author's return value crosses into the engine. The
 * action still fails, which is what its author meant; what changes is that the
 * failure now carries the field everything downstream reads, and the author is
 * told at the log which field they wanted.
 *
 * An EMPTY `error` counts as none: `if (flowState.actionError)` is the test
 * downstream, and `''` fails it exactly as `undefined` does.
 *
 * Not `partiallyApplied`. The author believed they were refusing cleanly, and a clean
 * refusal mutated nothing, so there is nothing for the runner to roll back.
 */
function acceptExecuteResult(actionName: string, result: ActionResult): ActionResult {
  if (result.success) return result;
  if (typeof result.error === 'string' && result.error.trim() !== '') return result;

  console.error(
    `[BoardSmith] Action '${actionName}' returned { success: false } with no 'error'. ` +
      "A refusal is reported by returning { success: false, error: 'why' } -- 'message' is a " +
      'log line and does not stop the action. ' +
      (typeof result.message === 'string' && result.message.trim() !== ''
        ? `The sentence it did carry was: ${result.message}`
        : 'It carried no sentence at all.'),
  );

  // The player is told the truth -- the rules said no -- without being handed
  // the author's mistake to read. In dev the author IS the reader, so the fix
  // travels with it. Same split as `failedExecute` above (#47).
  const refusal = `The "${actionName}" action was refused by the game's rules, and they did not say why.`;
  return {
    success: false,
    error: isDevThrowEnabled()
      ? `${refusal} (Return { success: false, error: 'why' } -- 'message' is only a log line.)`
      : refusal,
  };
}

/**
 * A labeled predicate threw./**
 * A labeled predicate threw. Distinct from "the predicate returned false",
 * which is a normal game state — this is a bug in the predicate itself.
 */
export class ConditionEvaluationError extends Error {
  constructor(
    readonly label: string,
    readonly owner: string,
    readonly cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Condition "${label}" on ${owner} threw instead of returning true or false.\n` +
      `  ${detail}\n` +
      `  A crashing predicate is not "the condition is false" — folding the two together ` +
      `would make the action silently vanish from every player's list with no error anywhere. ` +
      `Fix the predicate, or guard the value it reads.`
    );
    this.name = 'ConditionEvaluationError';
  }
}

/**
 * Evaluate a labeled-predicate condition record, returning result and trace details.
 * All predicates are evaluated (AND semantics) and their results captured.
 *
 * A predicate that THROWS is not treated as a failed condition (#46). It is a
 * bug in game code, and reporting it as "condition false" makes the action
 * disappear from every player's list — the game may then deadlock or auto-skip
 * with nothing logged on the availability path at all. It throws
 * {@link ConditionEvaluationError} instead.
 *
 * Context-generic so it can be shared across action conditions, tutorial gates,
 * and advanceWhen predicates without duplicating the evaluation logic.
 *
 * @typeParam Ctx - The context object passed to each predicate (e.g. ActionContext, TutorialGateContext).
 * @param owner - What the condition belongs to, for the error message (e.g. `action 'draw'`).
 */
export function evaluateConditionWithTrace<Ctx>(
  condition: Record<string, (ctx: Ctx) => boolean>,
  context: Ctx,
  owner = 'this condition'
): { passed: boolean; details: ConditionDetail[] } {
  const details: ConditionDetail[] = [];
  let allPassed = true;

  for (const [label, predicate] of Object.entries(condition)) {
    let value: unknown;
    try {
      value = predicate(context);
    } catch (error) {
      // #19/#31: "I cannot answer this from the information state I have" is
      // not a crashing predicate — it is the honest answer inside a bot's
      // redacted search sandbox, where a withheld attribute has no value at
      // all. Blaming the author's predicate for it would send them looking for
      // a bug that is not there. It travels as itself, and enumeration drops
      // the action.
      if (error instanceof NotSimulableError) throw error;
      throw new ConditionEvaluationError(label, owner, error);
    }
    // The trace keeps the RAW return value, not the coerced boolean, so a
    // designer reading it sees what was actually measured (a count, a name).
    const passed = Boolean(value);
    details.push({ label, value, passed });
    if (!passed) allPassed = false;
  }

  return { passed: allPassed, details };
}

/**
 * Evaluate a condition config and return whether it passes.
 *
 * Throws {@link ConditionEvaluationError} if a predicate crashes — see
 * {@link evaluateConditionWithTrace}.
 */
export function evaluateCondition(
  condition: ConditionConfig,
  context: ActionContext,
  owner = 'this condition'
): boolean {
  return evaluateConditionWithTrace(condition, context, owner).passed;
}

/**
 * Turn a `validate` callback's return value into "no error" or an error string.
 *
 * Both validate hooks — the per-selection one and the action-level one — share
 * ONE contract: `true` passes, `false` fails generically, a string fails with
 * that message. Nothing else is legal, and the reason is the trap this function
 * exists to kill: an object like `{ valid: true }` is truthy but not `true`, so
 * a bare `result !== true` test rejects the very case the author meant to
 * allow — the passing case fails, quietly, blaming the player's choice.
 *
 * So an unrecognized return is treated as a programming error and SAID so: the
 * action is still refused (never silently allowed), and the message states the
 * real contract instead of blaming the player's input.
 *
 * @param result - Whatever the callback returned
 * @param what - Human-readable identification of the callback, for the message
 * @param genericFailure - Message to use for a bare `false`
 * @returns The error string, or `null` when the value passes
 */
function interpretValidateResult(
  result: unknown,
  what: string,
  genericFailure: string,
): string | null {
  if (result === true) return null;
  if (result === false) return genericFailure;
  if (typeof result === 'string') return result;
  return (
    `${what} returned ${describeValidateReturn(result)}, which is not a valid result. ` +
    `Return true to allow, false to reject, or a string to reject with that message ` +
    `shown to the player. (There is no { valid, message } form — a returned object ` +
    `cannot be distinguished from a mistake, so it is refused rather than guessed at.)`
  );
}

/** Compact, safe rendering of an unexpected validate return for the message. */
function describeValidateReturn(result: unknown): string {
  if (result === null) return 'null';
  if (result === undefined) return 'undefined (no return value?)';
  if (typeof result === 'object') {
    const keys = Object.keys(result as object);
    return `an object${keys.length ? ` with keys: ${keys.join(', ')}` : ''}`;
  }
  return `a ${typeof result}`;
}

/** One candidate of a selection: the value it delivers, and the label a `{ value, label }` choice brought. */
interface Candidate {
  value: unknown;
  label?: string;
}

/**
 * One `chooseFrom` choice as the candidate it offers (#509).
 *
 * A choice is a value, or the labelled shape `{ value, label? }`: a plain
 * object whose only keys are `value` and an optional string `label`. Only that
 * shape is read; any other object, such as `{ value: 'go', cost: 3 }`, is a
 * value in its own right and is offered whole. `ChoiceValue` in types.ts is the
 * same rule for the compiler, so what an author is told a callback receives is
 * what it receives.
 */
function asCandidate(choice: unknown): Candidate {
  if (!isLabelledChoice(choice)) return { value: choice };
  return choice.label === undefined ? { value: choice.value } : { value: choice.value, label: choice.label };
}

/** A plain object (not an array, element or other class instance) whose only keys are `value` and a string `label`. */
function isLabelledChoice(choice: unknown): choice is LabelledChoice<unknown> {
  if (choice === null || typeof choice !== 'object') return false;
  const proto = Object.getPrototypeOf(choice);
  if (proto !== Object.prototype && proto !== null) return false;
  const obj = choice as Record<string, unknown>;
  return 'value' in obj
    && Object.keys(obj).every((key) => key === 'value' || key === 'label')
    && (obj.label === undefined || typeof obj.label === 'string');
}

/**
 * How a choice submission's COUNT is out of bounds, or nothing when it is not.
 *
 * One function because a `multiSelect` set and an `orderedList` sequence (#249)
 * bound their count identically and differ only in what they count: distinct
 * identities for one, entries for the other. Two copies of the sentence is how
 * the player would end up reading two different ones for the same mistake.
 */
function choiceCountErrors(
  name: string,
  count: number,
  min: number,
  max: number | undefined,
): string[] {
  const errors: string[] = [];
  if (count < min) {
    errors.push(`Selection "${name}" requires at least ${min} choice${min === 1 ? '' : 's'}, got ${count}`);
  }
  if (max !== undefined && count > max) {
    errors.push(`Selection "${name}" requires at most ${max} choice${max === 1 ? '' : 's'}, got ${count}`);
  }
  return errors;
}

/**
 * Handles validation, argument resolution, and execution of player actions.
 *
 * ActionExecutor is an internal class used by the game session to process
 * incoming action requests. It resolves serialized arguments (element IDs,
 * player indices) to actual game objects before calling action handlers.
 *
 * Most game developers won't interact with ActionExecutor directly - instead
 * use the {@link Action} builder to define actions and the game session's
 * `sendAction` to execute them.
 *
 * Key responsibilities:
 * - Resolving element IDs to GameElement objects
 * - Validating selections against available choices
 * - Checking action availability (conditions and selection paths)
 * - Executing action handlers with resolved arguments
 * - Supporting repeating selections and pending action state
 */
/** How an action is being taken, when it is not an ordinary offered action. */
export interface PerformOptions {
  /**
   * The action is the acting seat's held follow-up: its condition is not
   * checked, since the chain offers it, not the condition. Only the flow
   * engine passes this, for the seat that owns the follow-up.
   */
  asFollowUp?: boolean;
}

export class ActionExecutor {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  /**
   * Create the restricted OnSelectContext for onSelect/onCancel callbacks.
   * Only exposes animate() without the callback parameter.
   * @internal
   */
  createOnSelectContext(): OnSelectContext {
    const game = this.game;
    return {
      animate(type: string, data?: Record<string, unknown>): void {
        game.animate(type, data ?? {});
      },
    };
  }

  /**
   * Resolve a single selection's raw value to its resolved form.
   * Element IDs become Element objects, choice values get smart-resolved, etc.
   * @internal
   */
  resolveSelectionValue(selection: Selection, value: unknown, player: Player): unknown {
    switch (selection.type) {
      case 'element':
      case 'elements': {
        if (typeof value === 'number') {
          return this.game.getElementById(value) ?? value;
        }
        if (this.looksLikeSerializedElement(value)) {
          return this.game.getElementById((value as { id: number }).id) ?? value;
        }
        return value;
      }
      case 'choice': {
        if (this.isSerializedElement(value)) {
          return this.game.getElementById((value as { id: number }).id) ?? value;
        }
        const candidates = this.candidatesOf(selection, { game: this.game, player, args: {} });
        return this.smartResolveChoiceValue(value, candidates);
      }
      default:
        return value;
    }
  }

  /**
   * Resolve serialized args (player indices, element IDs) to actual objects.
   * This is needed because network-serialized args use indices/IDs instead of objects.
   *
   * @param action The action definition
   * @param args The raw args from the client
   * @param player Optional player for context-dependent choice resolution
   * @param reading The game elements are looked up in and `choices` callbacks
   *   see, when it must not be the live one. One caller: a world's read of a
   *   draft (a quote, a re-asked pick), which hands over its read-only
   *   projection so the elements it resolves cannot be written through
   *   (ShufflewickPub #384, #418). Everything else passes nothing and gets the
   *   live game.
   */
  resolveArgs(
    action: ActionDefinition,
    args: Record<string, unknown>,
    player?: Player,
    reading?: Game,
  ): Record<string, unknown> {
    const game = reading ?? this.game;
    const resolved = { ...args };
    const selectionNames = new Set(action.selections.map(s => s.name));

    // First pass: resolve selection args based on their type
    for (const selection of action.selections) {
      const value = args[selection.name];
      if (value === undefined || value === null) continue;

      switch (selection.type) {
        case 'element': {
          if (Array.isArray(value)) {
            // A repeating chooseElement's picks: one element per pick, in the
            // order they were made (#325). Any other array is left as sent, for
            // validateSelection to refuse.
            if (this.isRepeatingSelection(selection)) {
              resolved[selection.name] = value.map(v => this.resolveElementItem(v, game));
            }
          } else if (typeof value === 'number') {
            // If value is a number, resolve to actual GameElement by ID
            const element = game.getElementById(value);
            if (element) {
              resolved[selection.name] = element;
            }
          } else if (this.looksLikeSerializedElement(value)) {
            // Handle serialized element objects from followUp args
            const element = game.getElementById((value as { id: number }).id);
            if (element) {
              resolved[selection.name] = element;
            }
          }
          break;
        }
        case 'elements': {
          // chooseElements() selection - value is element ID(s)
          // Resolve to actual GameElement object(s)
          if (typeof value === 'number') {
            // Single element ID
            const element = game.getElementById(value);
            if (element) {
              resolved[selection.name] = element;
            }
          } else if (Array.isArray(value)) {
            // Multi-select: array of element IDs or serialized elements.
            const elements = value.map(v => this.resolveElementItem(v, game));
            resolved[selection.name] = elements;
          }
          break;
        }
        case 'choice': {
          // If the choice value is a serialized element (object with id and className),
          // resolve it to the actual GameElement
          if (this.isSerializedElement(value)) {
            const element = game.getElementById((value as { id: number }).id);
            if (element) {
              resolved[selection.name] = element;
            }
          } else if (Array.isArray(value) && player) {
            // multiSelect chooseFrom: canonicalize each array item exactly like
            // the scalar path below, so element IDs / display strings sent by
            // custom UIs resolve to canonical choice values before validation
            // and never reach execute() as raw IDs (CR-01). Gated on multiSelect
            // being configured so a single choice whose VALUE is itself an
            // array is never corrupted by per-item resolution.
            if ((selection as ChoiceSelection).multiSelect !== undefined) {
              const candidates = this.candidatesOf(selection, { game, player, args: resolved });
              resolved[selection.name] = value.map((item) => {
                if (this.isSerializedElement(item)) {
                  const element = game.getElementById((item as { id: number }).id);
                  return element ?? item;
                }
                return this.smartResolveChoiceValue(item, candidates);
              });
            }
          } else if (player) {
            // Try smart resolution: element ID or display string → actual choice
            // This supports custom UIs sending element IDs for chooseFrom selections
            const candidates = this.candidatesOf(selection, { game, player, args: resolved });
            const resolvedValue = this.smartResolveChoiceValue(value, candidates);

            if (resolvedValue !== value) {
              resolved[selection.name] = resolvedValue;
            }
          }
          break;
        }
      }
    }

    // Second pass: resolve non-selection args that unambiguously represent element
    // references. This handles followUp args like { sectorId: { id: 145, className: 'Sector' } }.
    // Bare numbers are NEVER coerced here -- a non-selection arg was never declared
    // element-typed by the developer, so a plain number that happens to collide with a
    // live element's id must survive as a number (ENG-05: ambiguous, corruption-prone
    // auto-coercion). Only genuine {id, className}-shaped serialized-element objects
    // (isSerializedElement) are resolved.
    for (const [key, value] of Object.entries(args)) {
      if (selectionNames.has(key)) continue; // Already processed above
      if (value === undefined) continue;

      // Resolve serialized element objects (from followUp args). className is part
      // of the contract, not just a shape discriminator: if the id points at an
      // element of a different class than the caller claimed, resolving by id alone
      // would hand the handler a wrong-class element (the corruption class ENG-05
      // removed, one step removed). On mismatch, leave the arg unresolved so it
      // fails loudly downstream -- mirroring relinkFlowVariables (flow/engine.ts).
      if (this.isSerializedElement(value)) {
        const serialized = value as { id: number; className: string };
        const element = game.getElementById(serialized.id);
        if (element && element.constructor.name === serialized.className) {
          resolved[key] = element;
        } else if (element) {
          devWarn(
            `followup-arg-class-mismatch:${key}`,
            `followUp arg '${key}' claims className '${serialized.className}' but element ` +
            `${serialized.id} is a ${element.constructor.name}; leaving the arg unresolved.`
          );
        }
      }
    }

    return resolved;
  }

  /**
   * One entry of an element array (a chooseElements pick, or one pick of a
   * repeating chooseElement) resolved to its element. An id that resolves to
   * nothing is KEPT as its id, not dropped, so validateSelection can refuse the
   * submission with an actionable error instead of letting it vanish.
   */
  private resolveElementItem(item: unknown, game: Game): unknown {
    if (typeof item === 'number') return game.getElementById(item) ?? item;
    if (this.looksLikeSerializedElement(item)) {
      const id = (item as { id: number }).id;
      return game.getElementById(id) ?? id;
    }
    return item;
  }

  /**
   * Check if a value looks like a serialized element (has numeric id property).
   * This is a looser check than isSerializedElement - used for followUp args
   * which may not have className but still represent elements.
   */
  private looksLikeSerializedElement(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.id === 'number';
  }

  /**
   * Check if a value is a serialized game element (has id and className properties)
   */
  private isSerializedElement(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.id === 'number' && typeof obj.className === 'string';
  }

  /**
   * Get available choices for a selection given current args.
   * Returns AnnotatedChoice[] with each item annotated with disabled status.
   *
   * @param actionName - When provided, tutorial gate evaluation is applied:
   *   choices not permitted by the active tutorial step for the player's seat
   *   are annotated with a gate reason. Pass `undefined` for internal calls
   *   that should not trigger tutorial gating (e.g. debug traces). A caller
   *   that only maps a value onto a choice wants `candidatesOf`, which judges
   *   nothing (#364).
   */
  getChoices(
    selection: Selection,
    player: Player,
    args: Record<string, unknown>,
    actionName?: string,
    /**
     * The game the CANDIDATE CALLBACKS see, when it must not be the live one.
     *
     * One caller: a world's offer, which runs these callbacks to describe what
     * a seat may do and hands over a read-only projection because an offer sits
     * on a path with no rollback and no checkpoint -- a `choices` or `elements`
     * callback that wrote there reached every watcher's frame and was reverted
     * at the next hibernation with nobody told (ShufflewickPub #384).
     *
     * Everything else passes nothing and gets the live game, so enumeration and
     * enforcement are still one function evaluated one way.
     */
    reading?: Game,
  ): AnnotatedChoice<unknown>[] {
    const context: ActionContext = {
      game: reading ?? this.game,
      player,
      args,
    };

    // Resolve the active tutorial step once per getChoices call (O(1) map lookup).
    // Only done when actionName is provided so internal / non-gated callers
    // (resolveArgs, traceActionAvailability) pay zero cost.
    const tutorialStep = actionName !== undefined
      ? getActiveStep(this.game, player.seat)
      : null;

    // Each candidate annotated with why it is not selectable, or `false`.
    // `prepare` runs once for this evaluation, never per candidate and never
    // kept past it (#334), so every `disabled` call shares its result and a
    // later evaluation sees the game as it is then.
    const candidates = this.candidatesOf(selection, context);
    const rule: DisabledRule<unknown> =
      selection.type === 'choice' || selection.type === 'element' || selection.type === 'elements'
        ? (selection as DisabledRule<unknown>)
        : {};
    const { disabled } = rule;
    const prepared = disabled && rule.prepare ? rule.prepare(context) : undefined;
    return candidates.map((candidate) => {
      const gameDisabled = disabled ? disabled(candidate.value, context, prepared) : false;
      // OR-in gate reason: only when no game-defined reason already applies.
      if (tutorialStep && gameDisabled === false) {
        const gateReason = getGateReasonForValue(tutorialStep, actionName!, candidate.value, selection.name);
        if (gateReason) return { ...candidate, disabled: gateReason };
      }
      return { ...candidate, disabled: gameDisabled };
    });
  }

  /**
   * A selection's candidates, UNJUDGED: the values `choices` (after `filterBy`)
   * or the element options produce, with no `disabled` rule, `prepare` or
   * tutorial gate run. What `getChoices` annotates, and all that mapping a
   * submitted value onto a choice needs (#364): resolving an id or a display
   * string must not pay for a verdict on every candidate.
   *
   * A `{ value, label }` choice is read HERE and nowhere else (#509): its
   * candidate is its value, carrying its label. Every later reader -- the
   * `disabled` rule, the wire, validation, `execute` -- sees the value.
   */
  private candidatesOf(selection: Selection, context: ActionContext): Candidate[] {
    if (selection.type === 'choice') return this.choiceItemsOf(selection as ChoiceSelection, context).map(asCandidate);
    return this.elementCandidatesOf(selection, context).map((value) => ({ value }));
  }

  /** A choice selection's `choices`, after `filterBy`, as the game wrote them. */
  private choiceItemsOf(choiceSel: ChoiceSelection, context: ActionContext): unknown[] {
    let choices = typeof choiceSel.choices === 'function'
      ? choiceSel.choices(context)
      : [...choiceSel.choices];

    // Apply filterBy if present and the dependent selection has a value
    if (choiceSel.filterBy) {
      const { key, selectionName } = choiceSel.filterBy;
      const previousValue = context.args[selectionName];

      if (previousValue !== undefined) {
        // Extract the filter value from the previous selection
        // For elements, use .id as fallback if the key doesn't exist
        let filterValue: unknown;
        if (typeof previousValue === 'object' && previousValue !== null) {
          const prevObj = previousValue as Record<string, unknown>;
          // Try the key first, then fall back to 'id' (for element selections)
          filterValue = prevObj[key] !== undefined ? prevObj[key] : prevObj['id'];
        } else {
          filterValue = previousValue;
        }

        // Filter choices where choice[key] matches the filter value
        choices = choices.filter((choice) => {
          if (typeof choice === 'object' && choice !== null) {
            return (choice as Record<string, unknown>)[key] === filterValue;
          }
          return choice === filterValue;
        });
      }
    }

    return choices;
  }

  /** An element selection's candidates, or none for a selection without a list (text, number). */
  private elementCandidatesOf(selection: Selection, context: ActionContext): GameElement[] {
    if (selection.type === 'elements') {
      const elementsSel = selection as ElementsSelection;
      return typeof elementsSel.elements === 'function'
        ? elementsSel.elements(context)
        : [...elementsSel.elements];
    }
    if (selection.type !== 'element') return [];
    const elementSel = selection as ElementSelection;
    // Precomputed candidates (chooseElement's `elements`)
    if (elementSel.elements) {
      return typeof elementSel.elements === 'function'
        ? elementSel.elements(context)
        : [...elementSel.elements];
    }
    return this.boardElementsOf(elementSel, context);
  }

  /** A chooseElement's candidates from its `from`/`elementClass`/`filter` search of the board. */
  private boardElementsOf(elementSel: ElementSelection, context: ActionContext): GameElement[] {
    const from =
      typeof elementSel.from === 'function'
        ? elementSel.from(context)
        : elementSel.from ?? this.game;

    // DEV: Check if 'from' is an ElementCollection (likely a bug in action definition)
    if (isDevMode() && Array.isArray(from) && from.length > 0 && 'all' in from) {
      console.warn(
        `[BoardSmith] ⚠️ Selection "${elementSel.name}" 'from' returned an ElementCollection!\n` +
        `  This is likely a bug - 'from' should return a container (Space/Game), not elements.\n` +
        `  Example fix: from: () => game.stash  (not game.stash.all(Equipment))\n` +
        `  The 'from' collection has ${from.length} elements. Calling .all() on it will search WITHIN these.`
      );
    }

    const elements = elementSel.elementClass ? [...from.all(elementSel.elementClass)] : [...from.all()];
    if (!elementSel.filter) return elements;
    const wrappedFilter = wrapFilterWithHelpfulErrors(elementSel.filter, elementSel.name);
    return elements.filter((e) => wrappedFilter(e, context));
  }

  /**
   * Detect duplicate items in a multiSelect elements submission (WR-04). A
   * client must not be able to satisfy "choose N" by repeating one element.
   *
   * Items are keyed by element id — so a raw ID and its resolved element
   * count as the same item — which is sound here because GameElement ids are
   * globally unique. Non-element values fall back to JSON keying, matching
   * valuesEqual's object-equality semantics. Choice submissions use
   * hasDuplicateChoiceItems instead: choice values may legitimately repeat
   * in the choices list, and plain objects sharing an `id` field are not
   * elements (WR-07).
   */
  private hasDuplicateElementItems(items: unknown[]): boolean {
    const seen = new Set<string>();
    for (const item of items) {
      let key: string;
      if (typeof item === 'number') {
        key = `id:${item}`;
      } else if (item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'number') {
        key = `id:${(item as { id: number }).id}`;
      } else {
        key = `v:${JSON.stringify(item)}`;
      }
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }

  /**
   * Detect duplicate items in a multiSelect chooseFrom submission,
   * multiplicity-aware against the choices list (WR-04, WR-07).
   *
   * Values ARE the identity in the wire protocol — there is no per-instance
   * id for scalar choices — so when the choices list legitimately offers the
   * same value more than once (e.g. a hand holding two coppers), submitting
   * that many copies is the only possible encoding of "select both copies"
   * and must be accepted. Each submitted item is therefore assigned to a
   * distinct choice slot: an item is a duplicate only when every choice it
   * identifies (by valuesEqual, or by smart resolution for raw IDs / display
   * strings) has already been claimed by an earlier item.
   *
   * Items matching no choice at all are ignored here — the per-item
   * validation loop already rejects them with a clear "Invalid selection"
   * error.
   */
  private hasDuplicateChoiceItems(items: unknown[], choices: AnnotatedChoice<unknown>[]): boolean {
    const claimed = new Array<boolean>(choices.length).fill(false);
    for (const item of items) {
      let matching: number[] = [];
      for (let i = 0; i < choices.length; i++) {
        if (this.valuesEqual(choices[i].value, item)) matching.push(i);
      }
      if (matching.length === 0) {
        // Raw element ID / display string: resolve to the canonical choice
        // value first, then claim by that identity.
        const smartMatch = this.trySmartResolveChoice(item, choices);
        if (!smartMatch) continue; // invalid item — per-item validation rejects it
        matching = [];
        for (let i = 0; i < choices.length; i++) {
          if (this.valuesEqual(choices[i].value, smartMatch.value)) matching.push(i);
        }
      }
      const free = matching.find(i => !claimed[i]);
      if (free === undefined) return true; // more copies than the choices offer
      claimed[free] = true;
    }
    return false;
  }

  /**
   * Check if two values are equal (handles objects by comparing JSON).
   *
   * Delegates to `choice-matching.ts`, which the browser's action controller
   * imports too -- the two had separate implementations and disagreed (#219).
   */
  private valuesEqual(a: unknown, b: unknown): boolean {
    return valuesEqual(a, b);
  }

  /**
   * Check if a value exists in annotated choices (compares against .value)
   */
  private annotatedChoicesContain(choices: AnnotatedChoice<unknown>[], value: unknown): boolean {
    return choices.some(choice => this.valuesEqual(choice.value, value));
  }

  /**
   * Try to resolve a value to a valid choice using smart matching.
   * Handles custom UIs sending element IDs
   * when using chooseFrom with element-based choices.
   *
   * Smart matching tries (in order):
   * 1. Element ID match: if value is a number and a choice is an element with that ID
   * 2. Display match: if value is a string matching a choice's display property
   *
   * @returns the matched AnnotatedChoice (so callers can enforce `disabled`),
   *   or undefined when the value cannot be resolved to any choice. Callers
   *   MUST check `.disabled` on the match — a smart-resolved value must never
   *   bypass disabled/tutorial-gate enforcement (CR-01).
   */
  private trySmartResolveChoice(
    value: unknown,
    choices: AnnotatedChoice<unknown>[]
  ): AnnotatedChoice<unknown> | undefined {
    return trySmartResolveChoice(value, choices);
  }

  /**
   * Resolve a value to the actual choice value using smart matching.
   * Used by resolveArgs to convert IDs/display strings to actual choice values.
   *
   * @returns The resolved choice value, or the original value if no match found
   */
  private smartResolveChoiceValue(value: unknown, candidates: Candidate[]): unknown {
    const match = findMatchingChoice(value, candidates);
    return match === undefined ? value : match.value;
  }

  /**
   * Format valid choices for error messages
   */
  private formatValidChoices(choices: AnnotatedChoice<unknown>[]): string {
    const maxShow = 5;
    const formatted = choices.slice(0, maxShow).map(choice => {
      if (choice.label !== undefined) return choice.label;
      const actual = choice.value;
      if (actual && typeof actual === 'object') {
        const obj = actual as Record<string, unknown>;
        // Try to get a readable representation
        if (obj.name) return String(obj.name);
        if (obj.label) return String(obj.label);
        if ('id' in obj) return `(id: ${obj.id})`;
      }
      return JSON.stringify(actual);
    });

    if (choices.length > maxShow) {
      formatted.push(`... and ${choices.length - maxShow} more`);
    }

    return `[${formatted.join(', ')}]`;
  }

  /**
   * Validate a single selection value.
   *
   * @param actionName - When provided, tutorial gate disabled reasons are
   *   included in the choices evaluated here, so a learner submitting a
   *   non-allowed target receives the gate reason via the existing
   *   "Selection disabled: <reason>" path.
   */
  validateSelection(
    selection: Selection,
    value: unknown,
    player: Player,
    args: Record<string, unknown>,
    actionName?: string,
  ): ValidationResult {
    const errors: string[] = [];
    const context: ActionContext = {
      game: this.game,
      player,
      args,
    };

    // Check if value is in valid choices (for choice/element)
    if (selection.type === 'choice' || selection.type === 'element') {
      const choices = this.getChoices(selection, player, args, actionName);

      // Handle multiSelect arrays - validate each value in the array
      if (Array.isArray(value)) {
        // A single `element` selection is never multiSelect, so an array is
        // never a valid submission shape for it (WR-08). Without this the
        // loop below records no error for element selections (its checks are
        // choice-only) and the raw array reaches execute() untouched.
        if (selection.type === 'element') {
          return {
            valid: false,
            errors: [
              `Selection "${selection.name}" expects a single element, got an array of ${value.length}. ` +
              `Submit one element or element ID; use chooseElements for multi-element selections.`,
            ],
          };
        }
        for (const v of value) {
          // Check if this specific array item is disabled
          const disabledItem = choices.find(c => this.valuesEqual(c.value, v) && c.disabled !== false);
          if (disabledItem) {
            errors.push(`Selection disabled: ${disabledItem.disabled}`);
            continue;
          }
          if (!this.annotatedChoicesContain(choices, v)) {
            // Try smart resolution for choice selections. A smart-resolved
            // match must still pass the disabled check (CR-01): resolving an
            // element ID / display string to a choice must never grant access
            // to a disabled (including tutorial-gated) choice.
            if (selection.type === 'choice') {
              const smartMatch = this.trySmartResolveChoice(v, choices);
              if (!smartMatch) {
                errors.push(this.unavailableRefusal(
                  selection, v, context, actionName,
                  `Invalid selection for "${selection.name}": ${JSON.stringify(v)}. Valid choices: ${this.formatValidChoices(choices)}`,
                ));
              } else if (smartMatch.disabled !== false) {
                errors.push(`Selection disabled: ${smartMatch.disabled}`);
              }
            }
          }
        }
      } else {
        // Check disabled FIRST -- if value matches a disabled item, reject with reason
        const disabledMatch = choices.find(c => this.valuesEqual(c.value, value) && c.disabled !== false);
        if (disabledMatch) {
          errors.push(`Selection disabled: ${disabledMatch.disabled}`);
        } else if (!this.annotatedChoicesContain(choices, value)) {
          // Try smart resolution for choice selections; a match must still
          // pass the disabled check (CR-01, same contract as the array path).
          if (selection.type === 'choice') {
            const smartMatch = this.trySmartResolveChoice(value, choices);
            if (!smartMatch) {
              errors.push(this.unavailableRefusal(
                selection, value, context, actionName,
                `Invalid selection for "${selection.name}": ${JSON.stringify(value)}. Valid choices: ${this.formatValidChoices(choices)}`,
              ));
            } else if (smartMatch.disabled !== false) {
              errors.push(`Selection disabled: ${smartMatch.disabled}`);
            }
          } else if (selection.type === 'element') {
            errors.push(this.unavailableRefusal(
              selection, value, context, actionName,
              `Invalid selection for "${selection.name}": ${this.describeSubmittedElement(value)}. Valid elements: ${this.formatValidChoices(choices)}`,
            ));
          }
        }
      }

      // Enforce multiSelect min/max bounds on choice selections (ENG-04/F6).
      // Structurally identical to the elements-branch enforcement below, except
      // a non-array value must be REJECTED outright when multiSelect is
      // configured -- unlike the elements branch, a bare choice is not a valid
      // shorthand for a multiSelect-configured chooseFrom.
      if (selection.type === 'choice') {
        // AN ORDERED LIST IS BOUNDED THE SAME WAY AND DEDUPED NOT AT ALL (#249).
        // Its bounds count ENTRIES, so a repeat satisfies `min` and fills a slot
        // under `max`; every occurrence was already checked against `choices` by
        // the per-item loop above, which is the guarantee that makes repetition
        // safe to allow. The two configs are mutually exclusive (the builder
        // refuses both), so the set rules below are skipped when this one
        // applies -- while everything AFTER this block (the selection's own
        // `validate`, the type-specific rules) still runs for both.
        const orderedList = resolveOrderedList(selection, context);
        if (orderedList !== undefined) {
          if (!Array.isArray(value)) {
            errors.push(
              `Selection "${selection.name}" is an ordered list and expected an array, got ${typeof value}: ${JSON.stringify(value)}`
            );
          } else {
            errors.push(...choiceCountErrors(selection.name, value.length, orderedList.min, orderedList.max));
          }
        }

        const multiSelectConfig = orderedList !== undefined
          ? undefined
          : resolveMultiSelect(selection, context);
        if (multiSelectConfig !== undefined) {
          if (!Array.isArray(value)) {
            errors.push(`Selection "${selection.name}" is multi-select and expected an array, got ${typeof value}: ${JSON.stringify(value)}`);
          } else {
            // Reject duplicates before the count check (WR-04): repeated
            // items must not satisfy the min bound. Multiplicity-aware
            // (WR-07): a value duplicated in the choices list may be
            // submitted that many times.
            if (this.hasDuplicateChoiceItems(value, choices)) {
              errors.push(`Selection "${selection.name}" contains duplicate choices`);
            }
            errors.push(...choiceCountErrors(selection.name, value.length, multiSelectConfig.min, multiSelectConfig.max));
          }
        }
      }
    }

    // Validate elements selection (new "pit of success" type)
    // After resolveArgs, values are GameElement objects (not raw IDs)
    if (selection.type === 'elements') {
      const annotatedElements = this.getChoices(selection, player, args, actionName);
      const validElements = annotatedElements.map(c => c.value) as GameElement[];
      const validIds = validElements.map(e => e.id);
      const validNames = () => validElements.map(e => `${e.name} (id: ${e.id})`).join(', ');

      const validateElement = (elem: unknown): string | null => {
        // Handle resolved GameElement objects
        if (elem && typeof elem === 'object' && 'id' in elem) {
          const id = (elem as { id: number }).id;
          // Check disabled first
          const disabledMatch = annotatedElements.find(
            c => c.value && typeof c.value === 'object' && 'id' in c.value && (c.value as { id: number }).id === id && c.disabled !== false
          );
          if (disabledMatch) {
            return `Selection disabled: ${disabledMatch.disabled}`;
          }
          if (!validIds.includes(id)) {
            return this.unavailableRefusal(
              selection, elem, context, actionName,
              `Element ID ${id} is not a valid choice for "${selection.name}". Valid elements: [${validNames()}]`,
            );
          }
          return null;
        }
        // Handle unresolved IDs (numeric element IDs)
        if (typeof elem === 'number') {
          // Check disabled first
          const disabledMatch = annotatedElements.find(
            c => c.value && typeof c.value === 'object' && 'id' in c.value && (c.value as { id: number }).id === elem && c.disabled !== false
          );
          if (disabledMatch) {
            return `Selection disabled: ${disabledMatch.disabled}`;
          }
          if (!validIds.includes(elem)) {
            // An ID that doesn't resolve to any element at all is "not found";
            // an ID that resolves but isn't an offered choice is "not valid".
            // The player is told the same thing either way: it is gone.
            const detail = this.game.getElementById(elem)
              ? `Element ID ${elem} is not a valid choice for "${selection.name}". Valid elements: [${validNames()}]`
              : `Element ID ${elem} not found for "${selection.name}".`;
            return this.unavailableRefusal(selection, elem, context, actionName, detail);
          }
          return null;
        }
        return `Expected element or element ID for "${selection.name}", got ${typeof elem}: ${JSON.stringify(elem)}`;
      };

      if (Array.isArray(value)) {
        // Multi-select: array of elements or IDs
        for (const v of value) {
          const error = validateElement(v);
          if (error) errors.push(error);
        }
      } else {
        // Single selection
        const error = validateElement(value);
        if (error) errors.push(error);
      }

      // Enforce multiSelect min/max bounds on the submitted count.
      // multiSelect can be a number (max, with implicit min 1), a { min, max }
      // config, or a function returning either. Mirror pick-handler.ts resolution.
      const multiSelectConfig = resolveMultiSelect(selection, context);
      if (multiSelectConfig !== undefined) {
        // Reject duplicates before the count check (WR-04): repeated
        // elements (or repeated IDs of the same element) must not satisfy
        // the min bound.
        if (Array.isArray(value) && this.hasDuplicateElementItems(value)) {
          errors.push(`Selection "${selection.name}" contains duplicate elements`);
        }
        const { min, max } = multiSelectConfig;
        const count = Array.isArray(value) ? value.length : 1;
        if (count < min) {
          errors.push(`Selection "${selection.name}" requires at least ${min} element${min === 1 ? '' : 's'}, got ${count}`);
        }
        if (max !== undefined && count > max) {
          errors.push(`Selection "${selection.name}" requires at most ${max} element${max === 1 ? '' : 's'}, got ${count}`);
        }
      }
    }

    // Type-specific validation
    switch (selection.type) {
      case 'text': {
        const textSel = selection as TextSelection;
        const str = value as string;
        if (typeof str !== 'string') {
          errors.push(`${selection.name} must be a string`);
        } else {
          // The bounds live in `text-rules.ts` because the Action Panel has to
          // apply the same ones to tell a player why their text will be refused
          // before they submit it (#229). Two copies of these three checks is
          // two rule sets that drift.
          errors.push(...textRuleErrors(selection.name, str, textSel));
        }
        break;
      }

      case 'number': {
        const numSel = selection as NumberSelection;
        const num = value as number;
        if (typeof num !== 'number' || isNaN(num)) {
          errors.push(`${selection.name} must be a number`);
        } else {
          // The bounds live in `number-rules.ts` because the Action Panel has to
          // apply the same ones to tell a player why their number will be
          // refused before they submit it (#237), exactly as the text case above
          // does. Two copies of these three checks is two rule sets that drift.
          errors.push(...numberRuleErrors(selection.name, num, numSel));
        }
        break;
      }
    }

    // Custom validation
    if (selection.validate && errors.length === 0) {
      // Cast value since we've already validated the type above
      const result = (selection.validate as (v: unknown, a: Record<string, unknown>, c: ActionContext) => boolean | string)(value, args, context);
      const error = interpretValidateResult(
        result,
        `validate for selection '${selection.name}'` +
          (actionName ? ` of action '${actionName}'` : ''),
        `Invalid ${selection.name}`,
      );
      if (error) errors.push(error);
    }

    // One sentence per refusal: a multiSelect with three stale values is one
    // stale pick to the player, not the same sentence three times.
    const refusals = [...new Set(errors)];
    return {
      valid: refusals.length === 0,
      errors: refusals,
    };
  }

  /**
   * What the player is told when a value they submitted is no longer among the
   * selection's choices (#393).
   *
   * In a world this is routine -- another seat took the offer, a second tab
   * acted first -- so it is not the engine's text, which names raw values and
   * lists the valid ones. It is the selection's own `unavailable` sentence when
   * the game wrote one, and a plain one that says what to do otherwise. The
   * engine's `detail` goes to the dev log, where the author reads it.
   */
  private unavailableRefusal(
    selection: Pick<Selection, 'name'> & UnavailableRule,
    value: unknown,
    context: ActionContext,
    actionName: string | undefined,
    detail: string,
  ): string {
    const message = selection.unavailable
      ? this.gameUnavailableSentence(selection, value, context, actionName)
      : NO_LONGER_AVAILABLE;
    if (isDevThrowEnabled()) {
      console.warn(`[BoardSmith] ${detail} The player was told: "${message}"`);
    }
    return message;
  }

  /** The game's own `unavailable` sentence, refused loudly when it is not one. */
  private gameUnavailableSentence(
    selection: Pick<Selection, 'name'> & UnavailableRule,
    value: unknown,
    context: ActionContext,
    actionName: string | undefined,
  ): string {
    const message: unknown = selection.unavailable!(value, context);
    if (typeof message === 'string' && message.trim() !== '') return message;
    const returned = typeof message === 'string' ? 'an empty string' : describeValidateReturn(message);
    throw new Error(
      `unavailable for selection '${selection.name}'` +
        (actionName ? ` of action '${actionName}'` : '') +
        ` returned ${returned}. Return the sentence the player reads when the value they ` +
        `submitted is no longer listed, saying what happened and what to do next.`,
    );
  }

  /** An element submission, for the dev log: its name and id, or what was sent. */
  private describeSubmittedElement(value: unknown): string {
    if (isElement(value)) return `${value.name} (id: ${value.id})`;
    return JSON.stringify(value);
  }

  /**
   * Run the action-level `validate` gate, if the action declares one.
   *
   * Shared by BOTH paths into `execute` — the one-shot `executeAction` (via
   * `validateAction`) and the incremental `executePendingAction` the interactive
   * UI drives. A gate that holds on only one of them is worse than no gate: it
   * would pass every test written against `performAction` and let the same
   * submission through the moment a player clicked their way to it instead.
   *
   * @returns The refusal message, or `null` when the action may proceed
   */
  private checkActionValidate(action: ActionDefinition, context: ActionContext): string | null {
    if (!action.validate) return null;
    return interpretValidateResult(
      action.validate(context.args, context),
      `validate for action '${action.name}'`,
      `Action '${action.name}' is not allowed with these choices`,
    );
  }

  /**
   * Validate all arguments for an action
   */
  validateAction(
    action: ActionDefinition,
    player: Player,
    args: Record<string, unknown>,
    options?: PerformOptions,
  ): ValidationResult {
    const allErrors: string[] = [];
    const context: ActionContext = {
      game: this.game,
      player,
      args,
    };

    // Check condition. A follow-up is offered by the chain, not its condition.
    if (!options?.asFollowUp && action.condition && !evaluateCondition(action.condition, context, `action '${action.name}'`)) {
      return {
        valid: false,
        errors: ['Action is not available'],
      };
    }

    // Validate each selection
    for (const selection of action.selections) {
      const value = args[selection.name];

      // Handle missing or skipped selections
      // undefined = not provided (key absent from args)
      // null = explicitly skipped (from direct API/bot calls; UI strips skipped via buildServerArgs)
      if (value === undefined || value === null) {
        if (!selection.optional) {
          allErrors.push(`Missing required selection: ${selection.name}`);
        }
        continue;
      }

      const result = this.validateSelection(selection, value, player, args, action.name);
      allErrors.push(...result.errors);
    }

    // Whole-action gate, LAST: every selection is present and individually
    // valid by now, so `args` is complete and a cross-selection rule can be
    // stated once, in one place, with its own message. Skipped when a selection
    // already failed — reporting "you must play 2 cards" on top of "missing
    // required selection: cards" only obscures the real problem.
    if (allErrors.length === 0) {
      const error = this.checkActionValidate(action, context);
      if (error) allErrors.push(error);
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
    };
  }

  /**
   * Execute an action with the given arguments
   */
  executeAction(
    action: ActionDefinition,
    player: Player,
    args: Record<string, unknown>,
    options?: PerformOptions,
  ): ActionResult {
    // A repeating selection is a protocol, not a value: each pick is checked
    // against the choices the previous pick's onEach left, runs onEach, and is
    // tested against `until`. That protocol lives in processRepeatingStep, so a
    // whole submission runs the same selection steps a player's picks do
    // (#325) rather than a second, repeat-blind validation.
    if (this.hasRepeatingSelections(action)) {
      return this.executeThroughSelectionSteps(action, player, args, options);
    }

    // Resolve serialized args (player indices, element IDs) to actual objects
    const resolvedArgs = this.resolveArgs(action, args, player);

    // Validate with resolved args
    const validation = this.validateAction(action, player, resolvedArgs, options);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join('; '),
      };
    }

    // Fire onSelect for each selection that has it (before execute).
    // A throwing onSelect must ABORT the action (fail loud): fire onCancel for
    // any selections whose onSelect already ran, then return failure WITHOUT
    // committing the action via execute().
    const onSelectCtx = this.createOnSelectContext();
    const firedSelections: Selection[] = [];
    for (const selection of action.selections) {
      if (selection.onSelect && resolvedArgs[selection.name] != null) {
        try {
          (selection.onSelect as (value: unknown, ctx: OnSelectContext) => void)(resolvedArgs[selection.name], onSelectCtx);
          firedSelections.push(selection);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // Compensate: run onCancel for selections whose onSelect already fired.
          for (const fired of firedSelections) {
            if (fired.onCancel) {
              try {
                fired.onCancel(onSelectCtx);
              } catch (cancelError) {
                console.error(`[BoardSmith] onCancel for '${fired.name}' threw during abort:`, cancelError);
              }
            }
          }
          return {
            success: false,
            error: `onSelect for selection '${selection.name}' in action '${action.name}' threw: ${message}`,
          };
        }
      }
    }

    const context: ActionContext = {
      game: this.game,
      player,
      args: resolvedArgs,
    };

    try {
      const result = action.execute(resolvedArgs, context);
      return result ? acceptExecuteResult(action.name, result) : { success: true };
    } catch (error) {
      return failedExecute(action.name, error);
    }
  }

  /**
   * Execute a whole submission of an action that has a repeating selection by
   * feeding it through the selection steps, one value at a time (#325).
   *
   * A repeating selection's value is its picks as an array, in the order they
   * were made, ending with the pick that ends the repeat: exactly what
   * `execute` receives when a player makes the picks one by one. Each pick goes
   * through `processRepeatingStep`, so `onEach` runs for it and the next pick is
   * checked against the choices that left. Every other selection goes through
   * `processSelectionStep`, as it does for a player.
   *
   * `onEach` changes the game while the picks are still being checked, so a
   * submission refused after it ran is marked `partiallyApplied` and the runner
   * rolls the game back.
   */
  private executeThroughSelectionSteps(
    action: ActionDefinition,
    player: Player,
    args: Record<string, unknown>,
    options?: PerformOptions,
  ): ActionResult {
    const context = { game: this.game, player, args: this.resolveArgs(action, args, player) };
    if (!options?.asFollowUp && action.condition && !evaluateCondition(action.condition, context, `action '${action.name}'`)) {
      return { success: false, error: 'Action is not available' };
    }

    const pendingState = this.createPendingActionState(action.name, player.seat);
    let applied = false;
    for (const selection of action.selections) {
      const step = this.feedSelection(action, player, pendingState, selection, args[selection.name]);
      applied ||= step.applied;
      if (step.error !== undefined) {
        this.fireOnCancelCallbacks(action, pendingState);
        return { success: false, error: step.error, ...(applied && { partiallyApplied: true }) };
      }
    }

    const result = this.executePendingAction(action, player, pendingState);
    return !result.success && applied ? { ...result, partiallyApplied: true } : result;
  }

  /**
   * Feed one selection's whole submitted value through the selection steps.
   * `applied` says whether a callback that can change the game (`onSelect`,
   * `onEach`) has run, so a refusal after it must be rolled back.
   */
  private feedSelection(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    selection: Selection,
    value: unknown
  ): { error?: string; applied: boolean } {
    if (!this.isRepeatingSelection(selection)) {
      const step = this.processSelectionStep(action, player, pendingState, selection.name, value);
      return { error: step.success ? undefined : step.error, applied: false };
    }
    if (value === undefined || value === null) {
      if (!selection.optional) return { error: `Missing required selection: ${selection.name}`, applied: false };
      pendingState.currentSelectionIndex++;
      return { applied: false };
    }
    if (!Array.isArray(value) || value.length === 0) {
      return { error: this.repeatShapeError(selection, value), applied: false };
    }
    return this.feedRepeatPicks(action, player, pendingState, selection, value);
  }

  /**
   * Feed a repeating selection's picks, in order, through `processRepeatingStep`,
   * so each pick runs `onEach` and is checked against the choices the previous
   * one left. The picks must end exactly where the repeat ends.
   */
  private feedRepeatPicks(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    selection: Selection,
    picks: unknown[]
  ): { error?: string; applied: boolean } {
    const index = pendingState.currentSelectionIndex;
    let applied = false;
    for (const [pickIndex, pick] of picks.entries()) {
      if (pendingState.currentSelectionIndex !== index) {
        return { error: this.repeatEndedEarlyError(selection, pickIndex, picks.length), applied };
      }
      const step = this.feedRepeatPick(action, player, pendingState, selection, pick);
      applied ||= step.applied;
      if (step.error) return { error: `Pick ${pickIndex + 1} of "${selection.name}": ${step.error}`, applied };
    }
    if (pendingState.repeating) {
      return {
        error:
          `Selection "${selection.name}" repeats and its ${picks.length} pick(s) did not end it: the repeat ` +
          `still expects another pick. End the array with the pick that ends the repeat.`,
        applied,
      };
    }
    return { applied };
  }

  /** One pick through `processRepeatingStep`. */
  private feedRepeatPick(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    selection: Selection,
    pick: unknown
  ): { error?: string; applied: boolean } {
    const iterationsBefore = pendingState.repeating?.iterationCount ?? 0;
    const step = this.processRepeatingStep(action, player, pendingState, this.repeatPickValue(selection, pick));
    // A pick that got past validation has run onSelect/onEach, even when they
    // then failed, so the game may have changed.
    const applied = !step.error || (pendingState.repeating?.iterationCount ?? 0) > iterationsBefore;
    return { error: step.error, applied };
  }

  private repeatShapeError(selection: Selection, value: unknown): string {
    const shown = Array.isArray(value) ? value : this.describeSubmittedValue(value);
    return (
      `Selection "${selection.name}" repeats, so its value is its picks as an array, in the order ` +
      `they are made, ending with the pick that ends the repeat (for example [first, second, last]). ` +
      `Got ${JSON.stringify(shown)}.`
    );
  }

  private repeatEndedEarlyError(selection: Selection, pickIndex: number, total: number): string {
    return (
      `Selection "${selection.name}" repeats and pick ${pickIndex} of ${total} ended it, so the ` +
      `${total - pickIndex} pick(s) after the pick that ended it cannot be made. End the array with ` +
      `the pick that ends the repeat.`
    );
  }

  /** A pick in the form processRepeatingStep takes: an element selection's is the element's id. */
  private repeatPickValue(selection: Selection, pick: unknown): unknown {
    if (selection.type !== 'element' && selection.type !== 'elements') return pick;
    if (isElement(pick)) return pick.id;
    if (this.looksLikeSerializedElement(pick)) return (pick as { id: number }).id;
    return pick;
  }

  /** An element is named by its id in an error, not dumped whole. */
  private describeSubmittedValue(value: unknown): unknown {
    return isElement(value) ? { id: value.id, name: value.name } : value;
  }

  /**
   * Check if an action is available for a player.
   * For actions with dependent selections (filterBy), this checks if at least
   * one valid path through all selections exists.
   */
  /**
   * Whether a seat holding `action` as a follow-up pre-filled with `args` has
   * at least one valid way to complete it. The condition is not checked: a
   * follow-up is offered by the chain, not by its condition.
   */
  hasFollowUpChoices(action: ActionDefinition, player: Player, args: Record<string, unknown>): boolean {
    const resolved = this.resolveArgs(action, args, player);
    return this.hasValidSelectionPath(action.selections, player, resolved, 0, action.name);
  }

  isActionAvailable(action: ActionDefinition, player: Player): boolean {
    const context: ActionContext = {
      game: this.game,
      player,
      args: {},
    };

    if (action.condition && !evaluateCondition(action.condition, context, `action '${action.name}'`)) {
      return false;
    }

    // Check if there's at least one valid path through all selections.
    // Pass action.name so tutorial gate disabled reasons are included when
    // filtering enabled choices — hasValidSelectionPath checks disabled===false.
    return this.hasValidSelectionPath(action.selections, player, {}, 0, action.name);
  }

  /**
   * Trace why an action is or isn't available for debug purposes.
   * Returns detailed information about condition checks and selection availability.
   */
  traceActionAvailability(action: ActionDefinition, player: Player): ActionTrace {
    const trace: ActionTrace = {
      actionName: action.name,
      available: false,
      selections: [],
    };

    const context: ActionContext = {
      game: this.game,
      player,
      args: {},
    };

    // Check condition with automatic tracing
    if (action.condition) {
      try {
        const { passed, details } = evaluateConditionWithTrace(action.condition, context, `action '${action.name}'`);
        trace.conditionResult = passed;
        if (details.length > 0) {
          trace.conditionDetails = details;
        }

        if (!trace.conditionResult) {
          // Condition failed - action not available
          return trace;
        }
      } catch (error) {
        trace.conditionError = error instanceof Error ? error.message : String(error);
        return trace;
      }
    } else {
      // No condition - always passes
      trace.conditionResult = true;
    }

    // ONE SOURCE OF TRUTH FOR "AVAILABLE" (#270). The trace describes each step;
    // whether the action is offered is decided by the very walk that offers it,
    // so a trace can never name a reason the offer does not act on.
    this.traceSelectionPath(action.selections, player, trace.selections);
    trace.available = this.hasValidSelectionPath(action.selections, player, {}, 0, action.name);
    return trace;
  }

  /**
   * The same walk as {@link hasValidSelectionPath}, written down (#270).
   *
   * A trace that disagreed with the offer is worse than no trace: it would name
   * a later step as the reason a verb the engine actually offers is missing, and
   * send the author debugging a question the player has not been asked yet. So
   * this stops where availability stops, and every step past that is recorded
   * with `notYetAskable` -- present in the trace, NOT evaluated, and never the
   * reason for anything.
   */
  private traceSelectionPath(
    selections: Selection[],
    player: Player,
    selectionTraces: PickTrace[]
  ): void {
    // Nothing is asked, so there is nothing to describe.
    if (selections.length === 0) {
      return;
    }

    // The first step is the only one evaluated, for the reason it is the only
    // one availability evaluates: it is the only one whose arguments are known.
    const selection = selections[0];
    const selTrace = this.describePick(selection);

    // Optional steps and free input always have an answer, and what that answer
    // will be is unknown, so nothing past them can be judged either.
    if (selection.optional || selection.type === 'text' || selection.type === 'number') {
      if (selection.type === 'text' || selection.type === 'number') {
        selTrace.choiceCount = -1; // -1 indicates free input, not choices
      }
      selectionTraces.push(selTrace);
      this.traceNotYetAskable(selections, 1, selectionTraces);
      return;
    }

    const choices = this.getChoices(selection, player, {});
    selTrace.choiceCount = choices.length; // Total including disabled
    selectionTraces.push(selTrace);
    this.traceNotYetAskable(selections, 1, selectionTraces);
  }

  /**
   * Record every step after the one the player is waiting on, unevaluated.
   *
   * Their candidates are a function of answers that do not exist yet, so the
   * trace says which step each one is waiting for rather than a choice count
   * that would only be the empty list a dependent callback correctly returns.
   */
  private traceNotYetAskable(
    selections: Selection[],
    from: number,
    selectionTraces: PickTrace[]
  ): void {
    for (let i = from; i < selections.length; i++) {
      selectionTraces.push({ ...this.describePick(selections[i]), notYetAskable: true });
    }
  }

  /**
   * One step's trace, minus anything that takes evaluating it to know.
   *
   * Written once because an evaluated step and an unevaluated one differ in
   * exactly that, and two copies of "what a step is called and what it depends
   * on" is how the two came to describe the same selection differently.
   */
  private describePick(selection: Selection): PickTrace {
    const selTrace: PickTrace = {
      name: selection.name,
      type: selection.type,
      choiceCount: 0,
      optional: selection.optional,
    };
    if (selection.type === 'choice') {
      const choiceSel = selection as ChoiceSelection;
      if (choiceSel.filterBy) selTrace.filterApplied = true;
      if (choiceSel.dependsOn) selTrace.dependentOn = choiceSel.dependsOn;
    }
    if ((selection.type === 'element' || selection.type === 'elements') && 'dependsOn' in selection) {
      selTrace.dependentOn = (selection as ElementSelection | ElementsSelection).dependsOn;
    }
    return selTrace;
  }

  /**
   * Check if any selection after the given index depends on a selection by name
   */
  private hasDependentSelection(
    selections: Selection[],
    afterIndex: number,
    selectionName: string
  ): boolean {
    for (let i = afterIndex; i < selections.length; i++) {
      const sel = selections[i];
      // Check for filterBy dependency (choice selections only)
      if (sel.type === 'choice') {
        const choiceSel = sel as ChoiceSelection;
        if (choiceSel.filterBy?.selectionName === selectionName) {
          return true;
        }
      }
      // Check for dependsOn dependency (all selection types)
      if ('dependsOn' in sel && sel.dependsOn === selectionName) {
        return true;
      }
    }
    return false;
  }

  /**
   * OFFERED ON ITS FIRST UNSATISFIED STEP, NEVER PRUNED BY A LATER ONE (#270).
   *
   * Availability runs with `args: {}`, so every step past the first is being
   * asked a question it cannot answer: a dependent `choices` callback has
   * nothing to narrow by until the answer it narrows by exists, and the natural
   * `if (args.slot === undefined) return []` is the correct thing for an author
   * to write. Reading that as "impossible" took the whole verb off the seat's
   * panel with no diagnostic anywhere, and the only way out was to over-offer
   * the union of every first answer's rows -- showing the player items they
   * would not be allowed to pick, once per multi-step verb in the game.
   *
   * So the walk STOPS at the first step the player would actually be asked. A
   * later step is "not yet askable", never "empty, therefore impossible".
   *
   * Two things still prune, because in both the engine has a real answer:
   *
   *   THE FIRST STEP ITSELF. Its candidates are evaluated with exactly the
   *     arguments the player will have when they are asked -- none -- so an
   *     empty list there is a pick that opens on nothing.
   *
   *   A DECLARED DEPENDENCY (`dependsOn` / `filterBy`). The walk enumerates the
   *     earlier step's enabled choices and re-asks the dependent step with each
   *     one BOUND, which is the same question the player's own answer will ask.
   *     Exhausting them all means no answer leads anywhere.
   *
   * Both say so out loud through `devWarn` rather than vanishing.
   *
   * An OPTIONAL step, a `text` and a `number` can never be the reason an action
   * is impossible -- and their answers are equally unknown here, so a step after
   * one of them is no more askable than a step after a choice. The walk stops
   * there too.
   *
   * @param actionName - Propagated from `isActionAvailable` so tutorial gate
   *   disabled reasons are included when filtering enabled choices, and so a
   *   pruning diagnostic can name the verb that disappeared.
   */
  private hasValidSelectionPath(
    selections: Selection[],
    player: Player,
    args: Record<string, unknown>,
    index: number,
    actionName: string,
  ): boolean {
    // Base case: every step has been walked (or bound by the enumeration above).
    if (index >= selections.length) {
      return true;
    }

    const selection = selections[index];

    // Already answered by the dependent enumeration below: keep walking, this
    // step is not the one the player is waiting on.
    if (Object.prototype.hasOwnProperty.call(args, selection.name)) {
      return this.hasValidSelectionPath(selections, player, args, index + 1, actionName);
    }

    // The first unsatisfied step. Optional steps and free input always have an
    // answer, and what that answer will be is unknown, so nothing past them can
    // be judged either.
    if (selection.optional || selection.type === 'text' || selection.type === 'number') {
      return true;
    }

    const enabledChoices = this.getChoices(selection, player, args, actionName)
      .filter(c => c.disabled === false);

    if (enabledChoices.length === 0) {
      // ONLY WHERE IT COULD SURPRISE ANYONE. A one-question verb is dropped
      // exactly when that question has no answer -- no deck, so no draw -- which
      // is ordinary play and is the whole of what its absence means. #270's
      // confusion needs a LATER step to have been blamed, so it cannot arise
      // there, and a warning that fires for every such verb on every seat trains
      // its reader to ignore the one that means something.
      if (selections.length > 1) devWarn(
        `offer-pruned:${actionName}:${selection.name}`,
        `Action '${actionName}' was dropped from this player's offers: its first question ` +
        `'${selection.name}' has no selectable candidate right now (every candidate is either ` +
        `absent or disabled).\n` +
        `  That is the ONLY reason an unanswered question drops an action -- a later step is ` +
        `never evaluated before the player reaches it (#270).\n` +
        `  If the verb should be there, give '${selection.name}' a candidate. If it should ` +
        `not, prefer .condition() / .disabled(), so the player reads a reason instead of a ` +
        `missing verb.`
      );
      return false;
    }

    // Nothing later declared a dependency on this step, so nothing later can be
    // judged until the player answers it. The action is offerable.
    if (!this.hasDependentSelection(selections, index + 1, selection.name)) {
      return true;
    }

    // A DECLARED dependency: re-ask the dependent step with each enabled answer
    // bound, exactly as the player's own answer will.
    for (const choice of enabledChoices) {
      const newArgs = { ...args, [selection.name]: choice.value };
      if (this.hasValidSelectionPath(selections, player, newArgs, index + 1, actionName)) {
        return true;
      }
    }

    const dependents = selections
      .slice(index + 1)
      .filter(s => ('dependsOn' in s && s.dependsOn === selection.name) ||
        (s.type === 'choice' && (s as ChoiceSelection).filterBy?.selectionName === selection.name))
      .map(s => `'${s.name}'`)
      .join(', ');
    devWarn(
      `offer-pruned-dependent:${actionName}:${selection.name}`,
      `Action '${actionName}' was dropped from this player's offers: no value of ` +
      `'${selection.name}' leaves ${dependents} with anything to pick.\n` +
      `  A DECLARED dependency is evaluated during availability with the earlier answer bound, ` +
      `which is what dependsOn/filterBy asks for.\n` +
      `  If the verb should be there, narrow '${selection.name}' to the values that lead ` +
      `somewhere. If it should not, prefer .condition() / .disabled(), so the player reads a ` +
      `reason instead of a missing verb.`
    );
    return false;
  }

  // ============================================
  // Repeating Selections Support
  // ============================================

  /**
   * Check if a selection is configured for repeating.
   */
  isRepeatingSelection(selection: Selection): boolean {
    if (selection.type === 'choice') {
      const cs = selection as ChoiceSelection;
      return cs.repeat !== undefined || cs.repeatUntil !== undefined;
    }
    if (selection.type === 'element') {
      const es = selection as ElementSelection;
      return es.repeat !== undefined || es.repeatUntil !== undefined;
    }
    if (selection.type === 'elements') {
      const es = selection as ElementsSelection;
      return es.repeat !== undefined || es.repeatUntil !== undefined;
    }
    return false;
  }

  /**
   * Check if an action has any repeating selections.
   */
  hasRepeatingSelections(action: ActionDefinition): boolean {
    return action.selections.some(s => this.isRepeatingSelection(s));
  }

  /**
   * The args a repeating selection's callbacks see: the resolved answers so far,
   * with the repeating selection bound to its picks so far.
   *
   * Element/player IDs are resolved first because a choices function (e.g.
   * equipment) may depend on a previously selected element (e.g. actingMerc).
   */
  private repeatingSelectionArgs(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    selectionName: string
  ): Record<string, unknown> {
    const selection = action.selections.find(s => s.name === selectionName);
    const picks = pendingState.repeating?.accumulated ?? [];
    return {
      ...this.resolveArgs(action, pendingState.collectedArgs, player),
      // A repeating chooseElement's picks are held as ids; its callbacks see
      // the elements, as `execute` does.
      [selectionName]: selection?.type === 'element' || selection?.type === 'elements'
        ? picks.map(p => this.resolveElementItem(p, this.game))
        : [...picks],
    };
  }

  /**
   * Why a repeating selection's own `validate` refuses one pick, or `null` when
   * it accepts it or there is none (#352). It is called with the pick (an
   * element for an element selection), `args` holding the picks made before it
   * under the selection's name, and the action context. A rule about the
   * finished array belongs in the action-level `.validate()`.
   */
  private repeatPickRefusal(
    action: ActionDefinition,
    selection: Selection,
    pick: unknown,
    context: ActionContext
  ): string | null {
    if (!selection.validate) return null;
    const value = selection.type === 'element' || selection.type === 'elements'
      ? this.resolveElementItem(pick, this.game)
      : pick;
    const validate = selection.validate as (v: unknown, a: Record<string, unknown>, c: ActionContext) => boolean | string;
    return interpretValidateResult(
      validate(value, context.args, context),
      `validate for selection '${selection.name}' of action '${action.name}'`,
      `Invalid ${selection.name}`,
    );
  }

  /**
   * The values the repeating selection a pending action has reached will accept
   * as its NEXT pick, in the form `processRepeatingStep` takes them (an element
   * selection's are element ids).
   *
   * This is how move enumeration learns what a repeat offers after the picks
   * already made (#325): from the same choices `processRepeatingStep` checks a
   * pick against, not from a copy of that rule.
   */
  repeatingPickCandidates(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState
  ): unknown[] {
    const selection = action.selections[pendingState.currentSelectionIndex];
    if (!selection || !this.isRepeatingSelection(selection)) {
      throw new Error(
        `repeatingPickCandidates: action '${action.name}' is not at a repeating selection ` +
        `(it is at selection ${pendingState.currentSelectionIndex}).`
      );
    }
    const args = this.repeatingSelectionArgs(action, player, pendingState, selection.name);
    const enabled = this.getChoices(selection, player, args).filter(c => c.disabled === false);
    if (selection.type === 'element' || selection.type === 'elements') {
      return enabled.flatMap(c => (isElement(c.value) ? [c.value.id] : []));
    }
    return enabled.map(c => c.value);
  }

  /**
   * Process one step of a repeating selection.
   * This handles adding a value to the accumulated selections, running onEach,
   * and checking the termination condition.
   *
   * Supports choice, element, and elements selection types.
   *
   * @returns Object with:
   *   - done: true if the repeating selection is complete
   *   - nextChoices: available choices for the next iteration (if not done)
   *   - error: error message if something went wrong
   */
  processRepeatingStep(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    value: unknown
  ): { done: boolean; nextChoices?: unknown[]; error?: string } {
    const selection = action.selections[pendingState.currentSelectionIndex];
    if (!selection) {
      return { done: true, error: `Selection at index ${pendingState.currentSelectionIndex} not found` };
    }

    // Get repeat config based on selection type
    let repeatConfig: RepeatConfig<unknown> | undefined;
    let repeatUntil: unknown;
    const isElementSelection = selection.type === 'element' || selection.type === 'elements';

    if (selection.type === 'choice') {
      const choiceSel = selection as ChoiceSelection;
      repeatConfig = choiceSel.repeat;
      repeatUntil = choiceSel.repeatUntil;
    } else if (selection.type === 'element') {
      const elemSel = selection as ElementSelection;
      repeatConfig = elemSel.repeat as RepeatConfig<unknown>;
      repeatUntil = elemSel.repeatUntil;
    } else if (selection.type === 'elements') {
      const elemsSel = selection as ElementsSelection;
      repeatConfig = elemsSel.repeat as RepeatConfig<unknown>;
      repeatUntil = elemsSel.repeatUntil;
    } else {
      return { done: true, error: `Selection ${selection.name} type ${selection.type} does not support repeat` };
    }

    if (!repeatConfig && repeatUntil === undefined) {
      return { done: true, error: `Selection ${selection.name} is not repeating` };
    }

    // Initialize repeating state if needed
    if (!pendingState.repeating) {
      pendingState.repeating = {
        selectionName: selection.name,
        accumulated: [],
        iterationCount: 0,
      };
    }

    // Capture before accumulation -- onSelect fires on first iteration only
    const isFirstIteration = pendingState.repeating.iterationCount === 0;

    // Validate the choice is in the available choices
    const context: ActionContext = {
      game: this.game,
      player,
      args: this.repeatingSelectionArgs(action, player, pendingState, selection.name),
    };

    const currentChoices = this.getChoices(selection, player, context.args);

    // For element selections, value is an element ID - validate it exists in choices
    if (isElementSelection) {
      const elementId = value as number;
      // A choice whose value is not a live element cannot be selected by id.
      // Such values do occur: a `choices`/`elements` closure reading redacted
      // state yields `undefined` (see enumerate-moves' undefined-choice-value
      // warning). Narrowing rather than casting turns that into a refused
      // selection instead of a TypeError on `.id`.
      const elementChoices = currentChoices.flatMap((c) =>
        isElement(c.value) ? [{ element: c.value, disabled: c.disabled }] : []
      );
      if (!elementChoices.some((c) => c.element.id === elementId)) {
        // Format choices as {value, display} for UI
        const formattedChoices = this.formatElementChoices(elementChoices.map((c) => c.element));
        return { done: false, error: `Invalid element ID: ${elementId}`, nextChoices: formattedChoices };
      }
      // Check if the selected element is disabled
      const disabledMatch = elementChoices.find(
        (c) => c.element.id === elementId && c.disabled !== false
      );
      if (disabledMatch) {
        return { done: false, error: `Selection disabled: ${disabledMatch.disabled}` };
      }
    } else if (!this.annotatedChoicesContain(currentChoices, value)) {
      return { done: false, error: `Invalid choice: ${JSON.stringify(value)}`, nextChoices: currentChoices.map(c => c.value) };
    } else {
      // Check disabled for non-element choices
      const disabledMatch = currentChoices.find(c => this.valuesEqual(c.value, value) && c.disabled !== false);
      if (disabledMatch) {
        return { done: false, error: `Selection disabled: ${disabledMatch.disabled}` };
      }
    }

    // The selection's own `validate` judges this ONE pick (#352), with the
    // picks made before it in `args`, before anything can change the game: a
    // refused pick leaves the repeat open and runs no onSelect/onEach.
    const validateError = this.repeatPickRefusal(action, selection, value, context);
    if (validateError) {
      return { done: false, error: validateError };
    }

    // Add to accumulated values
    pendingState.repeating.accumulated.push(value);
    pendingState.repeating.iterationCount++;

    // Fire onSelect on first iteration only (after validation passes)
    if (isFirstIteration && selection.onSelect) {
      try {
        const resolvedForHook = isElementSelection
          ? (this.game.getElementById(value as number) ?? value)
          : value;
        const ctx = this.createOnSelectContext();
        (selection.onSelect as (value: unknown, ctx: OnSelectContext) => void)(resolvedForHook, ctx);

        if (!pendingState.onSelectFired) {
          pendingState.onSelectFired = new Set();
        }
        pendingState.onSelectFired.add(pendingState.currentSelectionIndex);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Fail loud: a throwing onSelect aborts the action. Fire onCancel for
        // selections whose onSelect already fired, then return an error.
        this.fireOnCancelCallbacks(action, pendingState);
        return {
          done: false,
          error: `onSelect for selection '${selection.name}' in action '${action.name}' threw: ${message}`,
        };
      }
    }

    // Update context with new accumulated value
    context.args[selection.name] = pendingState.repeating.accumulated;

    // Run onEach callback if present
    if (repeatConfig?.onEach) {
      try {
        // For element selections, resolve the value to actual element for onEach
        const resolvedValue = isElementSelection
          ? this.game.getElementById(value as number)
          : value;
        repeatConfig.onEach(context, resolvedValue);
      } catch (error) {
        return { done: true, error: error instanceof Error ? error.message : String(error) };
      }
    }

    // Check termination condition
    let isDone = false;
    if (repeatUntil !== undefined) {
      // Simple termination: check if value matches repeatUntil
      // For elements, repeatUntil would be an element, so compare IDs
      if (isElementSelection) {
        const untilId = typeof repeatUntil === 'number' ? repeatUntil : isElement(repeatUntil) ? repeatUntil.id : undefined;
        isDone = value === untilId;
      } else {
        isDone = this.valuesEqual(value, repeatUntil);
      }
    } else if (repeatConfig?.until) {
      // Custom termination function
      try {
        // For element selections, resolve value to actual element for until check
        const resolvedValue = isElementSelection
          ? this.game.getElementById(value as number)
          : value;
        isDone = repeatConfig.until(context, resolvedValue);
      } catch (error) {
        return { done: true, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (isDone) {
      // Move accumulated values to collected args
      pendingState.collectedArgs[selection.name] = pendingState.repeating.accumulated;
      pendingState.repeating = undefined;
      pendingState.currentSelectionIndex++;
      return { done: true };
    }

    // Get next choices (choices may have changed after onEach)
    // Re-resolve args in case they changed, and use resolved args for choices
    const nextContext: ActionContext = {
      game: this.game,
      player,
      args: this.repeatingSelectionArgs(action, player, pendingState, selection.name),
    };
    const nextAnnotated = this.getChoices(selection, player, nextContext.args);
    const nextEnabled = nextAnnotated.filter(c => c.disabled === false);

    // If no more enabled choices available, terminate
    if (nextEnabled.length === 0) {
      pendingState.collectedArgs[selection.name] = pendingState.repeating.accumulated;
      pendingState.repeating = undefined;
      pendingState.currentSelectionIndex++;
      return { done: true };
    }

    // Format choices for UI - element selections need {value: id, display: name}
    const nextChoicesRaw = nextAnnotated.map(c => c.value);
    const formattedChoices = isElementSelection
      ? this.formatElementChoices(nextChoicesRaw.filter(isElement), selection, nextContext)
      : nextChoicesRaw;

    return { done: false, nextChoices: formattedChoices };
  }

  /**
   * Format element array as choices for UI (with value/display format)
   * Uses the selection's display function if available, otherwise falls back to element.name
   */
  private formatElementChoices(
    elements: GameElement[],
    selection?: Selection,
    context?: ActionContext
  ): Array<{ value: number; display: string }> {
    // Only the two element selections reach here, and only they carry an
    // element-shaped `display`. Narrowing on the discriminant gives the real
    // signature, so a wrong arity or a renamed variant fails to compile rather
    // than at render time.
    const customDisplay =
      selection && (selection.type === 'element' || selection.type === 'elements')
        ? selection.display
        : undefined;

    // Auto-disambiguate names (for fallback when no custom display)
    const nameCounts = new Map<string, number>();
    for (const el of elements) {
      const name = el.name || 'Element';
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
    const nameIndices = new Map<string, number>();

    return elements.map(el => {
      let display: string;

      // Use custom display function if available
      if (customDisplay && context) {
        try {
          display = customDisplay(el, context, elements);
        } catch (error) {
          // #50: this used to swallow the throw with no log at all, so the
          // author saw a plausible but wrong label and had nothing to go on.
          // In dev/test the bug stops the run; in a live game a label is
          // cosmetic and is not worth crashing over, so it degrades VISIBLY.
          const detail = `A custom display() for element "${el.name ?? el.id}" threw`;
          console.error(`[BoardSmith] ${detail}:`, error);
          if (isDevThrowEnabled()) {
            throw new Error(
              `${detail}. Fix the display callback -- a label it cannot produce would otherwise ` +
              `be silently replaced by the element's name, which reads as correct output.`
            );
          }
          display = el.name || 'Element';
        }
      } else {
        // Default: use element name with disambiguation
        const baseName = el.name || 'Element';
        const count = nameCounts.get(baseName) || 1;

        if (count > 1) {
          const idx = (nameIndices.get(baseName) || 0) + 1;
          nameIndices.set(baseName, idx);
          display = `${baseName} #${idx}`;
        } else {
          display = baseName;
        }
      }

      return { value: el.id, display };
    });
  }

  /**
   * Create initial pending action state for an action.
   */
  createPendingActionState(actionName: string, playerPosition: number): PendingActionState {
    return {
      actionName,
      playerPosition,
      collectedArgs: {},
      currentSelectionIndex: 0,
    };
  }

  /**
   * Process a non-repeating selection step.
   * This handles regular selections during a pending action flow.
   */
  processSelectionStep(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    selectionName: string,
    value: unknown
  ): { success: boolean; error?: string } {
    const selectionIndex = action.selections.findIndex(s => s.name === selectionName);
    if (selectionIndex === -1) {
      return { success: false, error: `Selection ${selectionName} not found` };
    }

    // Ensure we're at the right selection index
    if (selectionIndex !== pendingState.currentSelectionIndex) {
      return { success: false, error: `Expected selection at index ${pendingState.currentSelectionIndex}, got ${selectionName} at index ${selectionIndex}` };
    }

    const selection = action.selections[selectionIndex];

    // If it's a repeating selection, delegate to processRepeatingStep
    if (this.isRepeatingSelection(selection)) {
      const result = this.processRepeatingStep(action, player, pendingState, value);
      return { success: !result.error, error: result.error };
    }

    // Skipping an optional selection: a null/undefined value means "no choice".
    // Mirror the bulk validateAction path (which treats null/undefined on an
    // optional selection as a valid skip) instead of running validateSelection,
    // which would reject null as an invalid element. The arg is intentionally
    // omitted from collectedArgs so the action's execute sees it as absent.
    if (value === null || value === undefined) {
      if (!selection.optional) {
        return { success: false, error: `Missing required selection: ${selectionName}` };
      }
      pendingState.currentSelectionIndex++;
      return { success: true };
    }

    // Resolve raw values (e.g. element IDs → GameElement objects) before validation.
    // Clients send element IDs over the wire; validation compares against GameElement objects.
    const resolvedValue = this.resolveSelectionValue(selection, value, player);

    // Validate the selection (pass action.name so tutorial gate disabled reasons apply)
    const validationResult = this.validateSelection(selection, resolvedValue, player, pendingState.collectedArgs, action.name);
    if (!validationResult.valid) {
      return { success: false, error: validationResult.errors.join('; ') };
    }

    // Store the resolved value so downstream dependsOn filters see GameElements, not raw IDs
    pendingState.collectedArgs[selectionName] = resolvedValue;

    // Fire onSelect if defined.
    // A throwing onSelect must ABORT the action (fail loud): fire onCancel for
    // any selections whose onSelect already ran, then return failure. The caller
    // discards the pending action rather than committing it.
    if (selection.onSelect) {
      try {
        const ctx = this.createOnSelectContext();
        (selection.onSelect as (value: unknown, ctx: OnSelectContext) => void)(resolvedValue, ctx);

        // Track that onSelect fired for this selection (for onCancel)
        if (!pendingState.onSelectFired) {
          pendingState.onSelectFired = new Set();
        }
        pendingState.onSelectFired.add(selectionIndex);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Compensate: run onCancel for selections whose onSelect already fired.
        this.fireOnCancelCallbacks(action, pendingState);
        return {
          success: false,
          error: `onSelect for selection '${selection.name}' in action '${action.name}' threw: ${message}`,
        };
      }
    }

    pendingState.currentSelectionIndex++;

    return { success: true };
  }

  /**
   * Fire onCancel callbacks for selections where onSelect had fired.
   * Called when a pending action is cancelled.
   */
  fireOnCancelCallbacks(action: ActionDefinition, pendingState: PendingActionState): void {
    if (!pendingState.onSelectFired || pendingState.onSelectFired.size === 0) return;

    // Each selection's onCancel runs once: the set is emptied as it is read, so
    // a caller that cancels after a step already did cannot compensate twice.
    const fired = [...pendingState.onSelectFired];
    pendingState.onSelectFired.clear();
    const ctx = this.createOnSelectContext();
    for (const index of fired) {
      const selection = action.selections[index];
      if (selection?.onCancel) {
        try {
          selection.onCancel(ctx);
        } catch (error) {
          console.error(`[BoardSmith] onCancel for '${selection.name}' threw:`, error);
        }
      }
    }
  }

  /**
   * Check if a pending action is complete (all selections processed).
   */
  isPendingActionComplete(action: ActionDefinition, pendingState: PendingActionState): boolean {
    return pendingState.currentSelectionIndex >= action.selections.length && !pendingState.repeating;
  }

  /**
   * Why the action-level `validate` gate refuses a COMPLETE pending action, or
   * `null` when it may run. Runs nothing else: move enumeration asks this of a
   * pending action it assembled so it offers only moves `executePendingAction`
   * would accept.
   */
  pendingActionRefusal(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState
  ): string | null {
    if (!this.isPendingActionComplete(action, pendingState)) {
      return 'Action is not complete';
    }
    const args = this.resolveArgs(action, pendingState.collectedArgs, player);
    return this.checkActionValidate(action, { game: this.game, player, args });
  }

  /**
   * Execute a completed pending action.
   *
   * The action-level gate applies here too -- this is the interactive path
   * (choice by choice), and the whole point of the gate is that it sees the
   * COMPLETE submission, which is exactly what has just been assembled.
   */
  executePendingAction(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState
  ): ActionResult {
    if (!this.isPendingActionComplete(action, pendingState)) {
      return { success: false, error: 'Action is not complete' };
    }

    // Resolve serialized args
    const resolvedArgs = this.resolveArgs(action, pendingState.collectedArgs, player);

    const context: ActionContext = {
      game: this.game,
      player,
      args: resolvedArgs,
    };

    const validateError = this.checkActionValidate(action, context);
    if (validateError) {
      // The action never runs, so nothing it would have mutated has happened;
      // but selections that already fired onSelect must be compensated, the
      // same as any other abort before execute.
      this.fireOnCancelCallbacks(action, pendingState);
      return { success: false, error: validateError };
    }

    try {
      const result = action.execute(resolvedArgs, context);
      return result ? acceptExecuteResult(action.name, result) : { success: true };
    } catch (error) {
      return failedExecute(action.name, error);
    }
  }
}
