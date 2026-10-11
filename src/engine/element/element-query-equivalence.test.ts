/**
 * Element queries answer exactly as the walk they replaced (#654).
 *
 * The query path was rewritten to cost less per call on the tiny collections a
 * bot asks about millions of times (a square's piece, a cell's stone). The
 * walk it replaced is copied below, verbatim, as the oracle, and random trees
 * are asked random queries through both. They must agree on the elements, their
 * order, which elements each function finder was asked about and in what
 * order, and the tree-corruption error, in development and production mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElementCollection } from './element-collection.js';
import { Game, GameElement, Piece, Player, Space } from '../index.js';
import type { ElementClass, ElementFinder } from './types.js';
import { isDevMode } from '../../utils/dev.js';
import { createSeededRandom } from '../../utils/random.js';

const devMode = vi.hoisted(() => ({ override: null as boolean | null }));
vi.mock('../../utils/dev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/dev.js')>();
  return { ...actual, isDevMode: () => devMode.override ?? actual.isDevMode() };
});

// ---------------------------------------------------------------------------
// The oracle: ElementCollection._finder and finderToPredicate as they were
// before #654, with `this` made the `roots` argument.
// ---------------------------------------------------------------------------

type FinderOptions = { limit?: number; order?: 'asc' | 'desc' };

function oracleFinder<F extends GameElement>(
  roots: GameElement[],
  className: ElementClass<F> | undefined,
  options: FinderOptions,
  ...finders: ElementFinder<F>[]
): ElementCollection<F> {
  const result = new ElementCollection<F>();
  if (options.limit !== undefined && options.limit <= 0) return result;

  const visitedIds = isDevMode() ? new Set<number>() : null;
  const firstSeenUnder = isDevMode() ? new Map<number, string>() : null;
  const duplicates: Array<{ id: number; name: string; depth: number; firstPath: string; dupPath: string }> = [];

  const predicates = finders.map((finder) => oracleFinderToPredicate<F>(finder));

  const traverse = (elements: GameElement[], order: 'asc' | 'desc', depth: number, parentPath: string) => {
    const items = order === 'desc' ? [...elements].reverse() : elements;

    for (const el of items) {
      if (options.limit !== undefined && result.length >= options.limit) break;

      if (visitedIds) {
        if (visitedIds.has(el.id)) {
          duplicates.push({
            id: el.id,
            name: el.name ?? el.constructor.name,
            depth,
            firstPath: firstSeenUnder!.get(el.id) ?? '?',
            dupPath: parentPath,
          });
          continue;
        }
        visitedIds.add(el.id);
        firstSeenUnder!.set(el.id, parentPath);
      }

      if ((!className || el instanceof className) && predicates.every((pred) => pred(el as F))) {
        if (order === 'desc') {
          result.unshift(el as F);
        } else {
          result.push(el as F);
        }
      }

      if (el._t.children.length > 0) {
        traverse(el._t.children, order, depth + 1, `${el.name ?? el.constructor.name}#${el.id}`);
      }
    }
  };

  traverse(roots, options.order ?? 'asc', 0, '<root>');

  if (visitedIds && duplicates.length > 0) {
    const shown = duplicates.slice(0, 5);
    const more = duplicates.length > 5 ? ` (and ${duplicates.length - 5} more)` : '';
    throw new Error(
      `TREE CORRUPTION: ${duplicates.length} duplicate element visit(s) during traversal.\n` +
      shown.map(d => `  - ${d.name} (id: ${d.id}) reachable under BOTH "${d.firstPath}" and "${d.dupPath}" (depth ${d.depth})`).join('\n') + more + '\n' +
      `  An element is parented in two places, or two elements share an id.\n` +
      `  The two container labels above are where to look.`
    );
  }

  return result;
}

function oracleFinderToPredicate<F extends GameElement>(finder: ElementFinder<F>): (el: F) => boolean {
  if (typeof finder === 'string') {
    return (el) => el.name === finder;
  }
  if (typeof finder === 'function') {
    return finder;
  }
  return (el) => {
    for (const [key, value] of Object.entries(finder)) {
      if (key === 'empty') {
        if (value !== el.isEmpty()) return false;
      } else if (key === 'mine') {
        if (value !== el.isMine()) return false;
      } else {
        if ((el as Record<string, unknown>)[key] !== value) return false;
      }
    }
    return true;
  };
}

// ---------------------------------------------------------------------------
// Random trees
// ---------------------------------------------------------------------------

class QueryGame extends Game<QueryGame, Player> {}
class Zone extends Space<QueryGame> {
  color = 'red';
  rank = 0;
}
class Cell extends Zone {}
class Token extends Piece<QueryGame> {
  color = 'red';
  rank = 0;
}
class Stone extends Token {}

const CLASSES = [Zone, Cell, Token, Stone] as const;
const NAMES = ['a', 'b', 'c'];
const COLORS = ['red', 'blue'];

type Rng = () => number;
const pick = <T>(rng: Rng, from: readonly T[]): T => from[Math.floor(rng() * from.length)];

function randomTree(rng: Rng): { game: QueryGame; elements: GameElement[] } {
  const game = new QueryGame({ playerCount: 2, seed: 'equivalence' });
  const elements: GameElement[] = [game];
  const grow = (parent: GameElement, depth: number) => {
    // Mostly 0 or 1 children, as on a board, sometimes a handful.
    const roll = rng();
    const count = depth >= 4 ? 0 : roll < 0.35 ? 0 : roll < 0.7 ? 1 : 2 + Math.floor(rng() * 4);
    for (let i = 0; i < count; i++) {
      const cls = parent instanceof Piece || rng() < 0.4 ? pick(rng, [Token, Stone]) : pick(rng, [Zone, Cell]);
      const child = parent.create(cls as ElementClass<Zone>, pick(rng, NAMES)) as Zone | Token;
      child.color = pick(rng, COLORS);
      child.rank = Math.floor(rng() * 4);
      if (child instanceof Token && rng() < 0.5) child.player = game.getPlayer(1 + Math.floor(rng() * 2))!;
      elements.push(child);
      grow(child, depth + 1);
    }
  };
  grow(game, 0);
  return { game, elements };
}

// ---------------------------------------------------------------------------
// Random queries, each built twice so the two runs keep separate call logs
// ---------------------------------------------------------------------------

type Calls = number[];

/** A finder recipe: builds the finder, logging a function finder's calls to `calls`. */
type Recipe = (calls: Calls) => ElementFinder<GameElement>;

function randomRecipe(rng: Rng): Recipe {
  const color = pick(rng, COLORS);
  const rank = Math.floor(rng() * 4);
  const name = pick(rng, NAMES);
  const bool = rng() < 0.5;
  switch (Math.floor(rng() * 7)) {
    case 0: return () => name;
    case 1: return () => ({ color });
    case 2: return () => ({ color, rank });
    case 3: return () => ({ empty: bool });
    case 4: return () => ({ mine: bool, name });
    case 5: return () => ({});
    default: return (calls) => (el: GameElement) => {
      calls.push(el.id);
      return ((el as Token).rank ?? 0) <= rank;
    };
  }
}

const METHODS = ['all', 'first', 'firstN', 'last', 'lastN', 'has', 'count'] as const;
type Method = typeof METHODS[number];

type Query = {
  method: Method;
  n: number;
  className: ElementClass<GameElement> | undefined;
  recipes: Recipe[];
};

function randomQuery(rng: Rng): Query {
  const recipes: Recipe[] = [];
  const finderCount = Math.floor(rng() * 4);
  for (let i = 0; i < finderCount; i++) recipes.push(randomRecipe(rng));
  return {
    method: pick(rng, METHODS),
    n: Math.floor(rng() * 5) - 1,
    className: rng() < 0.75 ? (pick(rng, [...CLASSES, GameElement]) as ElementClass<GameElement>) : undefined,
    recipes,
  };
}

type Target = GameElement | ElementCollection<GameElement>;

/** The query through the live code, by method. */
const LIVE: Record<Method, (target: Target, n: number, args: QueryArgs) => unknown> = {
  all: (target, _n, args) => target.all(...args),
  first: (target, _n, args) => target.first(...args),
  firstN: (target, n, args) => target.firstN(n, ...args),
  last: (target, _n, args) => target.last(...args),
  lastN: (target, n, args) => target.lastN(n, ...args),
  has: (target, _n, args) => target.has(...args),
  // ElementCollection has no count; Array#length of all() is what a game writes.
  count: (target, _n, args) => (target instanceof GameElement ? target.count(...args) : target.all(...args).length),
};

type QueryArgs = [ElementClass<GameElement>, ...ElementFinder<GameElement>[]];

function ask(target: Target, query: Query, finders: ElementFinder<GameElement>[]): unknown {
  const args = (query.className ? [query.className, ...finders] : finders) as QueryArgs;
  return LIVE[query.method](target, query.n, args);
}

/** The same query through the oracle, shaped as the public methods shaped it. */
function askOracle(target: Target, query: Query, finders: ElementFinder<GameElement>[]): unknown {
  const roots = target instanceof GameElement ? [...target._t.children] : [...target];
  const find = (options: FinderOptions) => oracleFinder(roots, query.className, options, ...finders);
  switch (query.method) {
    case 'all': return find({});
    case 'count': return find({}).length;
    case 'first': return find({ limit: 1 })[0];
    case 'has': return find({ limit: 1 })[0] !== undefined;
    case 'firstN': return find({ limit: query.n });
    case 'last': return find({ limit: 1, order: 'desc' })[0];
    case 'lastN': return find({ limit: query.n, order: 'desc' });
  }
}

/** Run `fn`, returning its answer or the error message it threw. */
function outcome(fn: () => unknown): { value?: unknown; error?: string } {
  try {
    return { value: fn() };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

function describeAnswer(value: unknown): unknown {
  if (value instanceof ElementCollection) return { collection: value.map((el) => el.id) };
  if (Array.isArray(value)) return { array: value.map((el: GameElement) => el.id) };
  if (value instanceof GameElement) return { element: value.id };
  return value;
}

function randomTarget(rng: Rng, game: QueryGame, elements: GameElement[]): Target {
  const roll = rng();
  if (roll < 0.6) return pick(rng, elements);
  if (roll < 0.8) return game.all(pick(rng, CLASSES) as ElementClass<GameElement>);
  // A hand-built collection, which may hold an element and one of its
  // descendants: a duplicate visit, refused in development mode.
  const collection = new ElementCollection<GameElement>();
  const size = Math.floor(rng() * 4);
  for (let i = 0; i < size; i++) collection.push(pick(rng, elements));
  return collection;
}

function checkAgreement(seed: string, trees: number, queriesPerTree: number): number {
  const rng = createSeededRandom(seed);
  let corruptions = 0;
  for (let t = 0; t < trees; t++) {
    const { game, elements } = randomTree(rng);
    if (rng() < 0.5) game.setPlayerContext(1);
    for (let q = 0; q < queriesPerTree; q++) {
      const target = randomTarget(rng, game, elements);
      const query = randomQuery(rng);
      const liveCalls: Calls = [];
      const oracleCalls: Calls = [];
      const live = outcome(() => ask(target, query, query.recipes.map((r) => r(liveCalls))));
      const expected = outcome(() => askOracle(target, query, query.recipes.map((r) => r(oracleCalls))));
      if (expected.error) corruptions++;
      const context = `seed ${seed}, tree ${t}, query ${q}: ${query.method}`;
      expect(live.error, context).toBe(expected.error);
      expect(describeAnswer(live.value), context).toEqual(describeAnswer(expected.value));
      if (live.value instanceof Array) expect(live.value, context).toBeInstanceOf(ElementCollection);
      expect(liveCalls, `${context} (function finder calls)`).toEqual(oracleCalls);
    }
  }
  return corruptions;
}

describe('element queries agree with the walk they replaced (#654)', () => {
  afterEach(() => {
    devMode.override = null;
  });

  it('in development mode, including the tree-corruption error', () => {
    expect(isDevMode()).toBe(true);
    const corruptions = checkAgreement('dev-654', 60, 120);
    // The hand-built collections must have exercised the corruption check.
    expect(corruptions).toBeGreaterThan(0);
  });

  it('in production mode, where no corruption check runs', () => {
    devMode.override = false;
    expect(isDevMode()).toBe(false);
    expect(checkAgreement('prod-654', 60, 120)).toBe(0);
  });
});
