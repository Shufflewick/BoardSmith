/**
 * Shared shape of the dev-host config the CLI injects (Node side) and the host
 * page consumes (browser side). Built in `src/cli/commands/dev.ts` from
 * boardsmith.json + the loaded gameDefinition, then serialized into the
 * `virtual:boardsmith-dev-config` module.
 *
 * A selection a client makes among these options is admitted by the session's
 * `selectDesignerGameOptions`: the production lobby's rules, except that a
 * designer-only option (`designerOnly: true`) may be set too. Nothing here
 * validates one.
 */

import type { GamePreset } from '../../session/types.js';

/** One option definition (game- or player-level) in object-keyed form. */
export interface DevOptionDef {
  id: string;
  type: string;
  label?: string;
  default?: unknown;
  choices?: Array<{ value: unknown; label?: string }>;
  min?: number;
  max?: number;
  /** Shown with a "Designer only" mark: no player sees it (#687). */
  designerOnly?: true;
  [key: string]: unknown;
}

export interface DevHostConfig {
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  /** Initial player count (from `--players`). */
  playerCount: number;
  /** Initial bot seats (1-indexed) from `--bot`. */
  botSeats: number[];
  /** Initial bot difficulty (from `--bot-level`). */
  botLevel: string;
  /** Game-level option definitions (object-keyed → flattened to a list). */
  gameOptions: DevOptionDef[];
  /** Per-player option definitions. */
  playerOptions: DevOptionDef[];
  /**
   * Declared presets (D13/DEVHOST-01) — `gameDefinition.presets`, read for the
   * first time by the dev host. Lets a selector (Plan 03) render them and a
   * client apply one via the `configure` wire message.
   */
  presets: GamePreset[];
  /** Color palette as {value,label} entries. */
  colorPalette: Array<{ value: string; label: string }>;
  /** URL the iframe loads to render the game UI (GameShell). */
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
