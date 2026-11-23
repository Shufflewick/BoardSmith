/**
 * Pure helper functions for useActionController.
 *
 * These are stateless utility functions extracted to reduce the main composable size.
 * They handle development warnings, value display extraction, and action analysis.
 */

import type { ActionStateSnapshot, EnrichedActionMetadata, ChoiceWithRefs, ElementRef, EnrichedPickMetadata, PickSnapshot, RefWithRole } from './useActionControllerTypes.js';
import { choiceValueKey, findMatchingChoice, labelOfValue, valuesEqual } from '../../engine/action/choice-matching.js';
import { numberRuleErrors } from '../../engine/action/number-rules.js';
import { textPickRefusal } from '../../engine/action/text-rules.js';
import type { MultiSelectBounds } from '../../types/protocol.js';

// ============================================
// MultiSelect Resolution (Pit of Success — single source of truth)
// ============================================

/**
 * The entry that is copy `copy` of a value offered more than once (#1561, #1574):
 * copies count the enabled entries first, then the disabled ones.
 */
export function copyOfChoice<C extends { value: unknown; disabled?: unknown }>(choices: readonly C[], value: unknown, copy: number): C | undefined {
  const same = choices.filter(c => valuesEqual(c.value, value));
  return [...same.filter(c => !c.disabled), ...same.filter(c => c.disabled)][copy];
}

/**
 * Which copy of its value each choice is, index for index: a value offered N times
 * is N multiSelect slots (#1561), counted as `copyOfChoice` counts them, enabled entries first.
 */
export function choiceCopies(choices: readonly { value: unknown; disabled?: string | false }[]): number[] {
  const copies: number[] = [];
  const seen = new Map<string, number>();
  for (const closed of [false, true]) {
    choices.forEach((choice, i) => {
      if (!!choice.disabled !== closed) return;
      const key = choiceValueKey(choice.value);
      copies[i] = seen.get(key) ?? 0;
      seen.set(key, copies[i] + 1);
    });
  }
  return copies;
}

/** Whether a multiSelect's last tick sends it, with no Done drawn: a fixed count above 0 that does not ask to confirm (#1568, #1789). */
export function sendsOnLastTick(bounds: MultiSelectBounds): boolean {
  return bounds.min === bounds.max && bounds.max !== 0 && bounds.confirm !== true;
}

/**
 * Resolve the EFFECTIVE multiSelect config for a selection — the one shared
 * helper `useActionController` (fill/toggleMultiSelect), `ActionPanel.vue`,
 * and `useBoardActionBridge.ts` all call, so the panel and custom UIs can
 * never disagree (mirrors the engine-side bot-01/D9 guarantee that
 * `resolveMultiSelect` gives enumeration and metadata).
 *
 * Resolution order:
 * 1. `dependsOn` + `multiSelectByDependentValue` — an explicitly declared
 *    dependent config, looked up from the current value of the dependent
 *    selection. Purely client-side; already correct.
 * 2. The fetched `pickSnapshot.multiSelect` — resolved server-side by
 *    `PickHandler.getPickChoices()` against the REAL accumulated
 *    `currentArgs` for this selection step (v4.8-WR01). This is what a
 *    *function-valued* `multiSelect` that reads an earlier sibling
 *    selection's value must use — the static `selection.multiSelect` on
 *    `EnrichedPickMetadata` was resolved once at `buildActionMetadata()` time with
 *    `knownArgs: {}`, so it's stale for anything but the very first step.
 *    A snapshot entry (even one whose `multiSelect` is `undefined`) means
 *    the server has already answered for THIS state — trust it.
 * 3. The static `selection.multiSelect` from metadata — fallback for when
 *    no snapshot has been fetched yet (e.g. `execute()` / tests that skip
 *    the fetch round-trip).
 */
export function resolveMultiSelectConfig(
  selection: EnrichedPickMetadata,
  currentArgs: Record<string, unknown>,
  pickSnapshot?: PickSnapshot
): MultiSelectBounds | undefined {
  if (selection.dependsOn && selection.multiSelectByDependentValue) {
    const depValue = currentArgs[selection.dependsOn];
    if (depValue !== undefined) {
      return selection.multiSelectByDependentValue[String(depValue)];
    }
    return undefined;
  }

  if (pickSnapshot) {
    return pickSnapshot.multiSelect;
  }

  return selection.multiSelect;
}

/**
 * Resolve the EFFECTIVE ordered-list bounds for a selection (#249) — the
 * repeatable sibling of {@link resolveMultiSelectConfig}, and the one helper
 * `useActionController`, `ActionPanel.vue` and `useBoardActionBridge.ts` all
 * call, so the panel and a custom board can never disagree about how many
 * entries a list still has room for.
 *
 * Resolution order is the same as multiSelect's, minus the dependent-value map:
 * a world action cannot declare `dependsOn` at all, and a table action that
 * wants a per-dependent-value bound writes the function form, which the server
 * resolves per step.
 *
 * 1. The fetched `pickSnapshot.orderedList` — resolved by
 *    `PickHandler.getPickChoices()` against the REAL accumulated args for this
 *    step, which is the only thing that knows a bound reading an earlier pick.
 * 2. The static `selection.orderedList` from metadata — for before any snapshot
 *    has been fetched (`execute()`, tests that skip the round-trip).
 */
export function resolveOrderedListConfig(
  selection: EnrichedPickMetadata,
  pickSnapshot?: PickSnapshot
): { min: number; max?: number } | undefined {
  if (pickSnapshot?.orderedList) return pickSnapshot.orderedList;
  return selection.orderedList;
}

/**
 * BOTH COUNT SHAPES A CHOICE PICK CAN CARRY, resolved for the current step.
 *
 * A pick is a set (`multiSelect`) or a sequence (`orderedList`, #249) or neither,
 * and the two surfaces that have to agree about which -- the Action Panel and a
 * custom board through `useBoardActionBridge` -- resolved them in two copies of
 * the same four lines each. One function, so the same click can never mean
 * "toggle" on one surface and "append" on the other.
 */
export function resolvePickCounts(
  selection: EnrichedPickMetadata | null | undefined,
  currentArgs: Record<string, unknown>,
  pickSnapshots?: Map<string, PickSnapshot>
): {
  multiSelect?: MultiSelectBounds;
  orderedList?: { min: number; max?: number };
} {
  if (!selection) return {};
  // The snapshot LOOKUP is in here too, and not at the two call sites, because
  // that lookup is the other half of the same rule: the fetched entry for THIS
  // selection is what makes a function-valued bound truthful.
  const pickSnapshot = pickSnapshots?.get(selection.name);
  return {
    multiSelect: resolveMultiSelectConfig(selection, currentArgs, pickSnapshot),
    orderedList: resolveOrderedListConfig(selection, pickSnapshot),
  };
}

/**
 * Why a multiSelect at its max cannot take one more value, or `undefined` when it
 * can. A held value is never blocked: deselecting is always allowed. The panel,
 * the board and the controller all read this, so their limits cannot drift (#1688).
 */
export function multiSelectFullReason(max: number | undefined, count: number, held: boolean): string | undefined {
  if (max === undefined || held || count < max) return undefined;
  return max === 1
    ? 'You can pick only one — deselect the other first.'
    : `You have already picked ${max}. Deselect one to change your mind.`;
}

/**
 * Why a full ordered list cannot take another entry, or `undefined` when it can.
 * Unlike a full multiSelect this blocks every option, since adding is never a deselect (#1688).
 */
export function orderedListFullReason(max: number | undefined, count: number): string | undefined {
  if (max === undefined || count < max) return undefined;
  return max === 1
    ? 'The list holds one entry. Remove it to choose differently.'
    : `The list is full at ${max} entries. Remove one to add another.`;
}

// ============================================
// Board target of a choice
// ============================================

/**
 * The board element a choice is picked by: its `target` ref, else its first ref.
 *
 * One rule for the two places that need it. The board bridge routes a click on
 * this element to the choice, and the Action Panel hands a large choice pick to
 * the board only when every candidate has a distinct one (#313). If they read
 * different refs, the panel could send a player to a board that cannot reach
 * what the panel stopped listing.
 */
export function choiceBoardTarget(choice: ChoiceWithRefs): ElementRef | undefined {
  const refs = choice.refs ?? [];
  return refs.find(r => r.role === 'target')?.ref ?? refs[0]?.ref;
}

/** A choice's refs split for the board highlight: 'target' and 'highlight' both draw on the target side. */
export function refsHighlight(refs: readonly RefWithRole[]): { sourceRefs: ElementRef[]; targetRefs: ElementRef[] } {
  return {
    sourceRefs: refs.filter(r => r.role === 'source').map(r => r.ref),
    targetRefs: refs.filter(r => r.role !== 'source').map(r => r.ref),
  };
}

/** The board element a choice answer marks, by the rule fill() matches the value with, or undefined. */
export function answerMark(value: unknown, offered: readonly ChoiceWithRefs[]): ElementRef | undefined {
  const chosen = findMatchingChoice(value, offered);
  return chosen && choiceBoardTarget(chosen);
}

// ============================================
// Value Display Extraction
// ============================================

/**
 * The label for a pick value the client holds without its choice (a follow-up's
 * or a prefill's arg): the server's own rule ({@link labelOfValue}), so the
 * breadcrumb reads what the button did. A missing value reads as nothing.
 */
export function getDisplayFromValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return labelOfValue(value);
}

/**
 * The label a pick the client holds reads as: the label of the offered choice
 * it equals, else {@link getDisplayFromValue}. The controller and the Action
 * Panel both label held picks with it, so a breadcrumb, a repeated pick's
 * entry and an ordered list's entry read as the button that made them (#509).
 * Equality is structural, because a custom UI's copy of an object value is
 * never the offered object itself.
 */
export function labelOfPick(
  value: unknown,
  choices: readonly { value: unknown; display: string }[],
): string {
  const choice = choices.find((c) => valuesEqual(c.value, value));
  return choice ? choice.display : getDisplayFromValue(value);
}

/**
 * An action's name as a fallback prompt: `playCard` reads as `Play Card`, and
 * an acronym or a digit stays with its word, `drawUSB` as `Draw USB` (#1298).
 */
export function formatActionName(name: string): string {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/^./, str => str.toUpperCase());
}

/**
 * Each available action's metadata, with a minimal entry synthesized for an
 * action that has none, so the Action Panel and a custom UI list the same actions.
 */
export function availableActionMetadata(
  names: readonly string[],
  metadata: Record<string, EnrichedActionMetadata> | undefined,
): EnrichedActionMetadata[] {
  return names.map((name) => metadata?.[name] ?? { name, prompt: formatActionName(name), selections: [] as EnrichedPickMetadata[] });
}

/**
 * The metadata frozen when `actionName` started, if the snapshot is that
 * action's: a follow-up the step does not list, or an action that left the
 * available actions mid-build, still has it.
 */
export function snapshotMetadata(actionName: string, snapshot: ActionStateSnapshot | null | undefined): EnrichedActionMetadata | undefined {
  return snapshot?.actionName === actionName ? snapshot.metadata : undefined;
}

// ============================================
// Action Analysis (Pit of Success)
// ============================================

/**
 * Result from checking if an action needs wizard mode.
 */
export interface WizardModeCheck {
  /** Whether wizard mode is needed */
  needed: boolean;
  /** Human-readable explanation of why wizard mode is needed */
  reason?: string;
  /** The selection that requires wizard mode */
  selectionName?: string;
}

/**
 * Check if an action needs wizard mode (start()) vs direct execution (execute()).
 *
 * This helps developers choose the right method:
 * - execute(): Use when you have all parameter values upfront
 * - start(): Use when the user needs to make selections interactively
 *
 * @param meta - Action metadata (from actionController.getActionMetadata())
 * @param providedArgs - Arguments already provided to execute()
 * @returns Analysis of whether wizard mode is needed and why
 *
 * @example
 * ```typescript
 * const check = actionNeedsWizardMode(meta, { target: unitId });
 * if (check.needed) {
 *   console.log(check.reason);  // "Selection 'destination' requires element selection..."
 *   actionController.start('move');  // Use wizard mode instead
 * }
 * ```
 */
export function actionNeedsWizardMode(
  meta: EnrichedActionMetadata | undefined,
  providedArgs: Record<string, unknown>
): WizardModeCheck {
  if (!meta) return { needed: false };

  for (const sel of meta.selections) {
    // Skip if value already provided
    if (providedArgs[sel.name] !== undefined) continue;

    // Skip optional selections - user can skip them
    if (sel.optional) continue;

    // Element selections almost always need server-side choice fetching
    if (sel.type === 'element' || sel.type === 'elements') {
      return {
        needed: true,
        reason: `Selection "${sel.name}" requires element selection from the game board`,
        selectionName: sel.name,
      };
    }

    // Dependent selections need prior selections to be made first
    if (sel.dependsOn && providedArgs[sel.dependsOn] === undefined) {
      return {
        needed: true,
        reason: `Selection "${sel.name}" depends on "${sel.dependsOn}" which must be selected first`,
        selectionName: sel.name,
      };
    }

    // Dynamic choices (no static choices, uses dependent value lookup)
    if (!sel.choices && (sel.choicesByDependentValue || sel.elementsByDependentValue)) {
      return {
        needed: true,
        reason: `Selection "${sel.name}" has dynamic choices that require server interaction`,
        selectionName: sel.name,
      };
    }
  }

  return { needed: false };
}

/**
 * Why a client refuses `value` for a typed pick (text or number), or null.
 *
 * The one check the Action Panel's editor and `controller.fill` both make, so a
 * custom UI is refused what the panel is refused, in the engine's words (#1057).
 */
export function editorRuleRefusal(pick: EnrichedPickMetadata, value: unknown): string | null {
  if (pick.type === 'text') return textPickRefusal(pick, value);
  if (pick.type === 'number') return numberRuleErrors(pick.name, value, pick)[0] ?? null;
  return null;
}
