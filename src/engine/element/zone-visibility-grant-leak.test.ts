/**
 * F-09 (residual): hidden-zone grant-metadata must not leak the full roster.
 *
 * `Space.toJSON` emits the complete `zoneVisibility` state — including the
 * `addPlayers` / `exceptPlayers` grant/denial rosters. In the per-player
 * broadcast (`Game.toJSONForPlayer`) that object was passed through to EVERY
 * seat, so any player could read off exactly which OTHER seats had been
 * granted or denied vision of a hidden zone. That is an information leak of
 * the same class F-09 addressed.
 *
 * Contract asserted here:
 *  - A non-granted seat's per-player frame must NOT disclose that some other
 *    seat holds a grant (no other-seat number in addPlayers/exceptPlayers).
 *  - A granted seat's own frame may still learn it is granted (self-only).
 *  - The full-fidelity `toJSON()` used for checkpoints/restore keeps the
 *    complete roster (restore contract untouched), and a granted seat still
 *    sees the zone's real contents after a checkpoint round-trip.
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  type GameOptions,
} from '../index.js';
import { GameRunner } from '../../runtime/index.js';

class Card extends Piece<GrantLeakGame> {
  suit!: string;
}

class SecretZone extends Space<GrantLeakGame> {}

class GrantLeakGame extends Game<GrantLeakGame, Player> {
  secretZone!: SecretZone;

  constructor(options: GameOptions) {
    super(options);

    this.secretZone = this.create(SecretZone, 'secret-zone');
    this.secretZone.contentsHidden();
    this.secretZone.createMany(3, Card, 'card', (i) => ({ suit: ['H', 'S', 'D'][i] }));

    this.registerAction(Action.create('noop').execute(() => ({ success: true })));
    // Grant seat 2 vision of the otherwise-hidden zone.
    this.registerAction(
      Action.create('grantSeat2').execute((_args, ctx) => {
        (ctx.game as GrantLeakGame).secretZone.addZoneVisibleTo(2);
        return { success: true };
      })
    );

    this.setFlow(
      defineFlow({
        root: actionStep({
          actions: ['noop', 'grantSeat2'],
          player: (ctx) => ctx.game.getPlayer(1)!,
          repeatUntil: () => false,
          maxMoves: 10,
        }),
      })
    );
  }
}

function buildRunner(): GameRunner<GrantLeakGame> {
  const runner = new GameRunner<GrantLeakGame>({
    GameClass: GrantLeakGame,
    gameType: 'grant-leak-test',
    gameOptions: { playerCount: 3, seed: 'grant-leak-seed' },
  });
  runner.start();
  return runner;
}

function zoneFrame(runner: GameRunner<GrantLeakGame>, seat: number) {
  const view = runner.game.toJSONForPlayer(seat);
  return view.children?.find((c) => c.name === 'secret-zone');
}

describe('F-09 residual: hidden-zone grant roster does not leak in per-player frames', () => {
  it("a non-granted seat's frame does not disclose that another seat holds a grant", () => {
    const runner = buildRunner();
    // Seat 1 (the acting seat) grants seat 2 vision of the hidden zone.
    expect(runner.performAction('grantSeat2', 1, {}).success).toBe(true);
    expect(runner.game.secretZone.getZoneVisibility()?.addPlayers).toEqual([2]);

    // Seat 3 is neither granter nor grantee — its frame must not name seat 2.
    const seat3Zone = zoneFrame(runner, 3);
    expect(seat3Zone).toBeDefined();
    expect(seat3Zone?.zoneVisibility?.addPlayers ?? []).not.toContain(2);
  });

  it("a granted seat's own frame may still learn it is granted (self-only)", () => {
    const runner = buildRunner();
    expect(runner.performAction('grantSeat2', 1, {}).success).toBe(true);

    // Seat 2 was granted, so it sees the zone contents; a self-only marker is fine,
    // but it must not learn about any OTHER seat's grant state.
    const seat2Zone = zoneFrame(runner, 2);
    expect(seat2Zone?.zoneVisibility?.addPlayers ?? []).not.toContain(1);
    expect(seat2Zone?.zoneVisibility?.addPlayers ?? []).not.toContain(3);
  });

  it('the full toJSON() (checkpoint/restore path) keeps the complete grant roster and a granted seat still sees contents after restore', () => {
    const runner = buildRunner();
    expect(runner.performAction('grantSeat2', 1, {}).success).toBe(true);

    // Full toJSON keeps the roster intact for restore.
    const full = runner.game.toJSON();
    const zoneJson = full.children?.find((c) => c.name === 'secret-zone');
    expect(zoneJson?.zoneVisibility?.addPlayers).toEqual([2]);

    // Round-trip through a snapshot; granted seat 2 still sees the real cards.
    const snapshot = JSON.parse(JSON.stringify(runner.getSnapshot()));
    const restored = GameRunner.fromSnapshot<GrantLeakGame>(snapshot, GrantLeakGame);
    const seat2Zone = restored.game
      .toJSONForPlayer(2)
      .children?.find((c) => c.name === 'secret-zone');
    // Seat 2 was granted vision: it must see the real child cards.
    expect(seat2Zone?.children?.length).toBe(3);
  });
});
