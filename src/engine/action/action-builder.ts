import type { GameElement } from '../element/game-element.js';
import type { Game } from '../element/game.js';
import type { ElementRef } from '../../types/protocol.js';
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
  RepeatConfig,
  MultiSelectConfig,
  OrderedListConfig,
  ConditionConfig,
  OnSelectContext,
} from './types.js';
import { DEFAULT_TEXT_MAX_LENGTH } from './types.js';
import type { TextPattern } from './text-rules.js';
import { assertLabellableRange, assertUsableInitial } from './number-labels.js';

/**
 * The args record for an action with no selections yet. Using an empty key set
 * (rather than `{}`) keeps `AddArg` clean: `AddArg<NoArgs, 'card', Card>` is
 * exactly `{ card: Card }`, with no leftover index signature.
 */
type NoArgs = Record<never, never>;

/**
 * Accumulates a new named selection into the args record threaded through the
 * builder chain. `AddArg<A, 'card', Card>` produces `A & { card: Card }`.
 *
 * Every selection method mutates `this.definition` and then returns `this`
 * re-typed with the wider args record. That re-type is a LOAD-BEARING cast, and
 * the same one in all five methods: the builder is one object whose static type
 * grows as the chain proceeds, and TypeScript has no way to say "the same
 * instance, now with one more arg" — `A` is an unresolved type parameter, so
 * `Action<G, A>` and `Action<G, AddArg<A, K, T>>` are unrelated to it. The cast
 * is a single assertion rather than the `as unknown as` it used to be, so the
 * two sides still have to be comparable: a change to the class's shape breaks
 * it instead of passing through.
 */
type AddArg<A, K extends string, T> = A & { [P in K]: T };

/**
 * The options that make a selection REPEAT (#325, #347): `repeat`,
 * `repeatUntil`, or both. A repeating selection is picked one value at a time,
 * each pick running `repeat.onEach` before the next is offered, until
 * `repeat.until` (or the `repeatUntil` value) ends it. The argument `execute`
 * receives is then every pick, in order, ending with the one that ended it --
 * which is why a selection given either option is typed as an array.
 */
type RepeatingOptions<T> =
  | {
      /** Repeat until `until` says the last pick ended it; `onEach` runs once per pick. */
      repeat: RepeatConfig<T>;
      /** Shorthand for a `repeat.until` that ends when this value is picked. */
      repeatUntil?: T;
    }
  | { repeat?: RepeatConfig<T>; repeatUntil: T };

/** A selection that does not repeat names neither repeat option. */
type NonRepeatingOptions = { repeat?: undefined; repeatUntil?: undefined };

/**
 * A selection's per-choice `disabled` rule, and the work every call of it
 * shares within one evaluation of the choices (#334).
 *
 * `prepare` runs once each time the engine evaluates the choices, before the
 * first `disabled` call, and what it returns is `disabled`'s third argument. It
 * is never kept between evaluations, so it always sees the game as it is now.
 * Use it for anything a rule would otherwise recompute for every candidate,
 * such as the set of spaces the pieces on the board already cover.
 */
type DisabledOptions<G extends Game, T, P> = {
  /** Work shared by every `disabled` call of one evaluation; its result is `disabled`'s `prepared`. */
  prepare?: (context: ActionContext<G>) => P;
  /** Check if a choice should be disabled. Returns reason string or false. */
  disabled?: (choice: T, context: ActionContext<G>, prepared: P) => string | false;
  /**
   * The player-facing refusal for a submitted value that is no longer listed
   * (#393). `value` is what was submitted: a choice's value, or an element if
   * it still exists and otherwise the id sent. Without it the player reads a
   * plain default and the engine's detail goes to the dev log.
   */
  unavailable?: (value: unknown, context: ActionContext<G>) => string;
};

/**
 * A `prepare` feeds `disabled` and nothing else, so one declared alone is a
 * mistake (most likely a misspelt or forgotten `disabled`). Refused where the
 * action is declared, rather than silently computing work nobody reads.
 */
function assertPrepareHasDisabled(method: string, name: string, options: { prepare?: unknown; disabled?: unknown }): void {
  if (options.prepare !== undefined && options.disabled === undefined) {
    throw new Error(
      `${method}('${name}') declares prepare but no disabled rule. prepare's result is handed only ` +
      `to disabled(choice, ctx, prepared), once per evaluation of the choices. Add the disabled ` +
      `rule that reads it, or remove prepare.`
    );
  }
}

/**
 * Picks are asked in declared order, optional ones included (#392), so a pick
 * may only read an EARLIER pick through `dependsOn` or `filterBy`. One naming a
 * later pick would be asked while its source is unanswered and draw an empty
 * list. Refused where the action is declared.
 */
function assertReadsEarlierPick(
  method: string,
  name: string,
  declared: readonly Selection[],
  source: string | undefined,
  relation: 'depends on' | 'filters by',
): void {
  if (source === undefined || declared.some((selection) => selection.name === source)) return;
  const earlier = declared.map((selection) => `'${selection.name}'`).join(', ') || 'none';
  throw new Error(
    `${method}('${name}') ${relation} '${source}', which is not declared before it. Picks are asked ` +
    `in the order the action declares them, so declare '${source}' earlier in the chain, or name one of ` +
    `the picks that come before '${name}' (${earlier}).`
  );
}

/** Every `chooseFrom` option except the repeat options ({@link RepeatingOptions}) and the disabled rule ({@link DisabledOptions}). */
type ChooseFromOptions<G extends Game, T> = {
  prompt?: string | ((context: ActionContext<G>) => string);
  choices: T[] | ((context: ActionContext<G>) => T[]);
  display?: (choice: T) => string;
  optional?: boolean | string;
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
   * Enable multi-select mode with checkboxes instead of radio buttons.
   * Can be a static config or dynamic function evaluated per context.
   */
  multiSelect?: number | MultiSelectConfig | ((context: ActionContext<G>) => number | MultiSelectConfig | undefined);
  /**
   * Ask for an ORDERED, REPEATABLE list rather than a set (#249): the value
   * is an array in the order the player built it, one identity may appear
   * more than once, and `min`/`max` count ENTRIES. Mutually exclusive with
   * `multiSelect`.
   */
  orderedList?: number | OrderedListConfig | ((context: ActionContext<G>) => number | OrderedListConfig | undefined);
  /** Called after this step is resolved. Receives the resolved value and a restricted context. */
  onSelect?: (value: T, context: OnSelectContext) => void;
  /** Called if the action is cancelled after onSelect fired but before execute(). */
  onCancel?: (context: OnSelectContext) => void;
};

/** Every `chooseElement` option except the repeat options ({@link RepeatingOptions}) and the disabled rule ({@link DisabledOptions}). */
type ChooseElementOptions<G extends Game, T extends GameElement> = {
  prompt?: string | ((context: ActionContext<G>) => string);
  elementClass?: ElementClass<T>;
  from?: GameElement | ((context: ActionContext<G>) => GameElement);
  filter?: (element: GameElement, context: ActionContext<G>) => boolean;
  /**
   * Precomputed candidates (alternative to elementClass/from/filter).
   * Custom UIs send the element ID directly.
   */
  elements?: T[] | ((context: ActionContext<G>) => T[]);
  optional?: boolean | string;
  validate?: (value: T, args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
  /**
   * Custom label for each element (for UI buttons). Receives the whole
   * candidate list too, so a label can disambiguate against its siblings.
   */
  display?: (element: T, context: ActionContext<G>, allElements: T[]) => string;
  /** Get board element reference for highlighting */
  boardRef?: (element: T, context: ActionContext<G>) => ElementRef;
  /**
   * Name of a previous selection this depends on.
   * When specified, availability checking will verify that at least one
   * choice from the dependency leads to valid choices for this selection.
   */
  dependsOn?: string;
  /** Called after this step is resolved. Receives the resolved value and a restricted context. */
  onSelect?: (value: T, context: OnSelectContext) => void;
  /** Called if the action is cancelled after onSelect fired but before execute(). */
  onCancel?: (context: OnSelectContext) => void;
};

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
      // No real handler supplied yet; cleared by .execute(fn) below. Only
      // relevant if the chain terminates via .build() instead of .execute().
      handlerless: true,
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
   * Offer this action, but greyed out, WITH the reason why.
   *
   * Return a reason string to disable the action's button, or `false` to leave
   * it enabled. The reason is not optional — the only way to disable an action
   * is to say why, so a player never meets a dead button with no explanation.
   * The string is shown on hover/focus and read by screen readers.
   *
   * Choose between this and `.condition()`:
   * - `.condition()` — the action is IRRELEVANT here, so it vanishes from the
   *   panel entirely (playing a card during someone else's turn).
   * - `.disabled()` — the action is relevant but currently blocked, and the
   *   player would otherwise wonder why (Build, while two wood short).
   *
   * Evaluated at availability time with EMPTY args, exactly like `.condition()`.
   * A rule that needs the resolved selections belongs in `.validate()`.
   * Enforced server-side: submitting a disabled action is refused with its reason.
   *
   * @param fn - Returns the reason the action is blocked, or `false` when it is not
   * @returns The builder for chaining
   *
   * @example
   * ```typescript
   * Action.create<MyGame>('build')
   *   .disabled((ctx) => {
   *     const wood = ctx.player.resources.wood;
   *     return wood < 3 ? `You need 3 wood to build; you have ${wood}.` : false;
   *   })
   *   .execute((_args, ctx) => { ... });
   * ```
   */
  disabled(fn: (context: ActionContext<G>) => string | false): this {
    // Same erasure as `.execute()`/`.validate()`: ActionDefinition is non-generic,
    // and the runtime always passes the game this chain declared.
    this.definition.disabled = fn as ActionDefinition['disabled'];
    return this;
  }

  /**
   * Gate the whole action at submit time, with every selection resolved.
   *
   * This is the place for a rule that spans selections and needs to explain
   * itself. Use it instead of:
   * - `.condition()`, which decides whether the action is OFFERED and is also
   *   evaluated with EMPTY args for that purpose — a predicate that reads
   *   `ctx.args` there must special-case the empty record or the action becomes
   *   permanently (un)available, and a failing condition cannot carry a custom
   *   message.
   * - a per-selection `validate`, which can only see the args collected so far,
   *   does not run when an optional selection is skipped, and has nowhere to
   *   live on an action with no selections.
   * - a `{ success: false }` return from `.execute()`, which is too late: the
   *   action has already been dispatched and the handler may have mutated state.
   *
   * Return `true` to allow, `false` to refuse generically, or a string to refuse
   * WITH that message shown to the player. (Same contract as a selection's
   * `validate` — one rule for both, on purpose.)
   *
   * @param fn - Predicate over the fully-resolved args
   * @returns The builder for chaining
   *
   * @example
   * ```typescript
   * Action.create<MyGame>('play')
   *   .chooseElements('cards', { elementClass: Card, min: 1 })
   *   .validate((args, ctx) => {
   *     if (args.cards.length < 2) return 'Play at least 2 cards.';
   *     const cost = args.cards.length;
   *     if (cost > ctx.player.actionPoints) {
   *       return `That costs ${cost} AP; you have ${ctx.player.actionPoints}.`;
   *     }
   *     return true;
   *   })
   *   .execute(({ cards }, ctx) => { ... });
   * ```
   */
  validate(fn: (args: A, context: ActionContext<G>) => boolean | string): this {
    // Same erasure as `.execute()`: ActionDefinition is non-generic, and the
    // runtime always passes the args/game this chain declared.
    this.definition.validate = fn as ActionDefinition['validate'];
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
   * Mark this action as manual: the shell will NOT play it for the player.
   * The player takes the beat themselves — by tapping the action's button in
   * the default Action Panel, or a control the game wires up in a custom board
   * UI. Use for actions like a draw, where the move should never be silently
   * played.
   *
   * - Sole *no-selection* action: the shell does not auto-execute it.
   * - Action *with selections*: the shell still auto-*starts* it (surfaces its
   *   prompt), but does NOT auto-fill a single enabled choice — so it never
   *   silently auto-executes. The player picks every choice deliberately; their
   *   final pick is what completes the action (AUTOEXEC-01 / F-02).
   */
  manual(): this {
    this.definition.manual = true;
    return this;
  }

  /**
   * Hide this action's **redundant start button** in the Action Panel. The
   * action remains fully executable via the board / custom UI
   * (useBoardInteraction) — this only suppresses the rendered button, it does
   * not disable or unregister the action. Not a security control.
   *
   * Use for actions the game also exposes through a custom board interaction
   * (e.g. drag-drop, click-to-select), where the board affordance is inherent
   * and a second start button is clutter.
   *
   * ## This is NOT a way to turn the Action Panel off
   *
   * The Action Panel is on at all times, and it offers exactly what the board
   * offers. A custom board control is *in addition to* the panel, never instead
   * of it: the panel is the keyboard path, the screen-reader path, and the path
   * that still works when a board control is off-screen, mid-animation, or not
   * built yet. Two surfaces showing different things means the panel's user is
   * playing a different game — see docs/actions-and-flow.md.
   *
   * Two consequences, both deliberate:
   *
   * - **Start button only.** Once the action is under way, the panel renders
   *   its prompt and its FULL choice list, exactly as it would without this
   *   flag. There is no setting that suppresses a live choice list. A board
   *   that draws the same choices is the intended arrangement, not a duplicate.
   * - **Suppression never empties the panel.** If every currently-available
   *   action is suppressed, they are all shown anyway — the panel is then the
   *   player's only remaining control, and a prompt with nothing to press is
   *   not a state a player can leave. (For an action with no selections it is
   *   terminal: no pick can start, so the mid-pick keyboard/SR affordance never
   *   appears either.) The guarantee is "hidden while something else is
   *   offered", not "hidden always".
   *
   * Design the board affordance as the primary path, not the only one.
   *
   * `platformActionPanelEscapeHatch` is not the game-side version of this: it
   * belongs to the host platform, which substitutes its own equivalent surface.
   */
  suppressFromActionPanel(): this {
    this.definition.suppressFromActionPanel = true;
    return this;
  }

  /**
   * Mark this verb as one that permanently ends something, so the Action Panel
   * draws it apart from every other button in the bar.
   *
   * ```typescript
   * Action.create('endSurvivor')
   *   .prompt('End this survivor, scattering everything you carry')
   *   .destructive()
   *   .execute(...)
   * ```
   *
   * Use it for a move a player cannot take back: eliminating their own piece,
   * conceding, razing something, spending a one-time resource for good. Do not
   * use it for merely expensive or merely bad moves -- a bar where half the
   * buttons are marked warns about nothing.
   *
   * ## What it draws
   *
   * The button is painted from `--bsg-destructive-surface` / `--bsg-destructive-ink`
   * instead of the accent, AND carries an inset ring, a marker glyph and a
   * screen-reader label. The warning is deliberately not colour alone: a player
   * who cannot separate the hues still sees a differently shaped button and
   * still hears "Destructive action."
   *
   * ## What it does NOT change
   *
   * Availability, validation, ordering and execution are all untouched, and a
   * destructive action is confirmed exactly as much as it was before -- if the
   * move needs a confirmation step, the game still writes one. This makes the
   * button look like what it does; it does not make it safe.
   *
   * A custom board reads the same flag off the same metadata
   * (`actionMetadata[name].destructive`), so the two surfaces cannot disagree
   * about which verb is the dangerous one.
   *
   * @returns The builder for chaining
   */
  // fallow-ignore-next-line unused-class-member
  destructive(): this {
    this.definition.destructive = true;
    return this;
  }

  /**
   * Put this action's **start button** inside a named Action Panel menu group.
   *
   * A game with many simultaneously available verbs gives a rare
   * administrative one the same prominence as the one the player uses every
   * turn. A group takes ONE button at its parent level, and its members appear
   * only after the player opens it:
   *
   * ```typescript
   * Action.create('dumpOre').group('Dump').order(10).execute(...)
   * Action.create('renamePlanet').group('More', 'Empire settings').execute(...)
   * ```
   *
   * Each argument is one level, outermost first, and intermediate groups are
   * created by being named. A segment is the group's LABEL and its IDENTITY at
   * once: there is nothing to register, so there is no id to leave dangling,
   * and two actions in the same group cannot disagree about what it is called.
   *
   * ## A group is navigation, never a command
   *
   * Opening or closing one submits no order, consumes no turn and moves no
   * persistent state. The panel derives the menu from the metadata it already
   * has and holds the open path in its own local state; nothing about a group
   * reaches the rules, which is why there is no group callback to write.
   *
   * ## What it does NOT change
   *
   * - **Availability.** Only actions that are currently available reach the
   *   menu, so a group whose members all went away is simply not there. It
   *   never hides an available action: the action is one press further away,
   *   not gone.
   * - **Executability.** `.condition()`, `.disabled()` and `.validate()` are
   *   untouched, the disabled reason and the help popover render inside a group
   *   exactly as at the top level, and the server validates a grouped action
   *   identically. A custom board UI is unaffected -- grouping is an
   *   arrangement of the panel's buttons, not a change to what the game offers,
   *   so the two surfaces still show the same state.
   *
   * Use `.order()` to place buttons within a level. A group sits where its
   * lowest-ordered member sits.
   *
   * @param path - One label per level, outermost first
   * @returns The builder for chaining
   */
  group(...path: string[]): this {
    if (path.length === 0) {
      throw new Error(
        `Action "${this.definition.name}": .group() needs at least one label, e.g. `
        + `.group('More') or .group('More', 'Empire settings'). Omit the call to leave the `
        + `action at the top level of the Action Panel.`,
      );
    }
    const blank = path.findIndex((label) => label.trim().length === 0);
    if (blank !== -1) {
      throw new Error(
        `Action "${this.definition.name}": .group() was given a blank label at position `
        + `${blank + 1}. Every level needs a name a player can read, because the label is `
        + `both the group's button text and what a screen reader announces on entering it.`,
      );
    }
    this.definition.group = path;
    return this;
  }

  /**
   * Place this action's start button within its Action Panel menu level.
   *
   * Lower sorts earlier. An action that declares no order sorts as `0`, so a
   * negative order means "before everything I did not think about" and a
   * positive one "after"; ties keep the order the actions became available in.
   * A GROUP sits where its lowest-ordered member sits, which is why there is no
   * separate order to declare for a group -- and therefore no way for two of
   * its members to disagree about where it goes.
   *
   * @param order - Sort key; any finite number, so fractions can slot between
   * @returns The builder for chaining
   */
  order(order: number): this {
    if (!Number.isFinite(order)) {
      throw new Error(
        `Action "${this.definition.name}": .order() needs a finite number and was given `
        + `${order}. Use a plain number such as 10, -5 or 2.5 -- lower sorts earlier.`,
      );
    }
    this.definition.order = order;
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
   * @param options.prompt - User-facing prompt text, or a function evaluated
   *   against the current game state each time the pick is rendered
   * @param options.choices - Static array or function returning available choices
   * @param options.display - Custom display function for each choice
   * @param options.optional - If true, player can skip this selection. A string skips
   *   too, and is used as the Skip button's label.
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
  chooseFrom<K extends string, T, P = undefined>(
    name: K,
    options: ChooseFromOptions<G, T> & DisabledOptions<G, T, P> & RepeatingOptions<T>
  ): Action<G, AddArg<A, K, T[]>>;
  chooseFrom<K extends string, T, P = undefined>(
    name: K,
    options: ChooseFromOptions<G, T> & DisabledOptions<G, T, P> & NonRepeatingOptions
  ): Action<G, AddArg<A, K, T>>;
  chooseFrom<K extends string, T, P = undefined>(
    name: K,
    options: ChooseFromOptions<G, T> & DisabledOptions<G, T, P> & Partial<RepeatingOptions<T>>
  ): Action<G, AddArg<A, K, T>> | Action<G, AddArg<A, K, T[]>> {
    assertPrepareHasDisabled('chooseFrom', name, options);
    assertReadsEarlierPick('chooseFrom', name, this.definition.selections, options.dependsOn, 'depends on');
    assertReadsEarlierPick('chooseFrom', name, this.definition.selections, options.filterBy?.selectionName, 'filters by');
    // A SET AND A SEQUENCE ARE DIFFERENT QUESTIONS (#249), and a selection that
    // asked both would have to pick one silently: the set refuses the repeat the
    // list exists to allow. Refused at declaration time, where the author is
    // standing, rather than at the first submission that happens to repeat.
    if (options.multiSelect !== undefined && options.orderedList !== undefined) {
      throw new Error(
        `chooseFrom('${name}') declares both multiSelect and orderedList. They ask opposite `
        + `questions: multiSelect is a SET (order incidental, a repeated choice refused), `
        + `orderedList is a SEQUENCE (order is the rule, a repeat is a second instruction). `
        + `Keep multiSelect for "choose N of these"; keep orderedList for "do these, in this order".`
      );
    }
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
      orderedList: options.orderedList,
      prepare: options.prepare,
      disabled: options.disabled,
      unavailable: options.unavailable,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    } as ChoiceSelection<T>;
    this.definition.selections.push(selection as Selection);
    return this as Action<G, AddArg<A, K, T>>;
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
   * @param options.prompt - User-facing prompt text, or a function evaluated
   *   against the current game state each time the pick is rendered
   * @param options.elementClass - Filter to specific element types (e.g., Card, Piece)
   * @param options.from - Container element to select from (defaults to game board)
   * @param options.filter - Additional filter function for elements
   * @param options.elements - Precomputed array (or function) of candidates
   * @param options.optional - If true, player can skip this selection. A string skips
   *   too, and is used as the Skip button's label.
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
  chooseElement<K extends string, T extends GameElement, P = undefined>(
    name: K,
    options: ChooseElementOptions<G, T> & DisabledOptions<G, T, P> & RepeatingOptions<T>
  ): Action<G, AddArg<A, K, T[]>>;
  chooseElement<K extends string, T extends GameElement, P = undefined>(
    name: K,
    options?: ChooseElementOptions<G, T> & DisabledOptions<G, T, P> & NonRepeatingOptions
  ): Action<G, AddArg<A, K, T>>;
  chooseElement<K extends string, T extends GameElement, P = undefined>(
    name: K,
    options: ChooseElementOptions<G, T> & DisabledOptions<G, T, P> & Partial<RepeatingOptions<T>> = {}
  ): Action<G, AddArg<A, K, T>> | Action<G, AddArg<A, K, T[]>> {
    assertPrepareHasDisabled('chooseElement', name, options);
    assertReadsEarlierPick('chooseElement', name, this.definition.selections, options.dependsOn, 'depends on');
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
      prepare: options.prepare,
      disabled: options.disabled,
      unavailable: options.unavailable,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    } as ElementSelection<T>;
    this.definition.selections.push(selection as Selection);
    return this as Action<G, AddArg<A, K, T>>;
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
   * @param options.prompt - User-facing prompt text, or a function evaluated
   *   against the current game state each time the pick is rendered
   * @param options.elements - Elements to choose from (array or function)
   * @param options.multiSelect - Count bound (number = max, or `{ min, max }`)
   * @param options.optional - If true, player can skip this selection. A string skips
   *   too, and is used as the Skip button's label.
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
  chooseElements<K extends string, T extends GameElement, P = undefined>(
    name: K,
    options: DisabledOptions<G, T, P> & {
      prompt?: string | ((context: ActionContext<G>) => string);
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
      optional?: boolean | string;
      validate?: (value: T[], args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
      /** Get board element reference for highlighting */
      boardRef?: (element: T, context: ActionContext<G>) => ElementRef;
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
      /** Called after this step is resolved. Receives the resolved value and a restricted context. */
      onSelect?: (value: T[], context: OnSelectContext) => void;
      /** Called if the action is cancelled after onSelect fired but before execute(). */
      onCancel?: (context: OnSelectContext) => void;
    }
  ): Action<G, AddArg<A, K, T[]>> {
    assertPrepareHasDisabled('chooseElements', name, options);
    assertReadsEarlierPick('chooseElements', name, this.definition.selections, options.dependsOn, 'depends on');
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
      prepare: options.prepare,
      disabled: options.disabled,
      unavailable: options.unavailable,
      onSelect: options.onSelect as ElementsSelection<T>['onSelect'],
      onCancel: options.onCancel,
    } as ElementsSelection<T>;
    this.definition.selections.push(selection as Selection);
    return this as Action<G, AddArg<A, K, T[]>>;
  }

  /**
   * Add a text input selection for free-form string input.
   *
   * **Every text selection is length-bounded.** Player-authored text goes into
   * the element tree, which is copied into every retained undo checkpoint AND
   * every per-seat player view — so an unbounded field is multiplied by the
   * game's action count and its seat count (see `docs/state-size.md`). If you
   * do not set `maxLength`, {@link DEFAULT_TEXT_MAX_LENGTH} is applied; set
   * your own, lower, bound whenever you know the real one.
   *
   * **What no text may contain (#394).** Control characters (C0, DEL, C1) and
   * unpaired UTF-16 surrogates are refused, with a sentence the player can act
   * on; a `multiline` field admits line feed and tab. See `text-rules.ts`.
   *
   * **Bounding length is not sanitization.** The engine validates length and
   * `pattern`/`validate`; it does not escape anything. Text a player types is
   * rendered in other players' clients, so for anything but free prose supply
   * a `pattern` (or `validate`) that admits only what your game means to allow.
   *
   * @param name - Argument name that will be passed to the execute handler
   * @param options - Configuration for the text input
   * @param options.prompt - User-facing prompt text, or a function evaluated
   *   against the current game state each time the pick is rendered
   * @param options.pattern - `{ regex, message }`: the regex the input must
   *   match, and the sentence the player is shown when it does not
   * @param options.minLength - Minimum required string length
   * @param options.maxLength - Maximum allowed string length. Default: {@link DEFAULT_TEXT_MAX_LENGTH}
   * @param options.maxBytes - The most UTF-8 bytes the text may add to a world
   *   partition, measured as the partition store measures it. A positive
   *   integer. Without it, `maxLength` bounds the bytes at three times itself
   * @param options.multiline - Draw the field as a resizable box rather than a
   *   single line, with a character count and an explicit submit button so
   *   Enter inserts a newline. Presentation only: the value, the bounds and the
   *   validation are identical either way. Reach for it when the text is prose
   *   the player must read back as well as write -- a description a player
   *   cannot see four words of at a time is one they cannot review.
   * @param options.optional - If true, player can skip this selection. A string skips
   *   too, and is used as the Skip button's label.
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
   *     pattern: { regex: /^[a-zA-Z0-9_]+$/, message: 'Use letters, digits and underscores only.' },
   *   })
   *   .execute(({ nickname }) => {
   *     ctx.player.nickname = nickname;
   *   });
   * ```
   *
   * @example
   * ```typescript
   * action('setDescription')
   *   .enterText('description', {
   *     prompt: 'Empire description',
   *     maxLength: 1000,
   *     multiline: true,
   *   })
   *   .execute(({ description }, ctx) => {
   *     ctx.player.description = description;
   *   });
   * ```
   */
  enterText<K extends string>(
    name: K,
    options: {
      prompt?: string | ((context: ActionContext<G>) => string);
      pattern?: TextPattern;
      minLength?: number;
      maxLength?: number;
      maxBytes?: number;
      multiline?: boolean;
      optional?: boolean | string;
      validate?: (value: string, args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
      /** Called after this step is resolved. Receives the resolved value and a restricted context. */
      onSelect?: (value: string, context: OnSelectContext) => void;
      /** Called if the action is cancelled after onSelect fired but before execute(). */
      onCancel?: (context: OnSelectContext) => void;
    } = {}
  ): Action<G, AddArg<A, K, string>> {
    if (options.maxBytes !== undefined && !(Number.isInteger(options.maxBytes) && options.maxBytes > 0)) {
      throw new Error(
        `enterText('${name}') was given maxBytes ${String(options.maxBytes)}. maxBytes is the most ` +
          'bytes the text may take when stored, so it must be a whole number above zero.',
      );
    }
    const selection = {
      type: 'text',
      name,
      prompt: options.prompt,
      pattern: options.pattern,
      minLength: options.minLength,
      maxLength: options.maxLength ?? DEFAULT_TEXT_MAX_LENGTH,
      maxBytes: options.maxBytes,
      multiline: options.multiline,
      optional: options.optional,
      validate: options.validate,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    } as TextSelection;
    this.definition.selections.push(selection);
    return this as Action<G, AddArg<A, K, string>>;
  }

  /**
   * Add a number input selection for numeric values.
   *
   * @param name - Argument name that will be passed to the execute handler
   * @param options - Configuration for the number input
   * @param options.prompt - User-facing prompt text, or a function evaluated
   *   against the current game state each time the pick is rendered
   * @param options.min - Minimum allowed value
   * @param options.max - Maximum allowed value
   * @param options.integer - If true, only whole numbers are allowed
   * @param options.initial - The value the field opens on (#258). Refused at
   *   declaration time if this pick's own min/max/integer would reject it.
   * @param options.display - What the value the player is on means (#258), the
   *   numeric twin of the choice kinds' `display`. Evaluated once per value in
   *   the range and shipped with the pick, so the range must be enumerable:
   *   min, max and `integer: true`, within `MAX_LABELLED_NUMBER_VALUES`.
   * @param options.optional - If true, player can skip this selection. A string skips
   *   too, and is used as the Skip button's label.
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
   *
   * @example A field that opens on a value and says what it means
   * ```typescript
   * action('declareAge')
   *   .enterNumber('age', {
   *     prompt: 'How old are you?',
   *     min: 16,
   *     max: 65,
   *     integer: true,
   *     initial: 35,
   *     display: (age) => (age <= 20 ? 'barely grown' : age <= 30 ? 'young' : 'seasoned'),
   *   })
   *   .execute(({ age }, ctx) => { ctx.player.age = age; });
   * ```
   */
  enterNumber<K extends string>(
    name: K,
    options: {
      prompt?: string | ((context: ActionContext<G>) => string);
      min?: number;
      max?: number;
      integer?: boolean;
      initial?: number;
      display?: (value: number) => string;
      optional?: boolean | string;
      validate?: (value: number, args: Record<string, unknown>, context: ActionContext<G>) => boolean | string;
      /** Called after this step is resolved. Receives the resolved value and a restricted context. */
      onSelect?: (value: number, context: OnSelectContext) => void;
      /** Called if the action is cancelled after onSelect fired but before execute(). */
      onCancel?: (context: OnSelectContext) => void;
    } = {}
  ): Action<G, AddArg<A, K, number>> {
    // REFUSED WHEN THE ACTION IS WRITTEN, not when a player opens the panel
    // (#258). Both of these are about the declaration alone, so there is no
    // state to wait for -- and a field that opens on a refused value, or a
    // display that could never be answered, is exactly the kind of thing that
    // otherwise surfaces as a blank field in front of a player.
    const range = { min: options.min, max: options.max, integer: options.integer };
    if (options.initial !== undefined) assertUsableInitial(name, options.initial, range);
    if (options.display !== undefined) assertLabellableRange(name, range);
    const selection = {
      type: 'number',
      name,
      prompt: options.prompt,
      min: options.min,
      max: options.max,
      integer: options.integer,
      initial: options.initial,
      display: options.display,
      optional: options.optional,
      validate: options.validate,
      onSelect: options.onSelect,
      onCancel: options.onCancel,
    } as NumberSelection;
    this.definition.selections.push(selection);
    return this as Action<G, AddArg<A, K, number>>;
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
    delete this.definition.handlerless;
    return this.definition;
  }

  /**
   * Get the built definition (without execute, for inspection).
   *
   * The returned definition is still flagged `handlerless` if `.execute(fn)`
   * was never called — `Game#registerAction()` rejects handler-less
   * definitions at registration time (ENG-08). `.build()` remains useful for
   * inspecting a chain (e.g. in tests), but its result must not be registered
   * as-is unless the chain later calls `.execute(fn)`.
   */
  build(): ActionDefinition {
    return this.definition;
  }
}

// Re-export ElementClass type for use in chooseElement
import type { ElementClass } from '../element/types.js';
