/**
 * A two-seat game whose hands only their owners can see, for tests that need
 * the per-seat view the engine really sends. Use these instead of building a
 * hidden element by hand: the engine marks a placeholder in
 * `attributes.__hidden`, and a hand-built shape that puts the marker anywhere
 * else tests a case that never happens (BoardSmith #491).
 */
import {
  Game,
  Player,
  Space,
  Card,
  Action,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
  type ElementJSON,
} from '../../../engine/index.js';
import { createTestGame } from '../../../testing/test-game.js';

class SecretCard extends Card<HiddenHandGame> {
  rank!: string;
}

/** Two seats, each with a hand only its owner can see. */
class HiddenHandGame extends Game<HiddenHandGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([SecretCard]);
    for (const player of this.all(Player)) {
      const hand = this.create(Space, `hand-${player.seat}`);
      hand.player = player;
      hand.contentsVisibleToOwner();
      hand.create(SecretCard, `card-${player.seat}`, { rank: player.seat === 1 ? 'A' : 'K' });
    }
    this.registerAction(Action.create<HiddenHandGame>('pass').execute(() => ({ success: true })));
    this.setFlow({
      root: loop({
        while: () => false,
        maxIterations: 10,
        do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
      }),
    });
  }
}

function handCardInViewOf(viewerSeat: number, handOwnerSeat: number): ElementJSON {
  const game = createTestGame(HiddenHandGame, { playerCount: 2, seed: 'presentation-hidden' });
  const root = game.getPlayerView(viewerSeat).state as ElementJSON;
  const hand = root.children?.find((c) => c.name === `hand-${handOwnerSeat}`);
  const card = hand?.children?.[0];
  if (!card) throw new Error(`seat ${viewerSeat}'s view has no card in hand-${handOwnerSeat}`);
  return card;
}

/** What seat 1 is sent for seat 2's card: the engine's hidden placeholder. */
export function hiddenOpponentCard(): ElementJSON {
  return handCardInViewOf(1, 2);
}

/** What seat 1 is sent for its own card: fully visible. */
export function ownCardOfSeat1(): ElementJSON {
  return handCardInViewOf(1, 1);
}

