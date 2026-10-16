import type { GameElement } from './game-element.js';
import type { ElementClass, ElementFinder, Sorter } from './types.js';
import { isDevMode, devWarn } from '../../utils/dev.js';

/**
 * Array-like collection of GameElements with query methods.
 * Returned by element query operations like `.all()`, `.first()`, etc.
 */
export class ElementCollection<T extends GameElement = GameElement> extends Array<T> {
  /**
   * Override slice to return ElementCollection
   */
  override slice(...args: Parameters<Array<T>['slice']>): ElementCollection<T> {
    return super.slice(...args) as ElementCollection<T>;
  }

  /**
   * Override filter to return ElementCollection
   */
  override filter(
    predicate: (value: T, index: number, array: T[]) => boolean
  ): ElementCollection<T> {
    return super.filter(predicate) as ElementCollection<T>;
  }

  /**
   * Find all matching elements recursively within this collection
   */
  all<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F>;
  all(...finders: ElementFinder<T>[]): ElementCollection<T>;
  all<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F> {
    return ElementCollection._finder(this, classNameOrFinder, finders, Infinity, false, new ElementCollection<F>());
  }

  /**
   * Find the first matching element
   */
  first<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined;
  first(...finders: ElementFinder<T>[]): T | undefined;
  first<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined {
    return ElementCollection._finder<F, F[]>(this, classNameOrFinder, finders, 1, false, [])[0];
  }

  /**
   * Find the first N matching elements
   */
  firstN<F extends GameElement>(
    n: number,
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F>;
  firstN(n: number, ...finders: ElementFinder<T>[]): ElementCollection<T>;
  firstN<F extends GameElement>(
    n: number,
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F> {
    return ElementCollection._finder(this, classNameOrFinder, finders, n, false, new ElementCollection<F>());
  }

  /**
   * Find the last matching element
   */
  last<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined;
  last(...finders: ElementFinder<T>[]): T | undefined;
  last<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): F | undefined {
    return ElementCollection._finder<F, F[]>(this, classNameOrFinder, finders, 1, true, [])[0];
  }

  /**
   * Find the last N matching elements
   */
  lastN<F extends GameElement>(
    n: number,
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F>;
  lastN(n: number, ...finders: ElementFinder<T>[]): ElementCollection<T>;
  lastN<F extends GameElement>(
    n: number,
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F> {
    return ElementCollection._finder(this, classNameOrFinder, finders, n, true, new ElementCollection<F>());
  }

  /**
   * Check if any matching elements exist
   */
  has<F extends GameElement>(
    className: ElementClass<F>,
    ...finders: ElementFinder<F>[]
  ): boolean;
  has(...finders: ElementFinder<T>[]): boolean;
  has<F extends GameElement>(
    classNameOrFinder?: ElementClass<F> | ElementFinder<F>,
    ...finders: ElementFinder<F>[]
  ): boolean {
    return this.first(classNameOrFinder as ElementClass<F>, ...finders) !== undefined;
  }

  /**
   * Sort elements by a property or function
   */
  sortBy<K extends Sorter<T>>(key: K, direction: 'asc' | 'desc' = 'asc'): ElementCollection<T> {
    const sorted = ElementCollection.from(this) as ElementCollection<T>;
    sorted.sort((a, b) => {
      const aVal = typeof key === 'function' ? key(a) : a[key as keyof T];
      const bVal = typeof key === 'function' ? key(b) : b[key as keyof T];
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }

  /**
   * Get the sum of a numeric property
   */
  sum(key: keyof T | ((element: T) => number)): number {
    return this.reduce((acc, el) => {
      const val = typeof key === 'function' ? key(el) : el[key as keyof T];
      return acc + (typeof val === 'number' ? val : 0);
    }, 0);
  }

  /**
   * Get the minimum value of a property
   */
  min(key: keyof T | ((element: T) => number)): T | undefined {
    if (this.length === 0) return undefined;
    return this.reduce((min, el) => {
      const minVal = typeof key === 'function' ? key(min) : min[key as keyof T];
      const elVal = typeof key === 'function' ? key(el) : el[key as keyof T];
      return elVal < minVal ? el : min;
    });
  }

  /**
   * Get the maximum value of a property
   */
  max(key: keyof T | ((element: T) => number)): T | undefined {
    if (this.length === 0) return undefined;
    return this.reduce((max, el) => {
      const maxVal = typeof key === 'function' ? key(max) : max[key as keyof T];
      const elVal = typeof key === 'function' ? key(el) : el[key as keyof T];
      return elVal > maxVal ? el : max;
    });
  }

  /**
   * Shuffle the collection in place using the provided random function
   */
  shuffle(random: () => number): ElementCollection<T> {
    for (let i = this.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [this[i], this[j]] = [this[j], this[i]];
    }
    return this;
  }

  /**
   * Get unique values of a property
   */
  unique<K extends keyof T>(key: K): T[K][] {
    const seen = new Set<T[K]>();
    for (const el of this) {
      seen.add(el[key]);
    }
    return Array.from(seen);
  }

  // ============================================
  // Element Comparison Helpers
  // ============================================

  /**
   * Override includes() to warn about element comparison issues.
   * Use contains() instead for correct element comparison by ID.
   */
  override includes(searchElement: T, fromIndex?: number): boolean {
    devWarn(
      'element-includes',
      `ElementCollection.includes() uses reference equality, which fails after serialization.\n` +
      `  Use .contains(element) instead for correct element comparison by ID.\n` +
      `  See: https://boardsmith.io/docs/common-pitfalls#object-reference-comparison`
    );
    return super.includes(searchElement, fromIndex);
  }

  /**
   * Override indexOf() to warn about element comparison issues.
   * Use indexOfElement() instead for correct element comparison by ID.
   */
  override indexOf(searchElement: T, fromIndex?: number): number {
    devWarn(
      'element-indexOf',
      `ElementCollection.indexOf() uses reference equality, which fails after serialization.\n` +
      `  Use .indexOfElement(element) instead for correct element comparison by ID.\n` +
      `  See: https://boardsmith.io/docs/common-pitfalls#object-reference-comparison`
    );
    return super.indexOf(searchElement, fromIndex);
  }

  /**
   * Check if this collection contains an element by ID comparison.
   * Use this instead of .includes() which fails due to object reference issues.
   *
   * @example
   * // WRONG: cards.includes(selectedCard) (fails - different object instances)
   * // CORRECT: cards.contains(selectedCard)
   */
  contains(element: GameElement | null | undefined): boolean {
    if (!element) return false;
    return this.some(e => e.id === element.id);
  }

  /**
   * Find an element in this collection by ID.
   * Returns undefined if not found.
   *
   * @example
   * const card = cards.findById(selectedCard.id);
   */
  findById(id: number): T | undefined {
    return this.find(e => e.id === id);
  }

  /**
   * Check if this collection contains an element with the given ID.
   */
  hasId(id: number): boolean {
    return this.some(e => e.id === id);
  }

  /**
   * Get the index of an element by ID comparison.
   * Returns -1 if not found.
   *
   * @example
   * // WRONG: cards.indexOf(selectedCard) (fails - different object instances)
   * // CORRECT: cards.indexOfElement(selectedCard)
   */
  indexOfElement(element: GameElement | null | undefined): number {
    if (!element) return -1;
    return this.findIndex(e => e.id === element.id);
  }

  /**
   * The one element query: the elements under `roots` (each root, then its
   * subtree, depth first) that are of the class and match every finder, up to
   * `limit` of them. `fromEnd` walks from the last root backwards, each
   * element before its children, and answers the first `limit` matches of
   * that walk in reverse: a root A with a matching child B answers [B, A].
   *
   * `classNameOrFinder` is a query method's first argument, a class or the
   * first finder. The matches are collected into, and returned as, `result`:
   * a new ElementCollection for a query that answers with one, a plain array
   * for one that answers with a single element, as an ElementCollection costs
   * more to make than the rest of a query on an empty square. Static, so
   * `GameElement` queries walk its children array without copying it; the bot
   * benchmark times every element walk here.
   *
   * It costs nothing it does not need per call (#654): bots ask a square or a
   * cell for its piece millions of times, nearly always with 0 or 1 children.
   */
  static _finder<F extends GameElement, R extends F[]>(
    roots: readonly GameElement[],
    classNameOrFinder: ElementClass<F> | ElementFinder<F> | undefined,
    finders: ElementFinder<F>[],
    limit: number,
    fromEnd: boolean,
    result: R,
  ): R {
    if (roots.length === 0 || limit <= 0) return result;

    let className: ElementClass<F> | undefined;
    if (isElementClass<F>(classNameOrFinder)) {
      className = classNameOrFinder;
    } else if (classNameOrFinder !== undefined) {
      finders = [classNameOrFinder, ...finders];
    }

    const query: Query = {
      className,
      predicates: finders.length === 0 ? NO_PREDICATES : finders.map(toPredicate) as Predicate[],
      limit,
      fromEnd,
      result,
      // DEV: where each visited id was first seen, to detect tree corruption
      // and name BOTH places a duplicate is reachable from. One childless
      // root cannot be visited twice, so it needs no map.
      firstSeenUnder: (roots.length > 1 || roots[0]._t.children.length > 0) && isDevMode() ? new Map() : null,
      duplicates: [],
    };
    walk(roots, query, 0, undefined);
    // A duplicate visit is a proven invariant violation, not a diagnostic:
    // this result set feeds snapshots and player views, so returning it ships
    // the corruption onward and poisons every later restore (#45).
    if (query.duplicates.length > 0) throw treeCorruption(query.duplicates);

    // A walk from the end met the matches last-first.
    if (fromEnd) result.reverse();
    return result;
  }
}

/** Is `value` an element class (a GameElement subclass constructor), rather than a finder? */
export function isElementClass<F extends GameElement>(value: unknown): value is ElementClass<F> {
  return (
    typeof value === 'function' &&
    'isGameElement' in value &&
    (value as ElementClass<F>).isGameElement === true
  );
}

type Predicate = (el: GameElement) => boolean;

const NO_PREDICATES: readonly Predicate[] = [];

/** One query's walk state, so the recursive walk needs no closure per call. */
type Query = {
  className: ElementClass<GameElement> | undefined;
  predicates: readonly Predicate[];
  limit: number;
  fromEnd: boolean;
  result: GameElement[];
  /** Dev mode only: the container each visited id was first seen under (undefined: the roots). */
  firstSeenUnder: Map<number, GameElement | undefined> | null;
  duplicates: Array<{ id: number; name: string; depth: number; firstUnder: GameElement | undefined; under: GameElement | undefined }>;
};

/** Visit `elements` (children of `under`, or the roots) and their subtrees, collecting matches. */
function walk(elements: readonly GameElement[], query: Query, depth: number, under: GameElement | undefined): void {
  const { limit, fromEnd, result, firstSeenUnder } = query;
  const count = elements.length;
  for (let i = 0; i < count; i++) {
    if (result.length >= limit) return;
    const el = elements[fromEnd ? count - 1 - i : i];
    // DEV: an element visited twice is tree corruption; skip it so a cycle cannot loop.
    if (firstSeenUnder && isRepeatVisit(query, firstSeenUnder, el, depth, under)) continue;
    if (matches(query, el)) result.push(el);
    if (el._t.children.length > 0) walk(el._t.children, query, depth + 1, el);
  }
}

/**
 * The class first, and the predicates only for an element of it (#283).
 * A predicate is typed for the class it was written against, and on a
 * world's offer road every call wraps the element it is handed in a
 * read-only projection -- so asking it about the whole tree cost a
 * projection per element walked to find one character.
 */
function matches({ className, predicates }: Query, el: GameElement): boolean {
  if (className && !(el instanceof className)) return false;
  for (let p = 0; p < predicates.length; p++) {
    if (!predicates[p](el)) return false;
  }
  return true;
}

/** Whether `el` was visited before in this query, recording the duplicate if so and the visit if not. */
function isRepeatVisit(
  query: Query,
  firstSeenUnder: Map<number, GameElement | undefined>,
  el: GameElement,
  depth: number,
  under: GameElement | undefined,
): boolean {
  if (!firstSeenUnder.has(el.id)) {
    firstSeenUnder.set(el.id, under);
    return false;
  }
  query.duplicates.push({
    id: el.id,
    name: el.name ?? el.constructor.name,
    depth,
    firstUnder: firstSeenUnder.get(el.id),
    under,
  });
  return true;
}

/** The error for a walk that visited elements twice, naming the first few and both places each was reached from. */
function treeCorruption(duplicates: Query['duplicates']): Error {
  const shown = duplicates.slice(0, 5);
  const more = duplicates.length > 5 ? ` (and ${duplicates.length - 5} more)` : '';
  return new Error(
    `TREE CORRUPTION: ${duplicates.length} duplicate element visit(s) during traversal.\n` +
    shown.map(d => `  - ${d.name} (id: ${d.id}) reachable under BOTH "${containerLabel(d.firstUnder)}" and "${containerLabel(d.under)}" (depth ${d.depth})`).join('\n') + more + '\n' +
    `  An element is parented in two places, or two elements share an id.\n` +
    `  The two container labels above are where to look.`
  );
}

/** How a corruption report names the container an element was reached under. */
function containerLabel(under: GameElement | undefined): string {
  return under ? `${under.name ?? under.constructor.name}#${under.id}` : '<root>';
}

/**
 * A finder as a predicate. An object finder's entries are read once per query,
 * when it first tests an element, not once per element tested.
 */
function toPredicate<F extends GameElement>(finder: ElementFinder<F>): (el: F) => boolean {
  if (typeof finder === 'string') {
    return (el) => el.name === finder;
  }
  if (typeof finder === 'function') {
    return finder;
  }
  let entries: [string, unknown][] | undefined;
  return (el) => {
    entries ??= Object.entries(finder);
    for (const [key, value] of entries) {
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
