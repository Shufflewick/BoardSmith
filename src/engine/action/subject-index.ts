/**
 * WHICH VERBS TAKE WHICH THING (#1640), inverted from the first-pick lists the
 * offer already carries: a table's state push and a world's offer. There is no
 * separate "accepts" rule, so the list that validates a pick is the one source.
 */
import type { ActionMetadata, ChoiceWithRefs, PickMetadata, PickSubject, PickSubjectType, SubjectRef } from '../../types/protocol.js';

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
  const { onBoard, laterVerbs } = declaredTypes(actions);
  const things = new Map<string, SubjectEntry>();
  const listedUnderThings = new Set<string>();
  const entryOf = (subject: PickSubject) => entryFor(things, onBoard, subject);
  for (const action of actions) {
    if (indexAction(action, entryOf)) listedUnderThings.add(action.name);
  }
  return { things: [...things.values()], listedUnderThings, laterVerbs };
}

/** Puts an action's verbs under its things; true when it is listed under them instead of in the action list. */
function indexAction(action: ActionMetadata, entryOf: (subject: PickSubject) => SubjectEntry): boolean {
  for (const subject of action.about ?? []) entryOf(subject).verbs.push({ action: action.name });
  const first = action.selections[0];
  if (!first?.subjectTypes || first.type === 'text') return false;
  const rows = rowsOf(first);
  for (const row of rows) {
    if (row.subject) entryOf(row.subject).verbs.push({ action: action.name, pick: first.name, value: row.value, ...(row.disabled ? { disabled: row.disabled } : {}) });
  }
  return listsThings(first.subjectTypes, rows);
}

/** The thing's one entry; a later row's label names it when the first row had none. */
function entryFor(things: Map<string, SubjectEntry>, onBoard: ReadonlyMap<string, boolean>, subject: PickSubject): SubjectEntry {
  const id = thingId(subject);
  const entry = things.get(id) ?? { ...subject, label: subject.label ?? subject.key, onBoard: onBoard.get(subject.type) ?? false, verbs: [] };
  things.set(id, entry);
  if (entry.label === entry.key && subject.label !== undefined) entry.label = subject.label;
  return entry;
}

const thingId = (subject: SubjectRef): string => `${subject.type}\u0000${subject.key}`;

/** Each declared type's `onBoard`, and the verbs that take a thing in a later pick or as typed text. */
function declaredTypes(actions: readonly ActionMetadata[]): { onBoard: Map<string, boolean>; laterVerbs: SubjectIndex['laterVerbs'] } {
  const onBoard = new Map<string, boolean>();
  const laterVerbs: SubjectIndex['laterVerbs'] = [];
  for (const action of actions) {
    action.selections.forEach((pick, index) => {
      const later = index > 0 || pick.type === 'text';
      for (const type of pick.subjectTypes ?? []) {
        onBoard.set(type.name, type.onBoard);
        if (later) laterVerbs.push({ type: type.name, action: action.name, pick: pick.name });
      }
    });
  }
  return { onBoard, laterVerbs };
}

function rowsOf(pick: PickMetadata): ChoiceWithRefs[] {
  return pick.choices ?? pick.validElements?.map((element) => ({ ...element, value: element.id, display: element.display ?? '' })) ?? [];
}

/** Listed under its things only when every type is on the board and each row is a different thing. */
function listsThings(types: readonly PickSubjectType[], rows: readonly ChoiceWithRefs[]): boolean {
  const things = new Set(rows.flatMap((row) => (row.subject ? [thingId(row.subject)] : [])));
  return rows.length > 0 && types.every((type) => type.onBoard) && things.size === rows.length;
}
