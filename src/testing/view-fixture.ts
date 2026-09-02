/**
 * View-fixture shapes for testing BoardSmith games (issue #160).
 *
 * The engine serializes a player-valued attribute as
 * `{ __playerRef, seat, color, name }` (`game-element.ts`). `__playerRef` is
 * the field that makes the value deserializable back into a `Player`; the
 * other three exist so a board can render a name and a color without a lookup.
 *
 * A hand-built fixture that writes the short form `{ player: { seat } }`
 * renders identically, because boards typically read only `seat` — so the
 * fixture drifts from what production sends and nothing fails. These two
 * exports close that: {@link viewPlayerRef} writes the real shape, and
 * {@link assertViewFixtureShape} refuses the short form loudly.
 *
 * @module
 */

import type { ElementJSON } from '../engine/index.js';
import type { Player } from '../engine/index.js';

/**
 * The serialized form of a player-valued attribute, as the engine emits it.
 */
export interface ViewPlayerRef {
  /** The seat this reference resolves to. Without it the value is not a player. */
  __playerRef: number;
  /** The same seat, readable by a board that never deserializes. */
  seat: number;
  /** The player's assigned color, when the fixture wants it on screen. */
  color: string | undefined;
  /** The player's display name, when the fixture wants it on screen. */
  name: string | undefined;
}

/**
 * Build a player-valued attribute for a hand-written view fixture.
 *
 * Use this instead of writing the object literal: a fixture that hand-writes
 * `{ seat }` renders the same and asserts against a shape production stopped
 * sending.
 *
 * @param player - A live `Player`, or the seat number it should resolve to
 * @param overrides - `color` / `name` to put on screen; defaulted from `player`
 *
 * @example
 * ```typescript
 * const view = {
 *   id: 1,
 *   className: 'Token',
 *   attributes: { player: viewPlayerRef(2, { name: 'Alice' }) },
 * };
 * ```
 */
export function viewPlayerRef(
  player: Player | number,
  overrides: { color?: string; name?: string } = {}
): ViewPlayerRef {
  const seat = typeof player === 'number' ? player : player.seat;
  const color = overrides.color ?? (typeof player === 'number' ? undefined : player.color);
  const name = overrides.name ?? (typeof player === 'number' ? undefined : player.name);
  return { __playerRef: seat, seat, color, name };
}

/**
 * Every field the engine puts on a serialized player reference besides
 * `__playerRef`. A value whose own keys stay inside this set, and which
 * carries a numeric `seat`, is a player reference wearing the wrong clothes —
 * anything carrying a key outside it (a `capacity`, a `row`) is some other
 * game object that merely happens to have a seat.
 */
const PLAYER_REF_FIELDS = new Set(['seat', 'color', 'name']);

function isDriftedPlayerRef(value: object): boolean {
  if (Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if ('__playerRef' in record) return false;
  if (typeof record.seat !== 'number') return false;
  return Object.keys(record).every((key) => PLAYER_REF_FIELDS.has(key));
}

function describeNode(node: ElementJSON): string {
  return node.name ? `${node.className} "${node.name}"` : node.className;
}

function findDrift(value: unknown, path: string, seen: Set<unknown>): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (isDriftedPlayerRef(value)) return path;

  const entries = Array.isArray(value)
    ? value.map((entry, index) => [`${path}[${index}]`, entry] as const)
    : Object.entries(value as Record<string, unknown>).map(
        ([key, entry]) => [`${path}.${key}`, entry] as const
      );

  for (const [childPath, entry] of entries) {
    const found = findDrift(entry, childPath, seen);
    if (found) return found;
  }
  return undefined;
}

/**
 * Refuse a view fixture that writes a player-valued attribute without
 * `__playerRef`.
 *
 * The library calls this on every hand-buildable view it is handed
 * ({@link diffPlayerViews}); call it directly on a fixture a custom UI test
 * mounts, so the drift fails at the fixture rather than staying invisible
 * behind a board that reads only `seat`.
 *
 * @throws Error naming the element and the attribute path that drifted
 */
export function assertViewFixtureShape(view: ElementJSON, label = 'view fixture'): void {
  walkNodes(view, label);
}

function walkNodes(node: ElementJSON, label: string): void {
  const seen = new Set<unknown>();
  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    const drift = findDrift(value, key, seen);
    if (drift !== undefined) {
      throw new Error(
        `${label}: ${describeNode(node)} writes the player attribute "${drift}" as { seat } ` +
          `with no __playerRef. The engine serializes a player-valued attribute as ` +
          `{ __playerRef, seat, color, name }, so this fixture asserts against a shape ` +
          `production does not send. Build it with viewPlayerRef() from 'boardsmith/testing'.`
      );
    }
  }
  for (const child of node.children ?? []) {
    walkNodes(child, label);
  }
}
