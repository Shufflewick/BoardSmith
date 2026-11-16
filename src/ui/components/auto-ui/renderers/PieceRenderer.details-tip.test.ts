// @vitest-environment jsdom
/**
 * A piece drawn where its row has no room for details (a board cell, a hand
 * fan, a deck stack) shows its full name and game attributes in a tip on
 * hover, on tap, and on keyboard focus of the piece or the cell it stands on
 * (#1667, the #1606 rule).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { computed, defineComponent, h } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import '../builtin-renderers.js';
import ElementRenderer from './ElementRenderer.vue';
import { GAME_VIEW_KEY, type GameElement } from '../auto-ui-helpers.js';

const caravan: GameElement = { id: 7, className: 'Sitting', name: 'caravan', attributes: { leg: 2, wear: 0 } };
const root: GameElement = { id: 1, className: 'Game', attributes: {}, children: [caravan] };

let wrapper: VueWrapper | undefined;

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
});

function render(details: boolean) {
  const Cell = defineComponent(() => () =>
    h('div', { role: 'gridcell', tabindex: '0', class: 'cell' }, [h(ElementRenderer, { element: caravan, details })]),
  );
  wrapper = mount(Cell, {
    attachTo: document.body,
    global: { provide: { [GAME_VIEW_KEY as symbol]: computed(() => root) } },
  });
  return wrapper;
}

const tip = () => document.body.querySelector<HTMLElement>('[role="tooltip"].piece-details-tip');
const tipText = () => tip() && [...tip()!.querySelectorAll('.piece-name, dt, dd')].map((node) => node.textContent).join(' ');

describe('PieceRenderer details tip where the row has no room (#1667)', () => {
  it('opens on a tap and closes on a tap elsewhere', async () => {
    const cell = render(false);
    await cell.find('.piece').trigger('click');
    expect(tipText()).toBe('caravan leg 2 wear 0');
    expect(cell.find('.piece').attributes('aria-describedby')).toBe(tip()!.id);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await cell.vm.$nextTick();
    expect(tip()).toBeNull();
  });

  it('keeps a tapped tip open when the panel takes focus back after the tap', async () => {
    const cell = render(false);
    document.dispatchEvent(new Event('pointerdown'));
    (cell.element as HTMLElement).focus();
    await cell.find('.piece').trigger('click');
    (cell.element as HTMLElement).blur();
    await cell.vm.$nextTick();
    expect(tipText()).toBe('caravan leg 2 wear 0');
  });

  it('opens on mouse hover and closes when the mouse leaves', async () => {
    const cell = render(false);
    await cell.find('.piece').trigger('pointerenter', { pointerType: 'mouse' });
    expect(tipText()).toBe('caravan leg 2 wear 0');
    await cell.find('.piece').trigger('pointerleave', { pointerType: 'mouse' });
    expect(tip()).toBeNull();
  });

  it('keeps a tapped tip open when the board redraws out from under the finger', async () => {
    const cell = render(false);
    await cell.find('.piece').trigger('click');
    await cell.find('.piece').trigger('pointerleave', { pointerType: 'touch' });
    expect(tipText()).toBe('caravan leg 2 wear 0');
  });

  it('opens when the keyboard focuses the cell the piece stands on, and closes on blur', async () => {
    const cell = render(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    (cell.element as HTMLElement).focus();
    await cell.vm.$nextTick();
    expect(tipText()).toBe('caravan leg 2 wear 0');

    (cell.element as HTMLElement).blur();
    await cell.vm.$nextTick();
    expect(tip()).toBeNull();
  });

  it('stays closed when focus arrives after a pointer press, as a script placing focus would', async () => {
    const cell = render(false);
    document.dispatchEvent(new Event('pointerdown'));
    (cell.element as HTMLElement).focus();
    await cell.vm.$nextTick();
    expect(tip()).toBeNull();
  });

  it('offers no tip where the details are already drawn beside the piece', async () => {
    const cell = render(true);
    await cell.find('.piece').trigger('click');
    await cell.find('.piece').trigger('pointerenter', { pointerType: 'mouse' });
    expect(tip()).toBeNull();
  });
});
