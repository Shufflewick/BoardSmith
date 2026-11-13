/**
 * WHICH VERBS TAKE WHICH THING (#1640), inverted from the first-pick lists the
 * offer already carries: a table's state push and a world's offer. There is no
 * separate "accepts" rule, so the list that validates a pick is the one source.
 */
import type { ActionMetadata, ChoiceWithRefs, PickSubject } from '../../types/protocol.js';

/** One verb under a thing: the first pick and the row value that names the thing, or neither for `.about()`. */
export interface SubjectVerb {
  action: string;
  pick?: string;
  value?: unknown;
  disabled?: string;
}

export interface SubjectEntry extends PickSubject {
  /** The first label any row gave the thing, else its key. */
  label: string;
  onBoard: boolean;
  verbs: SubjectVerb[];
}

export interface SubjectIndex {
  /** Every thing an offered action names, in first-seen order. */
  things: SubjectEntry[];
  /** Actions listed under their things instead of in the action list. */
  listedUnderThings: ReadonlySet<string>;
  /** Actions that take a thing of a type in a later pick, or as typed text, and carry the selected one to it. */
  laterVerbs: { type: string; action: string; pick: string }[];
}

export function subjectIndex(actions: readonly ActionMetadata[]): SubjectIndex {
  const things = new Map<string, SubjectEntry>();
  const onBoard = new Map<string, boolean>();
  const listedUnderThings = new Set<string>();
  const laterVerbs: SubjectIndex['laterVerbs'] = [];
  const entryOf = (subject: PickSubject): SubjectEntry => {
    const id = `${subject.type}\u0000${subject.key}`;
    let entry = things.get(id);
    if (!entry) things.set(id, entry = { ...subject, label: subject.label ?? subject.key, onBoard: onBoard.get(subject.type) ?? false, verbs: [] });
    else if (entry.label === entry.key && subject.label !== undefined) entry.label = subject.label;
    return entry;
  };
  for (const action of actions) {
    action.selections.forEach((pick, index) => {
      for (const type of pick.subjectTypes ?? []) onBoard.set(type.name, type.onBoard);
      if (index > 0 || pick.type === 'text') {
        for (const type of pick.subjectTypes ?? []) laterVerbs.push({ type: type.name, action: action.name, pick: pick.name });
      }
    });
  }
  for (const action of actions) {
    for (const subject of action.about ?? []) entryOf(subject).verbs.push({ action: action.name });
    const first = action.selections[0];
    if (!first?.subjectTypes || first.type === 'text') continue;
    const rows: ChoiceWithRefs[] = first.choices ?? first.validElements?.map((element) => ({ ...element, value: element.id, display: element.display ?? '' })) ?? [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.subject) continue;
      seen.add(`${row.subject.type}\u0000${row.subject.key}`);
      entryOf(row.subject).verbs.push({ action: action.name, pick: first.name, value: row.value, ...(row.disabled ? { disabled: row.disabled } : {}) });
    }
    const allOnBoard = first.subjectTypes.every((type) => type.onBoard);
    if (rows.length > 0 && allOnBoard && seen.size === rows.length) listedUnderThings.add(action.name);
  }
  return { things: [...things.values()], listedUnderThings, laterVerbs };
}
