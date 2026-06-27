import type { GameElement } from '../element/game-element.js';
import type { Game } from '../element/game.js';
import type {
  ActionDefinition,
  ActionContext,
  ActionResult,
  Selection,
  ChoiceSelection,
  ElementSelection,
  ElementsSelection,
  TextSelection,
  NumberSelection,
  ChoiceBoardRefs,
  DependentFilter,
  BoardElementRef,
  RepeatConfig,
  MultiSelectConfig,
  ConditionConfig,
  OnSelectContext,
} from './types.js';

/**
 * The args record for an action with no selections yet. Using an empty key set
 * (rather than `{}`) keeps `AddArg` clean: `AddArg<NoArgs, 'card', Card>` is
 * exactly `{ card: Card }`, with no leftover index signature.
 */
type NoArgs = Record<never, never>;

/**
 * Accumulates a new named selection into the args record threaded through the
 * builder chain. `AddArg<A, 'card', Card>` produces `A & { card: Card }`.
 */
type AddArg<A, K extends string, T> = A & { [P in K]: T };

/**
 * Builder class for creating game actions with a fluent API.
 *
 * Actions represent high-level player operations (game-specific, user-facing).
 * They generate low-level Commands internally to modify game state.
 *
 * @see {@link ../../ARCHITECTURE.md} for the Actions vs Commands architecture explanation
 *
 * @example
 * ```typescript
 * const askAction = Action.create('ask')
 *   .prompt('Ask another player for a card')
 *   .chooseFrom('target', {
 *     prompt: 'Choose a player to ask',
 *     choices: (ctx) => game.playerChoices({ excludeSelf: true, currentPlayer: ctx.player }),
 *   })
 *   .chooseFrom('rank', {
 *     prompt: 'Choose a rank',
 *     choices: (ctx) => getPlayerRanks(ctx.player)
 *   })
 *   .condition({ 'has cards': (ctx) => ctx.player.hand.count() > 0 })
 *   .execute((args, ctx) => {
 *     // Handle the ask action
 *   });
 * ```
 *
 * @typeParam G - The concrete Game subclass. Supply it via
 *   `Action.create<MyGame>('name')` so `ctx.game` is typed in every callback.
 * @typeParam A - The accumulated args record. Each selection method adds its
 *   `{ name: type }` so the `execute` handler receives a fully-typed args object
 *   with no casts required.
 */
export class Action<
  G extends Game = Game,
  A extends Record<string, unknown> = NoArgs,
> {
  private definition: ActionDefinition;

  private constructor(name: string) {
    this.definition = {
      name,
      selections: [],
      execute: () => {},
    };
  }

  /**
   * Create a new action builder.
   *
   * Supply the concrete game type to thread it through the whole chain:
   * `Action.create<MyGame>('move')` makes `ctx.game` typed as `MyGame` in every
   * selection callback, condition, and the final `execute` handler.
   */
  static create<G extends Game = Game>(name: string): Action<G, NoArgs> {
    return new Action<G, NoArgs>(name);
  }

  /**
   * Set the user-facing prompt for this action
   */
  prompt(prompt: string): this {
    this.definition.prompt = prompt;
    return this;
  }

  /**
   * Set the player-facing help text for this action.
   * Shown in the action help popover on hover/tap.
   * Display-only; never used as a predicate.
   */
  help(text: string): this {
    this.definition.help = text;
    return this;
  }

  /**
   * Add a condition for when this action is available.
   *
   * Conditions use an object format where keys are human-readable labels and
   * values are predicates. Labels appear in debug output when conditions fail,
   * making it easy to understand why an action isn't available.
   *
   * All predicates must return true for the action to be available.
   *
   * @param config - Object with labeled predicates
   * @returns The builder for chaining
   *
   * @example
   * ```typescript
   * Action.create('playCard')
   *   .condition({
   *     'has cards in hand': (ctx) => ctx.player.hand.count() > 0,
   *     'is active player': (ctx) => ctx.player === ctx.game.activePlayer,
   *     'not at action limit': (ctx) => ctx.player.actionsUsed < 3
   *   })
   *   .execute(() => { ... });
   * ```
   */
  condition(config: ConditionConfig<G>): this {
    // Stored as the base ConditionConfig; G extends Game so this is sound.
    this.definition.condition = config as ConditionConfig;
    return this;
  }

  /**
   * Mark this action as non-undoable.
   * Use for actions that reveal hidden info, involve randomness, or shouldn't be undone.
   * When executed, undo is disabled for the rest of the turn.
   */
  notUndoable(): this {
    this.definition.undoable = false;
    return this;
  }

  /**
   * Add a choice selection from a list of values.
   *
   * Use this for string/number choices (e.g., ranks, colors, amounts).
   * For selecting game elements, use {@link chooseElement} (one) or
   * {@link chooseElements} (many) instead.
   *
   * @param name - Argument name that will be passed to the execute handler
   * @param options - Configuration for the choice selection
   * @param options.prompt - User-facing prompt text
   * @param options.choices - Static array or function returning available choices
   * @param options.display - Custom display function for each choice
   * @param options.optional - If true, player can skip this selection
   * @param options.validate - Custom validation function
   * @param options.boardRefs - Get board element references for highlighting
   * @param options.filterBy - Filter choices based on a previous selection value
   * @param options.dependsOn - Name of previous selection this depends on
   * @param options.repeat - Configuration for repeating this selection
   * @param options.repeatUntil - Value that terminates a repeat loop
   * @param options.multiSelect - Enable multi-select with checkboxes
   * @returns The builder for chaining
   *
   * @example
   * ```typescript
   * // Simple choice selection
   * action('bid')
   *   .chooseFrom('amount', {
   *     prompt: 'How much do you bid?',
   *     choices: [1, 2, 3, 4, 5],
   *   })
   *   .execute(({ amount }) => {
   *     ctx.player.bid = amount;
   *   });
   *
   * // Choice with dynamic options and display
   * action('selectRank')
   *   .chooseFrom('rank', {
   *     prompt: 'Choose a rank',
   *     choices: (ctx) => getAvailableRanks(ctx.player),
   *     display: (rank) => `${rank} (${rankDescriptions[rank]})`,
   *   });
   * ```
   */
  chooseFrom<K extends string, T>(
    name: K,
    options: {
      prompt?: string;
      choices: T[] | ((context: ActionContext<G>) => T[]);
      display?: (choice: T) => string;
      optional?: boolean;
      validate?: (value: T, args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
      /** Get board element references for highlighting (source/target) */
      boardRefs?: (choice: T, context: ActionContext<G>) => ChoiceBoardRefs;
      /** Filter choices based on a previous selection value */
      filterBy?: DependentFilter;
      /**
       * Name of a previous selection this choice depends on.
       * When specified, choices are computed for each possible value of the
       * dependent selection and sent to the client as a map.
       */
      dependsOn?: string;
      /**
       * Repeat this selection until termination condition is met.
       * When used, the selection value becomes an array of all choices made.
       */
      repeat?: RepeatConfig<T>;
      /**
       * Shorthand for repeat.until that terminates when this value is selected.
       * Equivalent to: repeat: { until: (ctx, choice) => choice === repeatUntil }
       */
      repeatUntil?: T;
      /**
       * Enable multi-select mode with checkboxes instead of radio buttons.
       * Can be a static config or dynamic function evaluated per context.
       */
      multiSelect?: number | MultiSelectConfig | ((context: ActionContext<G>) => number | MultiSelectConfig | undefined);
      /** Check if choice should be disabled. Returns reason string or false. */
      disabled?: (choice: T, context: ActionContext<G>) => string | false;
      /** Called after this step is resolved. Receives the resolved value and a restricted context. */
      onSelect?: (value: T, context: OnSelectContext) => void;
      /** Called if the action is cancelled after onSelect fired but before execute(). */
      onCancel?: (context: OnSelectContext) => void;
    }
  ): Action<G, AddArg<A, K, T>> {
    const selection = {
      type: 'choice',
      name,
      prompt: options.prompt,
      choices: options.choices,
      display: options.display,
      optional: options.optional,
      validate: options.validate,
      boardRefs: options.boardRefs,
      filterBy: options.filterBy,
      dependsOn: options.dependsOn,
      repeat: options.repeat,
      repeatUntil: options.repeatUntil,
      multiSelect: options.multiSelect,
      disabled: options.disabled,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    } as ChoiceSelection<T>;
    this.definition.selections.push(selection as Selection);
    return this as unknown as Action<G, AddArg<A, K, T>>;
  }

  /**
   * Select a single game element. This is the canonical method for any
   * one-element choice; use {@link chooseElements} when the player picks many.
   *
   * Two ways to say which elements are selectable (pick one):
   * - **Board pattern**: `elementClass` + optional `from` + `filter`. Searches
   *   the board (or a container) and lets the player click matching elements.
   * - **Precomputed pattern**: `elements` — a ready-made array (or function
   *   returning one). Use when you already have the exact list of candidates.
   *
   * Value encoding is the same either way: values are element IDs (numbers),
   * custom UIs send the ID directly (`props.action('move', { piece: 42 })`),
   * and the execute handler receives the resolved Element object. Display
   * names auto-disambiguate (e.g., "Militia #1", "Militia #2").
   *
   * @param name - Argument name that will be passed to the execute handler
   * @param options - Configuration for the element selection
   * @param options.prompt - User-facing prompt text
   * @param options.elementClass - Filter to specific element types (e.g., Card, Piece)
   * @param options.from - Container element to select from (defaults to game board)
   * @param options.filter - Additional filter function for elements
   * @param options.elements - Precomputed array (or function) of candidates
   * @param options.optional - If true, player can skip this selection
   * @param options.validate - Custom validation function
   * @param options.display - Display function for elements (for UI buttons)
   * @param options.boardRef - Get board element reference for highlighting
   * @param options.dependsOn - Name of previous selection this depends on
   * @returns The builder for chaining
   *
   * @example
   * ```typescript
   * // Board pattern: click a piece, then a destination
   * action('move')
   *   .chooseElement('piece', {
   *     prompt: 'Select a piece to move',
   *     elementClass: Piece,
   *     filter: (el, ctx) => el.owner === ctx.player,
   *   })
   *   .chooseElement('destination', {
   *     prompt: 'Select destination',
   *     elementClass: Space,
   *     filter: (space, ctx) => space.isEmpty(),
   *   })
   *   .execute(({ piece, destination }) => {
   *     piece.moveTo(destination);
   *   });
   *
   * // Precomputed pattern: choose from a known list of targets
   * action('attack')
   *   .chooseElement('target', {
   *     prompt: 'Choose a target',
   *     elements: (ctx) => ctx.game.combat.validTargets,
   *   })
   *   .execute(({ target }) => {
   *     target.takeDamage(10);
   *   });
   * ```
   */
  chooseElement<K extends string, T extends GameElement>(
    name: K,
    options: {
      prompt?: string;
      elementClass?: ElementClass<T>;
      from?: GameElement | ((context: ActionContext<G>) => GameElement);
      filter?: (element: GameElement, context: ActionContext<G>) => boolean;
      /**
       * Precomputed candidates (alternative to elementClass/from/filter).
       * Custom UIs send the element ID directly.
       */
      elements?: T[] | ((context: ActionContext<G>) => T[]);
      optional?: boolean;
      validate?: (value: T, args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
      /** Display function for elements (for UI buttons) */
      display?: (element: T, context: ActionContext<G>) => string;
      /** Get board element reference for highlighting */
      boardRef?: (element: T, context: ActionContext<G>) => BoardElementRef;
      /**
       * Name of a previous selection this depends on.
       * When specified, availability checking will verify that at least one
       * choice from the dependency leads to valid choices for this selection.
       */
      dependsOn?: string;
      /**
       * Repeat this selection until termination condition is met.
       * When used, the selection value becomes an array of all elements selected.
       * Each selection round-trips to the server for state updates.
       */
      repeat?: RepeatConfig<T>;
      /**
       * Shorthand for repeat.until that terminates when this element is selected.
       * Equivalent to: repeat: { until: (ctx, el) => el === repeatUntil }
       */
      repeatUntil?: T;
      /** Check if element should be disabled. Returns reason string or false. */
      disabled?: (element: T, context: ActionContext<G>) => string | false;
      /** Called after this step is resolved. Receives the resolved value and a restricted context. */
      onSelect?: (value: T, context: OnSelectContext) => void;
      /** Called if the action is cancelled after onSelect fired but before execute(). */
      onCancel?: (context: OnSelectContext) => void;
    } = {}
  ): Action<G, AddArg<A, K, T>> {
    const selection = {
      type: 'element',
      name,
      prompt: options.prompt,
      elementClass: options.elementClass,
      from: options.from,
      filter: options.filter,
      elements: options.elements,
      optional: options.optional,
      validate: options.validate,
      display: options.display as ElementSelection<T>['display'],
      boardRef: options.boardRef as ElementSelection<T>['boardRef'],
      dependsOn: options.dependsOn,
      repeat: options.repeat,
      repeatUntil: options.repeatUntil,
      disabled: options.disabled,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    } as ElementSelection<T>;
    this.definition.selections.push(selection as Selection);
    return this as unknown as Action<G, AddArg<A, K, T>>;
  }

  /**
   * Select multiple game elements. This is the canonical method for any
   * many-element choice; use {@link chooseElement} when the player picks one.
   *
   * The execute handler receives an array of resolved Element objects. Bound
   * the count with `multiSelect` (a number is "up to N"; `{ min, max }` gives
   * full control). When omitted, the player may pick one or more.
   *
   * Value encoding matches {@link chooseElement}: the wire values are element
   * IDs, and custom UIs send IDs directly.
   *
   * @param name - Argument name that will be passed to the execute handler
   * @param options - Configuration for the element selection
   * @param options.prompt - User-facing prompt text
   * @param options.elements - Elements to choose from (array or function)
   * @param options.multiSelect - Count bound (number = max, or `{ min, max }`)
   * @param options.optional - If true, player can skip this selection
   * @param options.validate - Custom validation function
   * @param options.display - Display function for elements (for UI buttons)
   * @param options.boardRef - Get board element reference for highlighting
   * @param options.dependsOn - Name of previous selection this depends on
   * @returns The builder for chaining
   *
   * @example
   * ```typescript
   * action('discard')
   *   .chooseElements('cards', {
   *     prompt: 'Discard up to 2 cards',
   *     elements: (ctx) => [...ctx.player.hand.all(Card)],
   *     multiSelect: { min: 0, max: 2 },
   *   })
   *   .execute(({ cards }) => {
   *     for (const card of cards) card.discard();
   *   });
   * ```
   */
  chooseElements<K extends string, T extends GameElement>(
    name: K,
    options: {
      prompt?: string;
      /**
       * Elements to choose from - can be static array or function.
       * Custom UIs send the element ID directly.
       */
      elements: T[] | ((context: ActionContext<G>) => T[]);
      /**
       * Bound the number of elements the player may pick. A number means
       * "up to N"; `{ min, max }` gives full control. Defaults to one or more.
       */
      multiSelect?: number | MultiSelectConfig | ((context: ActionContext<G>) => number | MultiSelectConfig | undefined);
      /**
       * Custom display function. If not provided, uses element.name with
       * automatic disambiguation when multiple elements have the same name.
       */
      display?: (element: T, context: ActionContext<G>, allElements: T[]) => string;
      optional?: boolean;
      validate?: (value: T[], args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
      /** Get board element reference for highlighting */
      boardRef?: (element: T, context: ActionContext<G>) => BoardElementRef;
      /**
       * Name of a previous selection this element selection depends on.
       * When specified, elements are computed for each possible value of the
       * dependent selection and sent to the client as a map.
       */
      dependsOn?: string;
      /**
       * Repeat this selection until termination condition is met.
       * When used, the selection value becomes an array of all elements selected.
       * Each selection round-trips to the server for state updates.
       */
      repeat?: RepeatConfig<T>;
      /**
       * Shorthand for repeat.until that terminates when this element is selected.
       * Equivalent to: repeat: { until: (ctx, el) => el === repeatUntil }
       */
      repeatUntil?: T;
      /** Check if element should be disabled. Returns reason string or false. */
      disabled?: (element: T, context: ActionContext<G>) => string | false;
      /** Called after this step is resolved. Receives the resolved value and a restricted context. */
      onSelect?: (value: T[], context: OnSelectContext) => void;
      /** Called if the action is cancelled after onSelect fired but before execute(). */
      onCancel?: (context: OnSelectContext) => void;
    }
  ): Action<G, AddArg<A, K, T[]>> {
    const selection = {
      type: 'elements',
      name,
      prompt: options.prompt,
      elements: options.elements,
      // Default to "one or more" so chooseElements always yields an array.
      multiSelect: options.multiSelect ?? { min: 1 },
      display: options.display,
      optional: options.optional,
      validate: options.validate as ElementsSelection<T>['validate'],
      boardRef: options.boardRef,
      dependsOn: options.dependsOn,
      repeat: options.repeat,
      repeatUntil: options.repeatUntil,
      disabled: options.disabled,
      onSelect: options.onSelect as ElementsSelection<T>['onSelect'],
      onCancel: options.onCancel,
    } as ElementsSelection<T>;
    this.definition.selections.push(selection as Selection);
    return this as unknown as Action<G, AddArg<A, K, T[]>>;
  }

  /**
   * Add a text input selection for free-form string input.
   *
   * @param name - Argument name that will be passed to the execute handler
   * @param options - Configuration for the text input
   * @param options.prompt - User-facing prompt text
   * @param options.pattern - Regex pattern the input must match
   * @param options.minLength - Minimum required string length
   * @param options.maxLength - Maximum allowed string length
   * @param options.optional - If true, player can skip this selection
   * @param options.validate - Custom validation function
   * @returns The builder for chaining
   *
   * @example
   * ```typescript
   * action('setNickname')
   *   .enterText('nickname', {
   *     prompt: 'Enter your nickname',
   *     minLength: 1,
   *     maxLength: 20,
   *     pattern: /^[a-zA-Z0-9_]+$/,
   *   })
   *   .execute(({ nickname }) => {
   *     ctx.player.nickname = nickname;
   *   });
   * ```
   */
  enterText<K extends string>(
    name: K,
    options: {
      prompt?: string;
      pattern?: RegExp;
      minLength?: number;
      maxLength?: number;
      optional?: boolean;
      validate?: (value: string, args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
      /** Called after this step is resolved. Receives the resolved value and a restricted context. */
      onSelect?: (value: string, context: OnSelectContext) => void;
      /** Called if the action is cancelled after onSelect fired but before execute(). */
      onCancel?: (context: OnSelectContext) => void;
    } = {}
  ): Action<G, AddArg<A, K, string>> {
    const selection = {
      type: 'text',
      name,
      prompt: options.prompt,
      pattern: options.pattern,
      minLength: options.minLength,
      maxLength: options.maxLength,
      optional: options.optional,
      validate: options.validate,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    } as TextSelection;
    this.definition.selections.push(selection);
    return this as unknown as Action<G, AddArg<A, K, string>>;
  }

  /**
   * Add a number input selection for numeric values.
   *
   * @param name - Argument name that will be passed to the execute handler
   * @param options - Configuration for the number input
   * @param options.prompt - User-facing prompt text
   * @param options.min - Minimum allowed value
   * @param options.max - Maximum allowed value
   * @param options.integer - If true, only whole numbers are allowed
   * @param options.optional - If true, player can skip this selection
   * @param options.validate - Custom validation function
   * @returns The builder for chaining
   *
   * @example
   * ```typescript
   * action('buyResources')
   *   .enterNumber('amount', {
   *     prompt: 'How many resources to buy?',
   *     min: 1,
   *     max: (ctx) => ctx.player.gold,
   *     integer: true,
   *   })
   *   .execute(({ amount }) => {
   *     ctx.player.gold -= amount;
   *     ctx.player.resources += amount;
   *   });
   * ```
   */
  enterNumber<K extends string>(
    name: K,
    options: {
      prompt?: string;
      min?: number;
      max?: number;
      integer?: boolean;
      optional?: boolean;
      validate?: (value: number, args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
      /** Called after this step is resolved. Receives the resolved value and a restricted context. */
      onSelect?: (value: number, context: OnSelectContext) => void;
      /** Called if the action is cancelled after onSelect fired but before execute(). */
      onCancel?: (context: OnSelectContext) => void;
    } = {}
  ): Action<G, AddArg<A, K, number>> {
    const selection = {
      type: 'number',
      name,
      prompt: options.prompt,
      min: options.min,
      max: options.max,
      integer: options.integer,
      optional: options.optional,
      validate: options.validate,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    } as NumberSelection;
    this.definition.selections.push(selection);
    return this as unknown as Action<G, AddArg<A, K, number>>;
  }

  /**
   * Set the execution handler and finalize the action definition.
   *
   * This is the terminal method in the builder chain. The handler receives
   * all selection values as resolved args (elements are actual Element objects,
   * not IDs) and the action context.
   *
   * @param fn - Handler function that executes the action logic
   * @returns The completed action definition (not the builder)
   *
   * @example
   * ```typescript
   * action('attack')
   *   .chooseElement('target', { ... })
   *   .execute(({ target }, ctx) => {
   *     // target is the resolved Element object
   *     target.hp -= ctx.player.attackPower;
   *
   *     // Return data to client if needed
   *     return { damage: ctx.player.attackPower };
   *   });
   * ```
   */
  execute(
    fn: (args: A, context: ActionContext<G>) => ActionResult | void
  ): ActionDefinition {
    // The accumulated args type A and game type G are erased at the storage
    // boundary (ActionDefinition is non-generic); both are sound because the
    // runtime always passes the args/game this chain declared.
    this.definition.execute = fn as ActionDefinition['execute'];
    return this.definition;
  }

  /**
   * Get the built definition (without execute, for inspection)
   */
  build(): ActionDefinition {
    return this.definition;
  }
}

// Re-export ElementClass type for use in chooseElement
import type { ElementClass } from '../element/types.js';
