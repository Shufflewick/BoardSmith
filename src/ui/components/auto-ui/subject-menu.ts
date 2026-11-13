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

/** A selected thing's own menu, and the verbs of it that cannot be used now. */
export function selectionMenuItems(
  selection: SubjectEntry,
  subjects: SubjectIndex,
  metadataOf: (action: string) => EnrichedActionMetadata | undefined,
  disabledReason: (action: string) => string | undefined,
): SelectionMenu {
  const items: PanelMenuItem[] = [];
  const folded: FoldedVerb[] = [];
  const seen = new Set<string>();
  const offer = (action: string, of: SubjectRef, reason: string | undefined, label?: string) => {
    const meta = metadataOf(action);
    if (!meta || seen.has(action)) return;
    seen.add(action);
    const item = { ...meta, ...(label ? { prompt: label } : {}), verbOf: of };
    if (reason) folded.push({ ...item, reason });
    else items.push(item);
  };
  const verbsOf = (entry: SubjectEntry, label?: (prompt: string) => string) => {
    for (const action of new Set(entry.verbs.map((verb) => verb.action))) {
      const usable = usableVerbs(entry).includes(action);
      const prompt = metadataOf(action)?.prompt ?? action;
      offer(action, entry, usable ? undefined : entry.verbs.find((verb) => verb.action === action)!.disabled, label?.(prompt));
    }
  };
  verbsOf(selection);
  for (const later of subjects.laterVerbs) if (later.type === selection.type) offer(later.action, selection, disabledReason(later.action));
  const parts = subjects.things.filter((thing) => sameThing(thing.within, selection));
  for (const part of parts) {
    for (const action of usableVerbs(part)) if (!subjects.listedUnderThings.has(action)) offer(action, selection, undefined);
  }
  for (const ref of selection.related ?? []) {
    const related = subjects.things.find((thing) => sameThing(thing, ref));
    if (related) verbsOf(related, (prompt) => `${prompt}: ${related.label}`);
  }
  for (const part of parts) if (part.onBoard && usableVerbs(part).length > 0) items.push(thingItem(part, Infinity));
  return { items, folded };
}
