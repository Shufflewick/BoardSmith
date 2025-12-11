import type { GameElement } from '../element/game-element.js';
import type { Player } from '../player/player.js';
import type { Game } from '../element/game.js';
import type {
  ActionDefinition,
  ActionContext,
  ActionResult,
  Selection,
  ChoiceSelection,
  PlayerSelection,
  ElementSelection,
  TextSelection,
  NumberSelection,
  ValidationResult,
  ChoiceBoardRefs,
  DependentFilter,
  BoardElementRef,
} from './types.js';
import type { ElementClass } from '../element/types.js';

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
 *   .choosePlayer('target', {
 *     prompt: 'Choose a player to ask',
 *     filter: (p, ctx) => p !== ctx.player
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
      skipIfOnlyOne?: boolean;
      optional?: boolean;
      validate?: (value: T, args: Record<string, unknown>, context: ActionContext) => boolean | string;
      /** Get board element references for highlighting (source/target) */
      boardRefs?: (choice: T, context: ActionContext) => ChoiceBoardRefs;
      /** Filter choices based on a previous selection value */
      filterBy?: DependentFilter;
    }
  ): this {
    const selection: ChoiceSelection<T> = {
      type: 'choice',
      name,
      prompt: options.prompt,
      choices: options.choices,
      display: options.display,
      skipIfOnlyOne: options.skipIfOnlyOne,
      optional: options.optional,
      validate: options.validate,
      boardRefs: options.boardRefs,
      filterBy: options.filterBy,
    };
    this.definition.selections.push(selection as Selection);
    return this;
  }

  /**
   * Add a player selection
   */
  choosePlayer(
    name: string,
    options: {
      prompt?: string;
      filter?: (player: Player, context: ActionContext) => boolean;
      skipIfOnlyOne?: boolean;
      optional?: boolean;
      validate?: (value: Player, args: Record<string, unknown>, context: ActionContext) => boolean | string;
      boardRefs?: (player: Player, context: ActionContext) => ChoiceBoardRefs;
    } = {}
  ): this {
    const selection: PlayerSelection = {
      type: 'player',
      name,
      prompt: options.prompt,
      filter: options.filter,
      skipIfOnlyOne: options.skipIfOnlyOne,
      optional: options.optional,
      validate: options.validate,
      boardRefs: options.boardRefs,
    };
    this.definition.selections.push(selection);
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
      skipIfOnlyOne?: boolean;
      optional?: boolean;
      validate?: (value: T, args: Record<string, unknown>, context: ActionContext) => boolean | string;
      /** Display function for elements (for UI buttons) */
      display?: (element: T, context: ActionContext) => string;
      /** Get board element reference for highlighting */
      boardRef?: (element: T, context: ActionContext) => BoardElementRef;
    } = {}
  ): this {
    const selection: ElementSelection<T> = {
      type: 'element',
      name,
      prompt: options.prompt,
      elementClass: options.elementClass,
      from: options.from,
      filter: options.filter,
      skipIfOnlyOne: options.skipIfOnlyOne,
      optional: options.optional,
      validate: options.validate,
      display: options.display as ElementSelection<T>['display'],
      boardRef: options.boardRef as ElementSelection<T>['boardRef'],
    };
    this.definition.selections.push(selection as Selection);
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

/**
 * Action executor handles resolving selections and executing actions
 */
export class ActionExecutor {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  /**
   * Resolve serialized args (player indices, element IDs) to actual objects.
   * This is needed because network-serialized args use indices/IDs instead of objects.
   */
  resolveArgs(
    action: ActionDefinition,
    args: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved = { ...args };

    for (const selection of action.selections) {
      const value = args[selection.name];
      if (value === undefined) continue;

      switch (selection.type) {
        case 'player': {
          // If value is a number, resolve to actual Player object
          if (typeof value === 'number') {
            const player = this.game.players[value];
            if (player) {
              resolved[selection.name] = player;
            }
          }
          break;
        }

        case 'element': {
          // If value is a number, resolve to actual GameElement by ID
          if (typeof value === 'number') {
            const element = this.game.getElementById(value);
            if (element) {
              resolved[selection.name] = element;
            }
          }
          break;
        }
      }
    }

    return resolved;
  }

  /**
   * Get available choices for a selection given current args
   */
  getChoices(
    selection: Selection,
    player: Player,
    args: Record<string, unknown>
  ): unknown[] {
    const context: ActionContext = {
      game: this.game,
      player,
      args,
    };

    switch (selection.type) {
      case 'choice': {
        const choiceSel = selection as ChoiceSelection;
        let choices = typeof choiceSel.choices === 'function'
          ? choiceSel.choices(context)
          : [...choiceSel.choices];

        // Apply filterBy if present and the dependent selection has a value
        if (choiceSel.filterBy) {
          const { key, selectionName } = choiceSel.filterBy;
          const previousValue = args[selectionName];

          if (previousValue !== undefined) {
            // Extract the filter value from the previous selection
            // For elements, use .id as fallback if the key doesn't exist
            let filterValue: unknown;
            if (typeof previousValue === 'object' && previousValue !== null) {
              const prevObj = previousValue as Record<string, unknown>;
              // Try the key first, then fall back to 'id' (for element selections)
              filterValue = prevObj[key] !== undefined ? prevObj[key] : prevObj['id'];
            } else {
              filterValue = previousValue;
            }

            // Filter choices where choice[key] matches the filter value
            choices = choices.filter((choice) => {
              if (typeof choice === 'object' && choice !== null) {
                return (choice as Record<string, unknown>)[key] === filterValue;
              }
              return choice === filterValue;
            });
          }
        }

        return choices;
      }

      case 'player': {
        const playerSel = selection as PlayerSelection;
        let players = [...this.game.players];
        if (playerSel.filter) {
          players = players.filter((p) => playerSel.filter!(p, context));
        }
        return players;
      }

      case 'element': {
        const elementSel = selection as ElementSelection;
        const from =
          typeof elementSel.from === 'function'
            ? elementSel.from(context)
            : elementSel.from ?? this.game;

        let elements: GameElement[];
        if (elementSel.elementClass) {
          elements = [...from.all(elementSel.elementClass)];
        } else {
          elements = [...from.all()];
        }

        if (elementSel.filter) {
          elements = elements.filter((e) => elementSel.filter!(e, context));
        }

        return elements;
      }

      case 'text':
      case 'number':
        // These don't have predefined choices
        return [];

      default:
        return [];
    }
  }

  /**
   * Check if a selection should be skipped (only one valid choice)
   */
  shouldSkip(
    selection: Selection,
    player: Player,
    args: Record<string, unknown>
  ): { skip: boolean; value?: unknown } {
    if (!selection.skipIfOnlyOne) {
      return { skip: false };
    }

    const choices = this.getChoices(selection, player, args);
    if (choices.length === 1) {
      return { skip: true, value: choices[0] };
    }

    return { skip: false };
  }

  /**
   * Check if two values are equal (handles objects by comparing JSON)
   */
  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a === 'object' && a !== null && b !== null) {
      // For objects, compare by JSON serialization
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return false;
  }

  /**
   * Check if a value exists in a choices array (handles object comparison)
   */
  private choicesContain(choices: unknown[], value: unknown): boolean {
    return choices.some(choice => this.valuesEqual(choice, value));
  }

  /**
   * Validate a single selection value
   */
  validateSelection(
    selection: Selection,
    value: unknown,
    player: Player,
    args: Record<string, unknown>
  ): ValidationResult {
    const errors: string[] = [];
    const context: ActionContext = {
      game: this.game,
      player,
      args,
    };

    // Check if value is in valid choices (for choice/player/element)
    if (selection.type === 'choice' || selection.type === 'player' || selection.type === 'element') {
      const choices = this.getChoices(selection, player, args);
      if (!this.choicesContain(choices, value)) {
        errors.push(`Invalid selection for ${selection.name}`);
      }
    }

    // Type-specific validation
    switch (selection.type) {
      case 'text': {
        const textSel = selection as TextSelection;
        const str = value as string;
        if (typeof str !== 'string') {
          errors.push(`${selection.name} must be a string`);
        } else {
          if (textSel.minLength !== undefined && str.length < textSel.minLength) {
            errors.push(`${selection.name} must be at least ${textSel.minLength} characters`);
          }
          if (textSel.maxLength !== undefined && str.length > textSel.maxLength) {
            errors.push(`${selection.name} must be at most ${textSel.maxLength} characters`);
          }
          if (textSel.pattern && !textSel.pattern.test(str)) {
            errors.push(`${selection.name} does not match required pattern`);
          }
        }
        break;
      }

      case 'number': {
        const numSel = selection as NumberSelection;
        const num = value as number;
        if (typeof num !== 'number' || isNaN(num)) {
          errors.push(`${selection.name} must be a number`);
        } else {
          if (numSel.min !== undefined && num < numSel.min) {
            errors.push(`${selection.name} must be at least ${numSel.min}`);
          }
          if (numSel.max !== undefined && num > numSel.max) {
            errors.push(`${selection.name} must be at most ${numSel.max}`);
          }
          if (numSel.integer && !Number.isInteger(num)) {
            errors.push(`${selection.name} must be an integer`);
          }
        }
        break;
      }
    }

    // Custom validation
    if (selection.validate && errors.length === 0) {
      // Cast value since we've already validated the type above
      const result = (selection.validate as (v: unknown, a: Record<string, unknown>, c: ActionContext) => boolean | string)(value, args, context);
      if (result !== true) {
        errors.push(typeof result === 'string' ? result : `Invalid ${selection.name}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate all arguments for an action
   */
  validateAction(
    action: ActionDefinition,
    player: Player,
    args: Record<string, unknown>
  ): ValidationResult {
    const allErrors: string[] = [];
    const context: ActionContext = {
      game: this.game,
      player,
      args,
    };

    // Check condition
    if (action.condition && !action.condition(context)) {
      return {
        valid: false,
        errors: ['Action is not available'],
      };
    }

    // Validate each selection
    for (const selection of action.selections) {
      const value = args[selection.name];

      // Handle optional selections
      if (value === undefined) {
        if (!selection.optional) {
          allErrors.push(`Missing required selection: ${selection.name}`);
        }
        continue;
      }

      const result = this.validateSelection(selection, value, player, args);
      allErrors.push(...result.errors);
    }

    return {
      valid: allErrors.length === 0,
      errors: allErrors,
    };
  }

  /**
   * Execute an action with the given arguments
   */
  executeAction(
    action: ActionDefinition,
    player: Player,
    args: Record<string, unknown>
  ): ActionResult {
    // Resolve serialized args (player indices, element IDs) to actual objects
    const resolvedArgs = this.resolveArgs(action, args);

    // Validate with resolved args
    const validation = this.validateAction(action, player, resolvedArgs);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join('; '),
      };
    }

    const context: ActionContext = {
      game: this.game,
      player,
      args: resolvedArgs,
    };

    try {
      const result = action.execute(resolvedArgs, context);
      return result ?? { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if an action is available for a player.
   * For actions with dependent selections (filterBy), this checks if at least
   * one valid path through all selections exists.
   */
  isActionAvailable(action: ActionDefinition, player: Player): boolean {
    const context: ActionContext = {
      game: this.game,
      player,
      args: {},
    };

    if (action.condition && !action.condition(context)) {
      return false;
    }

    // Check if there's at least one valid path through all selections
    return this.hasValidSelectionPath(action.selections, player, {}, 0);
  }

  /**
   * Extract the value used for matching from a choice (for filterBy)
   */
  private getChoiceFilterValue(choice: unknown, key: string): unknown {
    if (typeof choice === 'object' && choice !== null) {
      return (choice as Record<string, unknown>)[key];
    }
    return choice;
  }

  /**
   * Check if any selection after the given index depends on a selection by name
   */
  private hasDependentSelection(
    selections: Selection[],
    afterIndex: number,
    selectionName: string
  ): boolean {
    for (let i = afterIndex; i < selections.length; i++) {
      const sel = selections[i];
      if (sel.type === 'choice') {
        const choiceSel = sel as ChoiceSelection;
        if (choiceSel.filterBy?.selectionName === selectionName) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Recursively check if there's a valid path through all selections.
   * For dependent selections, we need to verify at least one choice
   * leads to valid subsequent selections.
   *
   * OPTIMIZATION: We only do full path validation for choice selections
   * with static choices and filterBy. For element/player selections,
   * or choice selections with dynamic choices functions, the cost of
   * repeatedly computing choices is too high.
   */
  private hasValidSelectionPath(
    selections: Selection[],
    player: Player,
    args: Record<string, unknown>,
    index: number
  ): boolean {
    // Base case: all selections processed
    if (index >= selections.length) {
      return true;
    }

    const selection = selections[index];

    // Skip optional selections - they don't block availability
    if (selection.optional) {
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }

    // Text/number inputs are always available
    if (selection.type === 'text' || selection.type === 'number') {
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }

    // For element and player selections, just check they have choices
    // (don't do expensive path validation - trust their filter functions)
    if (selection.type === 'element' || selection.type === 'player') {
      const choices = this.getChoices(selection, player, args);
      if (choices.length === 0) {
        return false;
      }
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }

    // For choice selections with dynamic choices functions, also skip path validation
    // (computing dynamic choices repeatedly is too expensive)
    if (selection.type === 'choice') {
      const choiceSel = selection as ChoiceSelection;
      if (typeof choiceSel.choices === 'function') {
        const choices = this.getChoices(selection, player, args);
        if (choices.length === 0) {
          return false;
        }
        return this.hasValidSelectionPath(selections, player, args, index + 1);
      }
    }

    // Get choices for this selection (static choices only at this point)
    const choices = this.getChoices(selection, player, args);
    if (choices.length === 0) {
      return false;
    }

    // Check if any later selection depends on this one
    const hasDependent = this.hasDependentSelection(selections, index + 1, selection.name);

    if (!hasDependent) {
      // No dependent selections, just check if subsequent selections are valid
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }

    // Has dependent selections - need to check if at least one choice
    // leads to a valid path through subsequent selections
    for (const choice of choices) {
      // Build new args with this choice
      const newArgs = { ...args, [selection.name]: choice };

      // Check if this choice leads to a valid path
      if (this.hasValidSelectionPath(selections, player, newArgs, index + 1)) {
        return true; // Found at least one valid path
      }
    }

    // No choice led to a valid path
    return false;
  }
}
