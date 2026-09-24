/**
 * The one way BoardSmith writes the command that replays a random game (#322).
 *
 * `boardsmith simulate` prints it under each failing game, and `boardsmith
 * validate`'s choice cardinality check prints it when it could not play a
 * game. A random game is fixed by three things: its own per-game seed (not the
 * run's base seed, which `simulate --seed` derives new seeds from), its seat
 * count, and the game options it ran with. The command carries all three and
 * replays through `simulate --replay`, which plays exactly that one game.
 */

/** The facts that fix one random game, as the simulator reports them. */
interface ReplayableGame {
  /** The game's own seed (`SingleGameResult.seed`), not the run's base seed. */
  seed: string;
  /** The seat count the game ran with. */
  playerCount: number;
}

/** Quote one argument so a POSIX shell passes it through unchanged. */
function shellArg(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `boardsmith simulate --replay` command that plays `game` again, ready to
 * paste into a shell. `gameOptions` is the resolved option bundle the game ran
 * with; each value must be one a `--game-option key=value` flag can express.
 */
export function simulateReplayCommand(
  game: ReplayableGame,
  gameOptions: Record<string, unknown>,
): string {
  const args = ['--replay', game.seed, '--players', String(game.playerCount)];
  for (const [key, value] of Object.entries(gameOptions)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(
        `Cannot write a replay command: game option "${key}" is ${JSON.stringify(value)}, ` +
          `and --game-option only takes a string, number or true/false.`,
      );
    }
    args.push('--game-option', `${key}=${String(value)}`);
  }
  return ['boardsmith', 'simulate', ...args.map(shellArg)].join(' ');
}
