import type { GameElement } from '../element/game-element.js';
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
} from './types.js';

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
 *   .condition((ctx) => ctx.player.hand.count() > 0)
 *   .execute((args, ctx) => {
 *     // Handle the ask action
 *   });
 * ```
 */
export class Action {
  private definition: ActionDefinition;

  private constructor(name: string) {
    this.definition = {
      name,
      selections: [],
      execute: () => {},
    };
  }

  /**
   * Create a new action builder
   */
  static create(name: string): Action {
    return new Action(name);
  }

  /**
   * Set the user-facing prompt for this action
   */
  prompt(prompt: string): this {
    this.definition.prompt = prompt;
    return this;
  }

  /**
   * Add a condition for when this action is available
   */
  condition(fn: (context: ActionContext) => boolean): this {
    this.definition.condition = fn;
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
   * Add a choice selection
   */
  chooseFrom<T>(
    name: string,
    options: {
      prompt?: string;
      choices: T[] | ((context: ActionContext) => T[]);
      display?: (choice: T) => string;
      optional?: boolean;
      validate?: (value: T, args: Record<string, unknown>, context: ActionContext) => boolean | string;
      /** Get board element references for highlighting (source/target) */
      boardRefs?: (choice: T, context: ActionContext) => ChoiceBoardRefs;
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
      multiSelect?: number | MultiSelectConfig | ((context: ActionContext) => number | MultiSelectConfig | undefined);
    }
  ): this {
    const selection: ChoiceSelection<T> = {
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
    };
    this.definition.selections.push(selection as Selection);
    return this;
  }

  /**
   * Add an element selection (choose from board)
   */
  chooseElement<T extends GameElement>(
    name: string,
    options: {
      prompt?: string;
      elementClass?: ElementClass<T>;
      from?: GameElement | ((context: ActionContext) => GameElement);
      filter?: (element: GameElement, context: ActionContext) => boolean;
      optional?: boolean;
      validate?: (value: T, args: Record<string, unknown>, context: ActionContext) => boolean | string;
      /** Display function for elements (for UI buttons) */
      display?: (element: T, context: ActionContext) => string;
      /** Get board element reference for highlighting */
      boardRef?: (element: T, context: ActionContext) => BoardElementRef;
      /**
       * Name of a previous selection this depends on.
       * When specified, availability checking will verify that at least one
       * choice from the dependency leads to valid choices for this selection.
       */
      dependsOn?: string;
    } = {}
  ): this {
    const selection: ElementSelection<T> = {
      type: 'element',
      name,
      prompt: options.prompt,
      elementClass: options.elementClass,
      from: options.from,
      filter: options.filter,
      optional: options.optional,
      validate: options.validate,
      display: options.display as ElementSelection<T>['display'],
      boardRef: options.boardRef as ElementSelection<T>['boardRef'],
      dependsOn: options.dependsOn,
    };
    this.definition.selections.push(selection as Selection);
    return this;
  }

  /**
   * Select from a pre-computed array of elements.
   *
   * This is the "pit of success" method for element-based choices.
   * - Values are element IDs (numbers), not strings
   * - Custom UIs send IDs directly: `props.action('attack', { target: 42 })`
   * - Execute handler receives resolved Element objects
   * - Display names auto-disambiguate (e.g., "Militia #1", "Militia #2")
   *
   * @example
   * ```typescript
   * action('attack')
   *   .fromElements('target', {
   *     elements: (ctx) => ctx.game.combat.validTargets,
   *     prompt: 'Choose a target',
   *   })
   *   .execute(({ target }) => {
   *     // target is the resolved Element object, not an ID
   *     target.takeDamage(10);
   *   });
   * ```
   */
  fromElements<T extends GameElement>(
    name: string,
    options: {
      prompt?: string;
      /**
       * Elements to choose from - can be static array or function.
       * Custom UIs send the element ID directly.
       */
      elements: T[] | ((context: ActionContext) => T[]);
      /**
       * Custom display function. If not provided, uses element.name with
       * automatic disambiguation when multiple elements have the same name.
       */
      display?: (element: T, context: ActionContext, allElements: T[]) => string;
      optional?: boolean;
      validate?: (value: T, args: Record<string, unknown>, context: ActionContext) => boolean | string;
      /** Get board element reference for highlighting */
      boardRef?: (element: T, context: ActionContext) => BoardElementRef;
      /**
       * Enable multi-select mode. Result will be an array of elements.
       */
      multiSelect?: number | MultiSelectConfig | ((context: ActionContext) => number | MultiSelectConfig | undefined);
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
    }
  ): this {
    // For single-select (no multiSelect), use 'element' type to leverage existing code paths
    // For multi-select, use 'elements' type
    if (options.multiSelect !== undefined) {
      const selection: ElementsSelection<T> = {
        type: 'elements',
        name,
        prompt: options.prompt,
        elements: options.elements,
        display: options.display,
        optional: options.optional,
        validate: options.validate,
        boardRef: options.boardRef,
        multiSelect: options.multiSelect,
        dependsOn: options.dependsOn,
        repeat: options.repeat,
        repeatUntil: options.repeatUntil,
      };
      this.definition.selections.push(selection as Selection);
    } else {
      // Single-select: use 'element' type with elements array
      const selection: ElementSelection<T> = {
        type: 'element',
        name,
        prompt: options.prompt,
        elements: options.elements,
        display: options.display as ElementSelection<T>['display'],
        optional: options.optional,
        validate: options.validate,
        boardRef: options.boardRef,
        dependsOn: options.dependsOn,
        repeat: options.repeat,
        repeatUntil: options.repeatUntil,
      };
      this.definition.selections.push(selection as Selection);
    }
    return this;
  }

  /**
   * Add a text input selection
   */
  enterText(
    name: string,
    options: {
      prompt?: string;
      pattern?: RegExp;
      minLength?: number;
      maxLength?: number;
      optional?: boolean;
      validate?: (value: string, args: Record<string, unknown>, context: ActionContext) => boolean | string;
    } = {}
  ): this {
    const selection: TextSelection = {
      type: 'text',
      name,
      prompt: options.prompt,
      pattern: options.pattern,
      minLength: options.minLength,
      maxLength: options.maxLength,
      optional: options.optional,
      validate: options.validate,
    };
    this.definition.selections.push(selection);
    return this;
  }

  /**
   * Add a number input selection
   */
  enterNumber(
    name: string,
    options: {
      prompt?: string;
      min?: number;
      max?: number;
      integer?: boolean;
      optional?: boolean;
      validate?: (value: number, args: Record<string, unknown>, context: ActionContext) => boolean | string;
    } = {}
  ): this {
    const selection: NumberSelection = {
      type: 'number',
      name,
      prompt: options.prompt,
      min: options.min,
      max: options.max,
      integer: options.integer,
      optional: options.optional,
      validate: options.validate,
    };
    this.definition.selections.push(selection);
    return this;
  }

  /**
   * Set the execution handler for this action
   */
  execute(
    fn: (args: Record<string, unknown>, context: ActionContext) => ActionResult | void
  ): ActionDefinition {
    this.definition.execute = fn;
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
