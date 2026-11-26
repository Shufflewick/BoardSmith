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
