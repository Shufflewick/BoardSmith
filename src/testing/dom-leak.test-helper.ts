/**
 * The shared fixture for `dom-leak`'s custom-board suites.
 *
 * Two seats, each with an owner-only `Hand` holding one secret card — the
 * smallest game where "what seat 1 may see" and "what the tree actually holds"
 * differ, which is the whole subject of a hidden-info scan. The seat on move may
 * `pass`, or `peek` at the other seat's card: a blind pick whose choice is
 * labelled with the card's hidden rank, the leak that exists only while an
 * action is open (#405). Lives here because
 * both `dom-leak-custom-ui.test.ts` (the `component` seam) and
 * `dom-leak-board-interaction.test.ts` (the `provide` seam) need the same one,
 * and two copies of a fixture are two things to keep true.
 */
import {
  Game,
  Player,
  Hand,
  Card,
  Action,
  defineFlow,
  loop,
  eachPlayer,
  actionStep,
  type GameOptions,
} from '../engine/index.js';
import { TestGame } from './test-game.js';

class SecretCard extends Card<SecretHandGame> {
  rank!: string;
}

export class SecretHandGame extends Game<SecretHandGame, Player> {
  constructor(options: GameOptions) {
    super(options);
    this.registerElements([SecretCard]);

    for (const player of this.all(Player)) {
      const hand = this.create(Hand, `hand-${player.seat}`);
      hand.player = player;
      // Hand defaults to owner-only content visibility.
      hand.create(SecretCard, `${player.seat}-secret-card`, {
        rank: player.seat === 1 ? 'Ace' : 'King',
      });
    }

    this.registerAction(Action.create<SecretHandGame>('pass').execute(() => ({ success: true })));
    this.registerAction(
      Action.create<SecretHandGame>('peek')
        .chooseElement<'card', SecretCard>('card', {
          elements: (ctx) => this.all(SecretCard).filter((card) => (card.parent as Hand).player !== ctx.player),
          // The bug under test: the target is labelled with the face it hides.
          display: (card) => card.rank,
        })
        .execute(() => ({ success: true })),
    );

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 10,
          do: eachPlayer({ do: actionStep({ actions: ['pass', 'peek'] }) }),
        }),
      }),
    );
  }
}

/**
 * A fresh two-seat game. `seed` names the suite so two suites sharing the
 * fixture still get their own deterministic game rather than an accidental
 * shared one.
 */
export function makeSecretHandGame(seed: string): TestGame<SecretHandGame> {
  return TestGame.create(SecretHandGame, { playerCount: 2, seed });
}

/** The shape a board under test walks: whatever tree it was handed. */
export interface ViewNode {
  id?: number;
  name?: string;
  rank?: string;
  children?: ViewNode[];
}

/** Every secret card reachable from `node`, however deep. */
export function collectCards(node: ViewNode, into: ViewNode[] = []): ViewNode[] {
  if (node.rank !== undefined || (node.name?.includes('secret-card') ?? false)) into.push(node);
  for (const child of node.children ?? []) collectCards(child, into);
  return into;
}
