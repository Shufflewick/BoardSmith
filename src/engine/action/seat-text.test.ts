/**
 * The seat-neutral text rule (#1293) replaces only text a game callback wrote
 * after being handed a hidden card; a tutorial gate's reason is the engine's
 * own and reaches the seat as written.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Space, Card, Action } from '../index.js';
import type { TutorialDefinition } from '../tutorial/types.js';
import type { ElementSelection } from './types.js';
import { formatElementCandidates } from '../element/pick-candidates.js';

class Table extends Game<Table, Player> {
  constructor() {
    super({ playerCount: 2 });
    const hand = this.create(Space, 'hand-2');
    hand.player = this.getPlayer(2)!;
    hand.contentsVisibleToOwner();
    hand.create(Card, 'AS');
    hand.create(Card, 'KH');
  }
}

describe('a tutorial gate on a card the seat cannot see (#1293)', () => {
  it("keeps the gate's reason, which no game callback wrote", () => {
    const game = new Table();
    game.registerAction(
      Action.create<Table>('take')
        .chooseElement<'card', Card>('card', { elements: (ctx) => ctx.game.first(Space, 'hand-2')!.all(Card) })
        .execute(() => {}),
    );
    const tutorial: TutorialDefinition = {
      learnerSeat: 1,
      steps: [{ id: 'first', gate: { action: 'take', selections: { card: { name: 'AS' } } } }],
    };
    game.tutorialDefinition = tutorial;
    game.tutorialProgress.set(1, { stepId: 'first', status: 'running' });

    const player = game.getPlayer(1)!;
    const selection = game.getAction('take')!.selections[0] as ElementSelection;
    const choices = game.getSelectionChoices('take', 'card', player);
    const offered = formatElementCandidates(choices, selection, { game, player, args: {} }, []);
    expect(offered.map((c) => c.disabled)).toEqual([undefined, expect.stringMatching(/^Tutorial step requires a specific card/)]);
  });
});
