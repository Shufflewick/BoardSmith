/**
 * The part of `boardsmith simulate` built INTO the rules bundle (#556): it turns `--policy` flags
 * into seat policies and plays a list of games.
 *
 * The rules are bundled with the engine inlined, so the policies and the game loop that drive
 * them must come out of the same bundle, or `mcts` would search on a second copy of the engine.
 * A worker thread imports the bundle and calls {@link playShard} on its slice of the games; a run
 * with `--jobs 1` and a replay call the same function in-process.
 */
import { playGame, type SingleGameResult } from '../../sim/play-game.js';
import { random, mcts, type Policy, type SimulatedGame } from '../../sim/policies.js';
import { parseBotLevel } from '../../bot/index.js';

const BUILT_IN_POLICIES = 'random, mcts:<level>';

/** The policy a `--policy` name stands for: a built-in, or one of the project's. */
function policyNamed(name: string, project: Record<string, Policy>): Policy {
  if (name === 'random') return random();
  if (name.startsWith('mcts:')) return mcts(parseBotLevel(name.slice('mcts:'.length)));
  // Named by its key, so an error names the policy the author listed, not the builder it came from.
  // `choose` is called on the policy itself, so a class policy keeps its prototype and `this`.
  if (Object.hasOwn(project, name)) {
    const policy = project[name];
    return { name, choose: (turn) => policy.choose(turn) };
  }
  const names = [BUILT_IN_POLICIES, ...Object.keys(project)].join(', ');
  throw new Error(
    `Unknown policy "${name}". Use one of: ${names}; or add it to the policies src/sim/index.ts exports.`,
  );
}

/** Refuse a project policy list entry that is not a policy or that takes a built-in name. */
function checkProjectPolicies(project: Record<string, unknown>): Record<string, Policy> {
  for (const [name, policy] of Object.entries(project)) {
    if (name === 'random' || name.startsWith('mcts:')) {
      throw new Error(`src/sim/index.ts names a policy "${name}", which is a built-in policy's name. Rename it.`);
    }
    const candidate = policy as Partial<Policy> | null;
    if (typeof candidate?.name !== 'string' || typeof candidate.choose !== 'function') {
      throw new Error(
        `src/sim/index.ts's policy "${name}" is not a policy. Build it with greedy, random or mcts from boardsmith/sim.`,
      );
    }
  }
  return project as Record<string, Policy>;
}

/**
 * One policy per seat of a `playerCount` game, from the `--policy` flags: a
 * bare name sets every seat, `seat=name` sets one, and seats no flag names
 * play `random`. `project` is the policies the project's `src/sim/index.ts`
 * exports. Throws on an unknown name, a seat the game does not have, or a seat
 * named twice.
 */
export function seatPolicies(
  flags: readonly string[] | undefined,
  project: Record<string, Policy> | undefined,
  playerCount: number,
): Policy[] {
  const known = checkProjectPolicies(project ?? {});
  let everySeat: string | undefined;
  const bySeat = new Map<number, string>();
  for (const flag of flags ?? []) {
    const seatFlag = /^(\d+)=(.+)$/.exec(flag);
    if (!seatFlag) {
      if (everySeat !== undefined) {
        throw new Error(`--policy ${everySeat} and --policy ${flag} give more than one policy for every seat. Give one, and set single seats with seat=name.`);
      }
      everySeat = flag;
      continue;
    }
    const seat = Number(seatFlag[1]);
    if (seat < 1 || seat > playerCount) {
      throw new Error(`--policy ${flag} names seat ${seat}, which a ${playerCount}-player game does not have. Seats are 1 to ${playerCount}.`);
    }
    if (bySeat.has(seat)) throw new Error(`--policy names seat ${seat} more than once.`);
    bySeat.set(seat, seatFlag[2]);
  }
  return Array.from({ length: playerCount }, (_, i) => policyNamed(bySeat.get(i + 1) ?? everySeat ?? 'random', known));
}

/** What the rules bundle exports for a simulation: the game, the project's policies, and this module's runner. */
export interface SimulationBundle {
  gameDefinition: SimulatedGame;
  policies?: Record<string, Policy>;
  playShard: typeof playShard;
}

/** Games to play, and how: plain data, so it can be posted to a worker thread. */
export interface ShardRequest {
  games: Array<{ seed: string; players: number }>;
  /** The `--policy` flags that pick each seat's policy. */
  policyFlags: readonly string[];
  gameOptions: Record<string, unknown>;
  maxActions: number;
}

/** Play `request.games` in order with the bundle's own game and policies. */
export async function playShard(bundle: SimulationBundle, request: ShardRequest): Promise<SingleGameResult[]> {
  // Always a metrics object, so a game that records without declaring gameDefinition.metrics is refused, naming the metric.
  const recorded = { ...bundle.gameDefinition, metrics: bundle.gameDefinition.metrics ?? {} };
  const played: SingleGameResult[] = [];
  for (const game of request.games) {
    played.push(await playGame(recorded, {
      playerCount: game.players,
      seed: game.seed,
      policies: seatPolicies(request.policyFlags, bundle.policies, game.players),
      maxActions: request.maxActions,
      gameOptions: request.gameOptions,
    }));
  }
  return played;
}
