/**
 * Move enumeration reads every gate a game can write, not just one (#19).
 *
 * `enumerateLegalMoves` took its action names from the flow state's FROZEN
 * `availableActions` — computed once on the authoritative game, with full
 * information, when the step opened, then serialized into the snapshot and
 * replayed verbatim into a bot's redacted search sandbox. So of the three
 * places a game can say "you may not do this", enumeration read only one:
 *
 *   condition   — skipped; the frozen list was taken as the answer
 *   validate()  — never called
 *   disabled / choices — the only one that worked
 *
 * An author following the documented patterns writes availability in the first
 * two. The consequences were a hard crash (a `choices` closure reading state a
 * failing `condition` was meant to guard) and a wedged pump (the bot playing a
 * move `.validate()` then refused, so the round never closed for any seat).
 */
import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Action,
  defineFlow,
  simultaneousActionStep,
  enumerateLegalMoves,
  type GameOptions,
} from './index.js';

class Scout extends Player {
  position = 0;
  actionPoints = 2;
}

class FieldGame extends Game<FieldGame, Scout> {
  static PlayerClass = Scout;

  constructor(options: GameOptions) {
    super(options);

    this.registerActions(
      // Availability written as a `condition`: a scout with no position cannot
      // travel. The `choices` closure below THROWS for such a scout, exactly as
      // the reporting game's did, so a skipped condition is a crash.
      Action.create<FieldGame, Scout>('travel')
        .prompt('Travel')
        .condition({ 'scout has a position': (ctx) => ctx.player.position > 0 })
        .chooseFrom('to', {
          choices: (ctx) => {
            if (ctx.player.position <= 0) {
              throw new Error('stepsFrom(0): position 0 is not a place any scout can stand.');
            }
            return [ctx.player.position + 1, ctx.player.position - 1];
          },
        })
        .execute(() => {}),

      // Availability written as `.validate()`: kept available on purpose so a
      // broke seat is not locked out of the round, and refused with a message
      // naming the shortfall.
      Action.create<FieldGame, Scout>('sprint')
        .prompt('Sprint')
        .chooseFrom('distance', { choices: [1, 2, 3] })
        .validate((args, ctx) =>
          (args.distance as number) <= ctx.player.actionPoints
            ? true
            : `Sprinting ${args.distance} costs ${args.distance} action points and you have ${ctx.player.actionPoints}.`
        )
        .execute(() => {}),

      Action.create<FieldGame, Scout>('rest').prompt('Rest').execute(() => {}),
    );

    this.setFlow(
      defineFlow({
        root: simultaneousActionStep({ name: 'field', actions: ['travel', 'sprint', 'rest'] }),
      })
    );
  }
}

function started(): FieldGame {
  const game = new FieldGame({ playerCount: 2, playerNames: ['A', 'B'], seed: 'field' });
  // Both seats start placed and able, so the step opens offering everything.
  for (const scout of game.players as Scout[]) scout.position = 5;
  game.startFlow();
  return game;
}

describe('a condition the flow state was computed before', () => {
  it('offers travel while the condition holds', () => {
    const moves = enumerateLegalMoves(started(), 1);
    expect(moves.map((m) => m.action)).toContain('travel');
  });

  it('stops offering it once the condition fails, despite the frozen list', () => {
    const game = started();
    // What redaction does to a sandbox, and what a mid-step change does to a
    // live game: the seat no longer has a position.
    (game.getPlayer(1) as Scout).position = 0;

    const moves = enumerateLegalMoves(game, 1);
    expect(moves.map((m) => m.action)).not.toContain('travel');
  });

  it('does not crash in the choices closure the condition was guarding', () => {
    const game = started();
    (game.getPlayer(1) as Scout).position = 0;
    expect(() => enumerateLegalMoves(game, 1)).not.toThrow();
  });

  it('still offers the actions whose conditions do hold', () => {
    const game = started();
    (game.getPlayer(1) as Scout).position = 0;
    expect(enumerateLegalMoves(game, 1).map((m) => m.action)).toContain('rest');
  });
});

describe('an action-level validate()', () => {
  it('enumerates only the submissions validate would accept', () => {
    const game = started();
    (game.getPlayer(1) as Scout).actionPoints = 2;

    const distances = enumerateLegalMoves(game, 1)
      .filter((m) => m.action === 'sprint')
      .map((m) => m.args.distance);

    expect(distances).toEqual([1, 2]);
    // 3 costs more than the seat has, and validate() says so.
    expect(distances).not.toContain(3);
  });

  it('drops the action entirely when validate refuses every option', () => {
    const game = started();
    (game.getPlayer(1) as Scout).actionPoints = 0;
    expect(enumerateLegalMoves(game, 1).map((m) => m.action)).not.toContain('sprint');
  });

  it('leaves an action with no validate hook alone', () => {
    expect(enumerateLegalMoves(started(), 1).map((m) => m.action)).toContain('rest');
  });
});

describe('what a bot would do with the result', () => {
  it('never enumerates a move the engine would then reject', () => {
    const game = started();
    (game.getPlayer(1) as Scout).position = 0;
    (game.getPlayer(1) as Scout).actionPoints = 1;

    // Every enumerated move must be one performAction would accept — that is
    // the whole contract, and the pump halted because it did not hold.
    const executor = game.getActionExecutor();
    const scout = game.getPlayer(1)!;
    for (const move of enumerateLegalMoves(game, 1)) {
      const actionDef = game.getAction(move.action)!;
      const validation = executor.validateAction(actionDef, scout, move.args);
      expect(validation.valid, `${move.action} ${JSON.stringify(move.args)}`).toBe(true);
    }
  });
});
