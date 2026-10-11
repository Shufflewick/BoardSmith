/**
 * Counts an MCTS search's steps and splits its time into parts (#630).
 *
 * `measureSearch` wraps the bot's own methods for the length of one
 * measurement and puts the originals back after it, so the bot carries no
 * timers and no counters when no benchmark is running. The wrapped names are
 * private methods of `MCTSBot` (`src/bot/mcts-bot.ts`); `profile.test.mjs`
 * fails when one is renamed, and a measurement refuses to start without it.
 */

/** Which bot method's own time is charged to which part of the search. */
export const SEARCH_PARTS = {
  restoreGame: 'rebuild',
  captureSnapshot: 'rebuild',
  cloneSearchGame: 'rebuild',
  movesFor: 'legalMoves',
  makeSearchMove: 'apply',
  applyMoveToSearchGame: 'reapply',
  evaluateTerminalFromGame: 'scoring',
  sampleWorld: 'determinize',
};

/** The parts, in report order. Time charged to none of them is "other". */
export const PART_NAMES = ['rebuild', 'legalMoves', 'apply', 'reapply', 'scoring', 'determinize'];

/** Called once per search step: one walk down the tree from the root. */
export const STEP_METHOD = 'selectWithPath';

/** The element tree walk behind every `all`/`first` query (#632), timed across all parts. */
export const LOOKUP_METHOD = '_finder';

/** Replace `object[name]` with `wrap(original)` and return what puts it back. */
function patch(object, name, wrap) {
  const original = object[name];
  if (typeof original !== 'function') {
    throw new Error(
      `The bot benchmark times ${object.constructor.name}.${name}, which no longer exists. ` +
        'Update the method names in scripts/bench-bot/profile.mjs to match the code.',
    );
  }
  object[name] = wrap(original);
  return () => {
    object[name] = original;
  };
}

/**
 * Run `search` and measure it.
 *
 * @param targets `{ bot, collection }`: `MCTSBot.prototype` and `ElementCollection.prototype`.
 * @param search the search to run, usually `() => bot.play()`.
 * @param options `profile` also splits the time into parts and times element
 *   lookups; that adds two clock reads per wrapped call, so leave it off where
 *   the step count under a timeout is what is measured. `now` is the clock.
 * @returns `{ result, steps, ms }`, plus `parts` (ms per part) and `lookupMs` when profiled.
 */
export async function measureSearch(targets, search, { profile, now = () => performance.now() }) {
  let steps = 0;
  const parts = Object.fromEntries(PART_NAMES.map((part) => [part, 0]));
  const stack = [];
  let mark = 0;
  let lookupMs = 0;
  let lookupDepth = 0;

  // Charge the time since the last mark to the innermost part running.
  const charge = () => {
    const at = now();
    if (stack.length > 0) parts[stack.at(-1)] += at - mark;
    mark = at;
  };

  const restores = [];
  try {
    restores.push(patch(targets.bot, STEP_METHOD, (original) => function (...args) {
      steps++;
      return original.apply(this, args);
    }));
    if (profile) {
      for (const [name, part] of Object.entries(SEARCH_PARTS)) {
        restores.push(patch(targets.bot, name, (original) => function (...args) {
          charge();
          // A move made on the way down the tree is re-applying, not applying.
          stack.push(stack.at(-1) === 'reapply' ? 'reapply' : part);
          try {
            return original.apply(this, args);
          } finally {
            charge();
            stack.pop();
          }
        }));
      }
      restores.push(patch(targets.collection, LOOKUP_METHOD, (original) => function (...args) {
        const start = lookupDepth === 0 ? now() : undefined;
        lookupDepth++;
        try {
          return original.apply(this, args);
        } finally {
          lookupDepth--;
          if (start !== undefined) lookupMs += now() - start;
        }
      }));
    }

    const start = now();
    const result = await search();
    const ms = now() - start;
    return profile ? { result, steps, ms, parts, lookupMs } : { result, steps, ms };
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}
