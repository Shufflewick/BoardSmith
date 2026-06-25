// @vitest-environment jsdom
/**
 * anchorAttrs — single-source anchor attribute helper (105-02 structural-parity)
 *
 * Tests:
 *   - anchorAttrs returns exactly the present-key subset for each ref shape
 *   - useSelectable.attrs includes data-bs-el-* keys for its identity
 *   - useSelectableGrid returns cellAttrs that returns data-bs-el-* keys
 *   - Negative guard: attribute names exist only in anchorAttrs (single source)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computed } from 'vue';
import { anchorAttrs } from './useBoardInteraction.js';
import { useSelectable, useSelectableGrid } from './useSelectable.js';
import type { BoardInteraction } from './useBoardInteraction.js';

function makeMockInteraction(): Pick<BoardInteraction, 'triggerElementSelect'> {
  return {
    triggerElementSelect: () => {},
  };
}

// ---------------------------------------------------------------------------
// anchorAttrs — unit
// ---------------------------------------------------------------------------

describe('anchorAttrs', () => {
  it('id-only ref emits only data-bs-el-id', () => {
    const attrs = anchorAttrs({ id: 5 });
    expect(attrs).toEqual({ 'data-bs-el-id': '5' });
  });

  it('notation-only ref emits only data-bs-el-notation', () => {
    const attrs = anchorAttrs({ notation: 'd4' });
    expect(attrs).toEqual({ 'data-bs-el-notation': 'd4' });
  });

  it('name-only ref emits only data-bs-el-name', () => {
    const attrs = anchorAttrs({ name: 'Militia' });
    expect(attrs).toEqual({ 'data-bs-el-name': 'Militia' });
  });

  it('all-three ref emits all three present keys', () => {
    const attrs = anchorAttrs({ id: 5, notation: 'd4', name: 'Militia' });
    expect(attrs).toEqual({
      'data-bs-el-id': '5',
      'data-bs-el-notation': 'd4',
      'data-bs-el-name': 'Militia',
    });
  });

  it('empty ref emits no keys', () => {
    const attrs = anchorAttrs({});
    expect(Object.keys(attrs)).toHaveLength(0);
  });

  it('undefined keys are omitted (partial ref)', () => {
    const attrs = anchorAttrs({ id: 7, name: undefined });
    expect(attrs).toEqual({ 'data-bs-el-id': '7' });
    expect('data-bs-el-name' in attrs).toBe(false);
  });

  it('id value is String()-coerced to string', () => {
    const attrs = anchorAttrs({ id: 42 });
    expect(typeof attrs['data-bs-el-id']).toBe('string');
    expect(attrs['data-bs-el-id']).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// useSelectable.attrs — includes anchor keys
// ---------------------------------------------------------------------------

describe('useSelectable.attrs includes anchorAttrs keys', () => {
  it('attrs contains data-bs-el-id when identity has id', () => {
    const bi = makeMockInteraction();
    const { attrs } = useSelectable(
      () => ({ id: 10 }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => false),
    );
    expect(attrs.value['data-bs-el-id']).toBe('10');
  });

  it('attrs contains data-bs-el-name when identity has name', () => {
    const bi = makeMockInteraction();
    const { attrs } = useSelectable(
      () => ({ name: 'Camp' }),
      bi as BoardInteraction,
      computed(() => false),
      computed(() => false),
    );
    expect(attrs.value['data-bs-el-name']).toBe('Camp');
  });

  it('attrs contains all three keys when identity has all three', () => {
    const bi = makeMockInteraction();
    const { attrs } = useSelectable(
      () => ({ id: 3, name: 'Pawn', notation: 'e2' }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => false),
    );
    expect(attrs.value['data-bs-el-id']).toBe('3');
    expect(attrs.value['data-bs-el-name']).toBe('Pawn');
    expect(attrs.value['data-bs-el-notation']).toBe('e2');
  });

  it('attrs still contains role/tabindex/aria-disabled alongside anchor keys', () => {
    const bi = makeMockInteraction();
    const { attrs } = useSelectable(
      () => ({ id: 1 }),
      bi as BoardInteraction,
      computed(() => true),
      computed(() => false),
    );
    expect(attrs.value.role).toBe('button');
    expect(attrs.value.tabindex).toBe('0');
    expect(attrs.value['data-bs-el-id']).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// useSelectableGrid.cellAttrs — returns anchor keys for each cell
// ---------------------------------------------------------------------------

describe('useSelectableGrid.cellAttrs returns anchorAttrs for cell identity', () => {
  it('cellAttrs returns data-bs-el-id for an id-keyed cell', () => {
    const cells = [{ id: 100 }, { id: 101 }];
    const bi = makeMockInteraction();
    const { cellAttrs } = useSelectableGrid(
      computed(() => cells),
      computed(() => 2),
      (c) => ({ id: c.id }),
      bi as BoardInteraction,
    );
    expect(cellAttrs(cells[0])).toEqual({ 'data-bs-el-id': '100' });
    expect(cellAttrs(cells[1])).toEqual({ 'data-bs-el-id': '101' });
  });

  it('cellAttrs returns data-bs-el-notation for a notation-keyed cell', () => {
    const cells = [{ id: 0, notation: 'a1' }];
    const bi = makeMockInteraction();
    const { cellAttrs } = useSelectableGrid(
      computed(() => cells),
      computed(() => 1),
      (c) => ({ id: c.id, notation: (c as typeof cells[0]).notation }),
      bi as BoardInteraction,
    );
    expect(cellAttrs(cells[0])).toMatchObject({ 'data-bs-el-notation': 'a1' });
  });
});

// ---------------------------------------------------------------------------
// Negative guard: attribute names live only in anchorAttrs (single source)
// ---------------------------------------------------------------------------

describe('single-source guard: data-bs-el-* only in anchorAttrs', () => {
  const REPO_ROOT = join(import.meta.dirname, '../../..');
  const RENDERER_FILES = [
    'src/ui/components/auto-ui/renderers/CardRenderer.vue',
    'src/ui/components/auto-ui/renderers/PieceRenderer.vue',
    'src/ui/components/auto-ui/renderers/DieRenderer.vue',
    'src/ui/components/auto-ui/renderers/DeckRenderer.vue',
    'src/ui/components/auto-ui/renderers/SpaceRenderer.vue',
    'src/ui/components/auto-ui/renderers/HandRenderer.vue',
    'src/ui/components/auto-ui/renderers/GridBoardRenderer.vue',
    'src/ui/components/auto-ui/renderers/HexBoardRenderer.vue',
  ];

  it('no renderer file contains a data-bs-el literal (anchors come only from anchorAttrs)', () => {
    for (const relPath of RENDERER_FILES) {
      const fullPath = join(REPO_ROOT, relPath);
      const content = readFileSync(fullPath, 'utf-8');
      const hasLiteral = content.includes('data-bs-el-id') ||
        content.includes('data-bs-el-notation') ||
        content.includes('data-bs-el-name');
      expect(hasLiteral, `${relPath} must not define data-bs-el-* directly (use anchorAttrs)`).toBe(false);
    }
  });

  it('useSelectable.ts does not contain data-bs-el literals', () => {
    const content = readFileSync(join(REPO_ROOT, 'src/ui/composables/useSelectable.ts'), 'utf-8');
    const hasLiteral = content.includes('data-bs-el-id') ||
      content.includes('data-bs-el-notation') ||
      content.includes('data-bs-el-name');
    expect(hasLiteral, 'useSelectable.ts must not define data-bs-el-* directly (use anchorAttrs)').toBe(false);
  });
});
