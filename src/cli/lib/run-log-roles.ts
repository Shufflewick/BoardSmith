import { type WorkRole, nextRole } from './agent-roles.js';
import { type LedgerEntry, entryField, parseLedgerEntries } from './ledger-entries.js';
import { VERIFY_RESULT_FORMAT, type VerifyResult } from './verify-result.js';

/**
 * What a work package's run log records about who did the work and how its review went (#454),
 * checked as code by `boardsmith ledger-check`. The clock rules for the same entries are
 * ledger-check's own. `bs/routing.md` "When a Step Fails" and "The Run Log" state the rules in the
 * skills' terms; this module is them as code.
 *
 * `### Dispatch N` entries, one per dispatch of work:
 *   - Work: what was dispatched (`build-chunk`, a step name, `re-investigate`, `quote-fix`, a short
 *     name for a bulk edit)
 *   - Role: mechanical | bounded | judgement | second-opinion (reviewers are recorded in rounds)
 *   - Agent: the agent type actually dispatched
 *   - Escalated from: none, `Dispatch M` (a dispatch whose Outcome is `failed`), or `Review Round K`
 *     (a round whose Outcome is `changes requested`)
 *   - Designer answer: only on a dispatch that retries work which failed at the top role, once the
 *     designer has answered: where their answer is recorded
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
 * changes to the work it reviewed. Each failure is answered once: by an escalation one role up that
 * names it, or, at the top, by one of the three named exceptions or a dispatch that records the
 * designer's answer. A dispatch that does the failed work again without naming the failure is
 * refused, at any role. A gate, a context ceiling and a crash (a dispatch left `pending`) are not
 * failures: the next dispatch of the same work at the same role resumes it, keeps its role and
 * carries on the round it resumes, so a resumed exception round is still that round. The
 * `judgement` and `second-opinion` readings of one slice are separate lines of work: neither is a
 * retry of the other.
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
const RANK: Record<DispatchRole, number> = { mechanical: 0, bounded: 1, judgement: 2, 'second-opinion': 2 };
const DISPATCH_ROLES = Object.keys(RANK);

/** Outcomes of a dispatch whose work finished, and so may be reviewed. */
const FINISHED = ['done', 'closed'];
/**
 * Outcomes after which the next dispatch of the same work at the same role resumes it, rather than
 * starting fresh. `pending` is a dispatch that never returned (a crash), or a `build` whose check,
 * `test`'s verify, has not run yet.
 */
const RESUMED = ['pending', 'gate', 'context-ceiling'];

/** The work that writes a chunk's claims, which `claim-quote-check` checks on its return. */
const CLAIM_WORK = ['investigate', 're-investigate'];

/** Whether `work` is a transcription of one page range, `transcribe <range>`, which `verify-run-record` checks. */
const isTranscription = (work: string | undefined) => work !== undefined && work.startsWith('transcribe ');

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
  /** The entry named by "Escalated from", e.g. `Review Round 2`; undefined for "none". */
  escalatedFrom?: string;
  designerAnswer?: string;
  /** What the dispatch's "Detail" says; a failed transcription names `verify-run-record` there when that command refused it. */
  detail?: string;
  /** The dispatch this one carries on from: the failed one it escalates from, or the one it resumes. */
  parent?: Dispatch;
  /**
   * Set when this dispatch is one of routing.md's one-more-round exceptions: the one more judgement
   * round for a re-investigation or repair, or the one re-transcription of a refused page range.
   */
  exceptionRound?: boolean;
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
  'records where it is in "- Designer answer:".';

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
    else if (CLAIM_WORK.includes(work)) this.openByLine.set('quote-fix', failure);
  }

  // ------------------------------------------------------------------------------------------
  // Dispatches
  // ------------------------------------------------------------------------------------------

  dispatch(entry: LedgerEntry): void {
    const out: string[] = [];
    const d = this.readDispatch(entry, out);
    const problem = d.escalatedFrom !== undefined ? this.escalationProblem(d) : this.retryProblem(d);
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
    const escalated = valueOf(entry, 'Escalated from') ?? 'none';
    const from = /^(?:Dispatch|Review Round) \S+$/.exec(escalated)?.[0];
    if (escalated !== 'none' && from === undefined) {
      out.push(
        `${name} has "Escalated from: ${escalated}". Write "none", "Dispatch N" for the failed dispatch it retries one role ` +
          'up, or "Review Round N" for the review round that asked for changes.',
      );
    }
    return {
      name,
      work,
      role,
      outcome: valueOf(entry, 'Outcome')?.split(/\s/)[0],
      escalatedFrom: from,
      designerAnswer: valueOf(entry, 'Designer answer'),
      detail: valueOf(entry, 'Detail'),
    };
  }

  /** The failure an "Escalated from" names, or why it names none. */
  private failureNamed(by: string, source: string): Failure | string {
    const [, kind, id] = /^(Dispatch|Review Round) (\S+)$/.exec(source)!;
    const entry = kind === 'Dispatch' ? this.dispatches.get(id) : this.rounds.get(id);
    if (entry === undefined) return `${by} escalates from ${source}, but there is no ${source} before it.`;
    return this.failures.get(source) ?? notAFailure(by, source, entry);
  }

  /** Why `d`'s escalation is wrong, or undefined; a right one answers the failure it names. */
  private escalationProblem(d: Dispatch): string | undefined {
    const failure = this.failureNamed(d.name, d.escalatedFrom!);
    if (typeof failure === 'string') return failure;
    if (failure.answeredBy !== undefined) {
      return (
        `${d.name} escalates from ${failure.name}, but ${failure.name} was already answered by ${failure.answeredBy}. A failure is ` +
        `retried once, one role up; a dispatch that carries ${failure.answeredBy}'s work on after a gate, a context ceiling or a crash ` +
        'writes "Escalated from: none".'
      );
    }
    const problem = this.climbProblem(d, failure);
    if (problem === undefined) {
      failure.answeredBy = d.name;
      d.parent = failure.failed;
    }
    return problem;
  }

  private climbProblem(d: Dispatch, failure: Failure): string | undefined {
    const from = failure.failed.role;
    if (from === undefined || d.role === undefined) return undefined;
    if (from === 'second-opinion') {
      return `${d.name} escalates from ${failure.name}, but ${failure.failed.name} failed at second-opinion, which no role is above. ${ASK_DESIGNER}`;
    }
    const next = nextRole(from);
    if (next !== undefined) {
      return d.role === next ? undefined : `${d.name} escalates from ${failure.name} (${from}), so it must be the next role up, ${next}, not ${d.role}.`;
    }
    const exception = exceptionProblem(d, failure);
    if (exception !== undefined) return exception;
    if (d.role !== 'judgement') return `${d.name} is ${failure.name}'s one more round, which runs at judgement, not ${d.role}.`;
    d.exceptionRound = d.work !== 'quote-fix';
    return undefined;
  }

  /** Why `d` does failed work again without naming the failure, or undefined. */
  private retryProblem(d: Dispatch): string | undefined {
    if (d.work === undefined || d.role === undefined) return undefined;
    this.resume(d);
    const failure = this.openByLine.get(lineOf(d.work, d.role));
    if (failure === undefined || failure.answeredBy !== undefined || failure.failed.role === undefined) return undefined;
    if (RANK[d.role] > RANK[failure.failed.role]) return unnamedEscalationProblem(d, failure);
    if (!isTop(failure.failed.role)) return belowTopRetryProblem(d, failure);
    if (d.designerAnswer === undefined) return topRetryProblem(d, failure);
    failure.answeredBy = d.name;
    return undefined;
  }

  /** A dispatch after a gate, context ceiling or crash of the same work, at the same role, carries on that round. */
  private resume(d: Dispatch): void {
    const previous = this.latestAtRole.get(`${d.work} at ${d.role}`);
    if (previous !== undefined && RESUMED.includes(previous.outcome ?? '')) d.parent = previous;
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
          'checks is reviewed. A failed dispatch is retried one role up, never reviewed.',
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

  /** The latest finished dispatch that carries on from `d` (an escalation or a resume), or undefined. */
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

/** Why the entry an "Escalated from" names is not a failure that can be escalated from. */
function notAFailure(by: string, source: string, entry: Dispatch | Round): string {
  const only = 'Only a failed dispatch, or a review round that asked for changes, is retried one role up.';
  const outcome = entry.outcome ?? 'missing';
  if ('name' in entry) return `${by} escalates from ${source}, but ${source} did not fail (Outcome: ${outcome}). ${only}`;
  if (entry.outcome === CHANGES_REQUESTED && !entry.linked) {
    return `${by} escalates from ${source}, which does not name the dispatch it reviewed, so the role that failed is unknown. Fix its "- Reviewed:" line.`;
  }
  return `${by} escalates from ${source}, but ${source} did not ask for changes (Outcome: ${outcome}). ${only}`;
}

/** Why `d` may not do `failure`'s work again at the role it failed at, or below, instead of one up. */
function belowTopRetryProblem(d: Dispatch, failure: Failure): string {
  const failedRole = failure.failed.role;
  return (
    `${d.name} retries "${d.work}" at ${d.role} after ${described(failure)}. A failed step goes one role up, never to the ` +
    `same role or below: run \`boardsmith agent ${failedRole} --escalate\`, dispatch that, and write "Escalated from: ${failure.name}".`
  );
}

/** Why `d`, one role above `failure`, may not leave the failure unnamed: the record must show what each dispatch answers. */
function unnamedEscalationProblem(d: Dispatch, failure: Failure): string {
  return (
    `${d.name} does "${d.work}" at ${d.role} after ${described(failure)}, without naming it. Write "Escalated from: ${failure.name}", ` +
    'so the record shows which failure this dispatch answers and how many rounds the work has had.'
  );
}

/** Why `d` may not do `failure`'s work again at the top role without naming it or the designer's answer. */
function topRetryProblem(d: Dispatch, failure: Failure): string {
  const exception =
    exceptionProblem(d, failure) === undefined && failure.failed.role === 'judgement'
      ? `If this is its one more judgement round (routing.md "When a Step Fails"), write "Escalated from: ${failure.name}". Otherwise: `
      : '';
  return `${d.name} retries "${d.work}" at ${d.role} after ${described(failure)}. ${exception}${ASK_DESIGNER}`;
}

/** `d` and every dispatch it carries on from, nearest first. */
function lineage(d: Dispatch): Dispatch[] {
  const chain: Dispatch[] = [];
  for (let at: Dispatch | undefined = d; at !== undefined; at = at.parent) chain.push(at);
  return chain;
}

/**
 * Why `d`, which retries `failure` after it failed at judgement, is not one of routing.md's named
 * exceptions, or undefined when it is: one more judgement round for a red-team re-investigation
 * and for a repair, one narrower quote-fix for a `claim-quote-check` refusal, and one
 * re-transcription of a page range `verify-run-record` refused.
 */
function exceptionProblem(d: Dispatch, failure: Failure): string | undefined {
  if (d.work === 're-investigate' || d.work === 'repair') return secondRoundProblem(d, failure);
  if (d.work === 'quote-fix') return quoteFixProblem(d, failure);
  if (isTranscription(d.work)) return retranscriptionProblem(d, failure);
  return (
    `${d.name} escalates from ${failure.name}, but ${failure.failed.name} failed at judgement, the top role, and "${d.work}" is not ` +
    'one of the named exceptions (routing.md "When a Step Fails": one more judgement round for a re-investigate or a repair, ' +
    `one quote-fix for a claim-quote-check refusal, one re-transcription of a page range verify-run-record refused). ${ASK_DESIGNER}`
  );
}

/** The failures each second-round Work answers, and how routing.md says so. */
const SECOND_ROUND: Record<string, { answers: (f: Failure) => boolean; rule: string }> = {
  're-investigate': {
    answers: (f) => f.step === 'redteam',
    rule: 'a re-investigation after a red team round asked for changes',
  },
  repair: {
    answers: (f) => (f.step === undefined ? f.failed.work === 'repair' : f.step !== 'redteam'),
    rule: "a repair after an audit, final-acceptance or cross-chunk round asked for changes, or after a repair's verify failed",
  },
};

/** The first named exception: one more judgement round, for the failure it answers, once per line of work. */
function secondRoundProblem(d: Dispatch, failure: Failure): string | undefined {
  const { answers, rule } = SECOND_ROUND[d.work!];
  if (!answers(failure)) {
    return (
      `${d.name} is a ${d.work} escalated from ${failure.name}, but the one more judgement round is for ${rule} ` +
      `(routing.md "When a Step Fails"), and ${described(failure)}. ${ASK_DESIGNER}`
    );
  }
  const used = lineage(failure.failed).find((x) => x.exceptionRound);
  if (used === undefined) return undefined;
  return (
    `${d.name} escalates from ${failure.name}, but that work already had its one more judgement round (${used.name}). ` +
    `No step gets a third round. ${ASK_DESIGNER}`
  );
}

/** The third named exception: one re-transcription of a page range, after `verify-run-record` refused that range. */
function retranscriptionProblem(d: Dispatch, failure: Failure): string | undefined {
  if (failure.step !== undefined || failure.failed.work !== d.work) {
    const doing = failure.failed.work === d.work ? '' : ` doing "${failure.failed.work}"`;
    return (
      `${d.name} is a re-transcription of "${d.work}" escalated from ${failure.name}, but ${described(failure)}${doing}. A re-transcription ` +
      `answers verify-run-record's refusal of its own range, once (routing.md "When a Step Fails"). ${ASK_DESIGNER}`
    );
  }
  if (!failure.failed.detail?.includes('verify-run-record')) {
    return (
      `${d.name} is a re-transcription of "${d.work}" escalated from ${failure.name}, but ${failure.name}'s Detail does not name ` +
      'verify-run-record. The one re-transcription answers only a range `boardsmith verify-run-record` refused in /bs-verify-game, ' +
      `with the refusal in Detail (routing.md "When a Step Fails"). ${ASK_DESIGNER}`
    );
  }
  const used = lineage(failure.failed).find((x) => x.exceptionRound);
  if (used === undefined) return undefined;
  return (
    `${d.name} escalates from ${failure.name}, but that range already had its one re-transcription (${used.name}). ` +
    `No range is transcribed a third time. ${ASK_DESIGNER}`
  );
}

/** The second named exception: one quote-fix, for a claim-quote-check refusal of the claims. */
function quoteFixProblem(d: Dispatch, failure: Failure): string | undefined {
  if (failure.step === undefined && CLAIM_WORK.includes(failure.failed.work ?? '')) return undefined;
  return (
    `${d.name} is a quote-fix escalated from ${failure.name}, but ${described(failure)}. A quote-fix answers a ` +
    `claim-quote-check refusal of an investigate or re-investigate dispatch, once (routing.md "When a Step Fails"). ${ASK_DESIGNER}`
  );
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

/** Every problem with the role, agent, escalation and review-round records of one run log. */
export function checkRunLogRoles(text: string, verifyOnFile: VerifyLookup): RunLogRoleFinding[] {
  const checker = new RunLogChecker(verifyOnFile);
  for (const entry of runLogEntries(text)) {
    if (entry.kind === 'Dispatch') checker.dispatch(entry);
    else checker.round(entry);
  }
  return checker.findings;
}
