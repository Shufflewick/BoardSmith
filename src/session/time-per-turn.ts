/**
 * The time per turn a table plays at (#1830, Shufflewick/ShufflewickPub#871).
 *
 * The host runs the only clock: a step declared `timed: true` closes when the
 * table's time per turn runs out. A game declares the default in
 * `boardsmith.json` as `defaultTimePerTurn`; the table may choose another from
 * the same set before the game starts.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Every time per turn a table may choose, shortest first, in milliseconds. */
export const TIME_PER_TURN_MS = {
  '1m': MINUTE_MS,
  '2m': 2 * MINUTE_MS,
  '5m': 5 * MINUTE_MS,
  '10m': 10 * MINUTE_MS,
  '15m': 15 * MINUTE_MS,
  '1h': HOUR_MS,
  '6h': 6 * HOUR_MS,
  '12h': 12 * HOUR_MS,
  '24h': 24 * HOUR_MS,
  '48h': 48 * HOUR_MS,
} as const;

export type TimePerTurn = keyof typeof TIME_PER_TURN_MS;

/** The time per turn of a game that declares no `defaultTimePerTurn`. */
export const DEFAULT_TIME_PER_TURN: TimePerTurn = '5m';

const CHOICES = Object.keys(TIME_PER_TURN_MS).map((choice) => `"${choice}"`).join(', ');

/** Why a `boardsmith.json` `defaultTimePerTurn` is unusable, or `undefined` when it is absent or one of the host's choices. */
export function timePerTurnProblem(declared: unknown): string | undefined {
  if (declared === undefined || (typeof declared === 'string' && Object.hasOwn(TIME_PER_TURN_MS, declared))) return undefined;
  return (
    `"defaultTimePerTurn" must be one of ${CHOICES}, the times per turn a table can choose. ` +
    `Got ${JSON.stringify(declared)}. Leave it out to default to "${DEFAULT_TIME_PER_TURN}".`
  );
}

/**
 * The most seconds of watching any game may declare as `maxWatchSeconds`
 * (#1831), so no bundle can hold a table still for longer than this before its
 * clock runs.
 */
export const WATCH_SECONDS_CEILING = 300;

/** Why a `boardsmith.json` `maxWatchSeconds` is unusable, or `undefined` when it is absent or a whole number of seconds from 1 to {@link WATCH_SECONDS_CEILING}. */
export function maxWatchSecondsProblem(declared: unknown): string | undefined {
  if (declared === undefined) return undefined;
  if (Number.isInteger(declared) && (declared as number) >= 1 && (declared as number) <= WATCH_SECONDS_CEILING) return undefined;
  return (
    `"maxWatchSeconds" must be a whole number of seconds from 1 to ${WATCH_SECONDS_CEILING}: the longest watch time ` +
    `any of your timed steps can report. Got ${JSON.stringify(declared)}. Leave it out if no step reports watch time.`
  );
}

/**
 * When a timed step closes, and when its watching ends (#1831), on the host's
 * clock: turn start + min(watch time, `maxWatchSeconds`) + time per turn.
 * `watchEndsAt` is null when the step reported no watch time. The cap is 0
 * when the game declares none, so a step cannot add time the game never
 * declared.
 */
export function timedStepDeadline(turn: {
  openedAt: number;
  timePerTurn: TimePerTurn;
  watchSeconds: number | undefined;
  maxWatchSeconds: number | undefined;
}): { deadlineAt: number; watchEndsAt: number | null } {
  const watchMs = 1000 * Math.min(turn.watchSeconds ?? 0, turn.maxWatchSeconds ?? 0, WATCH_SECONDS_CEILING);
  return {
    deadlineAt: turn.openedAt + watchMs + TIME_PER_TURN_MS[turn.timePerTurn],
    watchEndsAt: turn.watchSeconds === undefined ? null : turn.openedAt + watchMs,
  };
}
