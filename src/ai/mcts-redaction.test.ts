import { describe, it, expect } from 'vitest';
import {
  Game,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  simultaneousActionStep,
  loop,
  type GameOptions,
  type ElementJSON,
} from '../engine/index.js';
import { MCTSBot } from './mcts-bot.js';

// ============================================================================
// AI-02: MCTS soundness — the bot must clone a per-seat REDACTED view of the
// game (toJSONForPlayer), not the full un-redacted truth (toJSON), and must
// not sequentialize simultaneous reveals so a later co-decider sees an
// earlier one's committed pick. All tests here drive MCTSBot directly against
// in-file Game subclasses (per mcts-restore.test.ts) — never the excluded
// checkers-dependent mcts-bot.test.ts.
// ============================================================================

/**
 * Walk a serialized element tree and find the element with the given `id`.
 * A single individually-hidden element (`showOnlyTo`/`hideFrom`) keeps its
 * real, stable id in the redacted view (game.ts: intentional for FLIP
 * animation correlation) but DROPS `name` -- so hidden-element lookups must
 * key off `id`, not `name`.
 */
function findById(json: ElementJSON, id: number): ElementJSON | undefined {
  if (json.id === id) return json;
  for (const child of json.children ?? []) {
    const found = findById(child, id);
    if (found) return found;
  }
  return undefined;
}

// ----------------------------------------------------------------------------
// Fixture 1: hidden-attribute redaction + exploitability.
//
// Seat 2 (the opponent) holds a face-down card only they can see
// (`showOnlyTo(2)`). Seat 1 (the bot) must guess the card's value. The action
// offers 3 choices (>=2 moves, per CONTEXT/RESEARCH) so MCTSBot's 1-move
// short-circuit (mcts-bot.ts:224) does not bypass the clone path.
// ----------------------------------------------------------------------------

class SecretCard extends Piece<HiddenInfoGame> {
  value!: number;
}

class HiddenInfoGame extends Game<HiddenInfoGame, Player> {
  opponentHand!: Space<HiddenInfoGame>;
  secretCard!: SecretCard;
  /** Bot's most recent guess -- a plain (non-element) property, read by the
   *  `objectives` checker below so scoring is a pure state READ with no
   *  mutation to undo (game.finish()'s settings.winners mutation is a plain
   *  field outside the command system and is NOT reverted by MCTS's
   *  incremental undoCommands -- see MEMORY.md testing notes. Avoiding
   *  finish() entirely keeps this fixture from tripping that pre-existing,
   *  out-of-scope limitation). */
  lastGuess?: number;

  constructor(options: GameOptions & { secretValue: number }) {
    super(options);
    const { secretValue } = options;

    this.opponentHand = this.create(Space<HiddenInfoGame>, 'opponentHand');
    this.secretCard = this.opponentHand.create(SecretCard, 'secretCard', { value: secretValue });
    // Only the opponent (seat 2) can see the card; the bot (seat 1) must not.
    this.secretCard.showOnlyTo(2);

    this.registerAction(
      Action.create('guess')
        .chooseFrom('guessedValue', {
          prompt: 'Guess the hidden card value',
          choices: [1, 2, 3],
        })
        .execute((args, ctx) => {
          (ctx.game as HiddenInfoGame).lastGuess = args.guessedValue as number;
          return { success: true };
        })
    );

    // A high maxIterations loop (never exhausted by these single-guess tests)
    // keeps the flow perpetually non-terminal, so MCTS scores via the
    // `objectives` hook (a pure read) instead of the terminal-winner path.
    this.setFlow(defineFlow({
      root: loop({
        maxIterations: 20,
        do: actionStep({ actions: ['guess'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    }));
  }
}

function createHiddenInfoGame(secretValue: number, seed: string) {
  const game = new HiddenInfoGame({
    playerCount: 2,
    playerNames: ['Bot', 'Opponent'],
    seed,
    secretValue,
  } as GameOptions & { secretValue: number });
  game.startFlow();
  return game;
}

function makeBot(game: HiddenInfoGame, seed: string) {
  return new MCTSBot(
    game,
    HiddenInfoGame,
    'hidden-info',
    1, // bot plays seat 1
    [],
    { iterations: 40, playoutDepth: 0, seed, async: false, usePNS: false },
    {
      // The bot "wins" (achieved=1) when its guess matches the hidden card's
      // TRUE value -- a full-info clone can always satisfy this; a redacted
      // clone (post-fix) sees `value` as undefined and can never match it.
      objectives: (game) => ({
        correctGuess: {
          weight: 1,
          checker: (g) => {
            const hg = g as HiddenInfoGame;
            return hg.lastGuess !== undefined && hg.lastGuess === hg.secretCard.value ? 1 : 0;
          },
        },
      }),
    },
  );
}

describe('MCTSBot redaction (AI-02 / T-159-06)', () => {
  it('captured snapshot does not expose the opponent\'s hidden card value', () => {
    const game = createHiddenInfoGame(2, 'redact-1');
    const bot = makeBot(game, 'redact-1');

    // Reach into the bot's private capture path directly (mirrors
    // mcts-restore.test.ts's use of `(bot as any).restoreGame`).
    const snapshot = (bot as any).captureSnapshot();
    const secretCardJson = findById(snapshot.state as ElementJSON, game.secretCard.id);

    expect(secretCardJson).toBeDefined();
    // Pre-fix: captureSnapshot clones game.toJSON() (full truth) -- the
    // hidden card's real value attribute is present. Post-fix it must be
    // redacted via toJSONForPlayer(botSeat).
    expect(secretCardJson!.attributes.value).toBeUndefined();
    expect(secretCardJson!.attributes.__hidden).toBe(true);
  });

  it('the redacted clone restores into a valid, playable game (restorability guard)', () => {
    const game = createHiddenInfoGame(2, 'restore-1');
    const bot = makeBot(game, 'restore-1');

    const snapshot = (bot as any).captureSnapshot();
    const restored = (bot as any).restoreGame(snapshot) as HiddenInfoGame;

    // Must be a valid, playable clone: flow intact, actions enumerable.
    const flowState = restored.getFlowState();
    expect(flowState?.awaitingInput).toBe(true);
    expect(flowState?.availableActions).toContain('guess');
    expect(restored.getAvailableActions(restored.getPlayer(1) as any).length).toBeGreaterThan(0);
  });

  it('a naive full-info bot always guesses the hidden card correctly (exploitability baseline)', async () => {
    // This documents the CURRENT (unfixed) exploit: with no redaction, the
    // bot's search clone sees the true secret value and the proof-number
    // solver deterministically finds the winning guess every time.
    const secretValues = [1, 2, 3];
    const results: boolean[] = [];
    for (const secretValue of secretValues) {
      const game = createHiddenInfoGame(secretValue, `exploit-${secretValue}`);
      const bot = makeBot(game, `exploit-${secretValue}`);
      const move = await bot.play();
      results.push(move.args.guessedValue === secretValue);
    }
    // Not asserted -- this is the pre-fix ground truth, captured for the
    // commit message (PROC-01). See the next test for the actual RED
    // assertion (the bot must NOT always exploit hidden info).
    expect(results.length).toBe(3);
  });

  it('the bot does not always exploit knowledge of the hidden card (non-exploitability)', async () => {
    const secretValues = [1, 2, 3];
    const matches: boolean[] = [];
    for (const secretValue of secretValues) {
      const game = createHiddenInfoGame(secretValue, `nonexploit-${secretValue}`);
      const bot = makeBot(game, `nonexploit-${secretValue}`);
      const move = await bot.play();
      matches.push(move.args.guessedValue === secretValue);
    }
    // Pre-fix: the bot's redacted-free clone sees the true value and always
    // guesses correctly -- all three match, so this assertion FAILS today.
    // Post-fix: the bot's search has no informational edge; it must not
    // match the secret in every trial.
    expect(matches.every(Boolean)).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// Fixture 2: simultaneous co-decider leak.
//
// Seats 1 (bot) and 2 both pick one of ['x','y','z'] in a single
// simultaneousActionStep; a player may not pick a value another player has
// already taken (checked against a shared `board` Space populated by each
// player's own `execute()`). In REAL simultaneous play neither player sees
// the other's pick before committing. The MCTS search must mirror that: the
// second co-decider's enumerated move set must not depend on which specific
// value the first co-decider chose.
// ----------------------------------------------------------------------------

class Marker extends Piece<SimultaneousGame> {
  choice!: string;
  owner!: number;
}

class SimultaneousGame extends Game<SimultaneousGame, Player> {
  board!: Space<SimultaneousGame>;

  constructor(options: GameOptions) {
    super(options);
    this.registerElements([Marker]);
    this.board = this.create(Space<SimultaneousGame>, 'board');

    this.registerAction(
      Action.create('pick')
        .chooseFrom('choice', {
          prompt: 'Pick one',
          choices: (ctx) => {
            const game = ctx.game as SimultaneousGame;
            const taken = new Set(game.board.all(Marker).map((m) => m.choice));
            return ['x', 'y', 'z'].filter((c) => !taken.has(c));
          },
        })
        .execute((args, ctx) => {
          const game = ctx.game as SimultaneousGame;
          game.board.create(Marker, 'marker', {
            choice: args.choice as string,
            owner: ctx.player.seat,
          });
          return { success: true };
        })
    );

    this.setFlow(defineFlow({
      root: simultaneousActionStep({
        actions: ['pick'],
        playerDone: (ctx, player) =>
          (ctx.game as SimultaneousGame).board.all(Marker).some((m) => m.owner === player.seat),
      }),
      isComplete: (ctx) =>
        (ctx.game as SimultaneousGame).board.all(Marker).length >= ctx.game.all(Player as any).length,
      getWinners: () => [],
    }));
  }
}

function createSimultaneousGame(seed: string) {
  const game = new SimultaneousGame({
    playerCount: 2,
    playerNames: ['Bot', 'Opponent'],
    seed,
  });
  game.startFlow();
  return game;
}

describe('MCTSBot simultaneous-step soundness (AI-02 / T-159-07)', () => {
  /**
   * Drive the bot's low-level search primitives directly (bypassing the tree
   * SELECT/EXPAND machinery, whose incremental undo does not revert the flow
   * engine's own `awaitingPlayers[].completed` bookkeeping across sibling
   * root branches -- an unrelated, pre-existing limitation orthogonal to
   * T-159-07). This isolates exactly the leak vector under test: seat 1
   * commits a pick on the shared searchGame, then seat 2's moves are
   * enumerated. `maybeCaptureSimultaneousBaseline` is the hook the fix adds
   * (mcts-bot.ts) -- called optionally so this test is genuinely RED before
   * the fix exists (no such method) and exercises it once added.
   */
  function seat2ChoicesAfterSeat1Picks(pick: string): Set<string> {
    const game = createSimultaneousGame(`sim-${pick}`);
    const bot: any = new MCTSBot(
      game,
      SimultaneousGame,
      'simultaneous',
      1, // bot plays seat 1, listed first in awaitingPlayers
      [],
      { iterations: 1, playoutDepth: 0, seed: `sim-${pick}`, async: false },
    );

    bot.searchGame = bot.restoreGame(bot.captureSnapshot());
    const preRevealFlowState = bot.searchGame.getFlowState();

    // Mirror the fix's integration point: capture the pre-reveal baseline
    // BEFORE seat 1's pick mutates the shared searchGame. No-op pre-fix.
    bot.maybeCaptureSimultaneousBaseline?.(preRevealFlowState);

    const postPickFlowState = bot.searchGame.continueFlow('pick', { choice: pick }, 1);
    const seat2Moves = bot.enumerateMovesForSimulation(bot.searchGame, postPickFlowState);
    return new Set((seat2Moves as Array<{ args: { choice: string } }>).map((m) => m.args.choice));
  }

  it('a co-decider\'s enumerated moves do not depend on the earlier co-decider\'s committed pick', () => {
    const afterX = seat2ChoicesAfterSeat1Picks('x');
    const afterY = seat2ChoicesAfterSeat1Picks('y');
    const afterZ = seat2ChoicesAfterSeat1Picks('z');

    // Pre-fix: seat 2's enumeration runs against the LIVE searchGame, which
    // already carries seat 1's committed marker -- each set EXCLUDES
    // whichever value seat 1 picked (a real leak of seat 1's exact pick into
    // seat 2's search), so the three sets differ. Post-fix: seat 2's
    // enumeration reads the pre-reveal baseline, so all three sets are
    // identical (independent of seat 1's pick).
    expect(afterY).toEqual(afterX);
    expect(afterZ).toEqual(afterX);
  });
});
