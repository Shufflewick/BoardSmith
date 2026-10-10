/**
 * The persistence commit rides on the op result, and on no view (#527).
 *
 * A game writes durable state through two reserved game-root attributes:
 * `persist` (public) and `persistPrivate` (sealed). The engine reads both off
 * the game root after every op that runs the game and returns them as
 * `persistCommit`, and leaves both out of every seat's and the spectator's
 * view, so no host has to dig a commit out of a view or strip a secret off one.
 */
import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, loop, type GameOptions, type PlayerViewFunction } from '../engine/index.js';
import { executeOp, type GameDefinitionLike, type StateEnvelope } from './stateless-ops.js';
import { boundaryKeyOf } from './testing/boundary-stamp.js';
import { succeeded } from './op-result.test-helper.js';

const PUBLIC_RECORD = { entries: [{ key: 'hall-of-fame', value: { winner: 'PUBLIC-WINNER' } }] };
const SEALED_RECORD = { entries: [{ key: 'player:p1/sheet', value: { secret: 'SEALED-SECRET' } }] };

/** A game that writes both channels when it finishes. */
class RecordingGame extends Game<RecordingGame, Player> {
  persist: unknown = undefined;
  persistPrivate: unknown = undefined;

  constructor(options: GameOptions) {
    super(options);
    this.registerAction(
      Action.create('finish').execute(() => {
        this.persist = PUBLIC_RECORD;
        this.persistPrivate = SEALED_RECORD;
        this.finish([this.getPlayer(1)!]);
        return { success: true };
      }),
    );
    this.setFlow({
      root: loop({
        while: () => !this.isFinished(),
        maxIterations: 10,
        do: actionStep({ actions: ['finish'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    });
  }
}

/** The same game, projecting each seat's view through its own hook. */
class HookedRecordingGame extends RecordingGame {
  static override playerView: PlayerViewFunction = (state) => state;
}

const options = { playerCount: 2, seed: 'persist-commit' };

async function finished(gameClass: typeof RecordingGame) {
  const def: GameDefinitionLike = { gameClass, gameType: 'recording', minPlayers: 2, maxPlayers: 2 };
  const started = succeeded(await executeOp(def, options, null, null, { type: 'start' }));
  const done = succeeded(await executeOp(def, options, started.snapshot, null, {
    type: 'action', actionName: 'finish', player: 1, args: {}, boundaryKey: boundaryKeyOf(started.snapshot),
  }));
  return { started, done };
}

/** Every view an op result publishes, as the text that would go on the wire. */
function publishedText(result: StateEnvelope): string {
  return JSON.stringify([...result.playerViews, result.spectatorView]);
}

describe('the persistence commit (#527)', () => {
  for (const gameClass of [RecordingGame, HookedRecordingGame]) {
    describe(gameClass.name, () => {
      it('is returned on the op result, both channels at once', async () => {
        const { done } = await finished(gameClass);
        expect(done.persistCommit).toEqual({ public: PUBLIC_RECORD, private: SEALED_RECORD });
      });

      it('is in no seat\'s view and not in the spectator\'s', async () => {
        const { done } = await finished(gameClass);
        const text = publishedText(done);
        expect(text).not.toContain('persistPrivate');
        expect(text).not.toContain('SEALED-SECRET');
        expect(text).not.toContain('"persist"');
        expect(text).not.toContain('PUBLIC-WINNER');
      });

      it('stays in the snapshot, so the game keeps it across ops', async () => {
        const { done } = await finished(gameClass);
        expect(done.snapshot.state.attributes).toMatchObject({ persist: PUBLIC_RECORD, persistPrivate: SEALED_RECORD });
      });
    });
  }

  it('is empty for a game that has written nothing', async () => {
    const { started } = await finished(RecordingGame);
    expect(started.persistCommit).toEqual({});
  });
});
