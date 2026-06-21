/**
 * renderer-registry — Ranked-tester registry for auto-UI element rendering.
 *
 * Pure module: no Vue reactivity, no DOM access.
 * Built-in renderers register at module load; consumer registers higher-priority
 * entries via registerRenderer() to upgrade auto-UI in place.
 *
 * Priority bands (D-03 — ranked-tester registry, JSONForms rankWith pattern):
 *   1–10   : built-in element renderers (card, hand, deck, die, grid, hex, piece, space)
 *   11–99  : reserved for future built-in specializations
 *   100+   : consumer overrides (registered by game authors to upgrade auto-UI in place)
 *
 * test() returns:
 *   -1     : this entry does not apply to the given element (skip)
 *   > 0    : this entry applies; higher values win
 *
 * Pit-of-Success mitigation (T-93-01):
 *   Each test() call is wrapped in try/catch. A throwing consumer test is treated as -1
 *   and console.warn'd — one bad consumer renderer never blanks the whole board.
 */

import type { Component } from 'vue';

// ---------------------------------------------------------------------------
// Local GameElement interface — do NOT import from engine (module is dependency-free)
// Mirrors auto-ui-helpers.ts lines 12-19.
// ---------------------------------------------------------------------------
interface GameElement {
  id: number;
  name?: string;
  className: string;
  attributes?: Record<string, unknown>;
  children?: GameElement[];
  childCount?: number;
}

// ---------------------------------------------------------------------------
// RendererEntry
// ---------------------------------------------------------------------------
export interface RendererEntry {
  /** Return -1 if this renderer does not apply; return a positive integer priority otherwise. */
  test: (element: GameElement) => number;
  /** The Vue component to render for matching elements. */
  component: Component;
}

// ---------------------------------------------------------------------------
// Module-level singleton registry
// ---------------------------------------------------------------------------
const registry: RendererEntry[] = [];

// ---------------------------------------------------------------------------
// registerRenderer
// ---------------------------------------------------------------------------
/**
 * Register a renderer entry in the global auto-UI registry.
 *
 * Built-in renderers register at priority 1–10.
 * Consumer overrides register at 100+ to upgrade auto-UI in place.
 */
export function registerRenderer(entry: RendererEntry): void {
  registry.push(entry);
}

// ---------------------------------------------------------------------------
// resolveRenderer
// ---------------------------------------------------------------------------
/**
 * Resolve the highest-priority registered component for the given element.
 *
 * Returns null when:
 * - The registry is empty, or
 * - All entries return -1 (or throw) for this element.
 *
 * A test() that throws is treated as -1 and logged via console.warn.
 * It never breaks dispatch for other elements.
 */
export function resolveRenderer(element: GameElement): Component | null {
  let bestPriority = -1;
  let bestComponent: Component | null = null;

  for (const entry of registry) {
    let priority: number;
    try {
      priority = entry.test(element);
    } catch (err) {
      console.warn(
        '[renderer-registry] A registered renderer test() threw an error and was skipped.',
        err,
      );
      priority = -1;
    }

    if (priority > bestPriority) {
      bestPriority = priority;
      bestComponent = entry.component;
    }
  }

  return bestComponent;
}

// ---------------------------------------------------------------------------
// resetRegistry (test-only helper)
// ---------------------------------------------------------------------------
/**
 * Clear the registry. For use in test beforeEach only — never call in production.
 * @internal
 */
export function resetRegistry(): void {
  registry.length = 0;
}
