/**
 * The option keys a builder refuses because BoardSmith once read them and no
 * longer does, by builder, each with what the author should do instead.
 *
 * Refusing a key an earlier revision accepted breaks rules built on that
 * revision, so the engine contract's surface hash names every key here
 * (`computeSurfaceHash`): retiring one moves the surface, and the platform stops
 * routing older worlds to an engine that would refuse them (#1843). A builder
 * refuses a retired key only through `refuseRetiredOptions`, never with a check
 * of its own.
 */
const TIME_LIMIT_MS_REMEDY =
  'The step would never time out. Remove timeLimitMs and set timed: true on the step. The table chooses ' +
  'the time per turn, starting from the optional "defaultTimePerTurn" in boardsmith.json (5m when unset), and a ' +
  'timed step needs "idleAction" declared there too.';

export const RETIRED_OPTIONS = {
  actionStep: {
    timeLimitMs: TIME_LIMIT_MS_REMEDY,
  },
  simultaneousActionStep: {
    timeLimitMs: TIME_LIMIT_MS_REMEDY,
  },
} satisfies Record<string, Readonly<Record<string, string>>>;

/** Throw naming the first retired option `config` still sets, with its remedy. */
export function refuseRetiredOptions(builder: keyof typeof RETIRED_OPTIONS, config: { name?: string }): void {
  const retired: Readonly<Record<string, string>> = RETIRED_OPTIONS[builder];
  const key = Object.keys(retired).find((option) => option in config);
  if (key === undefined) return;
  const label = config.name ? `${builder} "${config.name}"` : builder;
  throw new Error(`${label} sets ${key}, which BoardSmith no longer reads. ${retired[key]}`);
}
