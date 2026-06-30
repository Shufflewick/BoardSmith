/**
 * Shared shape of the dev-host config the CLI injects (Node side) and the host
 * page consumes (browser side). Built in `src/cli/commands/dev.ts` from
 * boardsmith.json + the loaded gameDefinition, then serialized into the
 * `virtual:boardsmith-dev-config` module.
 */

/** One option definition (game- or player-level) in object-keyed form. */
export interface DevOptionDef {
  id: string;
  type: string;
  label?: string;
  default?: unknown;
  choices?: Array<{ value: unknown; label?: string }>;
  min?: number;
  max?: number;
  [key: string]: unknown;
}

export interface DevHostConfig {
  gameType: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  /** Initial player count (from `--players`). */
  playerCount: number;
  /** Initial AI seats (1-indexed) from `--ai`. */
  aiSeats: number[];
  /** Initial AI difficulty (from `--ai-level`). */
  aiLevel: string;
  /** Game-level option definitions (object-keyed → flattened to a list). */
  gameOptions: DevOptionDef[];
  /** Per-player option definitions. */
  playerOptions: DevOptionDef[];
  /** Color palette as {value,label} entries. */
  colorPalette: Array<{ value: string; label: string }>;
  /** URL the iframe loads to render the game UI (GameShell, platform mode). */
  gameUrl: string;
  /**
   * When true, teaching/assist features (hint, heatmap, demo, tutorial) are disabled
   * for this session. Set by `boardsmith dev --lock-teaching`. Delivered to the
   * GameShell iframe via the init postMessage so client gating fires on first render
   * (before the first broadcast). The authoritative value for reconnects is the
   * broadcast's `state.teachingDisabled` (Plan 111-02 / Plan 111-03).
   */
  teachingDisabled?: boolean;
}
