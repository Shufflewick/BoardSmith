import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { ref } from 'vue';
import { createEnrichment } from './useGameViewEnrichment.js';
import type { GameElement } from '../types.js';
import type { PickMetadata, ValidElement } from './useActionControllerTypes.js';

function buildView(): GameElement {
  return {
    id: 1,
    className: 'Game',
    attributes: {},
    children: [
      { id: 2, className: 'Card', attributes: { rank: 'A' }, children: [] },
      { id: 3, className: 'Card', attributes: { rank: 'K' }, children: [] },
    ],
  };
}

describe('createEnrichment', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    warnSpy.mockClear();
  });

  afterEach(() => {
    warnSpy.mockClear();
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('enriches valid elements with full element data', () => {
    const gameView = ref<GameElement | null>(buildView());
    const currentArgs = ref<Record<string, unknown>>({});
    const { enrichElementsList } = createEnrichment(gameView, currentArgs);

    const elements: ValidElement[] = [{ id: 2, display: 'Ace' }];
    const enriched = enrichElementsList(elements);

    expect(enriched[0].element?.id).toBe(2);
    expect((enriched[0].element?.attributes as { rank?: string }).rank).toBe('A');
  });

  it('warns once for missing element ids', () => {
    const gameView = ref<GameElement | null>(buildView());
    const currentArgs = ref<Record<string, unknown>>({});
    const { enrichElementsList } = createEnrichment(gameView, currentArgs);

    const missing: ValidElement[] = [{ id: 999, display: 'Missing' }];
    enrichElementsList(missing);
    enrichElementsList(missing);

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('enriches dependsOn element sets using current args', () => {
    const gameView = ref<GameElement | null>(buildView());
    const currentArgs = ref<Record<string, unknown>>({ owner: 'p1' });
    const { enrichValidElements } = createEnrichment(gameView, currentArgs);

    const pick: PickMetadata = {
      name: 'card',
      type: 'element',
      dependsOn: 'owner',
      elementsByDependentValue: {
        p1: [{ id: 3, display: 'King' }],
      },
    };

    const enriched = enrichValidElements(pick);
    expect(enriched.validElements?.[0].element?.id).toBe(3);
  });
});
