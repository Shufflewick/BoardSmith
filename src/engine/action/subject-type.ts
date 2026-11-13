/**
 * WHAT A VERB IS ABOUT (#1640).
 *
 * A subject type is declared once per game: its name, how a thing is keyed and
 * labelled, and whether its things are pieces the player already has on the
 * board. A pick then says only which thing its value is (`subject: PACKS`, or
 * `PACKS.of(mapping)`), so two actions cannot key or label one thing two ways.
 * Each candidate row carries the thing it is, and `subjectIndex` inverts the
 * first-pick lists into which verbs take which thing.
 */
import { isElement, type GameElement } from '../element/game-element.js';
import type { PickSubject, PickSubjectType, SubjectRef } from '../../types/protocol.js';
import type { ActionContext } from './types.js';

/** The most rows a subject first pick may list: a table carries the list in every state push, and a world allows a selection as many. */
export const MAX_SUBJECT_ROWS = 200;

/** A game element is keyed by its id, so its type takes no key; any other thing needs one. */
type KeyOption<T> = [T] extends [GameElement] ? { key?: never } : { key: (thing: T) => string };

export type SubjectTypeOptions<T, C extends ActionContext = ActionContext> = KeyOption<T> & {
  /** What the panel calls the type: "Packs". */
  name: string;
  /** True only when every thing of the type is a piece the player already has on the board. */
  onBoard: boolean;
  /** The thing's own name. `undefined` only in a world offer that did not hydrate what names it. */
  label: (thing: T, context: C) => string | undefined;
  /** Category path for a long list, outermost first; at most two levels. */
  category?: (thing: T, context: C) => readonly string[];
  /** Other things to offer with this one: `(pack) => [UNIT_TYPES.ref(pack.unitType)]`. */
  related?: (thing: T, context: C) => readonly SubjectRef[];
  /** The thing this one belongs to: a blueprint's tower. */
  within?: (thing: T, context: C) => SubjectRef | undefined;
  /** Every thing of the type; when given, a pick naming any other thing is refused. */
  things?: (context: C) => readonly T[];
};

/**
 * What a pick binds: the types its values are things of, and the thing one
 * value is, or `undefined` when it is none of them. `world` is set by a world
 * action's forwarding, the one caller allowed a thing it cannot name.
 */
export interface SubjectBinding<V, C = ActionContext> {
  readonly types: readonly SubjectType<never, never>[];
  readonly describe: (value: V, context: C, world?: boolean) => PickSubject | undefined;
}

export class SubjectType<T, C extends ActionContext = ActionContext> implements SubjectBinding<T, C> {
  readonly types: readonly SubjectType<never, never>[] = [this as unknown as SubjectType<never, never>];

  constructor(readonly options: SubjectTypeOptions<T, C>) {
    if (options.name.trim() === '') throw new Error('subjectType() was given a blank name. Name the type as the panel should call it, such as "Packs".');
  }

  /** The pick's type, as its metadata names it. */
  get info(): PickSubjectType {
    return { name: this.options.name, onBoard: this.options.onBoard };
  }

  /** A pick whose value is not the thing itself: `PACKS.of((token, ctx) => packOf(ctx, token))`. */
  of<V>(thingOf: (value: V, context: C) => T | undefined): SubjectBinding<V, C> {
    return {
      types: this.types,
      describe: (value, context, world) => {
        const thing = thingOf(value, context);
        return thing === undefined ? undefined : this.describe(thing, context, world);
      },
    };
  }

  /** The identity of a thing, for `related` and `within`. */
  ref(thing: T): SubjectRef {
    const key = (this.options as { key?: (thing: T) => string }).key;
    if (key) return { type: this.options.name, key: key(thing) };
    if (!isElement(thing)) {
      throw new Error(`Subject type "${this.options.name}" has no key, so its things must be game elements, and it was handed ${String(thing)}. Give the type a key, or map the pick's value to the element with .of().`);
    }
    return { type: this.options.name, key: String(thing.id) };
  }

  /** The thing as a row carries it, or `undefined` for an element the seat cannot see, whose key, label and id would name it. */
  readonly describe = (thing: T, context: C, world = false): PickSubject | undefined => {
    if (isElement(thing) && !thing.isVisibleTo(context.player.seat)) return undefined;
    const subject: PickSubject = { ...this.ref(thing), ...(isElement(thing) ? { element: thing.id } : {}) };
    const label = this.options.label(thing, context);
    if (label !== undefined) subject.label = label;
    else if (!world) throw new Error(`${this.#named(subject)} has no label. Return the thing's name from the type's label; only a world offer may leave a thing it did not hydrate unnamed.`);
    this.#place(subject, thing, context);
    this.#assertListed(subject, context);
    return subject;
  };

  #named(subject: SubjectRef): string {
    return `${this.options.name} "${subject.key}"`;
  }

  /** Where the thing sits: its category, related things and container. */
  #place(subject: PickSubject, thing: T, context: C): void {
    const category = this.#category(subject, thing, context);
    if (category.length > 0) subject.category = category;
    const related = this.options.related?.(thing, context) ?? [];
    if (related.length > 0) subject.related = related;
    const within = this.options.within?.(thing, context);
    if (within) subject.within = within;
  }

  #category(subject: SubjectRef, thing: T, context: C): readonly string[] {
    const category = this.options.category?.(thing, context) ?? [];
    if (category.some((level) => level.trim() === '')) throw new Error(`${this.#named(subject)} was given a blank category label. Name every category, or return [].`);
    if (category.length > 2) throw new Error(`${this.#named(subject)} was given ${category.length} category levels, and a subject list takes at most two.`);
    return category;
  }

  #assertListed(subject: SubjectRef, context: C): void {
    const listed = this.options.things?.(context);
    if (!listed || listed.some((each) => this.ref(each).key === subject.key)) return;
    throw new Error(`${this.#named(subject)} is not one of the ${listed.length} ${this.options.name} the type lists. Check the pick's subject mapping.`);
  }
}

/** Declare a subject type once per game; picks bind to it with `subject:`. */
export function subjectType<T, C extends ActionContext = ActionContext>(options: SubjectTypeOptions<T, C>): SubjectType<T, C> {
  return new SubjectType(options);
}

/** A pick that lists two kinds of thing: the first binding that names a value wins. */
export function eitherSubject<V, C = ActionContext>(...bindings: SubjectBinding<V, C>[]): SubjectBinding<V, C> {
  const bare = bindings.slice(0, -1).find((binding) => binding instanceof SubjectType);
  if (bindings.length < 2 || bare) {
    const which = bare ? `${(bare as SubjectType<unknown>).options.name} is a bare type before the last, so it would claim every value` : 'it needs at least two bindings';
    throw new Error(`eitherSubject(): ${which}. Give each but the last as TYPE.of() returning undefined for a value it does not name.`);
  }
  return {
    types: bindings.flatMap((binding) => binding.types),
    describe: (value, context, world) => {
      for (const binding of bindings) {
        const subject = binding.describe(value, context, world);
        if (subject) return subject;
      }
      return undefined;
    },
  };
}
