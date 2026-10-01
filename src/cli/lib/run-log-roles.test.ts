import { describe, expect, it } from 'vitest';
import { type VerifyLookup, checkRunLogRoles, reviewRoundCommits, runLogEntries } from './run-log-roles.js';
import { type VerifyResult, buildVerifyResult } from './verify-result.js';

/**
 * The run log's record of who did the work and how review went (#454): each dispatch's role and
 * agent type, escalation one role at a time from a failed dispatch or a review round that asked for
 * changes, routing.md's three named exceptions at judgement, and each review round's link to the
 * dispatch it reviewed and the verify result it started from.
 */

function dispatch(n: number, fields: Record<string, string>): string {
  const all = {
    Work: 'build',
    Role: 'bounded',
    Agent: 'bs-bounded',
    'Escalated from': 'none',
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
const noVerifyFiles: VerifyLookup = () => undefined;
const details = (text: string, lookup: VerifyLookup = noVerifyFiles) =>
  checkRunLogRoles(text, lookup).map((f) => `${f.entry}: ${f.detail}`);
const log = (...entries: string[]) => entries.join('\n');
/** The findings `details` should give, in order, each as a pattern it must match. */
const matching = (...patterns: RegExp[]) => patterns.map((p) => expect.stringMatching(p));

/** A bounded build (Dispatch 1) whose audit round (Review Round 1) asked for changes. */
const buildWithFindings = [dispatch(1, {}), round(1, { Outcome: 'changes requested' })];
/** Dispatch `n`: a repair at judgement answering review round `r`. */
const repairOf = (n: number, r: number, fields: Record<string, string> = {}) =>
  dispatch(n, { Work: 'repair', ...J, 'Escalated from': `Review Round ${r}`, ...fields });
/** An investigate (Dispatch 1) whose red team round (Review Round 1) asked for changes. */
const refutedClaims = [dispatch(1, { Work: 'investigate', ...J }), round(1, { Step: 'redteam', Outcome: 'changes requested' })];

describe('dispatch entries', () => {
  it('pass with a role, the agent type dispatched, and an escalation one role up from a failed dispatch', () => {
    const text = log(
      dispatch(1, { Work: 'build-chunk', ...J, Agent: 'senior', Outcome: 'pending', 'Finished at': 'pending' }),
      dispatch(2, { Outcome: 'failed', Detail: 'verify failed: test' }),
      dispatch(3, { ...J, Agent: 'senior', 'Escalated from': 'Dispatch 2' }),
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

  it('accept second-opinion, the role of verify-game\'s second enumerator, which nothing escalates from', () => {
    const text = log(
      dispatch(1, { Work: 'enumerate', ...J }),
      dispatch(2, { Work: 'enumerate', Role: 'second-opinion', Agent: 'bs-second-opinion', Outcome: 'failed' }),
      dispatch(3, { Work: 'enumerate', ...J, 'Escalated from': 'Dispatch 2' }),
    );
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 3: .*Dispatch 2 failed at second-opinion.*ask the designer/)]);
  });

  it('never treat the judgement and second-opinion enumerators of one slice as retries of each other', () => {
    const slice = 'enumerate rulebook/03-scoring.md';
    const second = { Role: 'second-opinion', Agent: 'bs-second-opinion' };
    const text = log(
      dispatch(1, { Work: slice, ...J, Outcome: 'failed' }),
      dispatch(2, { Work: slice, ...second, Outcome: 'failed' }),
      dispatch(3, { Work: slice, ...J, 'Designer answer': 'RULINGS.md Ruling 2' }),
      dispatch(4, { Work: slice, ...second }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 4: .*retries "enumerate rulebook\/03-scoring.md" at second-opinion after Dispatch 2 failed at second-opinion/),
    ]);
  });

  it('refuse an escalation that skips a role, or starts from a dispatch that did not fail or is not there', () => {
    const text = log(
      dispatch(1, { Work: 'rename', Role: 'mechanical', Agent: 'bs-mechanical', Outcome: 'failed' }),
      dispatch(2, { Work: 'rename', ...J, 'Escalated from': 'Dispatch 1' }),
      dispatch(3, { Outcome: 'done' }),
      dispatch(4, { ...J, 'Escalated from': 'Dispatch 3' }),
      dispatch(5, { 'Escalated from': 'Dispatch 9' }),
      dispatch(6, { 'Escalated from': 'the last one' }),
    );
    expect(details(text)).toEqual(matching(
      /^Dispatch 2: .*escalates from Dispatch 1 \(mechanical\), so it must be the next role up, bounded, not judgement/,
      /^Dispatch 4: .*Dispatch 3 did not fail \(Outcome: done\)/,
      /^Dispatch 5: .*no Dispatch 9 before it/,
      /^Dispatch 6: .*"Escalated from: the last one".*"Dispatch N".*"Review Round N"/,
    ));
  });

  it('refuse a retry of failed work at the same role or below, and a second escalation from one failure', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, {}),
      dispatch(3, { Role: 'mechanical', Agent: 'bs-mechanical' }),
      dispatch(4, { ...J, 'Escalated from': 'Dispatch 1' }),
      dispatch(5, { ...J, 'Escalated from': 'Dispatch 1' }),
    );
    expect(details(text)).toEqual(matching(
      /^Dispatch 2: .*retries "build" at bounded after Dispatch 1 failed at bounded.*one role up.*"Escalated from: Dispatch 1"/,
      /^Dispatch 3: .*retries "build" at mechanical after Dispatch 1 failed at bounded/,
      /^Dispatch 5: .*Dispatch 1 was already answered by Dispatch 4/,
    ));
  });

  it('say that a dispatch carrying on after a gate or context ceiling writes Escalated from: none, when it names the failure again', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { ...J, 'Escalated from': 'Dispatch 1', Outcome: 'context-ceiling' }),
      dispatch(3, { ...J, 'Escalated from': 'Dispatch 1' }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 3: .*Dispatch 1 was already answered by Dispatch 2.*carries Dispatch 2's work on after .*writes "Escalated from: none"/),
    ]);
  });

  it('refuse an escalation from judgement for work that is not a named exception: after judgement the designer decides', () => {
    const text = log(dispatch(1, { Work: 'spec', ...J, Outcome: 'failed' }), dispatch(2, { Work: 'spec', ...J, 'Escalated from': 'Dispatch 1' }));
    expect(details(text)).toEqual([
      expect.stringMatching(
        /^Dispatch 2: .*Dispatch 1 failed at judgement, the top role, and "spec" is not one of the named exceptions.*re-investigate or a repair.*quote-fix.*re-transcription of a page range verify-run-record refused.*ask the designer/,
      ),
    ]);
  });

  it('refuse a dispatch one role up that does not name the failure it answers', () => {
    const text = log(dispatch(1, { Outcome: 'failed' }), dispatch(2, { ...J }));
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 2: .*does "build" at judgement after Dispatch 1 failed at bounded, without naming it.*"Escalated from: Dispatch 1"/),
    ]);
  });

  it("let a build wait for test's verify: pending until the done gate, then failed naming the check, then a build at judgement that names it", () => {
    const awaitingTest = dispatch(1, { Outcome: 'pending', 'Finished at': 'pending' });
    expect(details(log(awaitingTest))).toEqual([]);
    const failedAtTest = dispatch(1, { Outcome: 'failed', Detail: 'verify failed: mutation, 2 survivors in src/rules/trade.ts' });
    expect(details(log(failedAtTest, dispatch(2, { ...J, 'Escalated from': 'Dispatch 1' })))).toEqual([]);
    expect(details(log(failedAtTest, dispatch(2, { ...J })))).toEqual([expect.stringMatching(/^Dispatch 2: .*without naming it.*"Escalated from: Dispatch 1"/)]);
  });

  it('refuse the same work at judgement again unless the dispatch records where the designer answered', () => {
    const refused = log(dispatch(1, { Work: 'spec', ...J, Outcome: 'failed' }), dispatch(2, { Work: 'spec', ...J }));
    expect(details(refused)).toEqual([
      expect.stringMatching(/^Dispatch 2: .*retries "spec" at judgement after Dispatch 1 failed at judgement, the top role.*ask the designer.*"- Designer answer:"/),
    ]);
    const answered = log(
      dispatch(1, { Work: 'spec', ...J, Outcome: 'failed' }),
      dispatch(2, { Work: 'spec', ...J, 'Designer answer': 'RULINGS.md Ruling 4' }),
    );
    expect(details(answered)).toEqual([]);
  });

  it('refuse a designer answer standing in for the ladder below judgement', () => {
    const text = log(dispatch(1, { Outcome: 'failed' }), dispatch(2, { 'Designer answer': 'DECISIONS.md Decision 2' }));
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 2: .*retries "build" at bounded after Dispatch 1 failed at bounded.*one role up/)]);
  });

  it('tell a retry of one unit from the next unit\'s first dispatch by the unit in its Work', () => {
    const text = log(
      dispatch(1, { Work: 'transcribe rulebook.pdf pp. 1-8', ...J, Outcome: 'failed' }),
      dispatch(2, { Work: 'transcribe rulebook.pdf pp. 9-16', ...J }),
      dispatch(3, { Work: 'transcribe rulebook.pdf pp. 1-8', ...J }),
    );
    expect(details(text)).toEqual(matching(/^Dispatch 3: .*retries "transcribe rulebook.pdf pp. 1-8" at judgement after Dispatch 1 failed/));
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

describe('review rounds as the cause of an escalation', () => {
  it('link each round to the dispatch it reviewed, and let a round that asked for changes start an escalation one role up', () => {
    const text = log(
      dispatch(1, {}),
      round(1, { Reviewed: 'Dispatch 1', Outcome: 'changes requested' }),
      repairOf(2, 1),
      round(2, { Reviewed: 'Dispatch 2', Verify: 'fedcba987654 passed' }),
    );
    expect(details(text)).toEqual([]);
  });

  it('refuse a repair at the reviewed role after a round asked for changes, without an escalation', () => {
    const text = log(...buildWithFindings, dispatch(2, { Work: 'repair' }), dispatch(3, { Work: 'build' }));
    expect(details(text)).toEqual(matching(
      /^Dispatch 2: .*retries "repair" at bounded after Review Round 1 asked for changes to Dispatch 1's work at bounded.*`boardsmith agent bounded --escalate`.*"Escalated from: Review Round 1"/,
      /^Dispatch 3: .*retries "build" at bounded after Review Round 1/,
    ));
  });

  it('refuse an escalation from a round that did not ask for changes, is not there, or skips a role', () => {
    const text = log(
      dispatch(1, { Role: 'mechanical', Agent: 'bs-mechanical' }),
      round(1, { Outcome: 'clean' }),
      dispatch(2, { Work: 'repair', 'Escalated from': 'Review Round 1' }),
      dispatch(3, { Work: 'repair', 'Escalated from': 'Review Round 7' }),
      round(2, { Outcome: 'changes requested' }),
      repairOf(4, 2),
    );
    expect(details(text)).toEqual(matching(
      /^Dispatch 2: .*Review Round 1 did not ask for changes \(Outcome: clean\)/,
      /^Dispatch 3: .*no Review Round 7 before it/,
      /^Dispatch 4: .*escalates from Review Round 2 \(mechanical\), so it must be the next role up, bounded, not judgement/,
    ));
  });
});

describe('the named exceptions at judgement (routing.md "When a Step Fails")', () => {
  it('give a repair one more judgement round, and send the next failure to the designer: three audit rounds after a bounded build', () => {
    const text = log(
      ...buildWithFindings,
      repairOf(2, 1),
      round(2, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      repairOf(3, 2),
      round(3, { Reviewed: 'Dispatch 3', Outcome: 'changes requested' }),
      repairOf(4, 3),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 4: .*already had its one more judgement round \(Dispatch 3\).*No step gets a third round.*ask the designer/),
    ]);
  });

  it('count audit findings on work already at judgement as the repair exception', () => {
    const text = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { ...J, 'Escalated from': 'Dispatch 1' }),
      round(1, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      repairOf(3, 1),
      round(2, { Reviewed: 'Dispatch 3', Outcome: 'changes requested' }),
      repairOf(4, 2),
    );
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 4: .*already had its one more judgement round \(Dispatch 3\)/)]);
  });

  it('give a repair whose verify failed at judgement its one more round, but not a build', () => {
    const repair = log(
      ...buildWithFindings,
      repairOf(2, 1, { Outcome: 'failed' }),
      dispatch(3, { Work: 'repair', ...J, 'Escalated from': 'Dispatch 2' }),
    );
    expect(details(repair)).toEqual([]);
    const build = log(
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, { ...J, 'Escalated from': 'Dispatch 1', Outcome: 'failed' }),
      dispatch(3, { Work: 'repair', ...J, 'Escalated from': 'Dispatch 2' }),
    );
    expect(details(build)).toEqual([expect.stringMatching(/^Dispatch 3: .*one more judgement round is for a repair after an audit, final-acceptance or cross-chunk round asked for changes, or after a repair's verify failed.*ask the designer/)]);
  });

  it('give a red-team re-investigation one more judgement round, then the designer', () => {
    const text = log(
      ...refutedClaims,
      dispatch(2, { Work: 're-investigate', ...J, 'Escalated from': 'Review Round 1' }),
      round(2, { Step: 'redteam', Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      dispatch(3, { Work: 're-investigate', ...J, 'Escalated from': 'Review Round 2' }),
    );
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 3: .*already had its one more judgement round \(Dispatch 2\)/)]);
  });

  it('refuse a re-investigation after an audit round, and a repair after a red team round', () => {
    const text = log(
      ...refutedClaims,
      repairOf(2, 1),
      dispatch(3, { Work: 'build', ...J }),
      round(2, { Reviewed: 'Dispatch 3', Outcome: 'changes requested' }),
      dispatch(4, { Work: 're-investigate', ...J, 'Escalated from': 'Review Round 2' }),
    );
    expect(details(text)).toEqual(matching(
      /^Dispatch 2: .*one more judgement round is for a repair after an audit, final-acceptance or cross-chunk round asked for changes/,
      /^Dispatch 4: .*one more judgement round is for a re-investigation after a red team round asked for changes/,
    ));
  });

  it('give a claim-quote-check refusal one narrower quote-fix at judgement, then the designer', () => {
    const text = log(
      dispatch(1, { Work: 'investigate', ...J, Outcome: 'failed', Detail: 'claim-quote-check: claim 4 quote not at its citation' }),
      dispatch(2, { Work: 'quote-fix', ...J, 'Escalated from': 'Dispatch 1', Outcome: 'failed' }),
      dispatch(3, { Work: 'quote-fix', ...J, 'Escalated from': 'Dispatch 2' }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 3: .*A quote-fix answers a claim-quote-check refusal of an investigate or re-investigate dispatch.*ask the designer/),
    ]);
  });

  it('keep the exceptions apart, and refuse a second re-investigation reached through a quote-fix', () => {
    const text = log(
      ...refutedClaims,
      dispatch(2, { Work: 're-investigate', ...J, 'Escalated from': 'Review Round 1', Outcome: 'failed' }),
      dispatch(3, { Work: 'quote-fix', ...J, 'Escalated from': 'Dispatch 2' }),
      round(2, { Step: 'redteam', Reviewed: 'Dispatch 3', Outcome: 'changes requested' }),
      dispatch(4, { Work: 're-investigate', ...J, 'Escalated from': 'Review Round 2' }),
    );
    expect(details(text)).toEqual([expect.stringMatching(/^Dispatch 4: .*already had its one more judgement round \(Dispatch 2\)/)]);
  });

  /**
   * A repair's one more judgement round (Dispatch 3) that stopped with `stopped`, carried on by
   * Dispatch 4 at the same role, whose review asked for changes again, and a Dispatch 5 escalating
   * from that round: a third round, if Dispatch 4 counts as resuming Dispatch 3.
   */
  const resumedExceptionRound = (stopped: Record<string, string>) =>
    log(
      ...buildWithFindings,
      repairOf(2, 1),
      round(2, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      repairOf(3, 2, stopped),
      dispatch(4, { Work: 'repair', ...J }),
      round(3, { Reviewed: 'Dispatch 4', Outcome: 'changes requested' }),
      repairOf(5, 3),
    );
  const thirdRound = [expect.stringMatching(/^Dispatch 5: .*already had its one more judgement round \(Dispatch 3\)/)];

  it('carry an exception round across a context ceiling, so a resumed round is not a fresh one', () => {
    expect(details(resumedExceptionRound({ Outcome: 'context-ceiling' }))).toEqual(thirdRound);
  });

  it('carry an exception round across a crash: a dispatch left pending is resumed by the next of the same work at the same role', () => {
    expect(details(resumedExceptionRound({ Outcome: 'pending', 'Finished at': 'pending' }))).toEqual(thirdRound);
  });

  it('give a page range verify-run-record refused one re-transcription at judgement, the third named exception, then the designer', () => {
    const range = 'transcribe rulebook.pdf pp. 9-16';
    const refused = { Work: range, ...J, Outcome: 'failed', Detail: 'verify-run-record refused: Source: names cards.pdf' };
    const text = log(
      dispatch(1, refused),
      dispatch(2, { ...refused, 'Escalated from': 'Dispatch 1' }),
      dispatch(3, { Work: range, ...J, 'Escalated from': 'Dispatch 2' }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 3: .*that range already had its one re-transcription \(Dispatch 2\).*ask the designer/),
    ]);
    const otherRange = log(dispatch(1, refused), dispatch(2, { Work: 'transcribe rulebook.pdf pp. 1-8', ...J, 'Escalated from': 'Dispatch 1' }));
    expect(details(otherRange)).toEqual([
      expect.stringMatching(/^Dispatch 2: .*re-transcription.*"transcribe rulebook.pdf pp. 1-8".*Dispatch 1.*"transcribe rulebook.pdf pp. 9-16"/),
    ]);
  });

  it('refuse an unlinked judgement repair after a review failure at judgement, naming the exception and the designer', () => {
    const text = log(
      ...buildWithFindings,
      repairOf(2, 1),
      round(2, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      dispatch(3, { Work: 'repair', ...J }),
    );
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 3: .*after Review Round 2 asked for changes to Dispatch 2's work at judgement, the top role.*one more judgement round.*"Escalated from: Review Round 2".*"- Designer answer:"/),
    ]);
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
      dispatch(2, { Work: 'repair', Outcome: 'pending', 'Finished at': 'pending', ...J, 'Escalated from': 'Dispatch 1' }),
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

  it('refuse a round that names a dispatch a later finished dispatch carried on from, which would start the exception count again', () => {
    const text = log(
      ...buildWithFindings,
      repairOf(2, 1),
      round(2, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      repairOf(3, 2),
      round(3, { Reviewed: 'Dispatch 2', Outcome: 'changes requested' }),
      repairOf(4, 3),
    );
    expect(details(text)).toEqual(matching(
      /^Review Round 3: .*reviews Dispatch 2, but Dispatch 3 carried its work on and finished.*"Reviewed: Dispatch 3"/,
      /^Dispatch 4: .*Review Round 3, which does not name the dispatch it reviewed/,
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
      expect.stringMatching(/^Review Round 1: Review Round 1 says "Verify: 0123456789ab passed", but the verify result on file for that commit \(\.boardsmith\/verify\/0123456789abcdef0123456789abcdef01234567\.json\) failed/),
    ]);
    expect(details(text, () => ({ file, result: result(true, false) }))).toEqual([expect.stringMatching(/uncommitted changes/)]);
    expect(details(text, () => ({ file, result: 'unreadable' }))).toEqual([expect.stringMatching(/could not be read/)]);
    expect(details(text, () => ({ ambiguous: [COMMIT, '0123456789ab' + 'f'.repeat(28)] }))).toEqual([expect.stringMatching(/matches more than one verify result/)]);
  });
});
