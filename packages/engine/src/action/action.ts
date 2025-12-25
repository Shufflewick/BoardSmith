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
  ConditionDetail,
  ActionTrace,
  SelectionTrace,
  RepeatConfig,
  PendingActionState,
  MultiSelectConfig,
} from './types.js';
import type { ElementClass } from '../element/types.js';

// ============================================
// Condition Tracing (for debug interface)
// ============================================

/**
 * Helper class for detailed condition tracing.
 * Game developers can optionally use this in their condition functions
 * to provide detailed debug information about why a condition passed or failed.
 *
 * @example
 * ```typescript
 * .condition((ctx, tracer) => {
 *   // Basic usage (tracer may be undefined in normal execution)
 *   if (!tracer) return ctx.player.hand.count() > 0;
 *
 *   // Detailed tracing for debug mode
 *   return tracer.check('has cards in hand', ctx.player.hand.count() > 0);
 * })
 * ```
 */
export class ConditionTracer {
  private details: ConditionDetail[] = [];

  /**
   * Check a condition and record the result.
   * @param label Human-readable description of what's being checked
   * @param value The value to check (truthy = passed)
   * @returns The boolean result of the check
   */
  check(label: string, value: unknown): boolean {
    const passed = Boolean(value);
    this.details.push({ label, value, passed });
    return passed;
  }

  /**
   * Create a nested group of checks.
   * @param label Human-readable description of this group
   * @param fn Function that performs nested checks using a child tracer
   * @returns The boolean result of the nested checks
   */
  nested(label: string, fn: (tracer: ConditionTracer) => boolean): boolean {
    const childTracer = new ConditionTracer();
    const result = fn(childTracer);
    this.details.push({
      label,
      value: result,
      passed: result,
      children: childTracer.getDetails(),
    });
    return result;
  }

  /**
   * Get all recorded condition details.
   */
  getDetails(): ConditionDetail[] {
    return this.details;
  }
}

/**
 * Wrap a filter function to provide helpful error messages when it crashes
 * due to accessing undefined args properties.
 */
function wrapFilterWithHelpfulErrors<T>(
  filter: (item: T, context: ActionContext) => boolean,
  selectionName: string
): (item: T, context: ActionContext) => boolean {
  return (item: T, context: ActionContext) => {
    try {
      return filter(item, context);
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('Cannot read properties of undefined')) {
        // Extract the property name from the error
        const match = error.message.match(/reading '(\w+)'/);
        const prop = match?.[1] || 'unknown';

        // Find which args are undefined (during availability check)
        const argsKeys = Object.keys(context.args || {});
        const undefinedArgs = argsKeys.filter(k => context.args[k] === undefined);

        if (undefinedArgs.length > 0 || argsKeys.length === 0) {
          const undefinedList = undefinedArgs.length > 0
            ? undefinedArgs.join(', ')
            : '(no previous selections made yet)';

          throw new Error(
            `Filter for selection '${selectionName}' crashed accessing undefined property '${prop}'.\n\n` +
            `This likely happened because the filter runs during availability checks when ` +
            `previous selections haven't been made yet.\n\n` +
            `Undefined args: ${undefinedList}\n\n` +
            `Fix: Use the dependentFilter helper or add a null check:\n\n` +
            `  // Option 1: Use dependentFilter (recommended)\n` +
            `  import { dependentFilter } from '@boardsmith/engine';\n` +
            `  filter: dependentFilter({\n` +
            `    dependsOn: 'previousSelection',\n` +
            `    whenUndefined: (element) => true, // Allow during availability check\n` +
            `    whenSelected: (element, prev) => /* your filter logic */,\n` +
            `  })\n\n` +
            `  // Option 2: Manual null check\n` +
            `  filter: (element, ctx) => {\n` +
            `    const prev = ctx.args?.previousSelection;\n` +
            `    if (!prev) return true; // Allow during availability check\n` +
            `    return /* your actual filter logic */;\n` +
            `  }`
          );
        }
      }
      // Re-throw if it's a different kind of error
      throw error;
    }
  };
}

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
      skipIfOnlyOne: options.skipIfOnlyOne,
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
          const wrappedFilter = wrapFilterWithHelpfulErrors(playerSel.filter, selection.name);
          players = players.filter((p) => wrappedFilter(p, context));
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
          const wrappedFilter = wrapFilterWithHelpfulErrors(elementSel.filter, selection.name);
          elements = elements.filter((e) => wrappedFilter(e, context));
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

      // Handle multiSelect arrays - validate each value in the array
      if (Array.isArray(value)) {
        for (const v of value) {
          if (!this.choicesContain(choices, v)) {
            errors.push(`Invalid selection for ${selection.name}: ${JSON.stringify(v)}`);
          }
        }
      } else if (!this.choicesContain(choices, value)) {
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
   * Trace why an action is or isn't available for debug purposes.
   * Returns detailed information about condition checks and selection availability.
   */
  traceActionAvailability(action: ActionDefinition, player: Player): ActionTrace {
    const trace: ActionTrace = {
      actionName: action.name,
      available: false,
      selections: [],
    };

    const context: ActionContext = {
      game: this.game,
      player,
      args: {},
    };

    // Check condition with optional tracer for detailed info
    if (action.condition) {
      try {
        const tracer = new ConditionTracer();
        // Pass tracer as second arg - condition can use it for detailed tracing
        trace.conditionResult = action.condition(context, tracer);
        const details = tracer.getDetails();
        if (details.length > 0) {
          trace.conditionDetails = details;
        }

        if (!trace.conditionResult) {
          // Condition failed - action not available
          return trace;
        }
      } catch (error) {
        trace.conditionError = error instanceof Error ? error.message : String(error);
        return trace;
      }
    } else {
      // No condition - always passes
      trace.conditionResult = true;
    }

    // Trace each selection
    trace.available = this.traceSelectionPath(action.selections, player, {}, 0, trace.selections);
    return trace;
  }

  /**
   * Recursively trace selection availability for debug purposes.
   * Populates the selectionTraces array with info about each selection.
   */
  private traceSelectionPath(
    selections: Selection[],
    player: Player,
    args: Record<string, unknown>,
    index: number,
    selectionTraces: SelectionTrace[]
  ): boolean {
    // Base case: all selections processed
    if (index >= selections.length) {
      return true;
    }

    const selection = selections[index];
    const selTrace: SelectionTrace = {
      name: selection.name,
      type: selection.type,
      choiceCount: 0,
      optional: selection.optional,
    };

    // Handle skipIfOnlyOne
    if (selection.skipIfOnlyOne) {
      const choices = this.getChoices(selection, player, args);
      if (choices.length === 1) {
        selTrace.choiceCount = 1;
        selTrace.skipped = true;
        selectionTraces.push(selTrace);
        // Auto-select the only choice and continue
        const newArgs = { ...args, [selection.name]: choices[0] };
        return this.traceSelectionPath(selections, player, newArgs, index + 1, selectionTraces);
      }
    }

    // Skip optional selections - they don't block availability
    if (selection.optional) {
      selectionTraces.push(selTrace);
      return this.traceSelectionPath(selections, player, args, index + 1, selectionTraces);
    }

    // Text/number inputs are always available
    if (selection.type === 'text' || selection.type === 'number') {
      selTrace.choiceCount = -1; // -1 indicates free input, not choices
      selectionTraces.push(selTrace);
      return this.traceSelectionPath(selections, player, args, index + 1, selectionTraces);
    }

    // Check for filterBy
    if (selection.type === 'choice') {
      const choiceSel = selection as ChoiceSelection;
      if (choiceSel.filterBy) {
        selTrace.filterApplied = true;
      }
      if (choiceSel.dependsOn) {
        selTrace.dependentOn = choiceSel.dependsOn;
      }
    }

    // Get choices for this selection
    const choices = this.getChoices(selection, player, args);
    selTrace.choiceCount = choices.length;
    selectionTraces.push(selTrace);

    if (choices.length === 0) {
      return false;
    }

    // For simple path checking, just continue with no value
    // (full path validation would be too expensive for traces)
    return this.traceSelectionPath(selections, player, args, index + 1, selectionTraces);
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

  // ============================================
  // Repeating Selections Support
  // ============================================

  /**
   * Check if a selection is configured for repeating.
   */
  isRepeatingSelection(selection: Selection): boolean {
    if (selection.type !== 'choice') return false;
    const cs = selection as ChoiceSelection;
    return cs.repeat !== undefined || cs.repeatUntil !== undefined;
  }

  /**
   * Check if an action has any repeating selections.
   */
  hasRepeatingSelections(action: ActionDefinition): boolean {
    return action.selections.some(s => this.isRepeatingSelection(s));
  }

  /**
   * Process one step of a repeating selection.
   * This handles adding a value to the accumulated selections, running onEach,
   * and checking the termination condition.
   *
   * @returns Object with:
   *   - done: true if the repeating selection is complete
   *   - nextChoices: available choices for the next iteration (if not done)
   *   - error: error message if something went wrong
   */
  processRepeatingStep(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    value: unknown
  ): { done: boolean; nextChoices?: unknown[]; error?: string } {
    const selection = action.selections[pendingState.currentSelectionIndex];
    if (!selection || selection.type !== 'choice') {
      return { done: true, error: `Selection at index ${pendingState.currentSelectionIndex} not found or not a choice` };
    }

    const choiceSel = selection as ChoiceSelection;
    if (!choiceSel.repeat && choiceSel.repeatUntil === undefined) {
      return { done: true, error: `Selection ${selection.name} is not repeating` };
    }

    // Initialize repeating state if needed
    if (!pendingState.repeating) {
      pendingState.repeating = {
        selectionName: selection.name,
        accumulated: [],
        iterationCount: 0,
      };
    }

    // Resolve element/player IDs to actual objects before validating choices
    // This is needed because choices functions (e.g., equipment) may depend on
    // previously selected elements (e.g., actingMerc)
    const resolvedArgs = this.resolveArgs(action, pendingState.collectedArgs);

    // Validate the choice is in the available choices
    const context: ActionContext = {
      game: this.game,
      player,
      args: {
        ...resolvedArgs,
        [selection.name]: pendingState.repeating.accumulated,
      },
    };

    const currentChoices = this.getChoices(selection, player, context.args);
    if (!this.choicesContain(currentChoices, value)) {
      return { done: false, error: `Invalid choice: ${JSON.stringify(value)}`, nextChoices: currentChoices };
    }

    // Add to accumulated values
    pendingState.repeating.accumulated.push(value);
    pendingState.repeating.iterationCount++;

    // Update context with new accumulated value
    context.args[selection.name] = pendingState.repeating.accumulated;

    // Run onEach callback if present
    if (choiceSel.repeat?.onEach) {
      try {
        choiceSel.repeat.onEach(context, value);
      } catch (error) {
        return { done: true, error: error instanceof Error ? error.message : String(error) };
      }
    }

    // Check termination condition
    let isDone = false;
    if (choiceSel.repeatUntil !== undefined) {
      // Simple termination: check if value matches repeatUntil
      isDone = this.valuesEqual(value, choiceSel.repeatUntil);
    } else if (choiceSel.repeat?.until) {
      // Custom termination function
      try {
        isDone = choiceSel.repeat.until(context, value);
      } catch (error) {
        return { done: true, error: error instanceof Error ? error.message : String(error) };
      }
    }

    if (isDone) {
      // Move accumulated values to collected args
      pendingState.collectedArgs[selection.name] = pendingState.repeating.accumulated;
      pendingState.repeating = undefined;
      pendingState.currentSelectionIndex++;
      return { done: true };
    }

    // Get next choices (choices may have changed after onEach)
    // Re-resolve args in case they changed, and use resolved args for choices
    const nextResolvedArgs = this.resolveArgs(action, pendingState.collectedArgs);
    const nextContext: ActionContext = {
      game: this.game,
      player,
      args: {
        ...nextResolvedArgs,
        [selection.name]: pendingState.repeating.accumulated,
      },
    };
    const nextChoices = this.getChoices(selection, player, nextContext.args);

    // If no more choices available, terminate
    if (nextChoices.length === 0) {
      pendingState.collectedArgs[selection.name] = pendingState.repeating.accumulated;
      pendingState.repeating = undefined;
      pendingState.currentSelectionIndex++;
      return { done: true };
    }

    return { done: false, nextChoices };
  }

  /**
   * Create initial pending action state for an action.
   */
  createPendingActionState(actionName: string, playerPosition: number): PendingActionState {
    return {
      actionName,
      playerPosition,
      collectedArgs: {},
      currentSelectionIndex: 0,
    };
  }

  /**
   * Process a non-repeating selection step.
   * This handles regular selections during a pending action flow.
   */
  processSelectionStep(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState,
    selectionName: string,
    value: unknown
  ): { success: boolean; error?: string } {
    const selectionIndex = action.selections.findIndex(s => s.name === selectionName);
    if (selectionIndex === -1) {
      return { success: false, error: `Selection ${selectionName} not found` };
    }

    // Ensure we're at the right selection index
    if (selectionIndex !== pendingState.currentSelectionIndex) {
      return { success: false, error: `Expected selection at index ${pendingState.currentSelectionIndex}, got ${selectionName} at index ${selectionIndex}` };
    }

    const selection = action.selections[selectionIndex];

    // If it's a repeating selection, delegate to processRepeatingStep
    if (this.isRepeatingSelection(selection)) {
      const result = this.processRepeatingStep(action, player, pendingState, value);
      return { success: !result.error, error: result.error };
    }

    // Validate the selection
    const validationResult = this.validateSelection(selection, value, player, pendingState.collectedArgs);
    if (!validationResult.valid) {
      return { success: false, error: validationResult.errors.join('; ') };
    }

    // Store the value and move to next selection
    pendingState.collectedArgs[selectionName] = value;
    pendingState.currentSelectionIndex++;

    return { success: true };
  }

  /**
   * Check if a pending action is complete (all selections processed).
   */
  isPendingActionComplete(action: ActionDefinition, pendingState: PendingActionState): boolean {
    return pendingState.currentSelectionIndex >= action.selections.length && !pendingState.repeating;
  }

  /**
   * Execute a completed pending action.
   */
  executePendingAction(
    action: ActionDefinition,
    player: Player,
    pendingState: PendingActionState
  ): ActionResult {
    if (!this.isPendingActionComplete(action, pendingState)) {
      return { success: false, error: 'Action is not complete' };
    }

    // Resolve serialized args
    const resolvedArgs = this.resolveArgs(action, pendingState.collectedArgs);

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
}
