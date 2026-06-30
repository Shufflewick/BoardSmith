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
import type { Game } from './game.js';
import type { Player } from '../player/player.js';
import type { Selection, ActionDefinition } from '../action/types.js';
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
    // Access registered actions via the game's internal API
    const actions = (game as any)._actions as Map<string, ActionDefinition>;
    const actionDef = actions?.get(actionName);

    if (!actionDef) {
      console.warn(`[buildActionMetadata] Action "${actionName}" not found in game._actions`);
      continue;
    }

    // Re-check condition in case state changed during action execution (mid-action broadcast)
    // This prevents showing stale action metadata when the condition has become false
    if (actionDef.condition) {
      const ctx = { game, player, args: {} };
      try {
        if (!evaluateCondition(actionDef.condition, ctx)) {
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

    metadata[actionName] = {
      name: actionName,
      prompt: actionDef.prompt,
      help: actionDef.help,
      selections: pickMetas,
    };
  }

  return metadata;
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
  if ((selection as any).onSelect) {
    base.hasOnSelect = true;
  }

  // Type-specific properties (static metadata only)
  switch (selection.type) {
    case 'choice': {
      const choiceSel = selection as any;

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

      // Include multiSelect config only if it's static (not function-based)
      if (choiceSel.multiSelect !== undefined && typeof choiceSel.multiSelect !== 'function') {
        if (typeof choiceSel.multiSelect === 'number') {
          base.multiSelect = { min: 1, max: choiceSel.multiSelect };
        } else {
          base.multiSelect = {
            min: choiceSel.multiSelect.min ?? 1,
            max: choiceSel.multiSelect.max,
          };
        }
      }
      // Note: If multiSelect is a function, it will be evaluated when fetching choices
      break;
    }

    case 'element': {
      const elemSel = selection as any;

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
      const elementsSel = selection as any;

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

      // Include multiSelect config only if it's static (not function-based)
      if (elementsSel.multiSelect !== undefined && typeof elementsSel.multiSelect !== 'function') {
        if (typeof elementsSel.multiSelect === 'number') {
          base.multiSelect = { min: 1, max: elementsSel.multiSelect };
        } else {
          base.multiSelect = {
            min: elementsSel.multiSelect.min ?? 1,
            max: elementsSel.multiSelect.max,
          };
        }
      }
      // Note: If multiSelect is a function, it will be evaluated when fetching choices
      break;
    }

    case 'number': {
      const numSel = selection as any;
      base.min = numSel.min;
      base.max = numSel.max;
      base.integer = numSel.integer;
      break;
    }

    case 'text': {
      const textSel = selection as any;
      base.pattern = textSel.pattern?.source;
      base.minLength = textSel.minLength;
      base.maxLength = textSel.maxLength;
      break;
    }
  }

  return base;
}
