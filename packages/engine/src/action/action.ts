import type { GameElement } from '../element/game-element.js';
import type { Player } from '../player/player.js';
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
  ValidationResult,
  ActionTrace,
  SelectionTrace,
  RepeatConfig,
  PendingActionState,
  ConditionConfig,
  ConditionDetail,
  ObjectCondition,
} from './types.js';
import { isDevMode, devWarn, wrapFilterWithHelpfulErrors } from './helpers.js';
import { Action } from './action-builder.js';

// Re-export Action class from action-builder
export { Action };

/**
 * Check if a condition is an object-based condition (has labeled predicates).
 * Object conditions enable automatic debug tracing.
 */
function isObjectCondition(condition: ConditionConfig): condition is ObjectCondition {
  return typeof condition !== 'function';
}

/**
 * Evaluate an object condition, returning result and trace details.
 * All predicates are evaluated (AND semantics) and their results captured.
 */
function evaluateObjectCondition(
  condition: ObjectCondition,
  context: ActionContext
): { passed: boolean; details: ConditionDetail[] } {
  const details: ConditionDetail[] = [];
  let allPassed = true;

  for (const [label, predicate] of Object.entries(condition)) {
    let passed = false;
    let value: unknown = undefined;
    try {
      const result = predicate(context);
      passed = Boolean(result);
      value = result;
    } catch (error) {
      passed = false;
      value = error instanceof Error ? error.message : String(error);
    }
    details.push({ label, value, passed });
    if (!passed) allPassed = false;
  }

  return { passed: allPassed, details };
}

/**
 * Evaluate a condition config and return whether it passes.
 * Handles both legacy function format and new object format.
 */
export function evaluateCondition(
  condition: ConditionConfig,
  context: ActionContext
): boolean {
  // Legacy function format - call directly
  if (!isObjectCondition(condition)) {
    return condition(context);
  }

  // Object format - use evaluateObjectCondition
  return evaluateObjectCondition(condition, context).passed;
}

/**
 * Handles validation, argument resolution, and execution of player actions.
 *
 * ActionExecutor is an internal class used by the game session to process
 * incoming action requests. It resolves serialized arguments (element IDs,
 * player indices) to actual game objects before calling action handlers.
 *
 * Most game developers won't interact with ActionExecutor directly - instead
 * use the {@link Action} builder to define actions and the game session's
 * `sendAction` to execute them.
 *
 * Key responsibilities:
 * - Resolving element IDs to GameElement objects
 * - Validating selections against available choices
 * - Checking action availability (conditions and selection paths)
 * - Executing action handlers with resolved arguments
 * - Supporting repeating selections and pending action state
 */
export class ActionExecutor {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  /**
   * Resolve serialized args (player indices, element IDs) to actual objects.
   * This is needed because network-serialized args use indices/IDs instead of objects.
   *
   * @param action The action definition
   * @param args The raw args from the client
   * @param player Optional player for context-dependent choice resolution
   */
  resolveArgs(
    action: ActionDefinition,
    args: Record<string, unknown>,
    player?: Player
  ): Record<string, unknown> {
    const resolved = { ...args };
    const selectionNames = new Set(action.selections.map(s => s.name));

    // First pass: resolve selection args based on their type
    for (const selection of action.selections) {
      const value = args[selection.name];
      if (value === undefined) continue;

      switch (selection.type) {
        case 'element': {
          // If value is a number, resolve to actual GameElement by ID
          if (typeof value === 'number') {
            const element = this.game.getElementById(value);
            if (element) {
              resolved[selection.name] = element;
            }
          } else if (this.looksLikeSerializedElement(value)) {
            // Handle serialized element objects from followUp args
            const element = this.game.getElementById((value as { id: number }).id);
            if (element) {
              resolved[selection.name] = element;
            }
          }
          break;
        }
        case 'elements': {
          // fromElements() selection - value is element ID(s)
          // Resolve to actual GameElement object(s)
          if (typeof value === 'number') {
            // Single element ID
            const element = this.game.getElementById(value);
            if (element) {
              resolved[selection.name] = element;
            }
          } else if (Array.isArray(value)) {
            // Multi-select: array of element IDs or serialized elements
            const elements = value
              .map(v => {
                if (typeof v === 'number') {
                  return this.game.getElementById(v);
                } else if (this.looksLikeSerializedElement(v)) {
                  return this.game.getElementById((v as { id: number }).id);
                }
                return null;
              })
              .filter((el): el is GameElement => el !== null);
            resolved[selection.name] = elements;
          }
          break;
        }
        case 'choice': {
          // If the choice value is a serialized element (object with id and className),
          // resolve it to the actual GameElement
          if (this.isSerializedElement(value)) {
            const element = this.game.getElementById((value as { id: number }).id);
            if (element) {
              resolved[selection.name] = element;
            }
          } else if (player) {
            // Try smart resolution: element ID or display string → actual choice
            // This supports custom UIs sending element IDs for chooseFrom selections
            const choices = this.getChoices(selection, player, resolved);
            let resolvedValue = this.smartResolveChoiceValue(value, choices);

            // Extract just the 'value' property from {value, label/display} pattern choices
            // This makes chooseFrom with simple value objects work intuitively:
            //   choices: [{ value: 'skip', label: 'Skip' }]
            //   args.myChoice === 'skip' (not { value: 'skip', label: 'Skip' })
            resolvedValue = this.extractChoiceValue(resolvedValue);

            if (resolvedValue !== value) {
              resolved[selection.name] = resolvedValue;
            }
          }
          break;
        }
      }
    }

    // Second pass: resolve non-selection args that look like element references
    // This handles followUp args like { sectorId: { id: 145, name: 'Silver Industry' } }
    for (const [key, value] of Object.entries(args)) {
      if (selectionNames.has(key)) continue; // Already processed above
      if (value === undefined) continue;

      // Resolve numeric IDs
      if (typeof value === 'number') {
        const element = this.game.getElementById(value);
        if (element) {
          resolved[key] = element;
        }
      }
      // Resolve serialized element objects (from followUp args)
      else if (this.looksLikeSerializedElement(value)) {
        const element = this.game.getElementById((value as { id: number }).id);
        if (element) {
          resolved[key] = element;
        }
      }
    }

    return resolved;
  }

  /**
   * Check if a value looks like a serialized element (has numeric id property).
   * This is a looser check than isSerializedElement - used for followUp args
   * which may not have className but still represent elements.
   */
  private looksLikeSerializedElement(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.id === 'number';
  }

  /**
   * Check if a value is a serialized game element (has id and className properties)
   */
  private isSerializedElement(value: unknown): boolean {
    if (typeof value !== 'object' || value === null) return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.id === 'number' && typeof obj.className === 'string';
  }

  /**
   * Extract the 'value' property from a {value, label/display} choice object.
   * This enables the intuitive pattern where:
   *   choices: [{ value: 'skip', label: 'Skip' }]
   *   args.selection === 'skip'  // not the full object
   *
   * Only extracts if:
   * - The choice is an object with a 'value' property
   * - The choice is NOT a game element (no 'id' and 'className')
   * - The choice is NOT an element-like object (has 'id' but looks like metadata)
   */
  private extractChoiceValue(choice: unknown): unknown {
    if (typeof choice !== 'object' || choice === null) {
      return choice;
    }

    const obj = choice as Record<string, unknown>;

    // Don't extract from game elements
    if (this.isSerializedElement(choice)) {
      return choice;
    }

    // Don't extract from element-like objects (have numeric id but no className)
    // These are likely actual game elements or element references
    if (typeof obj.id === 'number') {
      return choice;
    }

    // If it has a 'value' property, extract just the value
    // This handles { value: 'skip', label: 'Skip' } → 'skip'
    if ('value' in obj) {
      return obj.value;
    }

    return choice;
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

      case 'element': {
        const elementSel = selection as ElementSelection;

        let elements: GameElement[];

        // Check if elements array is provided directly (from fromElements without multiSelect)
        if (elementSel.elements) {
          elements = typeof elementSel.elements === 'function'
            ? elementSel.elements(context)
            : [...elementSel.elements];
        } else {
          // Original from/filter/elementClass pattern (for chooseElement)
          const from =
            typeof elementSel.from === 'function'
              ? elementSel.from(context)
              : elementSel.from ?? this.game;

          // DEV: Check if 'from' is an ElementCollection (likely a bug in action definition)
          if (isDevMode() && Array.isArray(from) && from.length > 0 && 'all' in from) {
            console.warn(
              `[BoardSmith] ⚠️ Selection "${selection.name}" 'from' returned an ElementCollection!\n` +
              `  This is likely a bug - 'from' should return a container (Space/Game), not elements.\n` +
              `  Example fix: from: () => game.stash  (not game.stash.all(Equipment))\n` +
              `  The 'from' collection has ${from.length} elements. Calling .all() on it will search WITHIN these.`
            );
          }

          if (elementSel.elementClass) {
            elements = [...from.all(elementSel.elementClass)];
          } else {
            elements = [...from.all()];
          }

          if (elementSel.filter) {
            const wrappedFilter = wrapFilterWithHelpfulErrors(elementSel.filter, selection.name);
            elements = elements.filter((e) => wrappedFilter(e, context));
          }
        }

        return elements;
      }

      case 'elements': {
        // New "pit of success" selection type - elements array
        const elementsSel = selection as ElementsSelection;
        const elements = typeof elementsSel.elements === 'function'
          ? elementsSel.elements(context)
          : [...elementsSel.elements];

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
   * Check if a selection should be auto-skipped.
   * Note: Auto-skip is now handled by the UI's Auto mode toggle,
   * so this always returns skip: false.
   * @deprecated Auto-skip is handled by UI Auto mode
   */
  shouldSkip(
    _selection: Selection,
    _player: Player,
    _args: Record<string, unknown>
  ): { skip: boolean; value?: unknown } {
    // Auto-skip is now handled by the UI's Auto mode toggle
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
   * Try to resolve a value to a valid choice using smart matching.
   * This provides backward compatibility for custom UIs sending element IDs
   * when using chooseFrom with element-based choices.
   *
   * Smart matching tries (in order):
   * 1. Element ID match: if value is a number and a choice is an element with that ID
   * 2. Display match: if value is a string matching a choice's display property
   *
   * @returns true if the value can be resolved to a valid choice
   */
  private trySmartResolveChoice(value: unknown, choices: unknown[]): boolean {
    // Try element ID match or value match for numbers
    if (typeof value === 'number') {
      for (const choice of choices) {
        if (choice && typeof choice === 'object') {
          // Check if choice is an element with matching ID
          if ('id' in choice && (choice as { id: number }).id === value) {
            return true;
          }
          // Check if choice has matching 'value' property (for playerChoices pattern)
          if ('value' in choice && (choice as { value: number }).value === value) {
            return true;
          }
        }
      }
    }

    // Try string match against choice properties
    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      for (const choice of choices) {
        if (choice && typeof choice === 'object') {
          const obj = choice as Record<string, unknown>;
          // Check value property first (for {value, display} pattern), then display, name, label
          // Both exact match and case-insensitive match are tried
          const propsToCheck = ['value', 'display', 'name', 'label'];
          for (const prop of propsToCheck) {
            const propValue = obj[prop];
            if (propValue !== undefined) {
              // Exact match (for value property especially)
              if (propValue === value) {
                return true;
              }
              // Case-insensitive string match
              if (typeof propValue === 'string' && propValue.toLowerCase() === lowerValue) {
                return true;
              }
            }
          }
        } else if (typeof choice === 'string' && choice.toLowerCase() === lowerValue) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Resolve a value to the actual choice value using smart matching.
   * Used by resolveArgs to convert IDs/display strings to actual choice values.
   *
   * @returns The resolved choice value, or the original value if no match found
   */
  private smartResolveChoiceValue(value: unknown, choices: unknown[]): unknown {
    // Try element ID match
    if (typeof value === 'number') {
      for (const choice of choices) {
        if (choice && typeof choice === 'object' && 'id' in choice) {
          if ((choice as { id: number }).id === value) {
            return choice;
          }
        }
      }
    }

    // Try string match against choice properties
    if (typeof value === 'string') {
      const lowerValue = value.toLowerCase();
      for (const choice of choices) {
        if (choice && typeof choice === 'object') {
          const obj = choice as Record<string, unknown>;
          // Check value property first (for {value, display} pattern), then display, name, label
          const propsToCheck = ['value', 'display', 'name', 'label'];
          for (const prop of propsToCheck) {
            const propValue = obj[prop];
            if (propValue !== undefined) {
              // Exact match (for value property especially)
              if (propValue === value) {
                return choice;
              }
              // Case-insensitive string match
              if (typeof propValue === 'string' && propValue.toLowerCase() === lowerValue) {
                return choice;
              }
            }
          }
        } else if (typeof choice === 'string' && choice.toLowerCase() === lowerValue) {
          return choice;
        }
      }
    }

    return value;
  }

  /**
   * Format valid choices for error messages
   */
  private formatValidChoices(choices: unknown[]): string {
    const maxShow = 5;
    const formatted = choices.slice(0, maxShow).map(choice => {
      if (choice && typeof choice === 'object') {
        const obj = choice as Record<string, unknown>;
        // Try to get a readable representation
        if (obj.display) return String(obj.display);
        if (obj.name) return String(obj.name);
        if (obj.label) return String(obj.label);
        if ('id' in obj) return `(id: ${obj.id})`;
      }
      return JSON.stringify(choice);
    });

    if (choices.length > maxShow) {
      formatted.push(`... and ${choices.length - maxShow} more`);
    }

    return `[${formatted.join(', ')}]`;
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

    // Check if value is in valid choices (for choice/element)
    if (selection.type === 'choice' || selection.type === 'element') {
      const choices = this.getChoices(selection, player, args);

      // Handle multiSelect arrays - validate each value in the array
      if (Array.isArray(value)) {
        for (const v of value) {
          if (!this.choicesContain(choices, v)) {
            // Try smart resolution for choice selections
            if (selection.type === 'choice' && !this.trySmartResolveChoice(v, choices)) {
              const validChoicesStr = this.formatValidChoices(choices);
              errors.push(`Invalid selection for "${selection.name}": ${JSON.stringify(v)}. Valid choices: ${validChoicesStr}`);
            }
          }
        }
      } else if (!this.choicesContain(choices, value)) {
        // Try smart resolution for choice selections
        if (selection.type === 'choice' && !this.trySmartResolveChoice(value, choices)) {
          const validChoicesStr = this.formatValidChoices(choices);
          errors.push(`Invalid selection for "${selection.name}": ${JSON.stringify(value)}. Valid choices: ${validChoicesStr}`);
        } else if (selection.type === 'element') {
          errors.push(`Invalid selection for ${selection.name}`);
        }
      }
    }

    // Validate elements selection (new "pit of success" type)
    // After resolveArgs, values are GameElement objects (not raw IDs)
    if (selection.type === 'elements') {
      const validElements = this.getChoices(selection, player, args) as GameElement[];
      const validIds = validElements.map(e => e.id);

      const validateElement = (elem: unknown): string | null => {
        // Handle resolved GameElement objects
        if (elem && typeof elem === 'object' && 'id' in elem) {
          const id = (elem as { id: number }).id;
          if (!validIds.includes(id)) {
            const validNames = validElements.map(e => `${e.name} (id: ${e.id})`).join(', ');
            return `Element ID ${id} is not a valid choice for "${selection.name}". Valid elements: [${validNames}]`;
          }
          return null;
        }
        // Handle unresolved IDs (for backwards compatibility)
        if (typeof elem === 'number') {
          if (!validIds.includes(elem)) {
            const validNames = validElements.map(e => `${e.name} (id: ${e.id})`).join(', ');
            return `Element ID ${elem} is not a valid choice for "${selection.name}". Valid elements: [${validNames}]`;
          }
          return null;
        }
        return `Expected element or element ID for "${selection.name}", got ${typeof elem}: ${JSON.stringify(elem)}`;
      };

      if (Array.isArray(value)) {
        // Multi-select: array of elements or IDs
        for (const v of value) {
          const error = validateElement(v);
          if (error) errors.push(error);
        }
      } else {
        // Single selection
        const error = validateElement(value);
        if (error) errors.push(error);
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
    if (action.condition && !evaluateCondition(action.condition, context)) {
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
    const resolvedArgs = this.resolveArgs(action, args, player);

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
      console.error(`[BoardSmith] Action '${action.name}' execution failed:`, error);
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

    if (action.condition && !evaluateCondition(action.condition, context)) {
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

    // Check condition with automatic tracing for object conditions
    if (action.condition) {
      try {
        if (isObjectCondition(action.condition)) {
          // Object condition - automatic tracing via evaluateObjectCondition
          const { passed, details } = evaluateObjectCondition(action.condition, context);
          trace.conditionResult = passed;
          if (details.length > 0) {
            trace.conditionDetails = details;
          }
        } else {
          // Legacy function condition - no automatic tracing
          trace.conditionResult = action.condition(context);
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

    // Check dependsOn for element/elements selections too
    if ((selection.type === 'element' || selection.type === 'elements') && 'dependsOn' in selection) {
      selTrace.dependentOn = (selection as ElementSelection | ElementsSelection).dependsOn;
    }

    // Get choices for this selection
    const choices = this.getChoices(selection, player, args);
    selTrace.choiceCount = choices.length;
    selectionTraces.push(selTrace);

    if (choices.length === 0) {
      // Development mode warning: suggest dependsOn if there are prior selections
      if (index > 0 && !selTrace.dependentOn) {
        const priorSelections = selections.slice(0, index).map(s => s.name);
        devWarn(
          `dependsOn-hint:${selection.name}`,
          `Selection '${selection.name}' returned 0 choices during availability check.\n` +
          `  If it depends on a prior selection (${priorSelections.join(', ')}), add \`dependsOn: "${priorSelections[priorSelections.length - 1]}"\`.\n` +
          `  This tells the framework to check availability for each prior choice.\n` +
          `  See: https://boardsmith.io/docs/common-pitfalls#dependent-selections`
        );
      }
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
      // Check for filterBy dependency (choice selections only)
      if (sel.type === 'choice') {
        const choiceSel = sel as ChoiceSelection;
        if (choiceSel.filterBy?.selectionName === selectionName) {
          return true;
        }
      }
      // Check for dependsOn dependency (all selection types)
      if ('dependsOn' in sel && sel.dependsOn === selectionName) {
        return true;
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

    // For element selections, check if they have choices
    // If a later selection depends on this one, do full path validation
    if (selection.type === 'element') {
      const choices = this.getChoices(selection, player, args);
      if (choices.length === 0) {
        return false;
      }
      // Check if any later selection depends on this one
      const hasDependent = this.hasDependentSelection(selections, index + 1, selection.name);
      if (hasDependent) {
        // Need to verify at least one choice leads to a valid path
        for (const choice of choices) {
          const newArgs = { ...args, [selection.name]: choice };
          if (this.hasValidSelectionPath(selections, player, newArgs, index + 1)) {
            return true;
          }
        }
        return false;
      }
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }

    // For elements selections (fromElements), check if they have elements
    // If a later selection depends on this one, do full path validation
    if (selection.type === 'elements') {
      const elements = this.getChoices(selection, player, args);
      if (elements.length === 0) {
        return false;
      }
      // Check if any later selection depends on this one
      const hasDependent = this.hasDependentSelection(selections, index + 1, selection.name);
      if (hasDependent) {
        // Need to verify at least one element leads to a valid path
        for (const element of elements) {
          const newArgs = { ...args, [selection.name]: element };
          if (this.hasValidSelectionPath(selections, player, newArgs, index + 1)) {
            return true;
          }
        }
        return false;
      }
      return this.hasValidSelectionPath(selections, player, args, index + 1);
    }

    // For choice selections with dynamic choices functions
    // If a later selection depends on this one, do full path validation
    if (selection.type === 'choice') {
      const choiceSel = selection as ChoiceSelection;
      if (typeof choiceSel.choices === 'function') {
        const choices = this.getChoices(selection, player, args);
        if (choices.length === 0) {
          return false;
        }
        // Check if any later selection depends on this one
        const hasDependent = this.hasDependentSelection(selections, index + 1, selection.name);
        if (hasDependent) {
          // Need to verify at least one choice leads to a valid path
          for (const choice of choices) {
            const newArgs = { ...args, [selection.name]: choice };
            if (this.hasValidSelectionPath(selections, player, newArgs, index + 1)) {
              return true;
            }
          }
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
    if (selection.type === 'choice') {
      const cs = selection as ChoiceSelection;
      return cs.repeat !== undefined || cs.repeatUntil !== undefined;
    }
    if (selection.type === 'element') {
      const es = selection as ElementSelection;
      return es.repeat !== undefined || es.repeatUntil !== undefined;
    }
    if (selection.type === 'elements') {
      const es = selection as ElementsSelection;
      return es.repeat !== undefined || es.repeatUntil !== undefined;
    }
    return false;
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
   * Supports choice, element, and elements selection types.
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
    if (!selection) {
      return { done: true, error: `Selection at index ${pendingState.currentSelectionIndex} not found` };
    }

    // Get repeat config based on selection type
    let repeatConfig: RepeatConfig<unknown> | undefined;
    let repeatUntil: unknown | undefined;
    const isElementSelection = selection.type === 'element' || selection.type === 'elements';

    if (selection.type === 'choice') {
      const choiceSel = selection as ChoiceSelection;
      repeatConfig = choiceSel.repeat;
      repeatUntil = choiceSel.repeatUntil;
    } else if (selection.type === 'element') {
      const elemSel = selection as ElementSelection;
      repeatConfig = elemSel.repeat as RepeatConfig<unknown>;
      repeatUntil = elemSel.repeatUntil;
    } else if (selection.type === 'elements') {
      const elemsSel = selection as ElementsSelection;
      repeatConfig = elemsSel.repeat as RepeatConfig<unknown>;
      repeatUntil = elemsSel.repeatUntil;
    } else {
      return { done: true, error: `Selection ${selection.name} type ${selection.type} does not support repeat` };
    }

    if (!repeatConfig && repeatUntil === undefined) {
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
    const resolvedArgs = this.resolveArgs(action, pendingState.collectedArgs, player);

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

    // For element selections, value is an element ID - validate it exists in choices
    if (isElementSelection) {
      const elementId = value as number;
      const validIds = currentChoices.map((el: any) => el.id);
      if (!validIds.includes(elementId)) {
        // Format choices as {value, display} for UI
        const formattedChoices = this.formatElementChoices(currentChoices as GameElement[]);
        return { done: false, error: `Invalid element ID: ${elementId}`, nextChoices: formattedChoices };
      }
    } else if (!this.choicesContain(currentChoices, value)) {
      return { done: false, error: `Invalid choice: ${JSON.stringify(value)}`, nextChoices: currentChoices };
    }

    // Add to accumulated values
    pendingState.repeating.accumulated.push(value);
    pendingState.repeating.iterationCount++;

    // Update context with new accumulated value
    context.args[selection.name] = pendingState.repeating.accumulated;

    // Run onEach callback if present
    if (repeatConfig?.onEach) {
      try {
        // For element selections, resolve the value to actual element for onEach
        const resolvedValue = isElementSelection
          ? this.game.getElementById(value as number)
          : value;
        repeatConfig.onEach(context, resolvedValue);
      } catch (error) {
        return { done: true, error: error instanceof Error ? error.message : String(error) };
      }
    }

    // Check termination condition
    let isDone = false;
    if (repeatUntil !== undefined) {
      // Simple termination: check if value matches repeatUntil
      // For elements, repeatUntil would be an element, so compare IDs
      if (isElementSelection) {
        const untilId = typeof repeatUntil === 'number' ? repeatUntil : (repeatUntil as any)?.id;
        isDone = value === untilId;
      } else {
        isDone = this.valuesEqual(value, repeatUntil);
      }
    } else if (repeatConfig?.until) {
      // Custom termination function
      try {
        // For element selections, resolve value to actual element for until check
        const resolvedValue = isElementSelection
          ? this.game.getElementById(value as number)
          : value;
        isDone = repeatConfig.until(context, resolvedValue);
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
    const nextResolvedArgs = this.resolveArgs(action, pendingState.collectedArgs, player);
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

    // Format choices for UI - element selections need {value: id, display: name}
    const formattedChoices = isElementSelection
      ? this.formatElementChoices(nextChoices as GameElement[], selection, nextContext)
      : nextChoices;

    return { done: false, nextChoices: formattedChoices };
  }

  /**
   * Format element array as choices for UI (with value/display format)
   * Uses the selection's display function if available, otherwise falls back to element.name
   */
  private formatElementChoices(
    elements: GameElement[],
    selection?: Selection,
    context?: ActionContext
  ): Array<{ value: number; display: string }> {
    // Get custom display function from selection if available
    const customDisplay = selection && 'display' in selection ? (selection as any).display : undefined;

    // Auto-disambiguate names (for fallback when no custom display)
    const nameCounts = new Map<string, number>();
    for (const el of elements) {
      const name = el.name || 'Element';
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
    const nameIndices = new Map<string, number>();

    return elements.map(el => {
      let display: string;

      // Use custom display function if available
      if (customDisplay && context) {
        try {
          display = customDisplay(el, context, elements);
        } catch {
          // Fallback to element name if display function fails
          display = el.name || 'Element';
        }
      } else {
        // Default: use element name with disambiguation
        const baseName = el.name || 'Element';
        const count = nameCounts.get(baseName) || 1;

        if (count > 1) {
          const idx = (nameIndices.get(baseName) || 0) + 1;
          nameIndices.set(baseName, idx);
          display = `${baseName} #${idx}`;
        } else {
          display = baseName;
        }
      }

      return { value: el.id, display };
    });
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
    const resolvedArgs = this.resolveArgs(action, pendingState.collectedArgs, player);

    const context: ActionContext = {
      game: this.game,
      player,
      args: resolvedArgs,
    };

    try {
      const result = action.execute(resolvedArgs, context);
      return result ?? { success: true };
    } catch (error) {
      console.error(`[BoardSmith] Action '${action.name}' execution failed:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
