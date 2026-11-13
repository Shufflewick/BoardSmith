/**
 * ONE SHARED SELECTION FOR THE BOARD AND THE PANEL (#1641).
 *
 * The board and the Action Panel select the same one thing, so they cannot
 * drift. Which verbs take which thing is `subjectIndex` (#1640), inverted from
 * the first-pick lists the offer already carries. A game that keeps its
 * selection in its own state binds it here, so there is still one source.
 */
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import { subjectIndex, type SubjectEntry, type SubjectIndex } from '../../engine/action/subject-index.js';
import { valuesEqual } from '../../engine/action/choice-matching.js';
import { formatActionName } from './actionControllerHelpers.js';
import type { ActionMetadata, SubjectRef } from '../../types/protocol.js';
import type { SubjectChoice, SubjectSelectionBinding } from './useActionControllerTypes.js';

export const sameThing = (a: SubjectRef | null | undefined, b: SubjectRef | null | undefined): boolean =>
  !!a && !!b && a.type === b.type && a.key === b.key;

/** How a verb reaches a thing: the first-pick row that is it, the rows that belong to it, a later pick that takes one of its type, or `.about()`. */
export type ThingStart =
  | { kind: 'fill'; pick: string; value: unknown }
  | { kind: 'within'; pick: string }
  | { kind: 'carry'; pick: string }
  | { kind: 'about' };

interface SharedSelectionOptions {
  offered: ComputedRef<readonly ActionMetadata[]>;
  disabledActions?: Ref<Record<string, string> | undefined>;
}

export function useSharedSelection({ offered, disabledActions }: SharedSelectionOptions) {
  /** The offered actions' things, each verb carrying its action's disabled reason when the action has one. */
  const subjects = computed<SubjectIndex>(() => {
    const index = subjectIndex(offered.value);
    const reasons = disabledActions?.value ?? {};
    const things = index.things.map((entry) => ({
      ...entry,
      verbs: entry.verbs.map((verb) => (reasons[verb.action] ? { ...verb, disabled: reasons[verb.action] } : verb)),
    }));
    return { ...index, things };
  });

  const own = shallowRef<SubjectChoice | null>(null);
  const binding = shallowRef<SubjectSelectionBinding | null>(null);
  /** What a bound selection was last asked to become, until the game's state says what it is. */
  const written = shallowRef<SubjectChoice | null>(null);

  const entryOf = (chosen: SubjectChoice): SubjectEntry => {
    const entry = subjects.value.things.find((candidate) => sameThing(candidate, chosen));
    // A thing in no pick list right now is still selected: it has no verbs of its own.
    if (!entry) return { type: chosen.type, key: chosen.key, label: chosen.label ?? chosen.key, onBoard: true, verbs: [], ...(chosen.related ? { related: chosen.related } : {}) };
    return entry.related || !chosen.related ? entry : { ...entry, related: chosen.related };
  };

  const selection = computed<SubjectEntry | null>(() => {
    const chosen = binding.value ? binding.value.read() : own.value;
    return chosen ? entryOf(chosen) : null;
  });
  watch(() => selection.value && `${selection.value.type}\u0000${selection.value.key}`, () => { written.value = null; });

  function select(thing: SubjectChoice | null): void {
    if (!binding.value) {
      own.value = thing;
      return;
    }
    written.value = thing;
    binding.value.write(thing);
  }

  function bindSubjectSelection(next: SubjectSelectionBinding | null): void {
    binding.value = next;
    written.value = null;
  }

  /** How `start` reaches `thing` for this action, or undefined when the action does not take it. */
  function thingStart(meta: ActionMetadata, thing: SubjectRef): ThingStart | undefined {
    const first = meta.selections[0];
    const verbs = entryOf(thing).verbs.filter((verb) => verb.action === meta.name);
    const filled = verbs.find((verb) => verb.pick && !verb.disabled) ?? verbs.find((verb) => verb.pick);
    if (filled?.pick) return { kind: 'fill', pick: filled.pick, value: filled.value };
    const holds = subjects.value.things.some((part) => sameThing(part.within, thing)
      && part.verbs.some((verb) => verb.action === meta.name && verb.pick === first?.name));
    if (holds && first) return { kind: 'within', pick: first.name };
    const later = subjects.value.laterVerbs.find((verb) => verb.action === meta.name && verb.type === thing.type);
    if (later) return { kind: 'carry', pick: later.pick };
    return verbs.length > 0 ? { kind: 'about' } : undefined;
  }

  /** The thing a start names: the `subject` it was given, else the thing its first-pick value is. */
  function namedThing(meta: ActionMetadata, args: Record<string, unknown>, subject?: SubjectRef): SubjectEntry | undefined {
    if (subject) return entryOf(subject);
    const pick = meta.selections[0]?.name;
    if (!pick || args[pick] === undefined) return undefined;
    return subjects.value.things.find((entry) => entry.verbs.some((verb) => verb.action === meta.name && verb.pick === pick && valuesEqual(verb.value, args[pick])));
  }

  /** Why a start acting on `named` disagrees with the shared selection, or undefined when it agrees. */
  function mismatch(meta: ActionMetadata, named: SubjectEntry | undefined): string | undefined {
    const chosen = written.value ? entryOf(written.value) : selection.value;
    if (!named || !chosen || binding.value?.selects.includes(meta.name)) return undefined;
    if (sameThing(named, chosen) || sameThing(named.within, chosen) || chosen.related?.some((ref) => sameThing(ref, named))) return undefined;
    return `The board started "${meta.prompt || formatActionName(meta.name)}" on ${named.type} "${named.label}" while the shared selection is ${chosen.type} "${chosen.label}". `
      + 'Select the thing first with actionController.select(), or start the verb with { subject } set to the selection.';
  }

  /** A start on a board thing while nothing is selected selects it, so the panel stands on it and cancel lands there. */
  function follow(named: SubjectEntry | undefined): void {
    if (named?.onBoard && !binding.value && !own.value) own.value = named;
  }

  return { subjects, selection, select, bindSubjectSelection, thingStart, namedThing, mismatch, follow };
}

/** The actions that can act on a thing now, each once. */
export function usableVerbs(entry: SubjectEntry): string[] {
  return [...new Set(entry.verbs.filter((verb) => !verb.disabled).map((verb) => verb.action))];
}
