// @vitest-environment jsdom
/**
 * #1733: a game marks each seat card with that player's colour, through a fixed
 * set of treatments BoardSmith draws itself (`playerColorMarks`), never CSS of
 * the game's own: a stripe down the card's edge, and the name in the player's
 * colour when it reads on the card, else in the normal text colour.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import PlayersPanel, { type Player } from './PlayersPanel.vue';

const NAVY = '#1a237e';
const YELLOW = '#ffeb3b';

const PLAYERS: Player[] = [
  { seat: 0, name: 'Alice', color: NAVY },
  { seat: 1, name: 'Bob', color: YELLOW },
  { seat: 2, name: 'Carol' },
];

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

/** Mounts the panel on a ground of `background`, which jsdom computes like a browser. */
async function mountOn(background: string, props: Record<string, unknown> = {}) {
  const ground = document.createElement('div');
  ground.style.backgroundColor = background;
  document.body.append(ground);
  const wrapper = mount(PlayersPanel, {
    props: { players: PLAYERS, playerSeat: 0, dueSeats: [0], ...props },
    attachTo: ground,
  });
  mounted.push(wrapper);
  await nextTick();
  return { wrapper, ground };
}

const card = (wrapper: VueWrapper, seat: number) => wrapper.find(`.player-card[data-seat="${seat}"]`);
const nameColor = (wrapper: VueWrapper, seat: number) =>
  (card(wrapper, seat).find('.player-name').element as HTMLElement).style.color;

describe('playerColorMarks (#1733)', () => {
  it('marks nothing when the game turns nothing on', async () => {
    const { wrapper } = await mountOn('rgb(255, 255, 255)');
    expect(wrapper.findAll('.player-card.color-stripe')).toHaveLength(0);
    expect(nameColor(wrapper, 0)).toBe('');
  });

  it('draws a stripe in each coloured seat\'s colour, and none for a seat with no colour', async () => {
    const { wrapper } = await mountOn('rgb(255, 255, 255)', { playerColorMarks: ['stripe'] });
    expect(card(wrapper, 0).classes()).toContain('color-stripe');
    expect((card(wrapper, 0).element as HTMLElement).style.getPropertyValue('--bs-seat-color')).toBe(NAVY);
    expect(card(wrapper, 2).classes()).not.toContain('color-stripe');
    expect(nameColor(wrapper, 0)).toBe('');
  });

  it('writes a name in its colour only where that colour reads on the card', async () => {
    const { wrapper } = await mountOn('rgb(255, 255, 255)', { playerColorMarks: ['name'] });
    expect(nameColor(wrapper, 0)).toBe('rgb(26, 35, 126)');
    expect(nameColor(wrapper, 1)).toBe('');
    expect(nameColor(wrapper, 2)).toBe('');
    expect(wrapper.findAll('.player-card.color-stripe')).toHaveLength(0);
  });

  it('judges the card on its translucent layers over the ground, as drawn', async () => {
    // Yellow is unreadable on white but reads on a dark ground, even under a light veil.
    const { wrapper } = await mountOn('rgb(18, 20, 23)', { playerColorMarks: ['name'] });
    (wrapper.element as HTMLElement).style.backgroundColor = 'rgba(255, 255, 255, 0.04)';
    document.documentElement.setAttribute('data-theme', 'dark');
    await vi.waitFor(() => expect(nameColor(wrapper, 1)).toBe('rgb(255, 235, 59)'));
    expect(nameColor(wrapper, 0)).toBe('');
  });

  it('judges again when the theme changes', async () => {
    const { wrapper, ground } = await mountOn('rgb(255, 255, 255)', { playerColorMarks: ['name'] });
    expect(nameColor(wrapper, 1)).toBe('');
    ground.style.backgroundColor = 'rgb(18, 20, 23)';
    document.documentElement.setAttribute('data-theme', 'dark');
    await vi.waitFor(() => expect(nameColor(wrapper, 1)).toBe('rgb(255, 235, 59)'));
    expect(nameColor(wrapper, 0)).toBe('');
  });

  it('judges the names when the cards appear, as the collapsed sidebar opens', async () => {
    const { wrapper } = await mountOn('rgb(255, 255, 255)', { playerColorMarks: ['name'], seatStrip: true });
    await wrapper.setProps({ seatStrip: false });
    await nextTick();
    expect(nameColor(wrapper, 0)).toBe('rgb(26, 35, 126)');
  });

  it('judges a translucent colour as drawn, over the card', async () => {
    const { wrapper } = await mountOn('rgb(255, 255, 255)', {
      players: [{ seat: 0, name: 'Alice', color: 'rgba(26, 35, 126, 0.25)' }],
      playerColorMarks: ['name'],
    });
    expect(nameColor(wrapper, 0)).toBe('');
  });

  it('cannot judge a name over a background image, so writes it in the normal text colour', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wrapper } = await mountOn('rgb(255, 255, 255)', { playerColorMarks: ['name'] });
    (wrapper.element as HTMLElement).style.backgroundImage = 'linear-gradient(rgb(17, 17, 17), rgb(34, 34, 34))';
    document.documentElement.setAttribute('data-theme', 'dark');
    await vi.waitFor(() => expect(nameColor(wrapper, 0)).toBe(''));
  });

  it('writes a colour it cannot read in the normal text colour, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { wrapper } = await mountOn('rgb(255, 255, 255)', {
      players: [{ seat: 0, name: 'Alice', color: 'oklch(0.3 0.1 260)' }],
      playerColorMarks: ['name'],
    });
    expect(nameColor(wrapper, 0)).toBe('');
    expect(warn.mock.calls.flat().join(' ')).toContain('oklch(0.3 0.1 260)');
  });
});
