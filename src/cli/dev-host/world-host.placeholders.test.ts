// @vitest-environment jsdom
/**
 * #1326: A SEAT SHOWN A COUNT-ONLY PILE IS SENT THE SHARED BODY AND ITS OWN IDS.
 *
 * #1207 made `viewsFor` answer one body per group with each seat's placeholder
 * ids beside it, but the dev host filled each seat's ids in before sending, so
 * the wire carried a body per seat again. The frame now carries the shared body
 * and the seat's `placeholders`, and the page puts them back. Driven through the
 * real dev host, then the real page reader, against what the harness projects.
 */
import { describe, it, expect } from 'vitest';

import { Game, Piece, Player, Space, type GameOptions } from '../../engine/index.js';
import { worldAction, worldBudgets, type WorldDefinition } from '../../world/index.js';
import type { WorldHostClock } from '../../world/host/index.js';
import { createTestWorld, TEST_WORLD_EPOCH } from '../../testing/test-world.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { useWorldHost } from '../../ui/world/useWorldHost.js';
import { createOrderBook } from '../../ui/world/orderBook.js';
import { WORLD_HOST_SOURCE } from '../../ui/world/worldProtocol.js';
import { LocalWorldHost } from './world-host.js';
import { openWorldStore, worldStorePath } from './world-store.js';

class Plaza extends Space<DeckWorld> {}
class Deck extends Space<DeckWorld> {}
class Card extends Piece<DeckWorld> {}

class DeckWorld extends Game<DeckWorld, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Plaza, Deck, Card]);
  }
}

const PLAZA = 'plaza';
const CARDS = 3;

const wave = worldAction<DeckWorld>('wave')
  .prompt('Wave')
  .needs(() => [PLAZA])
  .execute(() => {});

function deckBundle() {
  return {
    gameClass: DeckWorld,
    gameType: 'deck-world',
    displayName: 'Deck World',
    world: {
      maxPlayers: 2,
      actions: [wave],
      view: () => [PLAZA],
      genesis: (game: Game) => {
        const plaza = game.create(Plaza, PLAZA);
        const deck = plaza.create(Deck, 'deck');
        deck.contentsCountOnly();
        for (let card = 0; card < CARDS; card += 1) deck.create(Card, `card-${card}`);
        return { [PLAZA]: plaza };
      },
    } as WorldDefinition,
  };
}

/** The same instant on both sides, as in `world-host.parity.test.ts`. */
const pinnedClock = (): WorldHostClock => ({
  now: () => TEST_WORLD_EPOCH,
  arm: () => {},
  yieldTurn: () => Promise.resolve(),
});

/** Both seats watching the dev host, and the last state frame each was sent. */
async function hostFrames(): Promise<{ frames: Map<string, Record<string, unknown>>; elementIdKey: string }> {
  const budgets = worldBudgets();
  // NAMED, because `temp-tree.test-helper` owns the removal and asserts that
  // every caller keeps the path it was given rather than losing it inline.
  const dir = tempTree('bs-world-placeholders-');
  const store = openWorldStore(worldStorePath(dir), budgets);
  const frames = new Map<string, Record<string, unknown>>();
  const host = new LocalWorldHost({
    definition: deckBundle(),
    worldName: 'Deck World',
    seed: 'deck-world',
    budgets,
    store,
    clock: pinnedClock(),
    send: (clientId, message) => {
      const frame = message as Record<string, unknown>;
      if (frame['type'] === 'world_state') frames.set(clientId, frame);
    },
    // No page in this file ever closes its socket.
    isOpen: () => true,
  });
  await host.start();
  for (const [clientId, seat] of [['c1', 1], ['c2', 2]] as const) {
    await host.handleMessage(clientId, { type: 'hello' });
    await host.handleMessage(clientId, { type: 'attach', seat });
  }
  const elementIdKey = store.elementIdKey();
  await host.close();
  return { frames, elementIdKey };
}

/** What a page holds once it has read `frame`. */
function pageView(frame: Record<string, unknown>): unknown {
  const page = useWorldHost({ post: () => {}, orders: createOrderBook({ storage: null }) });
  page.handleMessage({ origin: window.location.origin, source: window.parent, data: { ...frame, source: WORLD_HOST_SOURCE } } as MessageEvent);
  return page.view.value;
}

describe('a world state frame carries the shared body and the seat its own placeholder ids (#1326)', () => {
  it('sends both seats the same body, and each page fills in exactly what the harness projects for it', async () => {
    const { frames, elementIdKey } = await hostFrames();
    const one = frames.get('c1')!;
    const two = frames.get('c2')!;

    expect(JSON.stringify(one['view'])).toBe(JSON.stringify(two['view']));
    expect(one['placeholders']).toHaveLength(CARDS);
    expect(two['placeholders']).toHaveLength(CARDS);
    expect(one['placeholders']).not.toEqual(two['placeholders']);

    const world = await createTestWorld({ definition: deckBundle(), seed: 'deck-world', elementIdKey, now: TEST_WORLD_EPOCH, watching: [1, 2] });
    expect(pageView(one)).toEqual((await world.getPlayerView(1)).view);
    expect(pageView(two)).toEqual((await world.getPlayerView(2)).view);
    await world.close();
  });
});
