import { describe, expect, it } from 'vitest';
import {
  ESCALATION_LADDER,
  ROLES,
  agentTypeFor,
  agentsBlockProblems,
  defaultAgentType,
  nextRole,
  parseRole,
} from './agent-roles.js';

describe('the roles (#454)', () => {
  it('are mechanical, bounded, judgement, review and second-opinion, and only the first three climb', () => {
    expect([...ROLES]).toEqual(['mechanical', 'bounded', 'judgement', 'review', 'second-opinion']);
    expect([...ESCALATION_LADDER]).toEqual(['mechanical', 'bounded', 'judgement']);
  });

  it('each default to the bs- agent BoardSmith installs for it', () => {
    expect(ROLES.map(defaultAgentType)).toEqual(['bs-mechanical', 'bs-bounded', 'bs-judgement', 'bs-review', 'bs-second-opinion']);
  });

  it('climb one rung at a time, and judgement is the top', () => {
    expect(nextRole('mechanical')).toBe('bounded');
    expect(nextRole('bounded')).toBe('judgement');
    expect(nextRole('judgement')).toBeUndefined();
  });

  it('parseRole names every role when it refuses one, and suggests the near miss', () => {
    expect(parseRole('review')).toBe('review');
    expect(() => parseRole('judgment')).toThrow(/Unknown role "judgment"; did you mean "judgement"\? The roles are mechanical, bounded, judgement, review and second-opinion\./);
    expect(() => parseRole('senior')).toThrow(/Unknown role "senior"\. The roles are mechanical, bounded, judgement, review and second-opinion\./);
    expect(() => parseRole('../review')).toThrow(/Unknown role "\.\.\/review"/);
  });
});

describe('the "agents" block of boardsmith.json (#454)', () => {
  it('is optional: with none, every role is dispatched as its bs- default', () => {
    expect(agentsBlockProblems(undefined)).toEqual([]);
    expect(agentTypeFor({}, 'judgement')).toBe('bs-judgement');
  });

  it('maps a named role to the agent type given, and leaves the rest at their defaults', () => {
    const config = { agents: { judgement: 'senior', review: 'reviewer' } };
    expect(agentsBlockProblems(config.agents)).toEqual([]);
    expect(agentTypeFor(config, 'judgement')).toBe('senior');
    expect(agentTypeFor(config, 'review')).toBe('reviewer');
    expect(agentTypeFor(config, 'bounded')).toBe('bs-bounded');
  });

  it('refuses a block that is not an object, with an example of the right shape', () => {
    const [problem] = agentsBlockProblems(['senior']);
    expect(problem).toMatch(/"agents" must be an object mapping a role to the agent type to dispatch for it/);
    expect(problem).toContain('{ "judgement": "senior", "review": "reviewer" }');
  });

  it('refuses an unknown role, suggesting the role it is close to', () => {
    expect(agentsBlockProblems({ judgment: 'senior' })).toEqual([
      'Unknown role "judgment" in "agents"; did you mean "judgement"? The roles are mechanical, bounded, judgement, review and second-opinion.',
    ]);
    expect(agentsBlockProblems({ builder: 'builder' })[0]).toMatch(/^Unknown role "builder" in "agents"\. The roles are/);
  });

  it('refuses an agent type that is empty, not a string, or has spaces in it', () => {
    const problems = agentsBlockProblems({ mechanical: '', bounded: 3, judgement: 'my senior' });
    expect(problems).toHaveLength(3);
    for (const problem of problems) {
      expect(problem).toMatch(/^"agents\.(mechanical|bounded|judgement)" must be the name of a Claude Code agent type/);
    }
  });

  it('refuses a second opinion dispatched as the same agent type as the judgement it checks', () => {
    expect(agentsBlockProblems({ 'second-opinion': 'senior', judgement: 'senior' })).toEqual([
      expect.stringMatching(/"agents" dispatches second-opinion and judgement as the same agent type, "senior".*independent/),
    ]);
    expect(agentsBlockProblems({ 'second-opinion': 'bs-judgement' })[0]).toMatch(/same agent type, "bs-judgement"/);
    expect(agentsBlockProblems({ judgement: 'bs-second-opinion' })[0]).toMatch(/same agent type, "bs-second-opinion"/);
    expect(agentsBlockProblems({ 'second-opinion': 'builder', judgement: 'senior' })).toEqual([]);
  });

  it('agentTypeFor throws the problems, so no dispatch goes to a type the config got wrong', () => {
    expect(() => agentTypeFor({ agents: { judgment: 'senior' } }, 'judgement')).toThrow(
      /boardsmith\.json has a problem in "agents": Unknown role "judgment"/,
    );
  });
});
