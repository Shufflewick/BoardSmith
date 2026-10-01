import { describe, expect, it } from 'vitest';
import { type VerifyLookup, checkRunLogRoles, reviewRoundCommits, runLogEntries } from './run-log-roles.js';
import { type VerifyResult, buildVerifyResult } from './verify-result.js';

/**
 * The run log's record of who did the work and how review went (#454): each dispatch's role and
 * agent type, the one retry at the same role after a first failure and the move one role up after
 * a second, the designer after a second failure at the top role, and each review round's link to
 * the dispatch it reviewed and the verify result it started from.
 */

function dispatch(n: number, fields: Record<string, string>): string {
  const all = {
    Work: 'build',
    Role: 'bounded',
    Agent: 'bs-bounded',
    'Retry of': 'none',
    'Dispatched at': '2026-09-23T10:00:00Z',
    'Finished at': '2026-09-23T11:00:00Z',
    Outcome: 'done',
    Detail: 'n/a',
    ...fields,
  };
  return [`### Dispatch ${n}`, ...Object.entries(all).filter(([, v]) => v !== '').map(([k, v]) => `- ${k}: ${v}`), ''].join('\n');
}

function round(n: number, fields: Record<string, string>): string {
  const all = {
    Step: 'audit',
    Reviewed: 'Dispatch 1',
    Level: 'full',
    Verify: '0123456789ab passed',
    Agents: 'fidelity=bs-judgement, visibility=bs-review, undo=bs-review, constraints=bs-review',
    Outcome: 'clean',
    ...fields,
  };
  return [`### Review Round ${n}`, ...Object.entries(all).filter(([, v]) => v !== '').map(([k, v]) => `- ${k}: ${v}`), ''].join('\n');
}

const J = { Role: 'judgement', Agent: 'bs-judgement' };
const M = { Role: 'mechanical', Agent: 'bs-mechanical' };
const noVerifyFiles: VerifyLookup = () => undefined;
const details = (text: string, lookup: VerifyLookup = noVerifyFiles) =>
  checkRunLogRoles(text, lookup).map((f) => `${f.entry}: ${f.detail}`);
const log = (...entries: string[]) => entries.join('\n');
/** The findings `details` should give, in order, each as a pattern it must match. */
const matching = (...patterns: RegExp[]) => patterns.map((p) => expect.stringMatching(p));

/** A bounded build (Dispatch 1) whose audit round (Review Round 1) asked for changes. */
const buildWithFindings = [dispatch(1, {}), round(1, { Outcome: 'changes requested' })];
/** Dispatch `n`: a repair at `role` (judgement unless given) retrying review round `r`. */
const repairOf = (n: number, r: number, fields: Record<string, string> = {}) =>
  dispatch(n, { Work: 'repair', ...J, 'Retry of': `Review Round ${r}`, ...fields });
/** An investigate (Dispatch 1) whose red team round (Review Round 1) asked for changes. */
const refutedClaims = [dispatch(1, { Work: 'investigate', ...J }), round(1, { Step: 'redteam', Outcome: 'changes requested' })];

describe('dispatch entries', () => {
  it('pass with a role, the agent type dispatched, and a retry at the same role that names the failed dispatch', () => {
    const text = log(
      dispatch(1, { Work: 'build-chunk', ...J, Agent: 'senior', Outcome: 'pending', 'Finished at': 'pending' }),
      dispatch(2, { Outcome: 'failed', Detail: 'verify failed: test' }),
      dispatch(3, { 'Retry of': 'Dispatch 2' }),
    );
    expect(details(text)).toEqual([]);
  });

  it('refuse a missing Work, Role or Agent, and a role that does not exist or is review', () => {
    const text = log(dispatch(1, { Work: '', Role: '', Agent: '' }), dispatch(2, { Role: 'senior' }), dispatch(3, { Role: 'review', Agent: 'bs-review' }));
    expect(details(text)).toEqual(matching(
      /^Dispatch 1: .*no "- Work:" field/,
      /^Dispatch 1: .*no "- Role:" field/,
      /^Dispatch 1: .*no "- Agent:" field.*the agent type actually dispatched/,
      /^Dispatch 2: .*"Role: senior", which is not a role that does work: mechanical, bounded, judgement or second-opinion/,
      /^Dispatch 3: .*"Role: review".*Review Round/,
    ));
  });

  it('give second-opinion, the role of verify-game\'s second enumerator, its one retry, and send its second failure to the designer', () => {
    const second = { Work: 'enumerate', Role: 'second-opinion', Agent: 'bs-second-opinion' };
    const text = log(
      dispatch(1, { Work: 'enumerate', ...J }),
      dispatch(2, { ...second, Outcome: 'failed' }),
      dispatch(3, { Work: 'enumerate', ...J, 'Retry of': 'Dispatch 2' }),
      dispatch(4, { ...second, 'Retry of': 'Dispatch 2', Outcome: 'failed' }),
      dispatch(5, { Work: 'enumerate', ...J, 'Retry of': 'Dispatch 4' }),
    );
    expect(details(text)).toEqual(matching(
      /^Dispatch 3: .*retries Dispatch 2 at judgement, but Dispatch 2 failed at second-opinion.*its first failure there.*one retry at the same role, second-opinion/,
      /^Dispatch 5: .*Dispatch 4 failed at second-opinion.*second failure.*ask the designer/,
    ));
  });

  it('never treat the judgement and second-opinion enumerators of one slice as retries of each other', () => {
    const slice = 'enumerate rulebook/03-scoring.md';
    const second = { Role: 'second-opinion', Agent: 'bs-second-opinion' };
    const text = log(
      dispatch(1, { Work: slice, ...J, Outcome: 'failed' }),
      dispatch(2, { Work: slice, ...second, Outcome: 'failed' }),
      dispatch(3, { Work: slice, ...J, 'Retry of': 'Dispatch 1' }),
      dispatch(4, { Work: slice, ...second }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 4: .*does "enumerate rulebook\/03-scoring.md" at second-opinion after Dispatch 2 failed at second-opinion.*without naming it/),
    ]);
  });

  it('allow exactly one retry at the same role after a first failure, and refuse moving up before it', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { ...J, 'Retry of': 'Dispatch 1' }),
      dispatch(3, { 'Retry of': 'Dispatch 1' }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 2: .*retries Dispatch 1 at judgement, but Dispatch 1 failed at bounded\. It is its first failure there.*one retry at the same role, bounded, handed the failure output/),
    ]);
  });

  it('refuse a third attempt at the same role, and allow the move one role up after the second failure', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { 'Retry of': 'Dispatch 1', Outcome: 'failed' }),
      dispatch(3, { 'Retry of': 'Dispatch 2' }),
      dispatch(4, { ...J, 'Retry of': 'Dispatch 2' }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 3: .*retries Dispatch 2 at bounded, but Dispatch 2 failed at bounded\. Its work has now failed twice at bounded.*one role up, judgement.*`boardsmith agent bounded --escalate`/),
    ]);
  });

  it('refuse a move that skips a role, and a retry of a dispatch that did not fail or is not there', () => {
    const text = log(
      dispatch(1, { Work: 'rename', ...M, Outcome: 'failed' }),
      dispatch(2, { Work: 'rename', ...M, 'Retry of': 'Dispatch 1', Outcome: 'failed' }),
      dispatch(3, { Work: 'rename', ...J, 'Retry of': 'Dispatch 2' }),
      dispatch(4, { Outcome: 'done' }),
      dispatch(5, { ...J, 'Retry of': 'Dispatch 4' }),
      dispatch(6, { 'Retry of': 'Dispatch 9' }),
      dispatch(7, { 'Retry of': 'the last one' }),
    );
    expect(details(text)).toEqual(matching(
      /^Dispatch 3: .*failed twice at mechanical.*one role up, bounded/,
      /^Dispatch 5: .*Dispatch 4 did not fail \(Outcome: done\)/,
      /^Dispatch 6: .*no Dispatch 9 before it/,
      /^Dispatch 7: .*"Retry of: the last one".*"Dispatch N".*"Review Round N"/,
    ));
  });

  it('refuse failed work done again without naming the failure, at the same role or below, and a second retry of one failure', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, {}),
      dispatch(3, { ...M }),
      dispatch(4, { 'Retry of': 'Dispatch 1' }),
      dispatch(5, { 'Retry of': 'Dispatch 1' }),
    );
    expect(details(text)).toEqual(matching(
      /^Dispatch 2: .*does "build" at bounded after Dispatch 1 failed at bounded, without naming it.*one retry at the same role, bounded.*"Retry of: Dispatch 1"/,
      /^Dispatch 3: .*does "build" at mechanical after Dispatch 1 failed at bounded, without naming it/,
      /^Dispatch 5: .*Dispatch 1 was already answered by Dispatch 4/,
    ));
  });

  it('refuse a dispatch one role up that does not name the failure it answers', () => {
    const text = log(dispatch(1, { Outcome: 'failed' }), dispatch(2, { 'Retry of': 'Dispatch 1', Outcome: 'failed' }), dispatch(3, { ...J }));
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 3: .*does "build" at judgement after Dispatch 2 failed at bounded, without naming it.*`boardsmith agent bounded --escalate`.*"Retry of: Dispatch 2"/),
    ]);
  });

  it('say that a dispatch carrying on after a gate or context ceiling writes Retry of: none, when it names the failure again', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { 'Retry of': 'Dispatch 1', Outcome: 'context-ceiling' }),
      dispatch(3, { 'Retry of': 'Dispatch 1' }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 3: .*Dispatch 1 was already answered by Dispatch 2.*carries Dispatch 2's work on after .*writes "Retry of: none"/),
    ]);
  });

  /** A first failure (Dispatch 1), its retry (Dispatch 2) stopped by `stopped`, resumed by Dispatch 3, which fails. */
  const resumedRetry = (stopped: Record<string, string>, after: string) =>
    log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { 'Retry of': 'Dispatch 1', ...stopped }),
      dispatch(3, { Outcome: 'failed' }),
      after,
    );

  it('never grant a second retry to a retry resumed after a crash: a dispatch left pending is resumed, not retried', () => {
    const crash = { Outcome: 'pending', 'Finished at': 'pending' };
    expect(details(resumedRetry(crash, dispatch(4, { 'Retry of': 'Dispatch 3' })))).toEqual([
      expect.stringMatching(/^Dispatch 4: .*failed twice at bounded.*one role up, judgement/),
    ]);
    expect(details(resumedRetry(crash, dispatch(4, { ...J, 'Retry of': 'Dispatch 3' })))).toEqual([]);
  });

  it('never grant a second retry to a retry resumed after a context ceiling', () => {
    expect(details(resumedRetry({ Outcome: 'context-ceiling' }, dispatch(4, { 'Retry of': 'Dispatch 3' })))).toEqual([
      expect.stringMatching(/^Dispatch 4: .*failed twice at bounded/),
    ]);
  });

  it('send a second failure at judgement to the designer, and accept the dispatch that records their answer', () => {
    const twice = [dispatch(1, { Work: 'spec', ...J, Outcome: 'failed' }), dispatch(2, { Work: 'spec', ...J, 'Retry of': 'Dispatch 1', Outcome: 'failed' })];
    expect(details(log(...twice, dispatch(3, { Work: 'spec', ...J, 'Retry of': 'Dispatch 2' })))).toEqual([
      expect.stringMatching(/^Dispatch 3: .*Dispatch 2 failed at judgement, the top role, its second failure there.*ask the designer.*"- Designer answer:"/),
    ]);
    expect(details(log(...twice, dispatch(3, { Work: 'spec', ...J })))).toEqual([
      expect.stringMatching(/^Dispatch 3: .*does "spec" at judgement after Dispatch 2 failed at judgement, the top role, its second failure there.*ask the designer/),
    ]);
    expect(details(log(...twice, dispatch(3, { Work: 'spec', ...J, 'Designer answer': 'RULINGS.md Ruling 4' })))).toEqual([]);
  });

  it('refuse a designer answer standing in for the retry a first failure gets, or for the ladder below judgement', () => {
    const atJudgement = log(dispatch(1, { Work: 'spec', ...J, Outcome: 'failed' }), dispatch(2, { Work: 'spec', ...J, 'Designer answer': 'RULINGS.md Ruling 4' }));
    expect(details(atJudgement)).toEqual([expect.stringMatching(/^Dispatch 2: .*without naming it.*one retry at the same role, judgement.*"Retry of: Dispatch 1"/)]);
    const below = log(dispatch(1, { Outcome: 'failed' }), dispatch(2, { 'Designer answer': 'DECISIONS.md Decision 2' }));
    expect(details(below)).toEqual([expect.stringMatching(/^Dispatch 2: .*does "build" at bounded after Dispatch 1 failed at bounded, without naming it/)]);
  });

  it("let a build wait for test's verify: pending until the done gate, then failed naming the check, then a retry that names it", () => {
    const awaitingTest = dispatch(1, { Outcome: 'pending', 'Finished at': 'pending' });
    expect(details(log(awaitingTest))).toEqual([]);
    const failedAtTest = dispatch(1, { Outcome: 'failed', Detail: 'verify failed: mutation, 2 survivors in src/rules/trade.ts' });
    expect(details(log(failedAtTest, dispatch(2, { 'Retry of': 'Dispatch 1' })))).toEqual([]);
    expect(details(log(failedAtTest, dispatch(2, {})))).toEqual([expect.stringMatching(/^Dispatch 2: .*without naming it.*"Retry of: Dispatch 1"/)]);
  });

  it('tell a retry of one unit from the next unit\'s first dispatch by the unit in its Work', () => {
    const text = log(
      dispatch(1, { Work: 'transcribe rulebook.pdf pp. 1-8', ...J, Outcome: 'failed' }),
      dispatch(2, { Work: 'transcribe rulebook.pdf pp. 9-16', ...J }),
      dispatch(3, { Work: 'transcribe rulebook.pdf pp. 1-8', ...J }),
    );
    expect(details(text)).toEqual(matching(/^Dispatch 3: .*does "transcribe rulebook.pdf pp. 1-8" at judgement after Dispatch 1 failed/));
  });

  it('keep the role across a gate or a context ceiling, which are not failures', () => {
    const text = log(
      dispatch(1, { Outcome: 'context-ceiling' }),
      dispatch(2, { Outcome: 'gate', Detail: 'a rules question' }),
      dispatch(3, {}),
    );
    expect(details(text)).toEqual([]);
  });
});

describe('review rounds as the cause of a retry', () => {
  it('link each round to the dispatch it reviewed, and let a round that asked for changes start a retry at the same role', () => {
    const text = log(
      dispatch(1, {}),
      round(1, { Reviewed: 'Dispatch 1', Outcome: 'changes requested' }),
      repairOf(2, 1, { Role: 'bounded', Agent: 'bs-bounded' }),
      round(2, { Reviewed: 'Dispatch 2', Verify: 'fedcba987654 passed' }),
    );
    expect(details(text)).toEqual([]);
  });

  it('refuse a repair after a round asked for changes that does not name the round', () => {
    const text = log(...buildWithFindings, dispatch(2, { Work: 'repair' }), dispatch(3, { Work: 'build' }));
    expect(details(text)).toEqual(matching(
      /^Dispatch 2: .*does "repair" at bounded after Review Round 1 asked for changes to Dispatch 1's work at bounded, without naming it.*"Retry of: Review Round 1"/,
      /^Dispatch 3: .*does "build" at bounded after Review Round 1/,
    ));
  });

  it('refuse a retry of a round that did not ask for changes or is not there, and a first review failure sent up a role', () => {
    const text = log(
      dispatch(1, { ...M }),
      round(1, { Outcome: 'clean' }),
      dispatch(2, { Work: 'repair', 'Retry of': 'Review Round 1' }),
      dispatch(3, { Work: 'repair', 'Retry of': 'Review Round 7' }),
      round(2, { Outcome: 'changes requested' }),
      repairOf(4, 2, { Role: 'bounded', Agent: 'bs-bounded' }),
    );
    expect(details(text)).toEqual(matching(
      /^Dispatch 2: .*Review Round 1 did not ask for changes \(Outcome: clean\)/,
      /^Dispatch 3: .*no Review Round 7 before it/,
      /^Dispatch 4: .*retries Review Round 2 at bounded, but .*its first failure.*one retry at the same role, mechanical/,
    ));
  });
});

describe('the ladder across verify failures and review rounds (routing.md "When a Step Fails")', () => {
  const B = { Role: 'bounded', Agent: 'bs-bounded' };

  it('after a bounded build: one bounded repair, then judgement twice, then the designer', () => {
    const text = log(
      ...buildWithFindings,
      repairOf(2, 1, B),
      round(2, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      repairOf(3, 2),
      round(3, { Reviewed: 'Dispatch 3', Outcome: 'changes requested' }),
      repairOf(4, 3),
      round(4, { Reviewed: 'Dispatch 4', Outcome: 'changes requested' }),
      repairOf(5, 4),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 5: .*Review Round 4 asked for changes to Dispatch 4's work at judgement, the top role, its second failure there.*ask the designer/),
    ]);
  });

  it('refuse a third bounded attempt after the bounded repair is reviewed and changes are asked again', () => {
    const text = log(...buildWithFindings, repairOf(2, 1, B), round(2, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }), repairOf(3, 2, B));
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 3: .*failed twice at bounded.*one role up, judgement/)]);
  });

  it('count a verify failure and a review failure at one role together: the second goes one role up', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { 'Retry of': 'Dispatch 1' }),
      round(1, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      repairOf(3, 1, B),
    );
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 3: .*failed twice at bounded.*one role up, judgement/)]);
  });

  it('give red-team refuted claims one re-investigation at judgement, then the designer', () => {
    const text = log(
      ...refutedClaims,
      dispatch(2, { Work: 're-investigate', ...J, 'Retry of': 'Review Round 1' }),
      round(2, { Step: 'redteam', Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      dispatch(3, { Work: 're-investigate', ...J, 'Retry of': 'Review Round 2' }),
    );
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 3: .*its second failure there.*ask the designer/)]);
  });

  it('count a claim-quote-check refusal as a failure of the claims: its retry is their one retry at judgement', () => {
    const text = log(
      dispatch(1, { Work: 'investigate', ...J, Outcome: 'failed', Detail: 'claim-quote-check: claim 4 quote not at its citation' }),
      dispatch(2, { Work: 'investigate', ...J, 'Retry of': 'Dispatch 1' }),
      round(1, { Step: 'redteam', Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      dispatch(3, { Work: 're-investigate', ...J, 'Retry of': 'Review Round 1' }),
    );
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 3: .*its second failure there.*ask the designer/)]);
  });

  it('give a page range one re-transcription at judgement, whatever refused it, then the designer', () => {
    const range = 'transcribe rulebook.pdf pp. 9-16';
    const text = log(
      dispatch(1, { Work: range, ...J, Outcome: 'failed', Detail: 'verify-run-record refused: Source: names cards.pdf' }),
      dispatch(2, { Work: range, ...J, 'Retry of': 'Dispatch 1', Outcome: 'failed', Detail: 'the subagent returned no slice' }),
      dispatch(3, { Work: range, ...J, 'Retry of': 'Dispatch 2' }),
    );
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 3: .*its second failure there.*ask the designer/)]);
  });

  /**
   * A judgement build (Dispatch 1) whose review asked for changes, a repair retrying it (Dispatch 2)
   * that stopped with `stopped`, carried on by Dispatch 3 at the same role, whose review asked for
   * changes again, and a Dispatch 4 retrying that round: a third judgement attempt, since Dispatch 3
   * resumes the one retry rather than starting a fresh one.
   */
  const resumedRepair = (stopped: Record<string, string>) =>
    log(
      dispatch(1, { ...J }),
      round(1, { Reviewed: 'Dispatch 1', Outcome: 'changes requested' }),
      repairOf(2, 1, stopped),
      dispatch(3, { Work: 'repair', ...J }),
      round(2, { Reviewed: 'Dispatch 3', Outcome: 'changes requested' }),
      repairOf(4, 2),
    );

  it('carry the attempt count across a context ceiling or a crash, so a resumed attempt is not a fresh one', () => {
    const designer = [expect.stringMatching(/^Dispatch 4: .*its second failure there.*ask the designer/)];
    expect(details(resumedRepair({ Outcome: 'context-ceiling' }))).toEqual(designer);
    expect(details(resumedRepair({ Outcome: 'pending', 'Finished at': 'pending' }))).toEqual(designer);
  });
});

describe('review rounds', () => {
  it('pass when they record the step, the dispatch reviewed, level, the passing verify they started from, the agents and the outcome', () => {
    const text = log(...buildWithFindings, round(2, { Verify: 'fedcba9876543210 passed', Level: 'light', Agents: 'bs-review' }));
    expect(details(text)).toEqual([]);
  });

  it('refuse a round that did not start from a passing verify', () => {
    const text = log(dispatch(1, {}), round(1, { Verify: '' }), round(2, { Verify: '0123456789ab failed' }), round(3, { Verify: 'pending' }));
    const found = details(text);
    expect(found).toHaveLength(3);
    for (const line of found) expect(line).toMatch(/review-gate/);
    expect(found[0]).toMatch(/^Review Round 1: .*no "- Verify:" field/);
  });

  it('refuse a round with no link to the dispatch it reviewed, or a link to one that is not there or did not finish', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { Work: 'repair', Outcome: 'pending', 'Finished at': 'pending', 'Retry of': 'Dispatch 1' }),
      round(1, { Reviewed: '' }),
      round(2, { Reviewed: 'Dispatch 5' }),
      round(3, { Reviewed: 'Dispatch 1' }),
      round(4, { Reviewed: 'Dispatch 2' }),
      round(5, { Reviewed: 'the build' }),
    );
    expect(details(text)).toEqual(matching(
      /^Review Round 1: .*no "- Reviewed:" field.*"Dispatch N"/,
      /^Review Round 2: .*no Dispatch 5 before it/,
      /^Review Round 3: .*Dispatch 1, whose Outcome is failed.*only work that finished and passed its checks is reviewed/,
      /^Review Round 4: .*Dispatch 2, whose Outcome is pending/,
      /^Review Round 5: .*"Reviewed: the build".*"Dispatch N"/,
    ));
  });

  it('refuse a round that names a dispatch a later finished dispatch carried on from, which would start the count again', () => {
    const text = log(
      dispatch(1, { ...J }),
      round(1, { Reviewed: 'Dispatch 1', Outcome: 'changes requested' }),
      repairOf(2, 1),
      round(2, { Reviewed: 'Dispatch 1', Outcome: 'changes requested' }),
      repairOf(3, 2),
    );
    expect(details(text)).toEqual(matching(
      /^Review Round 2: .*reviews Dispatch 1, but Dispatch 2 carried its work on and finished.*"Reviewed: Dispatch 2"/,
      /^Dispatch 3: .*Review Round 2, which does not name the dispatch it reviewed/,
    ));
  });

  it('refuse an unknown step, level or outcome, and a round with no agents', () => {
    const text = log(dispatch(1, {}), round(1, { Step: 'playtest', Level: 'none', Outcome: 'fine', Agents: '' }));
    const found = details(text);
    expect(found).toHaveLength(4);
    expect(found.join('\n')).toMatch(/"Step: playtest", which is not a review step: redteam, audit, final-acceptance or cross-chunk/);
    expect(found.join('\n')).toMatch(/"Level: none".*a change review-gate sized "none" has no review round/);
    expect(found.join('\n')).toMatch(/"Outcome: fine", which must be pending, clean or changes requested/);
    expect(found.join('\n')).toMatch(/no "- Agents:" field/);
  });

  it('refuse a round number used twice', () => {
    expect(details(log(dispatch(1, {}), round(1, {}), round(1, {})))).toEqual([expect.stringMatching(/^Review Round 1: .*used twice/)]);
  });

  it('never read one entry\'s field from the entry after it', () => {
    const text = log(dispatch(1, {}), round(1, { Outcome: '' }), dispatch(2, { Outcome: 'done' }));
    expect(details(text)).toEqual([expect.stringMatching(/^Review Round 1: .*no "- Outcome:" field/)]);
    const [first] = runLogEntries(text);
    expect(first.body).not.toMatch(/Review Round/);
  });
});

describe('a review round\'s verify, confirmed against the result on file (#454)', () => {
  const COMMIT = '0123456789abcdef0123456789abcdef01234567';
  const result = (passed: boolean, cleanTree = true): VerifyResult =>
    buildVerifyResult({
      commit: COMMIT,
      cleanTree,
      base: { ref: 'main', commit: 'f'.repeat(40) },
      chunk: 'core-loop',
      checks: [{ name: 'test', passed, summary: passed ? '12 passed' : '1 failed' }],
    });
  const file = `.boardsmith/verify/${COMMIT}.json`;
  const text = log(dispatch(1, {}), round(1, { Verify: '0123456789ab passed' }));

  it('lists the commit each round names, so the caller can look its result up', () => {
    expect(reviewRoundCommits(log(text, round(2, { Verify: 'fedcba987654 passed' }), round(3, { Verify: 'pending' })))).toEqual([
      '0123456789ab',
      'fedcba987654',
    ]);
  });

  it('passes a round whose result on file passed on a clean tree, and one with no result on this machine', () => {
    expect(details(text, (c) => (c === '0123456789ab' ? { file, result: result(true) } : undefined))).toEqual([]);
    expect(details(text, noVerifyFiles)).toEqual([]);
  });

  it('refuses a round whose result on file failed, ran on a dirty tree, cannot be read, or is ambiguous', () => {
    expect(details(text, () => ({ file, result: result(false) }))).toEqual([
      expect.stringMatching(/^Review Round 1: Review Round 1 says "Verify: 0123456789ab passed", but the latest verify of that commit \(\.boardsmith\/verify\/0123456789abcdef0123456789abcdef01234567\.json\) failed\. Run `boardsmith verify` on that commit again/),
    ]);
    expect(details(text, () => ({ file, result: result(true, false) }))).toEqual([expect.stringMatching(/uncommitted changes/)]);
    expect(details(text, () => ({ file, result: 'unreadable' }))).toEqual([expect.stringMatching(/could not be read/)]);
    expect(details(text, () => ({ ambiguous: [COMMIT, '0123456789ab' + 'f'.repeat(28)] }))).toEqual([expect.stringMatching(/matches more than one verify result/)]);
  });
});
