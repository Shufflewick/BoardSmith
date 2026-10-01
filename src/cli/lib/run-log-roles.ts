import { ESCALATION_LADDER, type WorkRole, nextRole } from './agent-roles.js';
import { type LedgerEntry, entryField, parseLedgerEntries } from './ledger-entries.js';
import { VERIFY_RESULT_FORMAT, type VerifyResult } from './verify-result.js';

/**
 * What a work package's run log records about who did the work and how its review went (#454),
 * checked as code by `boardsmith ledger-check`. The clock rules for the same entries are
 * ledger-check's own. `bs/routing.md` "When a Step Fails" and "The Run Log" state the rules in the
 * skills' terms; this module is them as code.
 *
 * `### Dispatch N` entries, one per dispatch of work:
 *   - Work: what was dispatched (`build-chunk`, a step name, `re-investigate`, a short name for a
 *     bulk edit), with the unit for work done once per unit (`transcribe rulebook.pdf pp. 1-8`)
 *   - Role: mechanical | bounded | judgement | second-opinion (reviewers are recorded in rounds)
 *   - Agent: the agent type actually dispatched
 *   - Retry of: none, `Dispatch M` (a dispatch whose Outcome is `failed`), or `Review Round K`
 *     (a round whose Outcome is `changes requested`)
 *   - Designer answer: only on a dispatch that does work again after it failed twice at the top
 *     role, once the designer has answered: where their answer is recorded
 *
 * `### Review Round N` entries, one per review round:
 *   - Step: redteam | audit | final-acceptance | cross-chunk
 *   - Reviewed: `Dispatch M`, the dispatch whose finished work the round reviews
 *   - Level: light | full, as `boardsmith review-gate` sized it
 *   - Verify: `<commit> passed`, the verify result the round started from
 *   - Agents: the agent types dispatched
 *   - Outcome: pending | clean | changes requested
 *
 * A failure is a dispatch whose Outcome is `failed` (its verify failed, or a check run on its
 * return refused it, such as `claim-quote-check` or `verify-run-record`) or a round that asked for
 * changes to the work it reviewed. Each failure is answered once, by a dispatch that names it in
 * "Retry of". A first failure at a role is retried once at that same role; a second failure at
 * that role, on the same line of work, goes one role up (mechanical, then bounded, then
 * judgement), and a second failure at the top goes to the designer, after whose answer a dispatch
 * records it in "Designer answer". Verify failures and review rounds count together. A dispatch
 * that does the failed work again without naming the failure is refused, at any role. A gate, a
 * context ceiling and a crash (a dispatch left `pending`) are not failures: the next dispatch of
 * the same work at the same role resumes it and is the same attempt, so a resumed retry is still
 * the one retry. The `judgement` and `second-opinion` readings of one slice are separate lines of
 * work: neither is a retry of the other.
 */

interface RunLogRoleFinding {
  entry: string;
  kind: 'run-role' | 'review-round';
  detail: string;
}

/** The verify result on this machine for the commit a review round names (`.boardsmith/verify/`). */
export type VerifyOnFile = { file: string; result: VerifyResult | 'unreadable' } | { ambiguous: string[] } | undefined;

/** Looks up the result on file for a commit as a review round writes it (a prefix of the full id). */
export type VerifyLookup = (commit: string) => VerifyOnFile;

const REVIEW_STEPS = ['redteam', 'audit', 'final-acceptance', 'cross-chunk'];
const REVIEW_LEVELS = ['light', 'full'];
const REVIEW_OUTCOMES = ['pending', 'clean', 'changes requested'];
const CHANGES_REQUESTED = 'changes requested';

/** The roles a dispatch may be recorded as: the escalation ladder, and second-opinion beside its top. */
type DispatchRole = WorkRole | 'second-opinion';
const DISPATCH_ROLES: readonly string[] = [...ESCALATION_LADDER, 'second-opinion'];

/** Outcomes of a dispatch whose work finished, and so may be reviewed. */
const FINISHED = ['done', 'closed'];
/**
 * Outcomes after which the next dispatch of the same work at the same role resumes it, rather than
 * starting fresh. `pending` is a dispatch that never returned (a crash), or a `build` whose check,
 * `test`'s verify, has not run yet.
 */
const RESUMED = ['pending', 'gate', 'context-ceiling'];

/**
 * The line of work a dispatch belongs to, the key a retry is found by. The `second-opinion`
 * reading of a slice is its own line: it is never a retry of the `judgement` reading, nor that of it.
 */
const lineOf = (work: string, role: DispatchRole | undefined) => (role === 'second-opinion' ? `${work} (second-opinion)` : work);

interface Dispatch {
  name: string;
  work?: string;
  role?: DispatchRole;
  outcome?: string;
  /** The entry named by "Retry of", e.g. `Review Round 2`; undefined for "none". */
  retryOf?: string;
  designerAnswer?: string;
  /** The dispatch this one carries on from: the failed one it retries, or the one it resumes. */
  parent?: Dispatch;
  /**
   * Which attempt at its role this is on its line of work: 1, or 2 for the one retry at the same
   * role. A resume is the attempt it resumes; a move one role up, or a dispatch after the
   * designer's answer, starts again at 1.
   */
  attempt: number;
}

interface Round {
  outcome?: string;
  /** Whether the round names the dispatch it reviewed, so a request for changes has a role to climb from. */
  linked: boolean;
}

/** A dispatch whose work failed, and where that is recorded. */
interface Failure {
  /** The entry that records the failure: the failed dispatch, or the round that asked for changes. */
  name: string;
  failed: Dispatch;
  /** The review step, when a round asked for changes. */
  step?: string;
  answeredBy?: string;
}

/** A run log entry of either kind, its body cut at the next entry of either kind. */
interface RunLogEntry extends LedgerEntry {
  kind: 'Dispatch' | 'Review Round';
}

/**
 * Every `### Dispatch N` and `### Review Round N` entry in file order. Each body ends at the next
 * entry of EITHER kind, so a field an entry leaves out is never read from the entry after it.
 */
export function runLogEntries(text: string): RunLogEntry[] {
  const all = [
    ...parseLedgerEntries(text, 'Dispatch').map((e) => ({ ...e, kind: 'Dispatch' as const })),
    ...parseLedgerEntries(text, 'Review Round').map((e) => ({ ...e, kind: 'Review Round' as const })),
  ].sort((a, b) => a.line - b.line);
  return all.map((entry, i) => {
    const next = all[i + 1];
    if (next === undefined) return entry;
    return { ...entry, body: entry.body.split('\n').slice(0, next.line - entry.bodyLine).join('\n') };
  });
}

/** A field's value, or undefined when the field is missing or empty. */
function valueOf(entry: LedgerEntry, field: string): string | undefined {
  const value = entryField(entry, field)?.value;
  return value === undefined || value === '' ? undefined : value;
}

const missing = (name: string, entry: LedgerEntry, field: string, what: string) =>
  `${name} (line ${entry.line}) has no "- ${field}:" field. Add ${what}.`;

const isTop = (role: DispatchRole) => role === 'judgement' || role === 'second-opinion';

/** How a failure reads in a finding: "Dispatch 3 failed at bounded". */
function described(f: Failure): string {
  const role = f.failed.role ?? 'an unrecorded role';
  const at = f.step === undefined ? `${f.name} failed at ${role}` : `${f.name} asked for changes to ${f.failed.name}'s work at ${role}`;
  return f.failed.role !== undefined && isTop(f.failed.role) ? `${at}, the top role` : at;
}

const ASK_DESIGNER =
  'Stop and ask the designer, and dispatch nothing more for this work until they answer; the dispatch after their answer ' +
  'writes "Retry of: none" and records where the answer is in "- Designer answer:".';

/**
 * The role that answers `f`: its own role after a first failure there, the next role up after a
 * second, or undefined when the designer decides (a second failure at the top).
 */
function retryRole(f: Failure): DispatchRole | undefined {
  const role = f.failed.role!;
  if (f.failed.attempt < 2) return role;
  return role === 'second-opinion' ? undefined : nextRole(role);
}

/** What the dispatch answering `f` must be, for a finding that got it wrong. */
function howToRetry(f: Failure, role: DispatchRole): string {
  const failed = f.failed.role!;
  if (role === failed) {
    return (
      `It is its first failure there, so it gets one retry at the same role, ${role}, handed the failure output: dispatch that ` +
      `and write "Retry of: ${f.name}".`
    );
  }
  return (
    `Its work has now failed twice at ${failed}, so it goes one role up, ${role}: run \`boardsmith agent ${failed} --escalate\`, ` +
    `dispatch the agent it prints, and write "Retry of: ${f.name}".`
  );
}

/** Why the designer, not another dispatch, answers `f`. */
const designerDecides = (f: Failure) => `${described(f)}, its second failure there. ${ASK_DESIGNER}`;

/**
 * The checker for one run log. Entries are fed in file order, since whether a dispatch may do some
 * work at some role depends on what failed before it.
 */
class RunLogChecker {
  readonly findings: RunLogRoleFinding[] = [];
  private readonly dispatches = new Map<string, Dispatch>();
  private readonly rounds = new Map<string, Round>();
  private readonly seenRounds = new Set<string>();
  private readonly failures = new Map<string, Failure>();
  /** The latest failure each line of work would retry, by the line (`lineOf`) a retry would be on. */
  private readonly openByLine = new Map<string, Failure>();
  /** The latest dispatch of each work at each role, which the next one at that role may resume. */
  private readonly latestAtRole = new Map<string, Dispatch>();

  constructor(private readonly verifyOnFile: VerifyLookup) {}

  private report(entry: string, kind: RunLogRoleFinding['kind'], details: string[]): void {
    this.findings.push(...details.map((detail) => ({ entry, kind, detail })));
  }

  private register(failure: Failure): void {
    this.failures.set(failure.name, failure);
    const work = failure.failed.work;
    if (work === undefined) return;
    this.openByLine.set(lineOf(work, failure.failed.role), failure);
    if (failure.step !== undefined) this.openByLine.set(failure.step === 'redteam' ? 're-investigate' : 'repair', failure);
  }

  // ------------------------------------------------------------------------------------------
  // Dispatches
  // ------------------------------------------------------------------------------------------

  dispatch(entry: LedgerEntry): void {
    const out: string[] = [];
    const d = this.readDispatch(entry, out);
    const problem = d.retryOf !== undefined ? this.namedRetryProblem(d) : this.unnamedRetryProblem(d);
    if (problem !== undefined) out.push(problem);
    if (d.outcome === 'failed') this.register({ name: d.name, failed: d });
    this.dispatches.set(entry.id, d);
    if (d.work !== undefined) this.latestAtRole.set(`${d.work} at ${d.role}`, d);
    this.report(d.name, 'run-role', out);
  }

  private readDispatch(entry: LedgerEntry, out: string[]): Dispatch {
    const name = `Dispatch ${entry.id}`;
    const work = valueOf(entry, 'Work');
    if (work === undefined) out.push(missing(name, entry, 'Work', 'what was dispatched: build-chunk, a step name, or a short name for a bulk edit'));
    const role = readRole(name, entry, out);
    if (valueOf(entry, 'Agent') === undefined) {
      out.push(missing(name, entry, 'Agent', 'the agent type actually dispatched, as `boardsmith agent <role>` printed it'));
    }
    const retry = valueOf(entry, 'Retry of') ?? 'none';
    const of = /^(?:Dispatch|Review Round) \S+$/.exec(retry)?.[0];
    if (retry !== 'none' && of === undefined) {
      out.push(
        `${name} has "Retry of: ${retry}". Write "none", "Dispatch N" for the failed dispatch it retries, or ` +
          '"Review Round N" for the review round that asked for changes.',
      );
    }
    return {
      name,
      work,
      role,
      outcome: valueOf(entry, 'Outcome')?.split(/\s/)[0],
      retryOf: of,
      designerAnswer: valueOf(entry, 'Designer answer'),
      attempt: 1,
    };
  }

  /** The failure a "Retry of" names, or why it names none. */
  private failureNamed(by: string, source: string): Failure | string {
    const [, kind, id] = /^(Dispatch|Review Round) (\S+)$/.exec(source)!;
    const entry = kind === 'Dispatch' ? this.dispatches.get(id) : this.rounds.get(id);
    if (entry === undefined) return `${by} retries ${source}, but there is no ${source} before it.`;
    return this.failures.get(source) ?? notAFailure(by, source, entry);
  }

  /** Why `d`'s "Retry of" is wrong, or undefined; a right one answers the failure it names. */
  private namedRetryProblem(d: Dispatch): string | undefined {
    const failure = this.failureNamed(d.name, d.retryOf!);
    if (typeof failure === 'string') return failure;
    if (failure.answeredBy !== undefined) {
      return (
        `${d.name} retries ${failure.name}, but ${failure.name} was already answered by ${failure.answeredBy}. A failure is ` +
        `retried once; a dispatch that carries ${failure.answeredBy}'s work on after a gate, a context ceiling or a crash ` +
        'writes "Retry of: none".'
      );
    }
    const failed = failure.failed;
    if (failed.role !== undefined && d.role !== undefined) {
      const role = retryRole(failure);
      if (role === undefined) return `${d.name} retries ${failure.name}, but ${designerDecides(failure)}`;
      if (d.role !== role) return `${d.name} retries ${failure.name} at ${d.role}, but ${described(failure)}. ${howToRetry(failure, role)}`;
      d.attempt = d.role === failed.role ? failed.attempt + 1 : 1;
    }
    failure.answeredBy = d.name;
    d.parent = failed;
    return undefined;
  }

  /** Why `d` does failed work again without naming the failure, or undefined. */
  private unnamedRetryProblem(d: Dispatch): string | undefined {
    if (d.work === undefined || d.role === undefined) return undefined;
    this.resume(d);
    const failure = this.openByLine.get(lineOf(d.work, d.role));
    if (failure === undefined || failure.answeredBy !== undefined || failure.failed.role === undefined) return undefined;
    const role = retryRole(failure);
    if (role !== undefined) return `${d.name} does "${d.work}" at ${d.role} after ${described(failure)}, without naming it. ${howToRetry(failure, role)}`;
    if (d.designerAnswer === undefined) return `${d.name} does "${d.work}" at ${d.role} after ${designerDecides(failure)}`;
    failure.answeredBy = d.name;
    d.parent = failure.failed;
    return undefined;
  }

  /** A dispatch after a gate, context ceiling or crash of the same work, at the same role, is the attempt it resumes. */
  private resume(d: Dispatch): void {
    const previous = this.latestAtRole.get(`${d.work} at ${d.role}`);
    if (previous === undefined || !RESUMED.includes(previous.outcome ?? '')) return;
    d.parent = previous;
    d.attempt = previous.attempt;
  }

  // ------------------------------------------------------------------------------------------
  // Review rounds
  // ------------------------------------------------------------------------------------------

  round(entry: LedgerEntry): void {
    const name = `Review Round ${entry.id}`;
    if (this.seenRounds.has(entry.id)) {
      this.report(name, 'review-round', [`${name} (line ${entry.line}) is a round number used twice. Number the rounds 1, 2, 3 in order.`]);
      return;
    }
    this.seenRounds.add(entry.id);
    const out = reviewRoundProblems(name, entry);
    const reviewed = this.reviewedDispatch(name, entry, out);
    const round: Round = { outcome: valueOf(entry, 'Outcome'), linked: reviewed !== undefined };
    const verify = /^([0-9a-f]{7,64}) passed$/.exec(valueOf(entry, 'Verify') ?? '')?.[1];
    const onFile = verify === undefined ? undefined : verifyOnFileProblem(name, verify, this.verifyOnFile(verify));
    if (onFile !== undefined) out.push(onFile);
    if (round.outcome === CHANGES_REQUESTED && reviewed !== undefined) {
      this.register({ name, failed: reviewed, step: valueOf(entry, 'Step') });
    }
    this.rounds.set(entry.id, round);
    this.report(name, 'review-round', out);
  }

  private reviewedDispatch(name: string, entry: LedgerEntry, out: string[]): Dispatch | undefined {
    const value = valueOf(entry, 'Reviewed');
    if (value === undefined) {
      out.push(missing(name, entry, 'Reviewed', '"Dispatch N", the dispatch whose finished work this round reviews'));
      return undefined;
    }
    const id = /^Dispatch (\S+)$/.exec(value)?.[1];
    if (id === undefined) {
      out.push(`${name} has "Reviewed: ${value}". Write "Dispatch N", the dispatch whose finished work this round reviews.`);
      return undefined;
    }
    const reviewed = this.dispatches.get(id);
    if (reviewed === undefined) {
      out.push(`${name} reviews Dispatch ${id}, but there is no Dispatch ${id} before it. A round is recorded after the work it reviews.`);
      return undefined;
    }
    if (!FINISHED.includes(reviewed.outcome ?? '')) {
      out.push(
        `${name} reviews ${reviewed.name}, whose Outcome is ${reviewed.outcome ?? 'missing'}: only work that finished and passed its ` +
          'checks is reviewed. A failed dispatch is retried, never reviewed.',
      );
    }
    const later = this.finishedCarryingOn(reviewed);
    if (later !== undefined) {
      out.push(
        `${name} reviews ${reviewed.name}, but ${later.name} carried its work on and finished, so it is the latest dispatch that ` +
          `changed the work. Write "Reviewed: ${later.name}".`,
      );
      return undefined;
    }
    return reviewed;
  }

  /** The latest finished dispatch that carries on from `d` (a retry or a resume), or undefined. */
  private finishedCarryingOn(d: Dispatch): Dispatch | undefined {
    return [...this.dispatches.values()].filter((x) => FINISHED.includes(x.outcome ?? '') && lineage(x).slice(1).includes(d)).at(-1);
  }
}

/** The Role line's problem, or the role. */
function readRole(name: string, entry: LedgerEntry, out: string[]): DispatchRole | undefined {
  const role = valueOf(entry, 'Role');
  if (role === undefined) {
    out.push(missing(name, entry, 'Role', 'the role the work was dispatched as: mechanical, bounded, judgement or second-opinion'));
  } else if (role === 'review') {
    out.push(
      `${name} has "Role: review", but reviewers are recorded in a "### Review Round N" entry, not as a dispatch. ` +
        'Move it to a review round with the verify result it started from.',
    );
  } else if (!DISPATCH_ROLES.includes(role)) {
    out.push(`${name} has "Role: ${role}", which is not a role that does work: mechanical, bounded, judgement or second-opinion.`);
  } else {
    return role as DispatchRole;
  }
  return undefined;
}

/** Why the entry a "Retry of" names is not a failure that can be retried. */
function notAFailure(by: string, source: string, entry: Dispatch | Round): string {
  const only = 'Only a failed dispatch, or a review round that asked for changes, is retried.';
  const outcome = entry.outcome ?? 'missing';
  if ('name' in entry) return `${by} retries ${source}, but ${source} did not fail (Outcome: ${outcome}). ${only}`;
  if (entry.outcome === CHANGES_REQUESTED && !entry.linked) {
    return `${by} retries ${source}, which does not name the dispatch it reviewed, so the role that failed is unknown. Fix its "- Reviewed:" line.`;
  }
  return `${by} retries ${source}, but ${source} did not ask for changes (Outcome: ${outcome}). ${only}`;
}

/** `d` and every dispatch it carries on from, nearest first. */
function lineage(d: Dispatch): Dispatch[] {
  const chain: Dispatch[] = [];
  for (let at: Dispatch | undefined = d; at !== undefined; at = at.parent) chain.push(at);
  return chain;
}

const GATE = 'A review round starts only once `boardsmith review-gate <slug>` is open';

/**
 * One field of a review round: what to add when it is missing, and, when its value is wrong, what
 * to write instead. `check` is undefined for a field any value satisfies. `Reviewed` is the
 * checker's own, since it needs the dispatches before the round.
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
      /^[0-9a-f]{7,64} passed$/.test(v)
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

function reviewRoundProblems(name: string, entry: LedgerEntry): string[] {
  return ROUND_FIELDS.flatMap(({ field, add, check }) => {
    const value = valueOf(entry, field);
    if (value === undefined) return [missing(name, entry, field, add)];
    const wrong = check?.(value);
    if (wrong === undefined) return [];
    return [`${name} has "${field}: ${value}"${wrong.startsWith('which') ? ', ' : '. '}${wrong}`];
  });
}

/**
 * Why the verify result on this machine contradicts a round's "Verify: <commit> passed", or
 * undefined when it agrees or none is on file. A result written by another version of BoardSmith
 * is not read: its shape is not this one's.
 */
function verifyOnFileProblem(name: string, commit: string, found: VerifyOnFile): string | undefined {
  if (found === undefined) return undefined;
  const says = `${name} says "Verify: ${commit} passed", but`;
  if ('ambiguous' in found) {
    return `${says} that commit matches more than one verify result in .boardsmith/verify/ (${found.ambiguous.join(', ')}). Write the commit as review-gate printed it.`;
  }
  if (found.result === 'unreadable') {
    return `${says} its verify result (${found.file}) could not be read. Run \`boardsmith verify\` on that commit again to rewrite it.`;
  }
  if (found.result.format !== VERIFY_RESULT_FORMAT) return undefined;
  const why = !found.result.passed ? 'failed' : !found.result.cleanTree ? 'ran while the tree had uncommitted changes' : undefined;
  if (why === undefined) return undefined;
  return (
    `${says} the latest verify of that commit (${found.file}) ${why}. Run \`boardsmith verify\` on that commit again; ` +
    'a review round stands on a passing verify on a clean tree, and the latest clean run of a commit is the one that counts.'
  );
}

/** The commit each review round's "Verify: <commit> passed" names, for looking up its result on file. */
export function reviewRoundCommits(text: string): string[] {
  return runLogEntries(text)
    .filter((e) => e.kind === 'Review Round')
    .flatMap((e) => /^([0-9a-f]{7,64}) passed$/.exec(valueOf(e, 'Verify') ?? '')?.[1] ?? []);
}

/** Every problem with the role, agent, retry and review-round records of one run log. */
export function checkRunLogRoles(text: string, verifyOnFile: VerifyLookup): RunLogRoleFinding[] {
  const checker = new RunLogChecker(verifyOnFile);
  for (const entry of runLogEntries(text)) {
    if (entry.kind === 'Dispatch') checker.dispatch(entry);
    else checker.round(entry);
  }
  return checker.findings;
}
