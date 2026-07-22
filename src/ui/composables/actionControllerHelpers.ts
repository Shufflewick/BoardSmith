/**
 * Pure helper functions for useActionController.
 *
 * These are stateless utility functions extracted to reduce the main composable size.
 * They handle development warnings, value display extraction, and action analysis.
 */

import type { ActionMetadata, PickMetadata, PickSnapshot } from './useActionControllerTypes.js';
import { isDevMode, devWarn } from '../../utils/dev.js';

// Re-export for backwards compatibility during transition
export { isDevMode, devWarn };

// ============================================
// MultiSelect Resolution (Pit of Success — single source of truth)
// ============================================

/**
 * Resolve the EFFECTIVE multiSelect config for a selection — the one shared
 * helper `useActionController` (fill/toggleMultiSelect), `ActionPanel.vue`,
 * and `useBoardActionBridge.ts` all call, so the panel and custom UIs can
 * never disagree (mirrors the engine-side AI-01/D9 guarantee that
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
 *    `PickMetadata` was resolved once at `buildActionMetadata()` time with
 *    `knownArgs: {}`, so it's stale for anything but the very first step.
 *    A snapshot entry (even one whose `multiSelect` is `undefined`) means
 *    the server has already answered for THIS state — trust it.
 * 3. The static `selection.multiSelect` from metadata — fallback for when
 *    no snapshot has been fetched yet (e.g. `execute()` / tests that skip
 *    the fetch round-trip).
 */
export function resolveMultiSelectConfig(
  selection: PickMetadata,
  currentArgs: Record<string, unknown>,
  pickSnapshot?: PickSnapshot
): { min?: number; max?: number } | undefined {
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

// ============================================
// Value Display Extraction
// ============================================

/**
 * Extract a display string from a value.
 * Handles objects with display/name properties (e.g., followUp context args).
 *
 * Priority:
 * 1. `display` property (explicit display text)
 * 2. `name` property (common for elements/entities)
 * 3. `value` property if primitive
 * 4. String conversion fallback
 *
 * @param value - Any value to extract display from
 * @returns Display string for the value
 */
export function getDisplayFromValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'object') return String(value);

  const obj = value as Record<string, unknown>;
  // Priority 1: display property
  if (typeof obj.display === 'string') return obj.display;
  // Priority 2: name property (common for elements/entities)
  if (typeof obj.name === 'string') return obj.name;
  // Priority 3: primitive value property
  if (obj.value !== undefined && typeof obj.value !== 'object') return String(obj.value);
  // Fallback
  return String(value);
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
  meta: ActionMetadata | undefined,
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
