import { describe, it, expect } from 'vitest';
import {
  Game,
  GameElement,
  Player,
  Piece,
  Space,
  Action,
  defineFlow,
  actionStep,
  simultaneousActionStep,
  forEach,
  loop,
  createSnapshot,
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

  constructor(options: GameOptions & { secretValue: number; guesserSeat?: number; choices?: number[] }) {
    super(options);
    const { secretValue, guesserSeat = 1, choices = [1, 2, 3] } = options;
    const holderSeat = guesserSeat === 1 ? 2 : 1;

    this.opponentHand = this.create(Space<HiddenInfoGame>, 'opponentHand');
    this.secretCard = this.opponentHand.create(SecretCard, 'secretCard', { value: secretValue });
    // Only the holder can see the card; the guesser (the bot) must not.
    this.secretCard.showOnlyTo(holderSeat);

    this.registerAction(
      Action.create('guess')
        .chooseFrom('guessedValue', {
          prompt: 'Guess the hidden card value',
          choices,
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
        do: actionStep({ actions: ['guess'], player: (ctx) => ctx.game.getPlayer(guesserSeat)! }),
      }),
    }));
  }
}

function createHiddenInfoGame(secretValue: number, seed: string, guesserSeat = 1, choices = [1, 2, 3]) {
  const game = new HiddenInfoGame({
    playerCount: 2,
    playerNames: ['P1', 'P2'],
    seed,
    secretValue,
    guesserSeat,
    choices,
  } as GameOptions & { secretValue: number; guesserSeat: number; choices: number[] });
  game.startFlow();
  return game;
}

function makeBot(game: HiddenInfoGame, seed: string, guesserSeat = 1) {
  return new MCTSBot(
    game,
    HiddenInfoGame,
    'hidden-info',
    guesserSeat, // bot plays the guesser seat
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

  it('non-exploitability holds across seeds AND across which seat is the bot (adversarial)', async () => {
    // Sweep secret values, several seeds per value, AND both possible bot
    // seats (guesser=1 holder=2, and the mirror guesser=2 holder=1) -- not
    // just the single seed/seat combination Task 1 proved. Pre-fix this
    // fails identically to the Task 1 case (100% exploit, deterministic
    // regardless of seed/seat); post-fix the bot has zero informational
    // edge in any of these configurations.
    const secretValues = [1, 2, 3];
    const seedSuffixes = ['a', 'b', 'c'];
    const guesserSeats = [1, 2];
    const matches: boolean[] = [];

    for (const guesserSeat of guesserSeats) {
      for (const secretValue of secretValues) {
        for (const suffix of seedSuffixes) {
          const seed = `adversarial-${guesserSeat}-${secretValue}-${suffix}`;
          const game = createHiddenInfoGame(secretValue, seed, guesserSeat);
          const bot = makeBot(game, seed, guesserSeat);
          const move = await bot.play();
          matches.push(move.args.guessedValue === secretValue);
        }
      }
    }

    expect(matches.length).toBe(guesserSeats.length * secretValues.length * seedSuffixes.length);
    // Not exploitable in ANY configuration -- the bot must not have found a
    // way to peek at the hidden value regardless of seat or seed.
    expect(matches.every(Boolean)).toBe(false);
  });
});

describe('createSnapshot non-bot default (T-159-08 guard)', () => {
  it('without `forSeat`, the snapshot stays FULL, un-redacted truth (runner.ts shape)', () => {
    const game = createHiddenInfoGame(2, 'guard-1');

    // The exact call shape runner.ts:527 uses -- no `opts` argument at all.
    const snapshot = createSnapshot(game, 'hidden-info', [], 'guard-1');
    const secretCardJson = findById(snapshot.state as ElementJSON, game.secretCard.id);

    expect(secretCardJson).toBeDefined();
    // The default path must NEVER redact -- only an explicit `forSeat` opts
    // into the bot's per-seat view. A non-bot consumer (GameRunner, undo
    // checkpoints, etc.) depends on this staying full truth.
    expect(secretCardJson!.attributes.value).toBe(2);
    expect(secretCardJson!.attributes.__hidden).toBeUndefined();
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

// ----------------------------------------------------------------------------
// CR-01 (159-REVIEW): root move enumeration + game-supplied heuristic hooks
// (threatResponseMoves / uctConstant) must run against the REDACTED clone,
// not `this.game` (full truth). Reuses HiddenInfoGame -- the hooks receive a
// live `Game` instance, so reading `secretCard.value` directly on the object
// they were handed proves which view (full vs redacted) they saw.
// ----------------------------------------------------------------------------

describe('MCTSBot root-decision redaction (AI-02 / CR-01)', () => {
  it('threatResponseMoves does not see the opponent\'s hidden card value at the ROOT', async () => {
    let sawValue: number | undefined = 'unset' as unknown as number;
    const secretValue = 2;
    const game = createHiddenInfoGame(secretValue, 'cr01-threat-1');
    const bot = new MCTSBot(
      game,
      HiddenInfoGame,
      'hidden-info',
      1, // bot plays the guesser seat
      [],
      { iterations: 5, playoutDepth: 0, seed: 'cr01-threat-1', async: false, usePNS: false },
      {
        threatResponseMoves: (g) => {
          sawValue = (g as HiddenInfoGame).secretCard.value;
          return { moves: [] };
        },
      },
    );

    await bot.play();

    // Pre-fix: threatResponseMoves is called with `this.game` (full truth) --
    // sawValue === secretValue (the real hidden value leaks into the root
    // heuristic). Post-fix: it's called with the redacted searchGame, whose
    // secretCard.value attribute was never populated (redacted away).
    expect(sawValue).toBeUndefined();
  });

  it('uctConstant does not see the opponent\'s hidden card value, even on the allMoves.length===1 fast path', async () => {
    let sawValue: number | undefined = 'unset' as unknown as number;
    const secretValue = 3;
    // Single choice -- forces the allMoves.length===1 fast path (mcts-bot.ts),
    // which historically returned BEFORE the redacted searchGame was ever
    // built. uctConstant is cached unconditionally at the top of runSearch,
    // before that length check, so it is called on this path too.
    const game = createHiddenInfoGame(secretValue, 'cr01-uct-1', 1, [secretValue]);
    const bot = new MCTSBot(
      game,
      HiddenInfoGame,
      'hidden-info',
      1,
      [],
      { iterations: 5, playoutDepth: 0, seed: 'cr01-uct-1', async: false, usePNS: false },
      {
        uctConstant: (g) => {
          sawValue = (g as HiddenInfoGame).secretCard.value;
          return Math.sqrt(2);
        },
      },
    );

    await bot.play();

    // Pre-fix: uctConstant(this.game, ...) -- sawValue === secretValue.
    // Post-fix: uctConstant is called against the redacted searchGame (built
    // unconditionally before the fast-path check), so the value is redacted.
    expect(sawValue).toBeUndefined();
  });
});

// ----------------------------------------------------------------------------
// CR-02 (159-REVIEW): an element-typed flow variable pointing at a
// FUNGIBLE hidden-zone child (anonymized to a synthetic negative id by
// toJSONForPlayer) must relink to a live GameElement on restore of the
// redacted clone, not degrade to a dead serialized marker object.
//
// Individually-hidden elements (`showOnlyTo`/`hideFrom`) keep their real,
// stable id in the redacted view (game.ts, intentional for FLIP animation),
// so they do NOT exercise this bug -- only a Space with zone-level
// `contentsHidden()`/`contentsCountOnly()`/owner-zone visibility anonymizes
// its children's ids, which is what this fixture uses.
// ----------------------------------------------------------------------------

class FlowCard extends Piece<HiddenFlowVarGame> {
  label!: string;
}

class HiddenFlowVarGame extends Game<HiddenFlowVarGame, Player> {
  secretZone!: Space<HiddenFlowVarGame>;
  lastGuess?: number;

  constructor(options: GameOptions) {
    super(options);

    this.secretZone = this.create(Space<HiddenFlowVarGame>, 'secretZone');
    this.secretZone.contentsHidden(); // zone-level: children get synthetic ids
    this.secretZone.create(FlowCard, 'card-a', { label: 'A' });
    this.secretZone.create(FlowCard, 'card-b', { label: 'B' });

    this.registerAction(
      Action.create('guess')
        .chooseFrom('guessedValue', {
          prompt: 'Guess',
          choices: [1, 2, 3],
        })
        .execute((args, ctx) => {
          (ctx.game as HiddenFlowVarGame).lastGuess = args.guessedValue as number;
          return { success: true };
        })
    );

    // forEach binds `currentCard` (an element-typed flow variable) to each
    // hidden-zone child in turn -- the exact pattern CR-02 flags as plausible
    // for hidden-info games (e.g. "for each card in the opponent's hidden
    // deck, do X"). The bot pauses on the first iteration's actionStep, so
    // `currentCard` is live in the flow position the moment captureSnapshot()
    // runs.
    this.setFlow(defineFlow({
      root: forEach({
        collection: (ctx) => (ctx.game as HiddenFlowVarGame).secretZone.all(FlowCard),
        as: 'currentCard',
        do: actionStep({ actions: ['guess'], player: (ctx) => ctx.game.getPlayer(1)! }),
      }),
    }));
  }
}

function createHiddenFlowVarGame(seed: string) {
  const game = new HiddenFlowVarGame({
    playerCount: 2,
    playerNames: ['P1', 'P2'],
    seed,
  });
  game.startFlow();
  return game;
}

describe('MCTSBot flow-variable relinking on redacted restore (AI-02 / CR-02)', () => {
  it('a forEach-bound flow variable over a hidden zone relinks to a live element post-restore, not a dead marker', () => {
    const game = createHiddenFlowVarGame('cr02-1');
    const bot: any = new MCTSBot(
      game,
      HiddenFlowVarGame,
      'hidden-flow-var',
      1,
      [],
      { iterations: 5, playoutDepth: 0, seed: 'cr02-1', async: false, usePNS: false },
    );

    const snapshot = bot.captureSnapshot();
    const restored = bot.restoreGame(snapshot) as HiddenFlowVarGame;

    // Sanity: the clone is still a valid, playable game (locked requirement).
    const flowState = restored.getFlowState();
    expect(flowState?.awaitingInput).toBe(true);
    expect(flowState?.availableActions).toContain('guess');

    // Inspect what the forEach-bound flow variable resolved to on the
    // RESTORED (redacted) clone. This reaches into the private flow-engine
    // field the same way `bot.captureSnapshot()`/`bot.restoreGame()` are
    // reached into above (mirrors mcts-restore.test.ts's established pattern
    // for exercising internals no public API exposes).
    const currentCard = (restored as any)._flowEngine.variables.currentCard;

    // Pre-fix: `currentCard`'s original id no longer resolves in the redacted
    // tree (its zone-level redaction anonymized it to a synthetic negative
    // id) -- relinkFlowVariables leaves the raw `{__flowElementId,className}`
    // marker object in place, so `currentCard` is a plain object, not a
    // GameElement. Post-fix: the id remap relinks it to the correct redacted
    // placeholder GameElement.
    expect(currentCard).toBeInstanceOf(GameElement);

    // The clone must also still be genuinely PLAYABLE: driving the action
    // through to completion must not throw or corrupt state.
    restored.continueFlow('guess', { guessedValue: 1 }, 1);
    expect(restored.lastGuess).toBe(1);
  });
});
