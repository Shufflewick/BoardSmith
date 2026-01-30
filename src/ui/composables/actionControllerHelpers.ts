/**
 * Pure helper functions for useActionController.
 *
 * These are stateless utility functions extracted to reduce the main composable size.
 * They handle development warnings, value display extraction, and action analysis.
 */

import type { ActionMetadata, PickMetadata } from './useActionControllerTypes.js';
import { isDevMode, devWarn } from '../../utils/dev.js';

// Re-export for backwards compatibility during transition
export { isDevMode, devWarn };

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
