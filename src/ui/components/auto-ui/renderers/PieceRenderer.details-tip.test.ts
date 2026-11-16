// @vitest-environment jsdom
/**
 * A piece drawn where its row has no room for details (a board cell, a hand
 * fan, a deck stack) shows its full name and game attributes in a tip on mouse
 * hover, on tap, and on keyboard focus. On a board the keyboard focuses the
 * cell, which shows one tip for every piece on it (#1667, the #1606 rule).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { computed, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import '../builtin-renderers.js';
import ElementRenderer from './ElementRenderer.vue';
import GridBoardRenderer from './GridBoardRenderer.vue';
import { mountBoardRenderer } from './board-renderer-a11y.test-helper.js';
import { GAME_VIEW_KEY, type GameElement } from '../auto-ui-helpers.js';

const caravan: GameElement = { id: 7, className: 'Sitting', name: 'caravan', attributes: { leg: 2, wear: 0 } };
const crate: GameElement = { id: 8, className: 'Sitting', name: 'crate', attributes: { stores: 3 } };
const root: GameElement = { id: 1, className: 'Game', attributes: {}, children: [caravan] };

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

function renderPiece(details: boolean) {
  wrapper = mount(ElementRenderer, {
    props: { element: caravan, details },
    attachTo: document.body,
    global: { provide: { [GAME_VIEW_KEY as symbol]: computed(() => root) } },
  });
  return { wrapper, piece: wrapper.find('.piece') };
}

function renderBoard() {
  const board: GameElement = {
    id: 2,
    className: 'Board',
    name: 'board',
    attributes: { $layout: 'grid', $rowCoord: 'rank', $colCoord: 'file' },
    children: [
      { id: 100, className: 'Square', name: 'a1', attributes: { rank: 1, file: 1 }, children: [caravan, crate] },
      { id: 101, className: 'Square', name: 'b1', attributes: { rank: 1, file: 2 }, children: [] },
    ],
  };
  wrapper = mountBoardRenderer(GridBoardRenderer, board).wrapper;
  return (name: string) => wrapper!.find(`[role="gridcell"][title="${name}"]`).element as HTMLElement;
}

const tips = () => document.body.querySelectorAll<HTMLElement>('[role="tooltip"].piece-details-tip');
const tipText = () => tips().length === 0
  ? undefined
  : [...tips()].map((tip) => [...tip.querySelectorAll('.piece-name, dt, dd')].map((node) => node.textContent).join(' ')).join(' / ');

function pressKey() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
}

function pressPointer() {
  document.dispatchEvent(new Event('pointerdown'));
}

describe('PieceRenderer details tip where the row has no room (#1667)', () => {
  it('opens on a tap and closes on a tap elsewhere', async () => {
    const { piece } = renderPiece(false);
    await piece.trigger('click');
    expect(tipText()).toBe('caravan leg 2 wear 0');
    expect(piece.attributes('aria-describedby')).toBe(tips()[0].id);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();
    expect(tipText()).toBeUndefined();
  });

  it('keeps a tapped tip open when the panel takes focus back after the tap', async () => {
    const { piece } = renderPiece(false);
    pressPointer();
    (piece.element as HTMLElement).focus();
    await piece.trigger('click');
    (piece.element as HTMLElement).blur();
    await nextTick();
    expect(tipText()).toBe('caravan leg 2 wear 0');
  });

  it('opens on mouse hover and closes when the mouse leaves', async () => {
    const { piece } = renderPiece(false);
    await piece.trigger('pointerenter', { pointerType: 'mouse' });
    expect(tipText()).toBe('caravan leg 2 wear 0');
    await piece.trigger('pointerleave', { pointerType: 'mouse' });
    expect(tipText()).toBeUndefined();
  });

  it('keeps a tapped tip open when the board redraws out from under the finger', async () => {
    const { piece } = renderPiece(false);
    await piece.trigger('click');
    await piece.trigger('pointerleave', { pointerType: 'touch' });
    expect(tipText()).toBe('caravan leg 2 wear 0');
  });

  it('opens when the keyboard focuses the piece, and closes on blur', async () => {
    const { piece } = renderPiece(false);
    pressKey();
    (piece.element as HTMLElement).focus();
    await nextTick();
    expect(tipText()).toBe('caravan leg 2 wear 0');
    (piece.element as HTMLElement).blur();
    await nextTick();
    expect(tipText()).toBeUndefined();
  });

  it('closes when the page scrolls, since a fixed tip would stay behind', async () => {
    const { piece } = renderPiece(false);
    await piece.trigger('click');
    document.dispatchEvent(new Event('scroll'));
    await nextTick();
    expect(tipText()).toBeUndefined();
  });

  it('offers no tip where the details are already drawn beside the piece', async () => {
    const { piece } = renderPiece(true);
    await piece.trigger('click');
    await piece.trigger('pointerenter', { pointerType: 'mouse' });
    expect(tipText()).toBeUndefined();
  });
});

describe('GridBoardRenderer details tip for the focused cell (#1667)', () => {
  it('shows every piece on a keyboard-focused cell in one tip that describes the cell', async () => {
    const cell = renderBoard();
    pressKey();
    cell('a1').focus();
    await nextTick();
    expect(tipText()).toBe('caravan leg 2 wear 0 crate stores 3');
    expect(cell('a1').getAttribute('aria-describedby')).toBe(tips()[0].id);

    cell('b1').focus();
    await nextTick();
    expect(tipText()).toBeUndefined();
    expect(cell('a1').hasAttribute('aria-describedby')).toBe(false);
  });

  it('stays closed when focus arrives after a pointer press, as a script placing focus would', async () => {
    const cell = renderBoard();
    pressPointer();
    cell('a1').focus();
    await nextTick();
    expect(tipText()).toBeUndefined();
  });
});
