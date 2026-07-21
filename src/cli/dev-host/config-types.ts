/**
 * Shared shape of the dev-host config the CLI injects (Node side) and the host
 * page consumes (browser side). Built in `src/cli/commands/dev.ts` from
 * boardsmith.json + the loaded gameDefinition, then serialized into the
 * `virtual:boardsmith-dev-config` module.
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
  [key: string]: unknown;
}

/**
 * Thrown by `validateGameOptionSelection` (D13/DEVHOST-01, T-161-02) — kept
 * distinct from `DevFlagError` (owned by `dev.ts`, the CLI-flag surface) so
 * `multiplayer-host.ts` (the wire surface) does not need to import from the
 * CLI command module to report the same class of validation failure.
 */
export class GameOptionSelectionError extends Error {}

/**
 * T-161-02: validate a proposed gameOption selection (from a CLI
 * `--game-option` flag OR a host `configure` wire message) against the
 * DECLARED game options — reject an undeclared key, or a `select` value not
 * among its declared choices, with an actionable error. Never silently drop
 * or coerce an invalid selection into the start op.
 *
 * `playerCount` is a host-level field (not a per-game option) that a preset
 * may also set (`GamePreset.players.length`) — it is intentionally exempt
 * from declared-option validation.
 */
export function validateGameOptionSelection(
  declaredOptions: DevOptionDef[],
  selection: Record<string, unknown>,
): void {
  const byId = new Map(declaredOptions.map((o) => [o.id, o]));
  for (const [key, value] of Object.entries(selection)) {
    if (key === 'playerCount') continue;
    const def = byId.get(key);
    if (!def) {
      const known = declaredOptions.map((o) => o.id).join(', ') || '(none declared)';
      throw new GameOptionSelectionError(
        `Unknown game option "${key}" — declared options are: ${known}.`,
      );
    }
    if (def.type === 'select' && def.choices) {
      const allowed = def.choices.map((c) => c.value);
      if (!allowed.includes(value)) {
        throw new GameOptionSelectionError(
          `Invalid value ${JSON.stringify(value)} for game option "${key}" — must be one of: ${allowed.map((v) => JSON.stringify(v)).join(', ')}.`,
        );
      }
    }
  }
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
  /**
   * Declared presets (D13/DEVHOST-01) — `gameDefinition.presets`, read for the
   * first time by the dev host. Lets a selector (Plan 03) render them and a
   * client apply one via the `configure` wire message.
   */
  presets: GamePreset[];
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
