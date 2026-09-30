import { ESCALATION_LADDER, type WorkRole, nextRole } from './agent-roles.js';
import { type LedgerEntry, entryField, parseLedgerEntries } from './ledger-entries.js';

/**
 * What a chunk's run log records about who did the work and how its review went (#454), checked
 * as code by `boardsmith ledger-check`. The clock rules for the same entries are ledger-check's own.
 *
 * `### Dispatch N` entries, one per dispatch of work for the chunk:
 *   - Work: what was dispatched (`build-chunk`, a step name, a short name for a bulk edit)
 *   - Role: mechanical | bounded | judgement (reviewers are recorded in review rounds)
 *   - Agent: the agent type actually dispatched
 *   - Escalated from: none, or `Dispatch M`, the failed dispatch this one retries one role up
 *
 * A failed dispatch is retried one role up, never at the same role: an escalation must start from
 * a dispatch whose Outcome is `failed`, go exactly one role up, and be the only escalation from it.
 * Nothing is above judgement, so a failure there goes to the designer, and the same work may be
 * dispatched at judgement again once they have answered.
 *
 * `### Review Round N` entries, one per review round:
 *   - Step: redteam | audit | final-acceptance | cross-chunk
 *   - Level: light | full, as `boardsmith review-gate` sized it
 *   - Verify: `<commit> passed`, the verify result the round started from
 *   - Agents: the agent types dispatched
 *   - Outcome: pending | clean | changes requested
 */

interface RunLogRoleFinding {
  entry: string;
  kind: 'run-role' | 'review-round';
  detail: string;
}

const REVIEW_STEPS = ['redteam', 'audit', 'final-acceptance', 'cross-chunk'];
const REVIEW_LEVELS = ['light', 'full'];
const REVIEW_OUTCOMES = ['pending', 'clean', 'changes requested'];

interface Dispatch {
  name: string;
  work?: string;
  role?: WorkRole;
  outcome?: string;
  escalatedFrom?: string;
}

/** A field's value, or undefined when the field is missing or empty. */
function valueOf(entry: LedgerEntry, field: string): string | undefined {
  const value = entryField(entry, field)?.value;
  return value === undefined || value === '' ? undefined : value;
}

const missing = (name: string, entry: LedgerEntry, field: string, what: string) =>
  `${name} (line ${entry.line}) has no "- ${field}:" field. Add ${what}.`;

/** The Role line's problem, or the role. */
function readRole(name: string, entry: LedgerEntry, out: string[]): WorkRole | undefined {
  const role = valueOf(entry, 'Role');
  if (role === undefined) {
    out.push(missing(name, entry, 'Role', 'the role the work was dispatched as: mechanical, bounded or judgement'));
  } else if (role === 'review') {
    out.push(
      `${name} has "Role: review", but reviewers are recorded in a "### Review Round N" entry, not as a dispatch. ` +
        'Move it to a review round with the verify result it started from.',
    );
  } else if (!(ESCALATION_LADDER as readonly string[]).includes(role)) {
    out.push(`${name} has "Role: ${role}", which is not a role that does work: mechanical, bounded or judgement.`);
  } else {
    return role as WorkRole;
  }
  return undefined;
}

function readDispatch(entry: LedgerEntry, out: string[]): Dispatch {
  const name = `Dispatch ${entry.id}`;
  const work = valueOf(entry, 'Work');
  if (work === undefined) out.push(missing(name, entry, 'Work', 'what was dispatched: build-chunk, a step name, or a short name for a bulk edit'));
  const role = readRole(name, entry, out);
  if (valueOf(entry, 'Agent') === undefined) {
    out.push(missing(name, entry, 'Agent', 'the agent type actually dispatched, as `boardsmith agent <role>` printed it'));
  }
  const escalated = valueOf(entry, 'Escalated from') ?? 'none';
  const from = /^Dispatch (\S+)$/.exec(escalated)?.[1];
  if (escalated !== 'none' && from === undefined) {
    out.push(`${name} has "Escalated from: ${escalated}". Write "none", or "Dispatch N" for the failed dispatch it retries one role up.`);
  }
  return { name, work, role, outcome: valueOf(entry, 'Outcome')?.split(/\s/)[0], escalatedFrom: from };
}

/** Why `from` cannot be escalated from, or undefined when it can. `by` is the dispatch that tries. */
function cannotEscalateFrom(by: string, from: Dispatch, escalatedBy: Map<string, string>, id: string): string | undefined {
  if (from.outcome !== 'failed') {
    return `${by} escalates from ${from.name}, but ${from.name} did not fail (Outcome: ${from.outcome ?? 'missing'}). Only a failed dispatch is retried one role up.`;
  }
  const before = escalatedBy.get(id);
  if (before !== undefined) return `${by} escalates from ${from.name}, but ${from.name} was already escalated by ${before}. A failure is retried once, one role up.`;
  if (from.role === 'judgement') {
    return `${by} escalates from ${from.name}, but ${from.name} failed at judgement, the top role: nothing takes it next. Stop and ask the designer, and dispatch nothing more for this work until they answer.`;
  }
  return undefined;
}

/** Why `d`'s escalation is wrong, or undefined. `earlier` holds every dispatch before it, by id. */
function escalationProblem(d: Dispatch, earlier: Map<string, Dispatch>, escalatedBy: Map<string, string>): string | undefined {
  if (d.escalatedFrom === undefined) return undefined;
  const from = earlier.get(d.escalatedFrom);
  if (from === undefined) return `${d.name} escalates from Dispatch ${d.escalatedFrom}, but there is no Dispatch ${d.escalatedFrom} before it.`;
  const refused = cannotEscalateFrom(d.name, from, escalatedBy, d.escalatedFrom);
  if (refused !== undefined) return refused;
  const next = from.role === undefined ? undefined : nextRole(from.role);
  if (next === undefined || d.role === undefined || d.role === next) return undefined;
  return `${d.name} escalates from ${from.name} (${from.role}), so it must be the next role up, ${next}, not ${d.role}.`;
}

/** Why `d` retries failed work at the role it failed at, or undefined. */
function sameRoleRetry(d: Dispatch, failed: Dispatch[]): string | undefined {
  if (d.escalatedFrom !== undefined) return undefined;
  const at = failed.find((f) => f.work === d.work && f.role === d.role && f.role !== 'judgement');
  if (at === undefined) return undefined;
  return (
    `${d.name} retries "${d.work}" at ${d.role} after ${at.name} failed there. A failed step goes one role up, never to the same ` +
    `role: run \`boardsmith agent ${d.role} --escalate\`, dispatch that, and write "Escalated from: ${at.name}".`
  );
}

function dispatchFindings(text: string): RunLogRoleFinding[] {
  const findings: RunLogRoleFinding[] = [];
  const earlier = new Map<string, Dispatch>();
  const escalatedBy = new Map<string, string>();
  const failed: Dispatch[] = [];
  for (const entry of parseLedgerEntries(text, 'Dispatch')) {
    const out: string[] = [];
    const d = readDispatch(entry, out);
    const problem = escalationProblem(d, earlier, escalatedBy) ?? sameRoleRetry(d, failed);
    if (problem) out.push(problem);
    if (d.escalatedFrom !== undefined && !escalatedBy.has(d.escalatedFrom)) escalatedBy.set(d.escalatedFrom, d.name);
    if (d.outcome === 'failed') failed.push(d);
    earlier.set(entry.id, d);
    findings.push(...out.map((detail) => ({ entry: d.name, kind: 'run-role' as const, detail })));
  }
  return findings;
}

const GATE = 'A review round starts only once `boardsmith review-gate <slug>` is open';

/**
 * One field of a review round: what to add when it is missing, and, when its value is wrong, what
 * to write instead. `check` is undefined for a field any value satisfies.
 */
interface RoundField {
  field: string;
  add: string;
  check?: (value: string) => string | undefined;
}

const ROUND_FIELDS: RoundField[] = [
  {
    field: 'Step',
    add: `the review step: ${REVIEW_STEPS.join(', ')}`,
    check: (v) => (REVIEW_STEPS.includes(v) ? undefined : 'which is not a review step: redteam, audit, final-acceptance or cross-chunk.'),
  },
  {
    field: 'Level',
    add: 'light or full, as `boardsmith review-gate` printed it',
    check: (v) =>
      REVIEW_LEVELS.includes(v)
        ? undefined
        : 'Write light or full, as `boardsmith review-gate` printed it; a change review-gate sized "none" has no review round.',
  },
  {
    field: 'Verify',
    add: `the verify result the round started from, "<commit> passed". ${GATE}`,
    check: (v) =>
      /^[0-9a-f]{7,40} passed$/.test(v)
        ? undefined
        : `which is not a passing verify result ("<commit> passed"). ${GATE}, which needs a passing \`boardsmith verify\` for the commit under review.`,
  },
  { field: 'Agents', add: 'the agent types dispatched for the round' },
  {
    field: 'Outcome',
    add: 'pending, clean or changes requested',
    check: (v) => (REVIEW_OUTCOMES.includes(v) ? undefined : 'which must be pending, clean or changes requested.'),
  },
];

function reviewRoundProblems(entry: LedgerEntry): string[] {
  const name = `Review Round ${entry.id}`;
  return ROUND_FIELDS.flatMap(({ field, add, check }) => {
    const value = valueOf(entry, field);
    if (value === undefined) return [missing(name, entry, field, add)];
    const wrong = check?.(value);
    if (wrong === undefined) return [];
    return [`${name} has "${field}: ${value}"${wrong.startsWith('which') ? ', ' : '. '}${wrong}`];
  });
}

function reviewRoundFindings(text: string): RunLogRoleFinding[] {
  const findings: RunLogRoleFinding[] = [];
  const seen = new Set<string>();
  for (const entry of parseLedgerEntries(text, 'Review Round')) {
    const name = `Review Round ${entry.id}`;
    const out = seen.has(entry.id) ? [`${name} (line ${entry.line}) is a round number used twice. Number the rounds 1, 2, 3 in order.`] : reviewRoundProblems(entry);
    seen.add(entry.id);
    findings.push(...out.map((detail) => ({ entry: name, kind: 'review-round' as const, detail })));
  }
  return findings;
}

/** Every problem with the role, agent, escalation and review-round records of one chunk's run log. */
export function checkRunLogRoles(text: string): RunLogRoleFinding[] {
  return [...dispatchFindings(text), ...reviewRoundFindings(text)];
}
