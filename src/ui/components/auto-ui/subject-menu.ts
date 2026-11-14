/**
 * THE ACTION PANEL'S MENU WITH THINGS IN IT (#1641).
 *
 * With nothing selected the panel draws the ordinary grouped menu, and an
 * action listed under its things (`subjectIndex`) is reached through them: the
 * things of a type on the board sit under the type, then their categories. A
 * selected thing has a menu of its own, which keeps the actions' groups: its
 * verbs, the verbs that take it in a later pick, the verbs about the things
 * that belong to it, the verbs of its related things, and those things.
 *
 * Pure, like `action-menu.ts`: it arranges the metadata the panel was handed
 * and decides nothing about availability.
 */
import type { SubjectEntry, SubjectIndex } from '../../../engine/action/subject-index.js';
import type { SubjectRef } from '../../../types/protocol.js';
import type { EnrichedActionMetadata } from '../../composables/useActionControllerTypes.js';
import { sameThing, usableVerbs } from '../../composables/sharedSelection.js';

/** A button of the panel's menu: an action, a thing to select, or a verb of the selected thing. */
export type PanelMenuItem = EnrichedActionMetadata & {
  /** Pressing it selects this thing. */
  thing?: SubjectEntry;
  /** Pressing it starts the action on this thing. */
  verbOf?: SubjectRef;
};

/** A verb the open level cannot start now, with why. */
export type FoldedVerb = EnrichedActionMetadata & { reason: string };

function thingItem(thing: SubjectEntry, order: number | undefined): PanelMenuItem {
  return { name: `thing:${thing.type}:${thing.key}`, prompt: thing.label, selections: [], group: [thing.type, ...(thing.category ?? [])], order, thing };
}

/**
 * The ordinary menu: each action where `.group()` puts it, except one listed under its things, which
 * is reached through them. A thing sits where the first action that takes it sat. `usable` lists only
 * things something can be done with, as the panel's menu does; without it every thing is listed.
 */
export function ordinaryMenuItems(actions: readonly EnrichedActionMetadata[], subjects: SubjectIndex, usable: boolean): PanelMenuItem[] {
  const things = subjects.things.filter((thing) => thing.onBoard && (!usable || usableVerbs(thing).length > 0));
  const reached = (name: string) => subjects.listedUnderThings.has(name) && things.some((thing) => usableVerbs(thing).includes(name));
  const placed = new Set<SubjectEntry>();
  return actions.flatMap((action) => {
    const own = things.filter((thing) => !placed.has(thing) && thing.verbs.some((verb) => verb.action === action.name));
    for (const thing of own) placed.add(thing);
    return [...(reached(action.name) ? [] : [action]), ...own.map((thing) => thingItem(thing, action.order))];
  });
}

interface SelectionMenu {
  items: PanelMenuItem[];
  folded: FoldedVerb[];
}

/** A selection menu being built: each action is offered once, under the first thing that takes it. */
interface Building extends SelectionMenu {
  seen: Set<string>;
  metadataOf: (action: string) => EnrichedActionMetadata | undefined;
}

function offer(menu: Building, action: string, of: SubjectRef, reason: string | undefined, label?: string): void {
  const meta = menu.metadataOf(action);
  if (!meta || menu.seen.has(action)) return;
  menu.seen.add(action);
  const item = { ...meta, ...(label ? { prompt: label } : {}), verbOf: of };
  if (reason) menu.folded.push({ ...item, reason });
  else menu.items.push(item);
}

/** Every verb of `entry`, a disabled one with its reason. */
function offerVerbsOf(menu: Building, entry: SubjectEntry, label?: (prompt: string) => string): void {
  const usable = usableVerbs(entry);
  for (const action of new Set(entry.verbs.map((verb) => verb.action))) {
    const reason = usable.includes(action) ? undefined : entry.verbs.find((verb) => verb.action === action)!.disabled;
    offer(menu, action, entry, reason, label?.(menu.metadataOf(action)?.prompt ?? action));
  }
}

/** A selected thing's own menu, and the verbs of it that cannot be used now. */
export function selectionMenuItems(
  selection: SubjectEntry,
  subjects: SubjectIndex,
  metadataOf: (action: string) => EnrichedActionMetadata | undefined,
  disabledReason: (action: string) => string | undefined,
): SelectionMenu {
  const menu: Building = { items: [], folded: [], seen: new Set(), metadataOf };
  offerVerbsOf(menu, selection);
  for (const later of subjects.laterVerbs.filter((verb) => verb.type === selection.type)) offer(menu, later.action, selection, disabledReason(later.action));
  const parts = subjects.things.filter((thing) => sameThing(thing.within, selection));
  // A verb whose rows belong to the thing opens narrowed to them; one listed under its things is reached through them.
  for (const action of parts.flatMap(usableVerbs).filter((name) => !subjects.listedUnderThings.has(name))) offer(menu, action, selection, undefined);
  const related = (selection.related ?? []).flatMap((ref) => subjects.things.filter((thing) => sameThing(thing, ref)));
  for (const thing of related) offerVerbsOf(menu, thing, (prompt) => `${prompt}: ${thing.label}`);
  menu.items.push(...parts.filter((part) => part.onBoard && usableVerbs(part).length > 0).map((part) => thingItem(part, Infinity)));
  return { items: menu.items, folded: menu.folded };
}

/**
 * Every action the panel can start at some level now (#1642): its start buttons (`visible`), and the
 * verbs on the menu of each thing it lists or has selected, and of the things those menus list.
 */
export function panelReach(
  visible: readonly EnrichedActionMetadata[],
  subjects: SubjectIndex,
  metadataOf: (action: string) => EnrichedActionMetadata | undefined,
  disabledReason: (action: string) => string | undefined,
  selection: SubjectEntry | null,
): string[] {
  const reach = new Set(visible.map((action) => action.name));
  const listed = ordinaryMenuItems(visible, subjects, true).flatMap((item) => (item.thing ? [item.thing] : []));
  const things = [...(selection ? [selection] : []), ...listed];
  const seen = new Set<string>();
  // The list grows as menus name things of their own; each thing is opened once.
  for (const thing of things) {
    const key = `${thing.type}\u0000${thing.key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const item of selectionMenuItems(thing, subjects, metadataOf, disabledReason).items) {
      if (item.thing) things.push(item.thing);
      else reach.add(item.name);
    }
  }
  return [...reach];
}
