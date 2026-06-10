import { describe, it, expect } from 'vitest';
import {
  Game,
  Space,
  Piece,
  Player,
  Action,
  defineFlow,
  forEach,
  sequence,
  actionStep,
  execute,
  type FlowContext,
  type GameStateSnapshot,
} from '../engine/index.js';
import { GameRunner } from './runner.js';

/**
 * Regression for the latent fromSnapshot flow-variable gap:
 *
 * An `executeForEach` binds the current item into a flow variable (`as`). When the
 * loop body awaits player input, that variable is captured verbatim in the
 * serialized FlowPosition. Over the snapshot JSON boundary an element-valued
 * variable becomes a detached ElementJSON. If the body reads that variable AFTER
 * the await (and mutates it), the mutation must land on the authoritative loaded
 * tree — which only happens if the variable is re-linked to the loaded tree on
 * restore (GameRunner.fromSnapshot -> relinkFlowState).
 */

class Token extends Piece<RelinkGame> {
  marked = false;
}
class Bag extends Space<RelinkGame> {}

class RelinkGame extends Game<RelinkGame, Player> {
  bag!: Bag;

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);
    this.registerElements([Token, Bag]);

    this.bag = this.create(Bag, 'bag');
    this.bag.create(Token, 'token-a');
    this.bag.create(Token, 'token-b');

    // `mark`: a no-op action whose only job is to complete the per-iteration await.
    this.registerActions(Action.create('mark').execute(() => ({ success: true })));

    // For each token: await `mark`, then (AFTER the await) read the element-valued
    // flow variable `token` and mutate it. The mutation only persists to the
    // restored tree if `token` is re-linked to a live loaded element.
    this.setFlow(
      defineFlow({
        root: forEach<Token>({
          collection: (ctx: FlowContext) => (ctx.game as RelinkGame).bag.all(Token),
          as: 'token',
          do: sequence(
            actionStep({ actions: ['mark'] }),
            execute((ctx: FlowContext) => {
              const token = ctx.get<Token>('token');
              if (token) {
                token.marked = true;
              }
            }),
          ),
        }),
      }),
    );
  }
}

describe('fromSnapshot flow-variable re-linking', () => {
  it('re-links an element-valued forEach variable to the loaded tree across a snapshot JSON round-trip', () => {
    const runner = new GameRunner({
      GameClass: RelinkGame,
      gameType: 'relink',
      gameOptions: { playerCount: 1, playerNames: ['Solo'], seed: 'relink' },
    });
    runner.start();

    // Flow is paused at the first iteration's actionStep; the flow variable
    // `token` is bound to the first token (a LIVE element of the original tree).
    const firstTokenId = runner.game.bag.all(Token)[0].id;
    expect(runner.game.getFlowState()?.position.variables.token).toBeDefined();

    // Cross the JSON boundary exactly like the executor does: a live element in a
    // flow variable serializes to a detached ElementJSON here.
    const snapshot = JSON.parse(JSON.stringify(runner.getSnapshot())) as GameStateSnapshot;
    const restored = GameRunner.fromSnapshot(snapshot, RelinkGame);

    // Completing the await runs the `execute` node, which reads the element-valued
    // flow variable and mutates it. With re-linking, the variable is the live
    // loaded token, so the mutation lands on the restored tree.
    const result = restored.performAction('mark', 1, {});
    expect(result.success).toBe(true);

    const restoredFirstToken = restored.game.getElementById(firstTokenId) as Token;
    expect(restoredFirstToken.marked).toBe(true);
  });
});
