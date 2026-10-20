/**
 * THE IDS A SEAT KNOWS CARDS BY (#715).
 *
 * A seat is never sent the real id of a card that something it sits in hides
 * from it (a hidden, count-only or owner-only zone, or a concealed element
 * above it). It is sent a PLACEHOLDER instead, and this module is the one
 * source of them: the board view (`Game.toJSONForPlayer`), the pick candidates
 * (`pick-candidates.ts`) and the reading of what a seat sends back
 * (`picksFromSeat`) all call it, so the three cannot disagree.
 *
 * A placeholder is STABLE WHILE ITS PILE IS UNTOUCHED, AND PER SEAT. It is
 * made from the card's token with the seat's own key (`ElementIds.placeholder`),
 * so another seat's placeholder for it is a different number, and the number
 * says nothing about the card's id. The token is the card's id until its pile
 * is shuffled or a card enters or leaves it; then every card in the pile gets
 * a fresh one (`reissuePlaceholders`), so an old placeholder names nothing, is
 * refused rather than retargeted, and no seat can read an insert position or
 * which card left from the ids that stayed. The token lives on the element
 * (`_t.placeholderToken`), so snapshots, checkpoints, undo and a world's
 * stored partitions carry it.
 *
 * A card hidden only by its own visibility, in a place the seat can see, keeps
 * its real id: the board draws it face down at its real id, so a flip animates
 * (game.ts, WR-02).
 */
import type { Game } from './game.js';
import type { GameElement } from './game-element.js';
import type { ElementJSON } from './types.js';
import type { Selection } from '../action/types.js';
import { outermostConcealer } from './concealed-refs.js';
import { isSerializedElement } from '../action/choice-matching.js';

/** Whether `seat` knows `element` only by a placeholder: it is hidden from the seat by something it sits in. */
function namedByPlaceholder(element: GameElement, seat: number): boolean {
  return !element.isVisibleTo(seat) && outermostConcealer(element, seat) !== undefined;
}

/** `element`'s placeholder for `seat` (`-1` is the spectator). */
export function placeholderIdOf(element: GameElement, seat: number): number {
  // A game restored from a seat's view (a bot's search) already holds that seat's placeholders as ids.
  if (element._t.id < 0) return element._t.id;
  return element._ctx.ids.placeholder(seat, element._t.placeholderToken ?? element._t.id);
}

/**
 * `view` with each placeholder's id taken out, for every seat shown the same
 * thing to share (#1207), and the cards those placeholders stand for. Each
 * placeholder carries `placeholder: k` where its id was, and a seat's own id
 * for it is `placeholderIdOf(cards[k], seat)`. `shownAs` is the redaction's
 * `idRemap` for the seat `view` was made for, so none of that seat's ids is
 * left in what is returned.
 */
export function sharePlaceholders(
  view: ElementJSON,
  shownAs: ReadonlyMap<number, number>,
  game: Game,
): { view: ElementJSON; cards: GameElement[] } {
  const realIdOf = new Map([...shownAs].map(([real, shown]) => [shown, real]));
  const cards: GameElement[] = [];
  const shared = mapPlaceholders(view, (node) => {
    const real = realIdOf.get(node.id);
    return real === undefined ? undefined : renamed(node, 'id', 'placeholder', cards.push(game._ctx._elementsById.get(real)!) - 1);
  });
  return { view: shared, cards };
}

/** A shared view (`sharePlaceholders`) as one seat's, given that seat's ids for its placeholders in order. */
export function fillPlaceholders(view: ElementJSON, ids: readonly number[]): ElementJSON {
  let holes = 0;
  const filled = mapPlaceholders(view, (node) => {
    const { placeholder } = node as { placeholder?: unknown };
    if (typeof placeholder !== 'number') return undefined;
    holes += 1;
    return renamed(node, 'placeholder', 'id', ids[placeholder]);
  });
  if (holes !== ids.length) {
    throw new Error(
      `This view has ${holes} placeholders and was handed ${ids.length} ids for them. ` +
        "A seat's ids come in the same viewsFor answer as the body it holds; fill that body with exactly those.",
    );
  }
  return filled;
}

/** `node` with `replace` applied wherever it answers, copying only the nodes above a change. */
function mapPlaceholders(node: ElementJSON, replace: (node: ElementJSON) => ElementJSON | undefined): ElementJSON {
  const replaced = replace(node);
  if (replaced !== undefined) return replaced;
  if (node.children === undefined) return node;
  const children = node.children.map((child) => mapPlaceholders(child, replace));
  return children.every((child, i) => child === node.children![i]) ? node : { ...node, children };
}

/** `node` with key `from` renamed `to` and holding `value`, in the same place, so a filled view is byte for byte the seat's own. */
function renamed(node: ElementJSON, from: string, to: string, value: unknown): ElementJSON {
  return Object.fromEntries(Object.entries(node).map(([key, held]) => (key === from ? [to, value] : [key, held]))) as ElementJSON;
}

/** The id `seat` knows `element` by: its placeholder, or its real id. */
export function seatIdOf(element: GameElement, seat: number): number {
  return namedByPlaceholder(element, seat) ? placeholderIdOf(element, seat) : element.id;
}

/**
 * The picks a seat sent for action `actionName`, with every element reference
 * in the server's ids: where a seat's submission enters, before anything reads
 * it. A placeholder becomes the id of the card it names to that seat now; a
 * real id the seat may know stays as it is; any other id becomes one no element
 * has, so it is refused exactly as a card that is not there. A `chooseFrom`
 * value is read as a reference only in the `{ id, className }` form an element
 * choice is sent in. An action the game does not have is left for its own
 * refusal.
 */
export function picksFromSeat(
  game: Game,
  actionName: string | undefined,
  picks: Readonly<Record<string, unknown>>,
  seat: number,
): Record<string, unknown> {
  const out = { ...picks };
  const action = actionName === undefined ? undefined : game.getAction(actionName);
  if (action === undefined) return out;
  const read = seatReader(game, seat);
  for (const selection of action.selections) {
    const value = picks[selection.name];
    if (value !== undefined) out[selection.name] = Array.isArray(value) ? value.map((one) => itemFromSeat(selection, one, read)) : itemFromSeat(selection, value, read);
  }
  return out;
}

function itemFromSeat(selection: Selection, item: unknown, read: (id: number) => number): unknown {
  const isElementPick = selection.type === 'element' || selection.type === 'elements';
  if (isElementPick && typeof item === 'number') return read(item);
  const ref = item as { id?: unknown } | null;
  const isRef = selection.type === 'choice' ? isSerializedElement(item) : isElementPick && typeof ref?.id === 'number';
  return isRef ? { ...ref, id: read(ref!.id as number) } : item;
}

/** No element has this id: what a reference the seat may not make becomes. */
const NAMES_NOTHING = Number.MIN_SAFE_INTEGER;

/** Whether an id read from a seat is one it may not make, which names nothing. */
export function namesNothing(id: unknown): boolean {
  return id === NAMES_NOTHING;
}

/** Reads ids `seat` sent into the server's, walking the id index for reissued tokens once at most. */
function seatReader(game: Game, seat: number): (id: number) => number {
  const index = game._ctx._elementsById;
  let reissued: Map<number, GameElement> | undefined;
  const reissuedTo = (token: number) => {
    reissued ??= new Map([...index.values()].flatMap((e) => (e._t.placeholderToken === undefined ? [] : [[e._t.placeholderToken, e] as const])));
    return reissued.get(token);
  };
  return (id) => {
    if (!(id < 0)) {
      const element = index.get(id);
      return element && namedByPlaceholder(element, seat) ? NAMES_NOTHING : id;
    }
    const token = game._ctx.ids.tokenOf(seat, id);
    if (token === undefined) return id;
    const created = index.get(token);
    const element = created !== undefined && created._t.placeholderToken === undefined ? created : reissuedTo(token);
    return element && namedByPlaceholder(element, seat) ? element.id : id;
  };
}
