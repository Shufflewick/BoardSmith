import { describe, it, expect } from 'vitest';
import { selectArchetype } from './archetype-selector.js';
import type { Archetype } from './archetype-selector.js';

// ---------------------------------------------------------------------------
// Minimal GameElement interface for test factories (mirrors archetype-selector.ts)
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
// Factory helpers
// ---------------------------------------------------------------------------
function buildElement(attributes: Record<string, unknown> = {}): GameElement {
  return { id: Math.floor(Math.random() * 100000), className: 'Space', attributes, children: [] };
}

function gridElement(): GameElement {
  return buildElement({ $layout: 'grid' });
}

function hexElement(): GameElement {
  return buildElement({ $layout: 'hex-grid' });
}

function cardElement(): GameElement {
  return buildElement({ $type: 'card' });
}

function handElement(): GameElement {
  return buildElement({ $type: 'hand' });
}

function deckElement(): GameElement {
  return buildElement({ $type: 'deck' });
}

function freeFormElement(): GameElement {
  return buildElement({ $layout: 'free-form' });
}

function spaceElement(): GameElement {
  return buildElement({});
}

// ---------------------------------------------------------------------------
// selectArchetype
// ---------------------------------------------------------------------------
describe('selectArchetype', () => {
  it('returns grid-board when a top-level child has $layout=grid', () => {
    const result: Archetype = selectArchetype([gridElement(), cardElement()]);
    expect(result).toBe('grid-board');
  });

  it('returns grid-board when $layout=hex-grid is present, even alongside card elements (guards Pitfall 4 evaluation order)', () => {
    // hex-grid + cards: hex detection must win over card dominance
    const elements = [hexElement(), cardElement(), handElement()];
    const result: Archetype = selectArchetype(elements);
    expect(result).toBe('grid-board');
  });

  it('returns card when >=50% of top-level children have $type card/hand/deck and no grid/hex present', () => {
    // 3 of 4 elements are card-type (75%) — well over the 50% threshold
    const elements = [cardElement(), handElement(), deckElement(), spaceElement()];
    const result: Archetype = selectArchetype(elements);
    expect(result).toBe('card');
  });

  it('returns card for a hand-dominant tree like Go Fish (all hands, no grid)', () => {
    // All 4 elements are hand elements — 100% card-type
    const elements = [handElement(), handElement(), handElement(), handElement()];
    const result: Archetype = selectArchetype(elements);
    expect(result).toBe('card');
  });

  it('returns unsupported when a top-level child has $layout=free-form', () => {
    const elements = [freeFormElement(), spaceElement()];
    const result: Archetype = selectArchetype(elements);
    expect(result).toBe('unsupported');
  });

  it('returns tableau when no grid/hex, not card-dominant, not free-form', () => {
    // 1 of 4 elements is card (25%) — below 50% threshold; others are plain spaces
    const elements = [cardElement(), spaceElement(), spaceElement(), spaceElement()];
    const result: Archetype = selectArchetype(elements);
    expect(result).toBe('tableau');
  });

  it('returns tableau for an empty children array (never throws, never blank-crash)', () => {
    const result: Archetype = selectArchetype([]);
    expect(result).toBe('tableau');
  });
});
