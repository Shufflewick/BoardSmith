/**
 * presentation — Pure module for per-UI presentation overlay resolution.
 *
 * Pure module: no Vue reactivity, no DOM access.
 * Only import is `type Component` from 'vue' — no runtime vue import.
 * Local element interface — never import from engine (module is dependency-free).
 *
 * Precedence: byName > byClass > byAttribute (first match wins, no field merging).
 * SECURITY (PRESENT-02): __hidden elements have image and stats stripped.
 * The renderer must route through resolvePresentation — never index overlay maps directly.
 */

import type { Component } from 'vue';

// ---------------------------------------------------------------------------
// Local element interface — do NOT import from engine
// Mirrors the minimal shape needed for presentation resolution.
// ---------------------------------------------------------------------------
interface ElementForPresentation {
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  __hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface PresentationEntry {
  /** URL for the element's face image. Ignored when element.__hidden === true. */
  image?: string;
  /** Override display label. Safe to show on hidden elements (generic, not identity-bearing). */
  label?: string;
  /** Stats block to display. Ignored when element.__hidden === true. */
  stats?: Record<string, unknown>;
  /** Custom Vue component for full render override. Author's responsibility for hidden safety. */
  render?: Component;
}

export interface PresentationOverlay {
  /** Keyed by element.className. Lowest precedence. */
  byClass?: Record<string, PresentationEntry>;
  /** Keyed by element.name. Highest precedence. */
  byName?: Record<string, PresentationEntry>;
  /** Keyed by attribute key → attribute value → entry. Middle precedence. */
  byAttribute?: Record<string, Record<string, PresentationEntry>>;
}

// ---------------------------------------------------------------------------
// resolvePresentation
// ---------------------------------------------------------------------------

/**
 * Resolve the presentation entry for a given element.
 *
 * Precedence: byName > byClass > byAttribute (first match wins, no field merging).
 * Returns null when overlay is undefined or no key matches.
 *
 * SECURITY (PRESENT-02): When element.__hidden is true, strips `image` and `stats`
 * from the resolved entry — only `label` and `render` are safe to expose for hidden
 * elements. This prevents the overlay from re-introducing visual cues (face images,
 * stat values) that Phase 91's toJSONForPlayer redacted.
 *
 * Renderers MUST route through this function and never index overlay maps directly
 * (doing so would bypass the __hidden guard).
 */
export function resolvePresentation(
  element: ElementForPresentation,
  overlay: PresentationOverlay | undefined,
): PresentationEntry | null {
  if (!overlay) return null;

  let entry: PresentationEntry | null = null;

  // byName — highest precedence
  if (element.name && overlay.byName?.[element.name]) {
    entry = overlay.byName[element.name];
  // byClass — middle precedence
  } else if (overlay.byClass?.[element.className]) {
    entry = overlay.byClass[element.className];
  // byAttribute — lowest precedence, first matching key/value wins
  } else if (overlay.byAttribute) {
    for (const [attrKey, valueMap] of Object.entries(overlay.byAttribute)) {
      const attrVal = String(element.attributes?.[attrKey] ?? '');
      if (valueMap[attrVal]) {
        entry = valueMap[attrVal];
        break;
      }
    }
  }

  if (!entry) return null;

  // PRESENT-02: guard — hidden elements must not receive identity-bearing overlay fields
  // image and stats could encode card identity; label is safe (generic); render is
  // author's explicit responsibility.
  if (element.__hidden) {
    return { label: entry.label, render: entry.render };
  }

  return entry;
}
