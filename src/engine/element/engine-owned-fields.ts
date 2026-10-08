/**
 * The fields of every `Game` that belong to the ENGINE, and the one message a
 * game gets for claiming one (#346).
 *
 * A game subclass that declares, assigns or defines a member under one of these
 * names replaces the engine's value with its own. Nothing about that is visible
 * at first: TypeScript accepts a narrowing redeclaration (`pile!: Pile` narrows
 * `GameElement`), and a freshly constructed game behaves. But the engine owns
 * these fields' lifecycle. The unserializable ones (`pile`, `random`,
 * `_actions`, ...) are never written by `toJSON()` and are rebuilt by the
 * engine's own constructor on restore, so after any session op, undo or bot
 * search the game's value is gone and the field points at the engine's copy
 * again. The serialized ones (`phase`, `settings`, `messages`, ...) are
 * rewritten by the engine whenever it needs to. Either way the game silently
 * plays with two values for one name.
 *
 * Two checks read this table, so it is the single statement of which names a
 * game may not use:
 *
 * - The `boardsmith/no-engine-field-shadow` lint rule, which `boardsmith
 *   validate` and `boardsmith publish` run. It sees declarations, so it
 *   catches every entry.
 * - `constructGame`, which every engine path builds a game through. It
 *   compares each `'fixed'` field with the value the engine's constructor left
 *   there, after the subclass constructor has run.
 *
 * What each entry says:
 *
 *   'fixed'        — the engine gives it its value in its own constructor and
 *                    no engine API a game constructor calls reassigns it, so a
 *                    changed value can only be the subclass's doing, and
 *                    `constructGame` refuses the game.
 *   'engine-set'   — an engine API a game constructor may call (`setFlow`,
 *                    `startFlow`, `pruneMessages`, `animate`, `setVisibility`,
 *                    `onEnter`, ...) reassigns it,
 *                    or it starts out unset, so the value alone cannot say who
 *                    wrote it. Only the lint rule catches a shadow of these.
 *                    Every `_`-prefixed one is TypeScript-private or engine
 *                    internal, which also keeps a typed game off it.
 *
 * `engine-owned-fields.test.ts` holds this table equal to the own fields of a
 * bare `Game` (less the layout fields in `GAME_ROOT_FIELD_AUDIENCE` that a game
 * is meant to set), so an engine field added without an entry fails a test.
 *
 * This module imports nothing, so the lint rule can read it without loading
 * the engine.
 */
export const ENGINE_OWNED_GAME_FIELDS = {
  // --- inherited from GameElement / Space -------------------------------
  game: 'fixed',
  _ctx: 'fixed',
  _t: 'fixed',
  _visibility: 'engine-set',
  _redactedAttributes: 'engine-set',
  _eventHandlers: 'engine-set',
  _zoneVisibility: 'engine-set',

  // --- Game's own -------------------------------------------------------
  pile: 'fixed',
  phase: 'engine-set',
  random: 'fixed',
  messages: 'engine-set',
  settings: 'fixed',
  tutorialProgress: 'fixed',
  tutorialDefinition: 'engine-set',
  _actions: 'fixed',
  _actionExecutor: 'fixed',
  _flowDefinition: 'engine-set',
  _flowEngine: 'engine-set',
  _debugRegistry: 'fixed',
  _persistentMaps: 'fixed',
  _animationEvents: 'engine-set',
  _animationEventSeq: 'engine-set',
  _animationSeqBySeat: 'engine-set',
  _messagesEvicted: 'engine-set',
  _constructorOptions: 'fixed',
  _initError: 'engine-set',
} as const satisfies Record<string, 'fixed' | 'engine-set'>;

/** Is `name` a field the engine owns on every `Game`? */
export function isEngineOwnedGameField(name: string): boolean {
  return Object.hasOwn(ENGINE_OWNED_GAME_FIELDS, name);
}

/**
 * What a game is told when `owner` claims the engine field `field`. The lint
 * rule and the construction check say the same thing, in the same words.
 */
export function describeEngineFieldShadow(owner: string, field: string): string {
  const bare = field.replace(/^_+/, '');
  const suggestion = `my${bare.charAt(0).toUpperCase()}${bare.slice(1)}`;
  return (
    `${owner} uses the name "${field}", which the BoardSmith engine already uses for its own ` +
    `field on every Game. The engine sets that field and rebuilds it on every save, restore, ` +
    `undo and bot search, so your game's "${field}" would be silently replaced by the engine's. ` +
    `Rename yours to something that says what it holds (for example "${suggestion}") and update ` +
    `every use of it.`
  );
}
