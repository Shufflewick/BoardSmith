/**
 * builtin-renderers — Module-load registration of the eight built-in element renderers.
 *
 * Side-effect module: importing this file registers all built-in renderers in the
 * renderer-registry singleton. AutoRenderer.vue imports it as a side-effect so
 * registration runs exactly once when the auto-UI module loads.
 *
 * Priority band 1–10 (D-03): built-in renderers occupy this band.
 * Consumer overrides must register at 100+ to win over built-ins.
 *
 * test() functions are derived from the elementType detection logic (card/$type, die/$type, grid/$layout, etc.).
 * Ordering: specific types (card/hand/deck/die/grid/hex) first at higher priorities;
 * piece (leaf node) second at priority 2; space (catch-all) last at priority 1.
 *
 * NOTE: test() has no access to `depth` — depth-dependent detection (grid-cell, hex-cell)
 * is handled internally by GridBoardRenderer and HexBoardRenderer, not top-level registry.
 */

import { registerRenderer } from './renderer-registry.js';
import CardRenderer from './renderers/CardRenderer.vue';
import HandRenderer from './renderers/HandRenderer.vue';
import DeckRenderer from './renderers/DeckRenderer.vue';
import DieRenderer from './renderers/DieRenderer.vue';
import GridBoardRenderer from './renderers/GridBoardRenderer.vue';
import HexBoardRenderer from './renderers/HexBoardRenderer.vue';
import PieceRenderer from './renderers/PieceRenderer.vue';
import SpaceRenderer from './renderers/SpaceRenderer.vue';

// ---------------------------------------------------------------------------
// CardRenderer — $type === 'card'  (priority 10 — most specific)
// ---------------------------------------------------------------------------
registerRenderer({
  test: (element) => (element.attributes?.$type === 'card' ? 10 : -1),
  component: CardRenderer,
});

// ---------------------------------------------------------------------------
// HandRenderer — $type === 'hand'  (priority 9)
// ---------------------------------------------------------------------------
registerRenderer({
  test: (element) => (element.attributes?.$type === 'hand' ? 9 : -1),
  component: HandRenderer,
});

// ---------------------------------------------------------------------------
// DeckRenderer — $type === 'deck'  (priority 8)
// ---------------------------------------------------------------------------
registerRenderer({
  test: (element) => (element.attributes?.$type === 'deck' ? 8 : -1),
  component: DeckRenderer,
});

// ---------------------------------------------------------------------------
// DieRenderer — $type === 'die'  (priority 7)
// ---------------------------------------------------------------------------
registerRenderer({
  test: (element) => (element.attributes?.$type === 'die' ? 7 : -1),
  component: DieRenderer,
});

// ---------------------------------------------------------------------------
// GridBoardRenderer — $layout === 'grid'  (priority 6)
// ---------------------------------------------------------------------------
registerRenderer({
  test: (element) => (element.attributes?.$layout === 'grid' ? 6 : -1),
  component: GridBoardRenderer,
});

// ---------------------------------------------------------------------------
// HexBoardRenderer — $layout === 'hex-grid'  (priority 5)
// ---------------------------------------------------------------------------
registerRenderer({
  test: (element) => (element.attributes?.$layout === 'hex-grid' ? 5 : -1),
  component: HexBoardRenderer,
});

// ---------------------------------------------------------------------------
// PieceRenderer — leaf node (no children, no specific $type/$layout)  (priority 2)
// Elements that have no children and no recognised type/layout marker are pieces.
// Specific-type tests above fire at higher priorities so cards-in-hands etc. resolve first.
// ---------------------------------------------------------------------------
registerRenderer({
  test: (element) => {
    // Skip if a recognised $type is set (handled above at higher priorities)
    const t = element.attributes?.$type as string | undefined;
    if (t === 'card' || t === 'hand' || t === 'deck' || t === 'die') return -1;
    // Skip if a board $layout is set
    const l = element.attributes?.$layout as string | undefined;
    if (l === 'grid' || l === 'hex-grid') return -1;
    // Leaf nodes with no children are pieces
    if (!element.children?.length) return 2;
    return -1;
  },
  component: PieceRenderer,
});

// ---------------------------------------------------------------------------
// SpaceRenderer — generic container / catch-all  (priority 1 — lowest)
// Any element that no other renderer claims becomes a Space.
// Always returns 1 so it loses to any specific renderer returning >1.
// ---------------------------------------------------------------------------
registerRenderer({
  test: () => 1,
  component: SpaceRenderer,
});
