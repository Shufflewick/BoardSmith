/**
 * The half of the bot benchmark that runs beside the game (#630).
 *
 * `run.mjs` bundles this file into one bundle with the game's rules, so the
 * bot, the engine and the game share one copy of BoardSmith, the copy in this
 * checkout. The game, the random moves that reach each position and the fixed
 * search are seeded, so they are the same on every run. The preset searches are
 * made as a game makes them, unseeded; their timeouts bound them anyway.
 */
import { createBot, MCTSBot } from '../../src/bot/index.ts';
import { GameRunner } from '../../src/runtime/index.ts';
import { dueSeats, availableActionsForSeat } from '../../src/engine/index.ts';
import { enumerateActionMoves } from '../../src/engine/utils/enumerate-moves.ts';
import { ElementCollection } from '../../src/engine/element/element-collection.ts';
import { SeededRandom } from '../../src/utils/random.ts';
import { isDevMode } from '../../src/utils/dev.ts';
import { measureSearch } from './profile.mjs';
import { pickPositions, FIXED_STEPS } from './report.mjs';

const SEED = 'bench-bot-630';

/** Where a game that has not ended is cut off. */
const MAX_PLIES = 2000;

const targets = { bot: MCTSBot.prototype, collection: ElementCollection.prototype };

/** Every move `seat` can make, with the engine's own move enumeration. */
function legalMoves(game, flowState, seat) {
  const player = game.getPlayer(seat);
  return availableActionsForSeat(flowState, seat).flatMap((name) => {
    const action = game.getAction(name);
    return action ? enumerateActionMoves(game, action, player).map((args) => ({ name, args })) : [];
  });
}

/** The seat to move and its moves, or nothing when the game is over or no seat can move. */
function nextTurn(runner) {
  const flowState = runner.getFlowState();
  if (!flowState || flowState.complete || !flowState.awaitingInput) return undefined;
  const seat = dueSeats(flowState)[0];
  if (seat === undefined) return undefined;
  const moves = legalMoves(runner.game, flowState, seat);
  return moves.length === 0 ? undefined : { seat, moves };
}

/**
 * Play the game with seeded random moves, calling `visit(runner, ply, seat,
 * moveCount)` before each one. The same seed plays the same game every time,
 * so a second play reaches the same positions. Ends when the game does, when
 * no seat has a move, when `visit` returns false, or at `MAX_PLIES`.
 *
 * @returns the number of moves made
 */
async function play(gameDefinition, setup, visit) {
  const runner = new GameRunner({
    GameClass: gameDefinition.gameClass,
    gameType: gameDefinition.gameType,
    gameOptions: { ...setup.options, playerCount: setup.playerCount, seed: SEED },
  });
  runner.start();
  const rng = new SeededRandom(`${SEED}-moves`);
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const turn = nextTurn(runner);
    if (!turn) return ply;
    const { seat, moves } = turn;
    if ((await visit(runner, ply, seat, moves.length)) === false) return ply;
    const move = rng.pick(moves);
    const result = runner.performAction(move.name, seat, move.args);
    if (!result.success) {
      throw new Error(`Seat ${seat}'s "${move.name}" at ply ${ply} was refused: ${result.error ?? 'no reason given'}`);
    }
  }
  return MAX_PLIES;
}

/**
 * A bot at a difficulty preset for `seat`'s turn in `runner`'s game, made as a
 * game makes it: unseeded and with its timeout, which bounds the search anyway.
 */
function presetBot(gameDefinition, runner, seat, level) {
  const { gameClass, gameType, bot: strategy } = gameDefinition;
  return createBot(runner.game, gameClass, gameType, seat, runner.actionHistory, level, strategy);
}

/** Every preset with its timeout, then the fixed search, each from `seat`'s turn in `runner`'s game. */
async function searchPosition(gameDefinition, runner, seat) {
  const presets = {};
  for (const level of ['easy', 'medium', 'hard']) {
    const bot = presetBot(gameDefinition, runner, seat, level);
    const { steps, ms } = await measureSearch(targets, () => bot.play(), { profile: false });
    presets[level] = { steps, ms };
  }
  const { gameClass, gameType, bot: strategy } = gameDefinition;
  const bot = createBot(runner.game, gameClass, gameType, seat, runner.actionHistory, FIXED_STEPS, strategy, { seed: SEED });
  const { result, ...fixed } = await measureSearch(targets, () => bot.play(), { profile: true });
  return { presets, fixed: { ...fixed, move: describeMove(runner.game, result) } };
}

/**
 * A move as the report shows it, with each element named rather than given by
 * id, wherever the id sits in the args: element ids differ from one process to
 * the next, names do not.
 */
function describeMove(game, move) {
  if (!move) return 'none';
  const describe = (value) => {
    if (Array.isArray(value)) return value.map(describe);
    if (typeof value === 'number') return game.getElementById(value)?.name ?? value;
    if (typeof value !== 'object' || value === null) return value;
    const element = typeof value.id === 'number' ? game.getElementById(value.id) : undefined;
    if (element) return element.name;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, describe(inner)]));
  };
  const args = Object.entries(move.args).map(([key, value]) => `${key}=${JSON.stringify(describe(value))}`);
  return [move.action, ...args].join(' ');
}

/**
 * Benchmark the bot on one game.
 *
 * @param setup `{ playerCount, options }` for the game's constructor.
 * @returns `{ devMode, plies, positions }`, `devMode` as the bundled engine saw it.
 */
export async function runBench(gameDefinition, setup) {
  const moveCounts = [];
  const plies = await play(gameDefinition, setup, (_runner, _ply, _seat, moveCount) => {
    moveCounts.push(moveCount);
  });
  const marks = pickPositions(moveCounts);

  const positions = [];
  let warmedUp = false;
  await play(gameDefinition, setup, async (runner, ply, seat) => {
    for (const mark of marks.filter((candidate) => candidate.ply === ply)) {
      if (!warmedUp) {
        // One unrecorded search first, so the first recorded one does not pay for compiling the code.
        await presetBot(gameDefinition, runner, seat, 'easy').play();
        warmedUp = true;
      }
      positions.push({ ...mark, seat, ...(await searchPosition(gameDefinition, runner, seat)) });
    }
    return positions.length < marks.length;
  });
  return { devMode: isDevMode(), plies, positions };
}
