import { describe, expect, it } from 'vitest';
import { checkRunLogRoles } from './run-log-roles.js';

/**
 * The run log's record of who did the work and how review went (#454): each dispatch's role and
 * agent type, escalation one role at a time, and each review round's verify result.
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
    Level: 'full',
    Verify: '0123456789ab passed',
    Agents: 'fidelity=bs-judgement, visibility=bs-review, undo=bs-review, constraints=bs-review',
    Outcome: 'clean',
    ...fields,
  };
  return [`### Review Round ${n}`, ...Object.entries(all).filter(([, v]) => v !== '').map(([k, v]) => `- ${k}: ${v}`), ''].join('\n');
}

const details = (text: string) => checkRunLogRoles(text).map((f) => `${f.entry}: ${f.detail}`);

describe('dispatch entries', () => {
  it('pass with a role, the agent type dispatched, and an escalation one role up from a failed dispatch', () => {
    const text = [
      dispatch(1, { Work: 'build-chunk', Role: 'judgement', Agent: 'senior', Outcome: 'pending', 'Finished at': 'pending' }),
      dispatch(2, { Outcome: 'failed', Detail: 'verify failed: test' }),
      dispatch(3, { Work: 'build', Role: 'judgement', Agent: 'senior', 'Escalated from': 'Dispatch 2' }),
    ].join('\n');
    expect(details(text)).toEqual([]);
  });

  it('refuse a missing Work, Role or Agent, and a role that does not exist or is review', () => {
    const text = [
      dispatch(1, { Work: '', Role: '', Agent: '' }),
      dispatch(2, { Role: 'senior' }),
      dispatch(3, { Role: 'review', Agent: 'bs-review' }),
    ].join('\n');
    const found = details(text);
    expect(found).toHaveLength(5);
    expect(found[0]).toMatch(/^Dispatch 1: .*no "- Work:" field/);
    expect(found[1]).toMatch(/^Dispatch 1: .*no "- Role:" field/);
    expect(found[2]).toMatch(/^Dispatch 1: .*no "- Agent:" field.*the agent type actually dispatched/);
    expect(found[3]).toMatch(/^Dispatch 2: .*"Role: senior", which is not a role that does work: mechanical, bounded or judgement/);
    expect(found[4]).toMatch(/^Dispatch 3: .*"Role: review".*Review Round/);
  });

  it('refuse an escalation that skips a role, stays at the same role, or starts from a dispatch that did not fail', () => {
    const text = [
      dispatch(1, { Role: 'mechanical', Agent: 'bs-mechanical', Outcome: 'failed' }),
      dispatch(2, { Role: 'judgement', Agent: 'bs-judgement', 'Escalated from': 'Dispatch 1' }),
      dispatch(3, { Outcome: 'done' }),
      dispatch(4, { Role: 'judgement', Agent: 'bs-judgement', 'Escalated from': 'Dispatch 3' }),
      dispatch(5, { 'Escalated from': 'Dispatch 9' }),
    ].join('\n');
    const found = details(text);
    expect(found).toHaveLength(3);
    expect(found[0]).toMatch(/^Dispatch 2: .*escalates from Dispatch 1 \(mechanical\), so it must be the next role up, bounded, not judgement/);
    expect(found[1]).toMatch(/^Dispatch 4: .*Dispatch 3 did not fail/);
    expect(found[2]).toMatch(/^Dispatch 5: .*no Dispatch 9 before it/);
  });

  it('refuse a retry of failed work at the same role below judgement, and a second escalation from one failure', () => {
    const text = [
      dispatch(1, { Outcome: 'failed' }),
      dispatch(2, {}),
      dispatch(3, { Role: 'judgement', Agent: 'bs-judgement', 'Escalated from': 'Dispatch 1' }),
      dispatch(4, { Role: 'judgement', Agent: 'bs-judgement', 'Escalated from': 'Dispatch 1' }),
    ].join('\n');
    const found = details(text);
    expect(found).toHaveLength(2);
    expect(found[0]).toMatch(/^Dispatch 2: .*retries "build" at bounded after Dispatch 1 failed there.*one role up/);
    expect(found[1]).toMatch(/^Dispatch 4: .*Dispatch 1 was already escalated by Dispatch 3/);
  });

  it('refuse an escalation from judgement: after judgement the designer decides', () => {
    const text = [
      dispatch(1, { Role: 'judgement', Agent: 'bs-judgement', Outcome: 'failed' }),
      dispatch(2, { Role: 'judgement', Agent: 'bs-judgement', 'Escalated from': 'Dispatch 1' }),
    ].join('\n');
    expect(details(text)).toEqual([
      expect.stringMatching(/^Dispatch 2: .*Dispatch 1 failed at judgement, the top role.*ask the designer/),
    ]);
  });

  it('allow the same work at judgement again once the designer has answered', () => {
    const text = [dispatch(1, { Role: 'judgement', Agent: 'bs-judgement', Outcome: 'failed' }), dispatch(2, { Role: 'judgement', Agent: 'bs-judgement' })].join('\n');
    expect(details(text)).toEqual([]);
  });
});

describe('review rounds', () => {
  it('pass when they record the step, level, the passing verify they started from, the agents and the outcome', () => {
    const text = [round(1, { Outcome: 'changes requested' }), round(2, { Verify: 'fedcba9876543210 passed', Level: 'light', Agents: 'bs-review' })].join('\n');
    expect(details(text)).toEqual([]);
  });

  it('refuse a round that did not start from a passing verify', () => {
    const text = [round(1, { Verify: '' }), round(2, { Verify: '0123456789ab failed' }), round(3, { Verify: 'pending' })].join('\n');
    const found = details(text);
    expect(found).toHaveLength(3);
    for (const line of found) expect(line).toMatch(/review-gate/);
    expect(found[0]).toMatch(/^Review Round 1: .*no "- Verify:" field/);
  });

  it('refuse an unknown step, level or outcome, and a round with no agents', () => {
    const text = round(1, { Step: 'playtest', Level: 'none', Outcome: 'fine', Agents: '' });
    const found = details(text);
    expect(found).toHaveLength(4);
    expect(found.join('\n')).toMatch(/"Step: playtest", which is not a review step: redteam, audit, final-acceptance or cross-chunk/);
    expect(found.join('\n')).toMatch(/"Level: none".*a change review-gate sized "none" has no review round/);
    expect(found.join('\n')).toMatch(/"Outcome: fine", which must be pending, clean or changes requested/);
    expect(found.join('\n')).toMatch(/no "- Agents:" field/);
  });

  it('refuse a round number used twice', () => {
    expect(details([round(1, {}), round(1, {})].join('\n'))).toEqual([expect.stringMatching(/^Review Round 1: .*used twice/)]);
  });
});
