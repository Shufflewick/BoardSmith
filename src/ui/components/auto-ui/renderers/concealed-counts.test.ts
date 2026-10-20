// @vitest-environment jsdom
/**
 * A concealed zone's view carries, after one entry per child, the cards granted
 * to the seat from inside a hidden child (#961, #1208). The renderers count and
 * lay out the zone by its own children, and draw those granted cards apart
 * (#1292). The views are real seats' views from the engine.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Game, Card, Hand, Space, Player } from '../../../../engine/index.js';
import '../builtin-renderers.js';
import HandRenderer from './HandRenderer.vue';
import SpaceRenderer from './SpaceRenderer.vue';

type ViewElement = { id: number; name?: string; children?: ViewElement[]; childCount?: number };

class TableGame extends Game<TableGame, Player> {
  constructor(options: { playerCount: number }) {
    super(options);
    this.registerElements([Hand, Space, Card]);
    const hand = this.create(Hand, 'hand');
    hand.player = this.getPlayer(1)!;
    const tray = this.create(Space, 'tray');
    tray.player = this.getPlayer(1)!;
    tray.contentsVisibleToOwner();
    for (const zone of [hand, tray]) {
      zone.create(Card, `${zone.name}-card`);
      // Granted to seat 2 from inside a crate seat 2 cannot see.
      zone.create(Space, `${zone.name}-crate`).create(Card, `${zone.name}-gem`).addVisibleTo(2);
    }
    const vault = this.create(Space, 'vault');
    vault.contentsHidden();
    vault.create(Card, 'vault-card');
    vault.create(Card, 'vault-gem').addVisibleTo(2);
  }
}

const view = new TableGame({ playerCount: 2 }).toJSONForPlayer(2) as ViewElement;
const zone = (name: string) => view.children!.find((c) => c.name === name)!;

describe('a concealed zone carrying a card granted from inside a hidden child (#1292)', () => {
  it('is sent one entry per child, then the granted card', () => {
    expect(zone('hand').childCount).toBe(2);
    expect(zone('hand').children).toHaveLength(3);
  });

  it('counts a hand by its own cards, and draws the granted card apart', () => {
    const hand = mount(HandRenderer, { props: { element: zone('hand') as never } });

    expect(hand.find('.hand-count').text()).toBe('(2)');
    expect(hand.findAll('.hand-cards .hand-card')).toHaveLength(2);
    expect(hand.findAll('.hand-granted [data-element-id]').map((el) => el.attributes('data-element-id')))
      .toEqual([String(zone('hand').children![2].id)]);
  });

  it('counts a space by its own children', () => {
    const tray = mount(SpaceRenderer, { props: { element: zone('tray') as never } });

    expect(tray.find('.space-count').text()).toBe('(2)');
    expect(tray.attributes('aria-label')).toBe('tray, 2 items');
  });

  it('gives no size for a hidden zone, which sends only what it grants', () => {
    const vault = mount(SpaceRenderer, { props: { element: zone('vault') as never } });

    expect(zone('vault').children).toHaveLength(1);
    expect(vault.find('.space-count').exists()).toBe(false);
    expect(vault.attributes('aria-label')).toBe('vault');
  });
});
