/**
 * How the bot benchmark counts search steps and splits a search's time (#630).
 *
 * The benchmark wraps the bot's own methods for the length of one measurement
 * and puts them back after, so the bot carries no timers when no benchmark is
 * running. The clock is injected here, so these tests assert which part each
 * tick is charged to, never how long anything took.
 */
import { describe, it, expect } from 'vitest';
import { measureSearch, SEARCH_PARTS, STEP_METHOD, LOOKUP_METHOD } from './profile.mjs';
import { MCTSBot } from '../../src/bot/mcts-bot.ts';
import { ElementCollection } from '../../src/engine/element/element-collection.ts';

/** A clock that moves one millisecond each time it is read. */
function tickingClock() {
  let now = 0;
  return () => now++;
}

/** Stand-ins for the bot and the element collection, with the method names the benchmark wraps. */
function fakes() {
  class Bot {
    selectWithPath() {
      return this.applyMoveToSearchGame();
    }
    applyMoveToSearchGame() {
      return this.makeSearchMove();
    }
    makeSearchMove() {
      return 'made';
    }
    movesFor() {
      return [];
    }
    restoreGame() {}
    captureSnapshot() {}
    cloneSearchGame() {}
    evaluateTerminalFromGame() {
      return 0.5;
    }
    sampleWorld() {}
  }
  class Collection {
    _finder(depth) {
      return depth > 0 ? this._finder(depth - 1) : [];
    }
  }
  return { Bot, Collection, targets: { bot: Bot.prototype, collection: Collection.prototype } };
}

describe('measureSearch', () => {
  it('counts one step for each pass down the tree', async () => {
    const { Bot, targets } = fakes();
    const bot = new Bot();
    const measured = await measureSearch(targets, async () => {
      for (let i = 0; i < 7; i++) bot.selectWithPath();
    }, { profile: false, now: tickingClock() });
    expect(measured.steps).toBe(7);
    expect(measured.parts).toBeUndefined();
  });

  it('charges a move made on the way down the tree to re-applying, not to applying', async () => {
    const { Bot, targets } = fakes();
    const bot = new Bot();
    const measured = await measureSearch(targets, async () => {
      bot.selectWithPath();
      bot.makeSearchMove();
    }, { profile: true, now: tickingClock() });
    // Re-apply holds the clock from its entry to its exit: four reads, three ticks.
    // The move made outside it is one tick of applying.
    expect(measured.parts.reapply).toBe(3);
    expect(measured.parts.apply).toBe(1);
    expect(measured.steps).toBe(1);
  });

  it('charges each part only its own time, so the parts never add up to more than the search', async () => {
    const { Bot, targets } = fakes();
    const bot = new Bot();
    const measured = await measureSearch(targets, async () => {
      bot.movesFor();
      bot.restoreGame();
      bot.evaluateTerminalFromGame();
      bot.sampleWorld();
    }, { profile: true, now: tickingClock() });
    const charged = Object.values(measured.parts).reduce((sum, ms) => sum + ms, 0);
    expect(measured.parts).toEqual({
      rebuild: 1, legalMoves: 1, apply: 0, reapply: 0, scoring: 1, determinize: 1,
    });
    expect(charged).toBeLessThanOrEqual(measured.ms);
  });

  it('times only the outermost element lookup when one lookup runs another', async () => {
    const { Collection, targets } = fakes();
    const measured = await measureSearch(targets, async () => {
      new Collection()._finder(3);
    }, { profile: true, now: tickingClock() });
    expect(measured.lookupMs).toBe(1);
  });

  it('puts every wrapped method back, even when the search throws', async () => {
    const { Bot, Collection, targets } = fakes();
    const originals = [...Object.keys(SEARCH_PARTS), STEP_METHOD].map((name) => Bot.prototype[name]);
    const lookup = Collection.prototype._finder;
    await expect(
      measureSearch(targets, async () => {
        throw new Error('search failed');
      }, { profile: true, now: tickingClock() }),
    ).rejects.toThrow('search failed');
    expect([...Object.keys(SEARCH_PARTS), STEP_METHOD].map((name) => Bot.prototype[name])).toEqual(originals);
    expect(Collection.prototype._finder).toBe(lookup);
  });

  it('refuses, by name, a method the bot no longer has', async () => {
    const { Bot, targets } = fakes();
    delete Bot.prototype.sampleWorld;
    await expect(
      measureSearch(targets, async () => {}, { profile: true, now: tickingClock() }),
    ).rejects.toThrow(/sampleWorld/);
    expect(Bot.prototype.movesFor).toBeTypeOf('function');
  });
});

describe('the methods the benchmark wraps', () => {
  it('all exist on the real bot and element collection', () => {
    for (const name of [...Object.keys(SEARCH_PARTS), STEP_METHOD]) {
      expect(MCTSBot.prototype[name], `MCTSBot.${name}`).toBeTypeOf('function');
    }
    expect(ElementCollection.prototype[LOOKUP_METHOD]).toBeTypeOf('function');
  });
});
