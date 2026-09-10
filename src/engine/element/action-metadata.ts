/**
 * Action metadata builders — pure engine functions for constructing ActionMetadata
 * and PickMetadata from action definitions and player context.
 *
 * Lives in the engine layer (src/engine/element/) so that game.ts can import
 * buildActionMetadata directly without creating an engine<->session runtime cycle.
 *
 * The ActionMetadata / PickMetadata *shapes* are defined in src/session/types.ts
 * and imported here via `import type` (type-only, erased at compile time — no
 * runtime dependency on session).
 */

import { evaluateCondition } from '../action/action.js';
import { devWarn } from '../../utils/dev.js';
import { resolveMultiSelect } from '../utils/resolve-multiselect.js';
import type { Game } from './game.js';
import type { Player } from '../player/player.js';
import type { Selection, ActionDefinition, TextSelection } from '../action/types.js';
import type { ActionMetadata, PickMetadata } from '../../session/types.js';

/**
 * Build action metadata for auto-UI generation.
 *
 * SIMPLIFIED VERSION: Only includes static metadata.
 * Choices and elements are fetched on-demand via /selection-choices endpoint.
 */
export function buildActionMetadata(
  game: Game,
  player: Player,
  availableActionNames: string[]
): Record<string, ActionMetadata> {
  const metadata: Record<string, ActionMetadata> = {};

  for (const actionName of availableActionNames) {
    // `getAction` is the public reader for the registry — this used to reach
    // through `(game as any)._actions`, which is the same lookup with the type
    // system switched off (#52).
    const actionDef = game.getAction(actionName);

    if (!actionDef) {
      devWarn(
        `buildActionMetadata:unknown-action:${actionName}`,
        `[buildActionMetadata] Action "${actionName}" is not registered`,
      );
      continue;
    }

    // Re-check condition in case state changed during action execution (mid-action broadcast)
    // This prevents showing stale action metadata when the condition has become false
    if (actionDef.condition) {
      const ctx = { game, player, args: {} };
      try {
        if (!evaluateCondition(actionDef.condition, ctx, `action "${actionName}"`)) {
          continue; // Skip actions whose condition is now false
        }
      } catch (error) {
        throw new Error(
          `[buildActionMetadata] Condition for action "${actionName}" threw an error. ` +
          `Fix the condition function before this action can be used.\n` +
          `Original error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const pickMetas: PickMetadata[] = [];

    for (const selection of actionDef.selections) {
      const pickMeta = buildPickMetadata(game, player, selection);
      pickMetas.push(pickMeta);
    }

    metadata[actionName] = actionMetadataOf(actionName, actionDef, pickMetas);
  }

  return metadata;
}

/**
 * One action's metadata, assembled from its definition.
 *
 * Separate from the loop above because that loop is about WHICH actions are
 * offered -- the registry lookup and the condition re-check -- while this is
 * about what one of them says. Every optional field is ABSENT rather than
 * `undefined` when the game did not declare it: this record is serialized to a
 * client, and an `undefined` key vanishes in JSON, which makes "the game said
 * nothing" and "the game said nothing about this" indistinguishable on the far
 * side.
 */
function actionMetadataOf(
  actionName: string,
  actionDef: ActionDefinition,
  selections: PickMetadata[],
): ActionMetadata {
  return {
    name: actionName,
    prompt: actionDef.prompt,
    help: actionDef.help,
    ...(actionDef.manual ? { manual: true } : {}),
    ...(actionDef.suppressFromActionPanel ? { suppressFromActionPanel: true } : {}),
    // The Action Panel's menu placement (#228). Absent unless the game declared
    // it, so a game with no hierarchy sends no hierarchy and the panel stays the
    // flat list it has always been.
    ...(actionDef.group === undefined ? {} : { group: actionDef.group }),
    ...(actionDef.order === undefined ? {} : { order: actionDef.order }),
    selections,
  };
}

/**
 * Build metadata for a single selection.
 *
 * Only includes static metadata - choices are always fetched on-demand
 * via /selection-choices endpoint.
 *
 * This keeps:
 * - name, type, prompt, optional
 * - dependsOn - client needs to know what args to send
 * - filterBy - client needs to know what args to send
 * - repeat - client needs repeat behavior info
 * - multiSelect - only if static (not function-based)
 * - elementClassName - for CSS targeting
 * - min, max, integer, pattern, etc. - for number/text validation
 *
 * @param knownArgs Optional args for evaluating dynamic prompts (for followUp actions with pre-filled args)
 */
/**
 * A text pick's bounds, on the metadata a host serializes.
 *
 * Its own function rather than another arm of `buildPickMetadata`'s switch: that
 * switch is already the most complex thing in this file, and `multiline` was the
 * branch that tipped it past the complexity gate's threshold.
 *
 * `multiline` is emitted ONLY WHEN ASKED FOR (#229). A `multiline: false` on
 * every text pick in every game would be a field the wire carries for no
 * reader, and it would move the payload of every existing game for a
 * presentation default nobody chose.
 */
function describeTextPick(base: PickMetadata, selection: TextSelection): void {
  base.pattern = selection.pattern?.source;
  base.minLength = selection.minLength;
  base.maxLength = selection.maxLength;
  if (selection.multiline) base.multiline = true;
}

export function buildPickMetadata(
  game: Game,
  player: Player,
  selection: Selection,
  knownArgs?: Record<string, unknown>
): PickMetadata {
  // Create context with known args if provided (for followUp actions)
  const ctx = { game, player, args: knownArgs ?? {} };

  // Evaluate prompt - can be static string or function returning string
  const evaluatedPrompt = typeof selection.prompt === 'function'
    ? selection.prompt(ctx)
    : selection.prompt;

  const base: PickMetadata = {
    name: selection.name,
    type: selection.type,
    prompt: evaluatedPrompt,
    optional: selection.optional,
  };

  // onSelect callback flag - client needs this to route through server per-step
  if (selection.onSelect) {
    base.hasOnSelect = true;
  }

  // Type-specific properties (static metadata only)
  switch (selection.type) {
    case 'choice': {
      const choiceSel = selection;

      // Include dependsOn info so client knows what args to send when fetching
      if (choiceSel.dependsOn) {
        base.dependsOn = choiceSel.dependsOn;
      }

      // Include filterBy info so client knows about the dependency
      if (choiceSel.filterBy) {
        base.filterBy = choiceSel.filterBy;
      }

      // Include repeat info if present
      if (choiceSel.repeat || choiceSel.repeatUntil !== undefined) {
        base.repeat = {
          hasOnEach: !!choiceSel.repeat?.onEach,
          terminator: choiceSel.repeatUntil,
        };
      }

      // Resolve multiSelect (static or function-valued) via the SAME shared
      // helper enumeration uses, so the panel and MCTS never disagree
      // (bot-01 / C.2). A concrete result emits base.multiSelect so the
      // checkbox widget engages; undefined legitimately omits it.
      const resolvedChoiceMultiSelect = resolveMultiSelect(selection, ctx);
      if (resolvedChoiceMultiSelect !== undefined) {
        base.multiSelect = resolvedChoiceMultiSelect;
      }
      break;
    }

    case 'element': {
      const elemSel = selection;

      // Include elementClassName for CSS targeting
      if (elemSel.elementClass?.name) {
        base.elementClassName = elemSel.elementClass.name;
      }

      // Include dependsOn info so client knows what args to send when fetching
      if (elemSel.dependsOn) {
        base.dependsOn = elemSel.dependsOn;
      }

      // Include repeat info if present
      if (elemSel.repeat || elemSel.repeatUntil !== undefined) {
        base.repeat = {
          hasOnEach: !!elemSel.repeat?.onEach,
          terminator: elemSel.repeatUntil,
        };
      }
      break;
    }

    case 'elements': {
      const elementsSel = selection;

      // Include dependsOn info so client knows what args to send when fetching
      if (elementsSel.dependsOn) {
        base.dependsOn = elementsSel.dependsOn;
      }

      // Include repeat info if present
      if (elementsSel.repeat || elementsSel.repeatUntil !== undefined) {
        base.repeat = {
          hasOnEach: !!elementsSel.repeat?.onEach,
          terminator: elementsSel.repeatUntil,
        };
      }

      // Resolve multiSelect (static or function-valued) via the SAME shared
      // helper enumeration uses, so the panel and MCTS never disagree
      // (bot-01 / C.2). A concrete result emits base.multiSelect so the
      // checkbox widget engages; undefined legitimately omits it.
      const resolvedElementsMultiSelect = resolveMultiSelect(selection, ctx);
      if (resolvedElementsMultiSelect !== undefined) {
        base.multiSelect = resolvedElementsMultiSelect;
      }
      break;
    }

    case 'number': {
      const numSel = selection;
      base.min = numSel.min;
      base.max = numSel.max;
      base.integer = numSel.integer;
      break;
    }

    case 'text': {
      describeTextPick(base, selection);
      break;
    }
  }

  return base;
}

/**
 * THE LARGEST FLAT CANDIDATE SET A SELECTION MAY PRESENT AS BUTTONS.
 *
 * It lives beside `buildPickMetadata`, which is where a pick's candidates are
 * actually built, because THREE things now read it and no two of them may
 * disagree: the Action Panel (which hands a wider pick to the board), the
 * `boardsmith validate` choice-cardinality audit, and `worldBudgets`, whose own
 * `maxCandidatesPerSelection` must sit strictly above it (BoardSmith #170 R2).
 * `boardsmith/world` may reach the engine and nothing else, so the engine is the
 * only place all three can meet.
 *
 * 24 is where a wrapping row of pills stops being a sentence and becomes an
 * unlabelled grid the player must scan — roughly two full rows in the action bar
 * at a normal window width — and it is past the point where a screen-reader user
 * can hold the list in their head while walking it.
 *
 * It clears the reference games by a wide margin. Measured on 2026-09-05 by
 * running the audit over hex, go-fish, checkers, chess, cribbage, seven and
 * polyhedral-potions, the largest UNANCHORED flat set any of them ever offers is
 * 11 (seven's `discard.card`); the largest anchored one is Hex's 49 empty cells,
 * which is exactly the set that should go to the board rather than the panel.
 * Lacuna's planned hundreds of verbs trip it decisively.
 *
 * The number is a judgement about reading, not a measurement, so it is stated
 * once, here, and every consumer reads it rather than restating it.
 */
export const MAX_FLAT_CHOICE_CANDIDATES = 24;
