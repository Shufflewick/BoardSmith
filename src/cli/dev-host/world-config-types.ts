/**
 * What the `boardsmith dev` WORLD host page is told before it connects.
 *
 * The world twin of `config-types.ts`, and short for the reason the table's is
 * long: a table's chrome has to render game options, presets, a colour palette
 * and a bot level before a game exists, while a world already exists and every
 * fact about it -- its commands, its seats, its view -- arrives from the world
 * itself over the socket. What is here is only what the page needs BEFORE the
 * first frame.
 */
export interface WorldDevConfig {
  /** What to call this world on screen until the host says its own name. */
  readonly displayName: string;
  /** How many seats the bundle's own rules declare. The seat switcher's range. */
  readonly seatCount: number;
  /** The document the world's own surface is served from. */
  readonly worldUrl: string;
  /** Where this world durably lives, so an author can find it and delete it. */
  readonly storePath: string;
}
