/**
 * Policies: what decides each seat's move in a simulated game (#556).
 *
 * A policy is handed the live game with one seat to move and answers with a
 * move. It runs read-only: the simulator refuses, naming the policy, any
 * policy whose work changes the game. Because it reads the real game, a policy
 * can read cards its seat cannot see; one that plays fair must not.
 *
 * A project lists its own policies in `src/sim/index.ts`
 * (`export const policies = { ... }`) for `boardsmith simulate --policy`.
 *
 * @module
 */
import type {
  Game,
  ActionDefinition,
  Selection,
  NumberSelection,
  ChoiceSelection,
  ElementsSelection,
  Player,
  GameClass,
  FollowUpAction,
  GameMetrics,
} from '../engine/index.js';
import { followUpForSeat, MoveListTooLargeError } from '../engine/index.js';
import { enumerateActionMoves, enumerateLegalMoves, numberInputValues } from '../engine/utils/enumerate-moves.js';
import { createBot } from '../bot/index.js';
import type { BotStrategy, DifficultyLevel } from '../bot/types.js';
import type { SeededRandom } from '../utils/random.js';

/** The parts of a game definition a simulation reads. */
export interface SimulatedGame<G extends Game = Game> {
  gameClass: GameClass<G>;
  /** Needed by {@link mcts}, which snapshots the game under it. */
  gameType?: string;
  /** When given, a player count outside this range is refused. */
  minPlayers?: number;
  maxPlayers?: number;
  /** The game's bot strategy, which {@link mcts} searches with. */
  bot?: BotStrategy;
  /** The game's author metrics (`defineMetrics`), which the simulator records and reports. */
  metrics?: GameMetrics;
}

/** A move as a seat submits it. */
export interface PolicyMove {
  action: string;
  args: Record<string, unknown>;
}

/** A policy's answer: a move, or why its seat has none it can play. */
export type PolicyChoice = PolicyMove | { noMove: string };

/** What a policy is handed each time its seat is to move. */
export interface PolicyTurn {
  /** The live game. Read it only: a policy that changes it is refused. */
  game: Game;
  /** The seat to move. */
  seat: number;
  /** The seat's enabled actions. */
  actions: string[];
  /** This seat's own seeded generator, so one seat's policy never moves another seat's draws. */
  random: SeededRandom;
  /** The game being simulated. */
  definition: SimulatedGame;
}

/**
 * Decides a seat's moves. `name` is how errors refer to it; `boardsmith
 * simulate` names a project's policy by its key in the project's `policies`.
 */
export interface Policy {
  readonly name: string;
  choose(turn: PolicyTurn): PolicyChoice | Promise<PolicyChoice>;
}

/**
 * One enumerated selection, reported to `onSelectionChoices` as the random
 * policy builds a move.
 *
 * A choice step's candidate count only exists while a game is running, so this
 * is the one place a build-time tool can learn it without re-implementing move
 * enumeration. `boardsmith validate` uses it for the choice-cardinality audit
 * (#172).
 */
export interface SelectionChoicesObservation {
  /** Name of the action being enumerated. */
  action: string;
  /** The selection definition, verbatim — carries boardRef/boardRefs/dependsOn. */
  selection: Selection;
  /** How many ENABLED candidates the step offered at this moment. */
  candidateCount: number;
}

/**
 * Builds one random, valid move from each enabled action, step by step from
 * the engine's own choices, and from the seat's held follow-up (#911), and
 * plays one of them. `onSelectionChoices` sees
 * every choice, element and elements step it builds (not a repeating one,
 * whose candidates exist only on a scratch copy); it cannot change the game.
 */
export function random(
  options: { onSelectionChoices?: (observation: SelectionChoicesObservation) => void } = {},
): Policy {
  return {
    name: 'random',
    choose({ game, seat, actions, random: rng }) {
      const player = game.getPlayer(seat);
      if (!player) return { noMove: `No playable move for player ${seat}: there is no such player.` };
      const moves: PolicyMove[] = [];
      const reasons: string[] = [];
      for (const action of actions) {
        const actionDef = game.getAction(action);
        if (!actionDef) {
          reasons.push(`action '${action}' is not registered on the game`);
          continue;
        }
        const built = buildRandomArgs(game, actionDef, player, rng, options.onSelectionChoices);
        if (built.ok) moves.push({ action, args: built.args });
        else reasons.push(built.reason);
      }
      const followUp = randomFollowUpMove(game, player, rng);
      if (followUp && 'reason' in followUp) reasons.push(followUp.reason);
      else if (followUp) moves.push(followUp);
      if (moves.length > 0) return rng.pick(moves);
      return {
        noMove:
          `No playable move for player ${seat}. ` +
          (reasons.length > 0 ? `Reasons: ${reasons.join('; ')}. ` : '') +
          'The random simulator generates valid arguments from action choices; ' +
          'actions needing free-form input (text, unbounded numbers) must be made optional ' +
          'or driven by a custom harness.',
      };
    },
  };
}

/**
 * One random move from the seat's held follow-up, why it has none, or
 * `undefined` when it holds none. A follow-up is not among the seat's actions,
 * and its bound args come from the follow-up itself (#911).
 */
function randomFollowUpMove(game: Game, player: Player, rng: SeededRandom): PolicyMove | { reason: string } | undefined {
  const followUp = followUpForSeat(game.getFlowState(), player.seat);
  if (!followUp) return undefined;
  const actionDef = game.getAction(followUp.action);
  if (!actionDef) return { reason: `follow-up '${followUp.action}' is not registered on the game` };
  const moves = enumerateActionMoves(game, actionDef, player, { followUp, sampleAboveBudget: { count: 1, random: rng } });
  if (moves.length === 0) {
    return {
      reason:
        `follow-up '${followUp.action}' has no move the simulator can list: ` +
        'every pick is refused, or a number input lacks min, max and integer: true',
    };
  }
  return { action: followUp.action, args: rng.pick(moves) };
}

/**
 * Scores every legal move of the seat (`enumerateLegalMoves`) and plays the
 * highest, breaking a tie with the seat's own generator. `score` must return a
 * finite number and only read the game. A number input is listed only when it
 * declares min, max and `integer: true` within enumeration's cap (#689), so
 * greedy refuses a seat offered any other, as an action or as a held follow-up
 * whose args do not already answer it. It refuses a seat with an action whose
 * moves enumeration will not list for being too many (#691), too: scoring a
 * sample would not be greedy.
 */
export function greedy<G extends Game>(score: (game: G, move: PolicyMove, seat: number) => number): Policy {
  return {
    name: 'greedy',
    choose({ game, seat, actions, random: rng }) {
      const followUp = followUpForSeat(game.getFlowState(), seat);
      const unlistable = unlistableNumberInput(game, actions, followUp);
      if (unlistable) return { noMove: unlistable };
      let moves: PolicyMove[];
      try {
        moves = enumerateLegalMoves(game, seat);
      } catch (error) {
        if (!(error instanceof MoveListTooLargeError)) throw error;
        return { noMove: `greedy cannot list player ${seat}'s moves: ${error.message} Or play this seat with random.` };
      }
      let best: PolicyMove[] = [];
      let bestScore = -Infinity;
      for (const move of moves) {
        const value = score(game as G, move, seat);
        if (!Number.isFinite(value)) {
          throw new Error(`greedy's score returned ${value} for player ${seat}'s '${move.action}'. Return a finite number.`);
        }
        if (value > bestScore) [best, bestScore] = [[move], value];
        else if (value === bestScore) best.push(move);
      }
      if (best.length === 0) return { noMove: `greedy found no legal move for player ${seat}.` };
      return rng.pick(best);
    },
  };
}

/**
 * Why greedy cannot list one of the seat's offered moves, or `undefined`: an
 * enabled action, or the held follow-up, with a number input its args do not
 * already answer and enumeration cannot list (#689).
 */
function unlistableNumberInput(game: Game, actions: string[], followUp: FollowUpAction | undefined): string | undefined {
  const offered = [
    ...actions.map((action) => ({ action, args: {} })),
    ...(followUp ? [{ action: followUp.action, args: followUp.args ?? {} }] : []),
  ];
  for (const { action, args } of offered) {
    const unanswered = (game.getAction(action)?.selections ?? []).filter(
      (s): s is NumberSelection => s.type === 'number' && !(s.name in args),
    );
    for (const input of unanswered) {
      const listed = numberInputValues(input);
      if ('unlistable' in listed) {
        return (
          `greedy cannot play action '${action}': its number input '${input.name}' cannot be listed: ` +
          `${listed.unlistable} Or play this seat with random.`
        );
      }
    }
  }
  return undefined;
}

/**
 * Plays the game's own MCTS bot (`gameDefinition.bot`) at `level`: a
 * difficulty name or an iteration count. Each search is seeded from the
 * seat's generator and runs its full iterations with no time limit, so a
 * seeded simulation plays the same moves every time.
 */
export function mcts(level: DifficultyLevel | number): Policy {
  const name = `mcts:${level}`;
  return {
    name,
    async choose({ game, seat, random: rng, definition }) {
      if (definition.gameType === undefined) {
        throw new Error(`${name} needs the game definition's gameType. Simulate the whole game definition, not only its class.`);
      }
      const bot = createBot(game, definition.gameClass, definition.gameType, seat, [], level, definition.bot, {
        seed: String(rng.next()),
      });
      const move = await bot.play();
      return move ?? { noMove: `${name} found no move for player ${seat}: ${bot.lastStallReason ?? 'no reason recorded'}` };
    },
  };
}

/**
 * Resolve a selection's count config -- a `multiSelect` set or an `orderedList`
 * sequence (#249) -- into concrete {min, max}, or null if the selection is
 * single-valued. Both are written the same three ways (a number, a config, or a
 * function of context), which is why one parser answers for both.
 * @internal
 */
function resolveBounds(
  raw: unknown,
  ctx: { game: Game; player: Player; args: Record<string, unknown> }
): { min: number; max: number } | null {
  const value = typeof raw === 'function' ? (raw as (c: typeof ctx) => unknown)(ctx) : raw;
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') return { min: 1, max: value };
  const cfg = value as { min?: number; max?: number };
  return { min: cfg.min ?? 1, max: cfg.max ?? Infinity };
}

/**
 * Build one random, valid set of arguments for an action using the engine's
 * own choice introspection. Returns the buildable args, or a reason the action
 * cannot be randomly driven (so the caller can surface it instead of spinning).
 * @internal
 */
function buildRandomArgs(
  game: Game,
  actionDef: ActionDefinition,
  player: Player,
  rng: SeededRandom,
  onSelectionChoices?: (observation: SelectionChoicesObservation) => void
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  // A repeating selection's picks change the game (`onEach`) as they are made,
  // so what each pick may be is only known by making them. The engine's move
  // enumerator does exactly that on a scratch copy (#325); one of its moves is
  // the random move; above enumeration's budget (#692) it draws one at random
  // instead. Its selections are not reported to `onSelectionChoices`: their
  // candidates exist only on that copy.
  if (game.getActionExecutor().hasRepeatingSelections(actionDef)) {
    const moves = enumerateActionMoves(game, actionDef, player, { sampleAboveBudget: { count: 1, random: rng } });
    if (moves.length === 0) {
      return {
        ok: false,
        reason:
          `action '${actionDef.name}' has a repeating selection and no sequence of picks found that ends it ` +
          `(above enumeration's budget, the sequences tried are a few drawn at random)`,
      };
    }
    return { ok: true, args: rng.pick(moves) };
  }

  // Picks are kept as the elements and values offered, and submitted as they
  // are: performAction resolves an element by its id against the live game.
  const working: Record<string, unknown> = {};

  for (const sel of actionDef.selections) {
    const optional = Boolean(sel.optional);
    const ctx = { game, player, args: working };

    if (sel.type === 'text') {
      if (optional) continue;
      return {
        ok: false,
        reason: `action '${actionDef.name}' requires text input '${sel.name}', which the random simulator cannot generate`,
      };
    }

    if (sel.type === 'number') {
      const ns = sel as NumberSelection;
      if (ns.min === undefined || ns.max === undefined) {
        if (optional) continue;
        return {
          ok: false,
          reason: `action '${actionDef.name}' requires number input '${sel.name}' without both min and max bounds, which the random simulator cannot generate`,
        };
      }
      const lo = ns.integer ? Math.ceil(ns.min) : ns.min;
      const hi = ns.integer ? Math.floor(ns.max) : ns.max;
      if (hi < lo) {
        if (optional) continue;
        return {
          ok: false,
          reason: `action '${actionDef.name}' number input '${sel.name}' has an empty range [${ns.min}, ${ns.max}]`,
        };
      }
      working[sel.name] = ns.integer ? lo + rng.nextInt(hi - lo + 1) : lo + rng.next() * (hi - lo);
      continue;
    }

    // choice / element / elements -- driven by engine-provided choices
    const annotated = game.getSelectionChoices(actionDef.name, sel.name, player, working);
    const choices = annotated.filter(c => c.disabled === false).map(c => c.value);
    onSelectionChoices?.({ action: actionDef.name, selection: sel, candidateCount: choices.length });

    // AN ORDERED, REPEATABLE LIST (#249) is sampled WITH replacement: the same
    // identity may fill more than one entry, which is the one thing a set draw
    // cannot produce and therefore the one thing a random game would never
    // exercise if this fell through to the multiSelect path.
    const orderedListRaw =
      sel.type === 'choice' ? (sel as ChoiceSelection).orderedList : undefined;
    if (orderedListRaw !== undefined) {
      const bounds = resolveBounds(orderedListRaw, ctx);
      if (bounds) {
        if (choices.length === 0) {
          if (bounds.min <= 0 || optional) {
            if (bounds.min <= 0) working[sel.name] = [];
            continue;
          }
          return {
            ok: false,
            reason: `action '${actionDef.name}' selection '${sel.name}' needs at least ${bounds.min} entr(y/ies) but no choices are available`,
          };
        }
        const maxEntries = bounds.max === Infinity ? Math.max(bounds.min, choices.length) : bounds.max;
        const count = bounds.min + rng.nextInt(maxEntries - bounds.min + 1);
        working[sel.name] = Array.from({ length: count }, () => rng.pick(choices));
        continue;
      }
    }

    const multiSelectRaw =
      sel.type === 'choice'
        ? (sel as ChoiceSelection).multiSelect
        : sel.type === 'elements'
          ? (sel as ElementsSelection).multiSelect
          : undefined;
    // 'elements' selections always yield an array; default to "any non-empty subset".
    const multi =
      resolveBounds(multiSelectRaw, ctx) ?? (sel.type === 'elements' ? { min: 1, max: Infinity } : null);

    if (multi) {
      if (choices.length < multi.min) {
        if (optional) continue;
        return {
          ok: false,
          reason: `action '${actionDef.name}' selection '${sel.name}' needs at least ${multi.min} choice(s) but only ${choices.length} are available`,
        };
      }
      const maxPick = Math.min(multi.max === Infinity ? choices.length : multi.max, choices.length);
      const minPick = Math.max(multi.min, 0);
      const count = minPick + rng.nextInt(maxPick - minPick + 1);
      working[sel.name] = rng.shuffle(choices).slice(0, count);
      continue;
    }

    if (choices.length === 0) {
      if (optional) continue;
      return {
        ok: false,
        reason: `action '${actionDef.name}' selection '${sel.name}' has no selectable choices`,
      };
    }
    working[sel.name] = rng.pick(choices);
  }

  return { ok: true, args: working };
}
