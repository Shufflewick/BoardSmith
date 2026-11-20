/**
 * Which attribute names the ENGINE owns on an element, and so which are the
 * game's own.
 *
 * This module has no imports so the UI can tell a game's attributes from
 * engine structure without pulling in the engine (#1628).
 */

/**
 * A PLAYER's identity fields: what every seat needs to put an opponent on the
 * table -- name, seat, colour and whether they are still playing (#448).
 *
 * A player's `visibleAttributes` covers the game's own fields only. These are
 * sent to every seat whatever the list says, and naming one in it is refused,
 * so a game withholding one secret field no longer has to re-list them, and a
 * field the engine adds here reaches every seat in every game.
 * `visible-attributes-engine-fields.test.ts` holds this equal to what a bare
 * `Player` sends, so a new engine field on `Player` is classified here, by a
 * decision, before any game can withhold it by accident.
 */
export const PLAYER_IDENTITY_ATTRIBUTES: ReadonlySet<string> = new Set([
  'name', '$type', 'seat', 'status', 'color', 'colorLabel',
]);

/**
 * Attributes the ENGINE owns on every element, which a redacted restore never
 * takes away (#19).
 *
 * These are structure, not game data: identity, ownership and layout, read by
 * the engine itself (`getEffectiveOwner`, the renderers). Turning one into a
 * throwing accessor would not withhold a secret, it would take the tree apart.
 * A game's own secrets are never in this list. A hidden placeholder's `name`
 * is the one exception the restore withholds, since it names the card (#1782).
 *
 * This is NOT the list a game's whitelist cannot touch: on an ordinary element
 * `visibleAttributes` may still keep the owner, position or artwork from other
 * seats. Only a player's identity fields are sent regardless
 * ({@link PLAYER_IDENTITY_ATTRIBUTES}).
 */
const ELEMENT_STRUCTURE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'name', 'player', 'row', 'column', '$image', '$images', '$type',
]);

/** A player's engine-owned names: its structure and its identity, which seat lookup and turn order read. */
const PLAYER_ENGINE_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...ELEMENT_STRUCTURE_ATTRIBUTES, ...PLAYER_IDENTITY_ATTRIBUTES,
]);

/**
 * The names the engine owns on an element of `$type` `type` (#1433). A
 * player's identity names (`color`, `seat`, `status`, ...) are engine-owned
 * only on a player; on a card they are the game's own attributes.
 */
export function engineOwnedAttributeNames(type: unknown): ReadonlySet<string> {
  return type === 'player' ? PLAYER_ENGINE_ATTRIBUTES : ELEMENT_STRUCTURE_ATTRIBUTES;
}

/** The `$type` of every built-in Space: `Space` itself and the subclasses that set their own (#1667). */
export const SPACE_TYPES: ReadonlySet<string> = new Set(['space', 'deck', 'hand', 'hex-cell', 'dice-pool']);

/** Is `key` the game's own attribute on an element of `$type` `type`, not engine structure, identity or metadata? */
export function isGameAttributeName(key: string, type: unknown): boolean {
  // A Space's `sealed` is the engine's append-only guard, not game state.
  if (key === 'sealed' && SPACE_TYPES.has(type as string)) return false;
  return !key.startsWith('_') && !key.startsWith('$') && !engineOwnedAttributeNames(type).has(key);
}
