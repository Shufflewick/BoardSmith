/**
 * Shared overlay utilities for annotation-based overlays (TutorialOverlay,
 * HintOverlay, HeatmapOverlay).
 *
 * Extracted from TutorialOverlay.vue so cssEscape and buildSelector are
 * defined once — never copy-pasted across overlay components (RESEARCH
 * anti-pattern / PLAN 107-04 acceptance criterion).
 *
 * Security: buildSelector escapes all dynamic values via cssEscape to prevent
 * attribute-selector injection (T-105-06 / T-107-08 pattern).
 */

import type { AnnotationTarget } from '../../../engine/tutorial/types.js';

// ── CSS.escape polyfill ───────────────────────────────────────────────────────
// jsdom and some environments don't expose CSS.escape. Provide a minimal
// fallback that escapes characters which could break an attribute selector.
// In production browsers CSS.escape is universally available.
export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  // Minimal fallback: escape characters that would break an attribute selector.
  // Covers double-quote and backslash (attribute value terminators) plus null
  // byte, newline, carriage return, and form-feed (CSS string terminators that
  // can appear in programmatically-constructed element names in jsdom tests).
  return value.replace(/[\0\n\r\f"\\]/g, '\\$&');
}

/**
 * Build an attribute selector for an AnnotationTarget, using CSS.escape to
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
        return `[data-bs-el-id="${cssEscape(String(elRef.id))}"]`;
      }
      if (elRef.notation !== undefined) {
        return `[data-bs-el-notation="${cssEscape(elRef.notation)}"]`;
      }
      if (elRef.name !== undefined) {
        return `[data-bs-el-name="${cssEscape(elRef.name)}"]`;
      }
      return '';
    }
    case 'action':
      return `[data-bs-action="${cssEscape(target.actionName)}"]`;
    case 'panel':
      return '[data-bs-panel]';
  }
}
