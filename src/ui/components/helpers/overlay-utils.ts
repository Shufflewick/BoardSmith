/**
 * Shared overlay utilities for annotation-based overlays (TutorialOverlay,
 * HintOverlay, HeatmapOverlay).
 *
 * Extracted from TutorialOverlay.vue so buildSelector is
 * defined once — never copy-pasted across overlay components (RESEARCH
 * anti-pattern / PLAN 107-04 acceptance criterion).
 *
 * Security: buildSelector escapes all dynamic values via escapeCssString to prevent
 * attribute-selector injection (T-105-06 / T-107-08 pattern).
 */

import type { AnnotationTarget } from '../../../engine/tutorial/types.js';
import { escapeCssString } from '../../utils/css-string.js';

// One empty list for every push with nothing to show: a fresh [] would change
// the overlay's computed and rerun its measuring on every push (#748).
export const NOTHING_TO_SHOW: readonly never[] = Object.freeze([]);

/**
 * Build an attribute selector for an AnnotationTarget, using escapeCssString to
 * prevent attribute-selector injection.
 *
 * Precedence for 'element' targets: id > notation > name (mirrors matchesRef
 * in useBoardInteraction — both must agree for parity).
 *
 * Returns an empty string when no matching field is present (caller must guard
 * against empty-string selectors to avoid querying all elements).
 */
export function buildSelector(target: AnnotationTarget): string {
  switch (target.kind) {
    case 'element': {
      const { ref: elRef } = target;
      if (elRef.id !== undefined) {
        return `[data-bs-el-id="${escapeCssString(String(elRef.id))}"]`;
      }
      if (elRef.notation !== undefined) {
        return `[data-bs-el-notation="${escapeCssString(elRef.notation)}"]`;
      }
      if (elRef.name !== undefined) {
        return `[data-bs-el-name="${escapeCssString(elRef.name)}"]`;
      }
      return '';
    }
    case 'action':
      return `[data-bs-action="${escapeCssString(target.actionName)}"]`;
    case 'panel':
      return '[data-bs-panel]';
  }
}
