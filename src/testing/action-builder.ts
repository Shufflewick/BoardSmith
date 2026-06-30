/**
 * ActionBuilder — ergonomic multi-step / dependent-selection builder.
 *
 * Lets test authors drive actions with multiple selections fluently instead
 * of hand-constructing args or dropping to low-level engine calls.
 *
 * Only enabled choices are exposed — disabled choices (c.disabled !== false)
 * are filtered out so test authors cannot accidentally select an invalid value.
 *
 * @example
 * ```typescript
 * // Via factory (recommended):
 * const validDestinations = testGame.action('move', 1).getChoices('destination');
 * testGame.action('move', 1).select('destination', validDestinations[0]).execute();
 *
 * // Directly:
 * const builder = new ActionBuilder(testGame, 'categorize', 1);
 * builder.select('category', 'A');
 * const items = builder.getChoices('item'); // only enabled items for category='A'
 * builder.select('item', items[0]).execute();
 * ```
 *
 * @module
 */

import type { TestGame } from './test-game.js';

/**
 * Fluent builder for driving multi-step / dependent-selection actions in tests.
 *
 * Delegates to `game.getSelectionChoices()` for in-process choice resolution so
 * dependent selections (where choices depend on earlier selections) work correctly
 * without any bespoke evaluation logic.
 *
 * Import-cycle safety: TestGame is imported as a **type only** — there is no
 * runtime edge from action-builder.ts → test-game.ts, so the
 * test-game.ts → action-builder.ts import is a one-way dependency at runtime.
 */
export class ActionBuilder {
  private readonly _testGame: TestGame;
  private readonly _actionName: string;
  private readonly _seat: number;
  private _args: Record<string, unknown> = {};

  constructor(testGame: TestGame, actionName: string, seat: number) {
    this._testGame = testGame;
    this._actionName = actionName;
    this._seat = seat;
  }

  /**
   * Get available choices for a selection.
   *
   * Returns only **enabled** choices — entries where `disabled === false` after
   * filtering through the engine's `getSelectionChoices()`. Disabled choices are
   * never returned so test authors cannot accidentally select an invalid value
   * (Pit of Success: the easy path is the correct path).
   *
   * Accumulated args from prior `select()` calls flow through to the engine so
   * dependent selections see the correct upstream values.
   *
   * @param selectionName - The selection to get choices for
   * @returns Array of enabled choice values (not AnnotatedChoice wrappers)
   */
  getChoices(selectionName: string): unknown[] {
    const player = this._testGame.getPlayer(this._seat);
    return this._testGame.game
      .getSelectionChoices(this._actionName, selectionName, player, this._args)
      .filter(c => c.disabled === false)
      .map(c => c.value);
  }

  /**
   * Accumulate a selection value. Fluent — returns `this` for chaining.
   *
   * @param selectionName - The selection name (key in action args)
   * @param value - The value to set for this selection
   * @returns `this` for chaining
   */
  select(selectionName: string, value: unknown): this {
    this._args = { ...this._args, [selectionName]: value };
    return this;
  }

  /**
   * Execute the fully-built action with accumulated args.
   *
   * @throws {Error} When the action fails, with a message that names both the
   *   action and the seat so the failure is immediately actionable.
   */
  execute(): void {
    const result = this._testGame.doAction(this._seat, this._actionName, this._args);
    if (!result.success) {
      throw new Error(
        `ActionBuilder.execute(): action '${this._actionName}' failed for seat ${this._seat}: ${result.error}`,
      );
    }
  }

  /**
   * Return the accumulated selection values as a plain object without executing.
   *
   * Returns a shallow copy — mutations do not affect internal state.
   *
   * @returns A shallow copy of the accumulated args Record
   */
  buildArgs(): Record<string, unknown> {
    return { ...this._args };
  }
}
