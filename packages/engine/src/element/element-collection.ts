import type { GameElement } from './game-element.js';
import type { ElementClass, ElementFinder, Sorter } from './types.js';

// ============================================
// Development Mode Warnings
// ============================================

function isDevMode(): boolean {
  return typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
}

const shownWarnings = new Set<string>();

function devWarn(key: string, message: string): void {
  if (!isDevMode()) return;
  if (shownWarnings.has(key)) return;
  shownWarnings.add(key);
  console.warn(`[BoardSmith] ${message}`);
}

/**
 * Options for the internal finder method
 */
type FinderOptions = {
  limit?: number;
  order?: 'asc' | 'desc';
  noRecursive?: boolean;
};

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
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, {}, ...finders);
    }
    if (classNameOrFinder !== undefined) {
      finders = [classNameOrFinder as ElementFinder<F>, ...finders];
    }
    return this._finder(undefined, {}, ...finders) as ElementCollection<F>;
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
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, { limit: 1 }, ...finders)[0];
    }
    if (classNameOrFinder !== undefined) {
      finders = [classNameOrFinder as ElementFinder<F>, ...finders];
    }
    return this._finder(undefined, { limit: 1 }, ...finders)[0] as F | undefined;
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
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, { limit: n }, ...finders);
    }
    if (classNameOrFinder !== undefined) {
      finders = [classNameOrFinder as ElementFinder<F>, ...finders];
    }
    return this._finder(undefined, { limit: n }, ...finders) as ElementCollection<F>;
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
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, { limit: 1, order: 'desc' }, ...finders)[0];
    }
    if (classNameOrFinder !== undefined) {
      finders = [classNameOrFinder as ElementFinder<F>, ...finders];
    }
    return this._finder(undefined, { limit: 1, order: 'desc' }, ...finders)[0] as F | undefined;
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
    if (this.isElementClass(classNameOrFinder)) {
      return this._finder(classNameOrFinder, { limit: n, order: 'desc' }, ...finders);
    }
    if (classNameOrFinder !== undefined) {
      finders = [classNameOrFinder as ElementFinder<F>, ...finders];
    }
    return this._finder(undefined, { limit: n, order: 'desc' }, ...finders) as ElementCollection<F>;
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
    const sorted = new ElementCollection<T>(...this);
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
  shuffle(random: () => number = Math.random): ElementCollection<T> {
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
   *
   * @deprecated Use contains() instead - includes() uses reference equality which fails after serialization
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
   *
   * @deprecated Use indexOfElement() instead - indexOf() uses reference equality which fails after serialization
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
   * Internal finder implementation
   */
  _finder<F extends GameElement>(
    className: ElementClass<F> | undefined,
    options: FinderOptions,
    ...finders: ElementFinder<F>[]
  ): ElementCollection<F> {
    const result = new ElementCollection<F>();
    if (options.limit !== undefined && options.limit <= 0) return result;

    // Convert finders to predicate functions
    const predicates = finders.map((finder) => this.finderToPredicate<F>(finder));

    const process = (elements: GameElement[], order: 'asc' | 'desc') => {
      const items = order === 'desc' ? [...elements].reverse() : elements;

      for (const el of items) {
        if (options.limit !== undefined && result.length >= options.limit) break;

        // Check if element matches class and all predicates
        const matchesClass = !className || el instanceof className;
        const matchesPredicates = predicates.every((pred) => pred(el as F));

        if (matchesClass && matchesPredicates) {
          if (order === 'desc') {
            result.unshift(el as F);
          } else {
            result.push(el as F);
          }
        }

        // Recurse into children unless disabled
        if (!options.noRecursive && el._t.children.length > 0) {
          const childCollection = new ElementCollection(...el._t.children);
          const remaining = options.limit !== undefined
            ? options.limit - result.length
            : undefined;
          const childResults = childCollection._finder(className, {
            ...options,
            limit: remaining,
          }, ...finders);
          result.push(...childResults);
        }
      }
    };

    process(this as unknown as GameElement[], options.order ?? 'asc');
    return result;
  }

  /**
   * Convert an ElementFinder to a predicate function
   */
  private finderToPredicate<F extends GameElement>(finder: ElementFinder<F>): (el: F) => boolean {
    if (typeof finder === 'string') {
      return (el) => el.name === finder;
    }
    if (typeof finder === 'function') {
      return finder;
    }
    // Object matcher
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

  /**
   * Check if a value is an ElementClass
   */
  private isElementClass<F extends GameElement>(
    value: unknown
  ): value is ElementClass<F> {
    return (
      typeof value === 'function' &&
      'isGameElement' in value &&
      (value as ElementClass<F>).isGameElement === true
    );
  }
}
