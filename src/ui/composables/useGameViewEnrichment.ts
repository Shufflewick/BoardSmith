/**
 * Element enrichment utilities for useActionController.
 *
 * These functions add full element data from gameView to selection validElements,
 * enabling the "pit of success" pattern where designers automatically get full
 * element data when working with element selections.
 */

import type { Ref } from 'vue';
import type { GameElement } from '../types.js';
import type { ValidElement, PickMetadata } from './useActionControllerTypes.js';

/**
 * Create enrichment functions bound to a gameView and currentArgs.
 *
 * @param gameView - Reactive reference to the game view element tree
 * @param currentArgs - Reactive reference to current action arguments (for dependsOn lookups)
 * @returns Object with enrichment functions
 */
export function createEnrichment(
  gameView: Ref<GameElement | null | undefined> | undefined,
  currentArgs: Ref<Record<string, unknown>>
) {
  // Track which element IDs we've already warned about (to avoid spam)
  const warnedMissingElements = new Set<number>();
  let indexedRoot: GameElement | null | undefined;
  let elementIndex = new Map<number, GameElement>();

  function buildElementIndex(root: GameElement | null | undefined): Map<number, GameElement> {
    if (!root) return new Map<number, GameElement>();
    if (root === indexedRoot) return elementIndex;

    const index = new Map<number, GameElement>();
    const stack: GameElement[] = [root];
    while (stack.length > 0) {
      const element = stack.pop()!;
      index.set(element.id, element);
      if (element.children?.length) {
        for (const child of element.children) {
          stack.push(child);
        }
      }
    }

    indexedRoot = root;
    elementIndex = index;
    return elementIndex;
  }

  /**
   * Enrich a list of valid elements with full element data from gameView.
   * When elements are found, they're attached as the `element` property.
   */
  function enrichElementsList(elements: ValidElement[]): ValidElement[] {
    const root = gameView?.value;
    if (!root) return elements;
    const index = buildElementIndex(root);

    return elements.map(ve => {
      const element = index.get(ve.id);

      // Warning: element not found in gameView (only warn once per element)
      if (!element && !warnedMissingElements.has(ve.id)) {
        warnedMissingElements.add(ve.id);
        console.warn(
          `[actionController] Element ${ve.id} (${ve.display}) not found in gameView. ` +
          `This can happen if the element was removed after selection metadata was built.`
        );
      }

      return { ...ve, element };
    });
  }

  /**
   * Enrich a pick's validElements with full element data from gameView.
   * This is the "pit of success" - designers get full element data automatically.
   * Handles both static validElements and dependent elementsByDependentValue.
   */
  function enrichValidElements(sel: PickMetadata): PickMetadata {
    if (!gameView?.value) return sel;

    // Handle elementsByDependentValue (for element selections with dependsOn)
    if (sel.dependsOn && sel.elementsByDependentValue) {
      const dependentValue = currentArgs.value[sel.dependsOn];
      if (dependentValue !== undefined) {
        const key = String(dependentValue);
        const elements = sel.elementsByDependentValue[key] || [];
        const enrichedElements = enrichElementsList(elements);

        return {
          ...sel,
          validElements: enrichedElements,
        };
      }
      // Dependent value not set yet - return with empty validElements
      return { ...sel, validElements: [] };
    }

    // Handle static validElements
    if (!sel.validElements) return sel;

    const enrichedElements = enrichElementsList(sel.validElements);

    return {
      ...sel,
      validElements: enrichedElements,
    };
  }

  return {
    enrichElementsList,
    enrichValidElements,
  };
}
