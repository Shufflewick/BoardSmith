/**
 * archetype-selector — Introspection-based archetype selection for auto-UI.
 *
 * Pure module: no Vue reactivity, no DOM access, no engine imports.
 *
 * Topology-ranked selection (D-02):
 *   1. Grid/Hex board present  → 'grid-board'   (highest priority — Pitfall 4)
 *   2. Card/hand/deck dominant → 'card'          (≥50% of top-level children)
 *   3. Free-form layout        → 'unsupported'   (honest-fail boundary — RENDER-04)
 *   4. Otherwise               → 'tableau'       (general container fallback)
 *
 * Critical invariant: grid/hex detection always runs FIRST, before card-dominance
 * is checked. A game with both a Grid and Card elements above it must classify as
 * 'grid-board' (see Research Pitfall 4).
 */

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
// Archetype
// ---------------------------------------------------------------------------
export type Archetype = 'grid-board' | 'card' | 'tableau' | 'unsupported';

// ---------------------------------------------------------------------------
// selectArchetype
// ---------------------------------------------------------------------------
/**
 * Inspect the top-level children of a game view root and return an archetype.
 *
 * @param topLevelElements - The direct children of the game view root element.
 * @returns The archetype identifier that best describes this game's visual topology.
 */
export function selectArchetype(topLevelElements: GameElement[]): Archetype {
  // 1. Grid or hex board present → grid-board (highest priority — D-02, Pitfall 4)
  const hasGridOrHex = topLevelElements.some(
    (el) =>
      el.attributes?.$layout === 'grid' || el.attributes?.$layout === 'hex-grid',
  );
  if (hasGridOrHex) return 'grid-board';

  // 2. Dominant card/hand/deck zones → card
  //    Threshold: card-type count > 0 AND count >= half of all top-level elements
  const cardTypes = new Set(['card', 'hand', 'deck']);
  const cardCount = topLevelElements.filter(
    (el) => cardTypes.has(el.attributes?.$type as string),
  ).length;
  if (cardCount > 0 && cardCount >= topLevelElements.length / 2) return 'card';

  // 3. Free-form layout (unaddressable by closed-form math) → unsupported
  //    Honest-fail boundary: never degrade silently (RENDER-04, D-02)
  const hasFreeForm = topLevelElements.some(
    (el) => el.attributes?.$layout === 'free-form',
  );
  if (hasFreeForm) return 'unsupported';

  // 4. General containers → tableau (always matches; never throws on empty array)
  return 'tableau';
}
