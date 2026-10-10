/**
 * The one parser for an {@link ExecutorOp} read off a wire (#530).
 *
 * A platform executor receives ops from a host over a network hop. Before this
 * existed, the platform restated the op shapes in its own schemas, and each
 * restatement was a place a field could be dropped without an error: a schema
 * that strips unknown keys loses a `boundaryKey` it does not list, and the
 * engine then runs the submission as if no round were named. Parsing with the
 * engine's own definition removes the second copy.
 *
 * It is strict: a key the op does not declare is refused rather than dropped,
 * `boundaryKey` is required on every submission, and each refusal names the
 * field and what to do about it. An optional field set to `undefined` counts as
 * left out, as it does in the `ExecutorOp` type and after a JSON hop.
 */
import type { ExecutorOp, OpOfType } from './stateless-ops.js';

/** The result of {@link parseExecutorOp}. */
export type ParsedExecutorOp = { ok: true; op: ExecutorOp } | { ok: false; error: string };

type ExecutorOpType = ExecutorOp['type'];

/**
 * How one field is checked. `optional` is computed from the op's own type, so a
 * field made optional (or required) in `ExecutorOp` without the same change
 * here is a compile error.
 */
interface FieldRule<Optional extends boolean> {
  optional: Optional;
  /** What the field must be, as the error says it ("a non-empty string"). */
  must: string;
  accepts: (value: unknown) => boolean;
  /** Why the field matters, appended when it is missing. */
  why?: string;
}

/**
 * Every field of every executor op, `type` aside. The mapped type lists each
 * op's fields exactly: a field added to an `ExecutorOp` member and not here,
 * or listed here and not there, does not compile.
 */
type OpRules = {
  [T in ExecutorOpType]: {
    [F in Exclude<keyof OpOfType<T>, 'type'>]-?: FieldRule<
      Record<never, never> extends Pick<OpOfType<T>, F> ? true : false
    >;
  };
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const nonEmptyString = {
  must: 'a non-empty string',
  accepts: (value: unknown) => typeof value === 'string' && value.length > 0,
};
const seatNumber = {
  must: 'a whole number',
  accepts: (value: unknown) => Number.isInteger(value),
};
const argsObject = {
  must: 'an object of named arguments',
  accepts: isPlainObject,
};
const anyValue = {
  must: 'present',
  accepts: () => true,
};
const boundaryKey = {
  ...nonEmptyString,
  why:
    'it names the round this submission was composed in. Stamp it from the boundary key the host ' +
    'last sent this seat (meta.turnBoundary.key), and never fill it in with the current one',
};
const botSeats = {
  must: 'a list of { seat, level? }, where seat is a whole number and level a string',
  accepts: (value: unknown) =>
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isPlainObject(entry) &&
        Object.keys(entry).every((key) => key === 'seat' || key === 'level') &&
        Number.isInteger(entry.seat) &&
        (entry.level === undefined || typeof entry.level === 'string'),
    ),
};

const required = <R extends Omit<FieldRule<false>, 'optional'>>(rule: R) => ({ ...rule, optional: false as const });
const optional = <R extends Omit<FieldRule<true>, 'optional'>>(rule: R) => ({ ...rule, optional: true as const });

const RULES: OpRules = {
  start: {},
  action: {
    actionName: required(nonEmptyString),
    player: required(seatNumber),
    args: required(argsObject),
    boundaryKey: required(boundaryKey),
  },
  expireSeat: {
    player: required(seatNumber),
    idleAction: required(nonEmptyString),
    args: required(argsObject),
    boundaryKey: required(boundaryKey),
  },
  selectionStep: {
    player: required(seatNumber),
    selectionName: required(nonEmptyString),
    value: required(anyValue),
    actionName: optional(nonEmptyString),
    initialArgs: optional(argsObject),
    boundaryKey: required(boundaryKey),
  },
  resolveChoices: {
    actionName: required(nonEmptyString),
    player: required(seatNumber),
    selectionName: required(nonEmptyString),
    args: required(argsObject),
  },
  cancelAction: { player: required(seatNumber) },
  undo: { player: required(seatNumber) },
  botTurn: { seats: required(botSeats) },
};

const OP_TYPES = Object.keys(RULES) as ExecutorOpType[];

function isExecutorOpType(type: unknown): type is ExecutorOpType {
  return typeof type === 'string' && Object.hasOwn(RULES, type);
}

/**
 * Check `value` is an {@link ExecutorOp} and return it typed, or say exactly
 * what is wrong with it. Never throws.
 */
export function parseExecutorOp(value: unknown): ParsedExecutorOp {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      error: `An executor op must be an object with a "type", but this one is ${describe(value)}.`,
    };
  }
  const { type } = value;
  if (!isExecutorOpType(type)) {
    return {
      ok: false,
      error:
        `An executor op has type ${JSON.stringify(type) ?? 'undefined'}, which an executor does not run. ` +
        `An executor op's type is one of: ${OP_TYPES.join(', ')}.`,
    };
  }
  const rules: Record<string, FieldRule<boolean>> = RULES[type];
  const error = undeclaredKeyError(type, value, rules) ?? fieldError(type, value, rules);
  if (error !== null) return { ok: false, error };
  // Every key is declared and every declared field has passed its rule, which
  // is what `ExecutorOp` says this type of op is.
  return { ok: true, op: value as ExecutorOp };
}

/** The refusal for the first key `value` carries that its op does not declare, or `null`. */
function undeclaredKeyError(
  type: ExecutorOpType,
  value: Record<string, unknown>,
  rules: Record<string, FieldRule<boolean>>,
): string | null {
  const declared = ['type', ...Object.keys(rules)];
  const extra = Object.keys(value).find((key) => !declared.includes(key));
  if (extra === undefined) return null;
  return (
    `The "${type}" op has a field "${extra}" it does not declare. An "${type}" op carries ` +
    `${declared.join(', ')}; remove "${extra}".`
  );
}

/** The refusal for the first declared field `value` lacks or holds a wrong value for, or `null`. */
function fieldError(
  type: ExecutorOpType,
  value: Record<string, unknown>,
  rules: Record<string, FieldRule<boolean>>,
): string | null {
  for (const [field, rule] of Object.entries(rules)) {
    // An optional field holding undefined is absent: `ExecutorOp` lets an
    // in-process caller write it, and JSON drops it on the wire (#555).
    if (!(field in value) || (rule.optional && value[field] === undefined)) {
      if (rule.optional) continue;
      return `The "${type}" op has no "${field}"${rule.why ? `: ${rule.why}` : `. It must be ${rule.must}`}.`;
    }
    if (!rule.accepts(value[field])) {
      return `The "${type}" op's "${field}" must be ${rule.must}, but it is ${describe(value[field])}.`;
    }
  }
  return null;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'string') return value.length === 0 ? 'an empty string' : 'a string';
  if (typeof value === 'number') return `the number ${value}`;
  if (typeof value === 'object') return 'an object';
  return typeof value === 'undefined' ? 'undefined' : `a ${typeof value}`;
}
