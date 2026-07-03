import { describe, it, expect, beforeEach } from 'vitest';
import { Game, Player, defineFlow, loop, eachPlayer, actionStep, Action } from '../engine/index.js';
import { GameRunner } from '../runtime/runner.js';
import { buildPlayerState } from './utils.js';

// Regression test for audit finding F8 (SEC-03): `buildPlayerState`'s
// `state.players` is built from a raw, unfiltered `player.toJSON()` second
// pass (utils.ts:236-262) that bypasses every visibility mechanism, in
// parallel to the properly-filtered `state.view` (`truthView`). This suite
// proves the fix: `state.players` must be derived from the SAME filtered
// `truthView` tree that backs `state.view`, so a restricted Player attribute
// (via SEC-02's `static visibleAttributes`) is absent from an opponent's
// `state.players` but present in the owning player's own `state.players`.

class SecretPlayer extends Player<VisGame, SecretPlayer> {
  static override visibleAttributes = ['publicScore'];
  publicScore = 0;
  secretRole = 'undercover';
}

class VisGame extends Game<VisGame, SecretPlayer> {
  static override PlayerClass = SecretPlayer;

  constructor(options: { playerCount: number; playerNames?: string[]; seed?: string }) {
    super(options);

    const passAction = Action.create('pass')
      .prompt('Pass')
      .execute(() => {});
    this.registerActions(passAction);

    this.setFlow(
      defineFlow({
        root: loop({
          while: () => true,
          maxIterations: 10,
          do: eachPlayer({ do: actionStep({ actions: ['pass'] }) }),
        }),
      })
    );
  }
}

describe('state.players routed through visibility filtering (SEC-03 / F8)', () => {
  let runner: GameRunner<VisGame>;

  beforeEach(() => {
    runner = new GameRunner({
      GameClass: VisGame,
      gameType: 'vis-test',
      gameOptions: { playerCount: 2, playerNames: ['Alice', 'Bob'], seed: 'test' },
    });
    runner.start();

    const owner = runner.game.getPlayer(1) as SecretPlayer;
    owner.secretRole = 'spy';
  });

  it('hides a restricted Player attribute from an opponent\'s state.players', () => {
    const opponentState = buildPlayerState(runner, ['Alice', 'Bob'], 2);
    const ownerEntry = opponentState.players.find((p) => p.seat === 1);

    expect(ownerEntry).toBeDefined();
    expect(ownerEntry!.publicScore).toBe(0);
    expect(ownerEntry!.secretRole).toBeUndefined();
  });

  it('shows the restricted Player attribute in the owner\'s own state.players', () => {
    const ownState = buildPlayerState(runner, ['Alice', 'Bob'], 1);
    const ownEntry = ownState.players.find((p) => p.seat === 1);

    expect(ownEntry).toBeDefined();
    expect(ownEntry!.publicScore).toBe(0);
    expect(ownEntry!.secretRole).toBe('spy');
  });

  it('state.players agrees with the filtered view for a given viewer', () => {
    const opponentState = buildPlayerState(runner, ['Alice', 'Bob'], 2);
    const view = opponentState.view as { children?: any[] };

    // Locate seat 1's Player node in the SAME filtered tree that backs
    // state.view -- state.players must be a projection of this tree, not a
    // separately-computed unfiltered pass.
    const owner = runner.game.getPlayer(1)!;
    const ownerViewNode = view.children?.find((c: any) => c.className === 'SecretPlayer' && c.id === owner.id);
    const ownerPlayersEntry = opponentState.players.find((p) => p.seat === 1);

    expect(ownerViewNode).toBeDefined();
    expect(ownerPlayersEntry).toBeDefined();
    expect(ownerPlayersEntry!.publicScore).toBe(ownerViewNode!.attributes.publicScore);
    expect(ownerViewNode!.attributes.secretRole).toBeUndefined();
    expect(ownerPlayersEntry!.secretRole).toBeUndefined();
  });
});
