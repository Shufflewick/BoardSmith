import { describe, it, expect, vi } from 'vitest';
import { evaluateCondition, evaluateConditionWithTrace, ConditionEvaluationError } from './action.js';
import type { ActionContext, ConditionConfig } from './types.js';

/** Conditions only ever read the context, so a stub stands in for a live game. */
const ctx = { turn: 3, gold: 5 } as unknown as ActionContext;

const conditions = (config: Record<string, (c: any) => boolean>): ConditionConfig =>
  config as unknown as ConditionConfig;

describe('evaluateCondition', () => {
  it('passes when every predicate passes', () => {
    expect(evaluateCondition(conditions({
      'has gold': (c) => c.gold > 0,
      'past turn 1': (c) => c.turn > 1,
    }), ctx)).toBe(true);
  });

  it('fails when any predicate fails', () => {
    expect(evaluateCondition(conditions({
      'has gold': (c) => c.gold > 0,
      'past turn 10': (c) => c.turn > 10,
    }), ctx)).toBe(false);
  });

  it('passes vacuously when there are no conditions', () => {
    expect(evaluateCondition(conditions({}), ctx)).toBe(true);
  });

  it('hands the context to each predicate', () => {
    const predicate = vi.fn().mockReturnValue(true);
    evaluateCondition(conditions({ check: predicate }), ctx);
    expect(predicate).toHaveBeenCalledWith(ctx);
  });

  it('treats a truthy non-boolean return as passing', () => {
    expect(evaluateCondition(conditions({ truthy: () => 'yes' as unknown as boolean }), ctx)).toBe(true);
  });

  it('treats a falsy non-boolean return as failing', () => {
    expect(evaluateCondition(conditions({ falsy: () => 0 as unknown as boolean }), ctx)).toBe(false);
  });

  it('throws on a crashing predicate rather than reporting a failed condition (#46)', () => {
    // Folding a crash into "condition false" makes the action vanish from every
    // player's list with no error anywhere on the availability path.
    const config = conditions({ explodes: () => { throw new Error('boom'); } });
    expect(() => evaluateCondition(config, ctx)).toThrow(ConditionEvaluationError);
    expect(() => evaluateCondition(config, ctx)).toThrow(/explodes/);
    expect(() => evaluateCondition(config, ctx)).toThrow(/boom/);
  });

  it('names what the condition belongs to, so the author knows where to look', () => {
    const config = conditions({ explodes: () => { throw new Error('boom'); } });
    expect(() => evaluateCondition(config, ctx, "action 'draw'")).toThrow(/action 'draw'/);
  });
});

describe('evaluateConditionWithTrace', () => {
  it('reports one detail per condition, in declaration order', () => {
    const { details } = evaluateConditionWithTrace(conditions({
      first: () => true,
      second: () => false,
    }), ctx);
    expect(details.map((d) => d.label)).toEqual(['first', 'second']);
  });

  it('records the returned value alongside the verdict', () => {
    const { details } = evaluateConditionWithTrace(conditions({
      'has gold': (c) => c.gold > 0,
    }), ctx);
    expect(details[0]).toEqual({ label: 'has gold', value: true, passed: true });
  });

  it('keeps the raw truthy value so a designer can see what was measured', () => {
    const { details } = evaluateConditionWithTrace(conditions({
      count: (c) => c.gold as unknown as boolean,
    }), ctx);
    expect(details[0].value).toBe(5);
    expect(details[0].passed).toBe(true);
  });

  it('throws rather than recording the crash as a trace detail (#46)', () => {
    expect(() => evaluateConditionWithTrace(conditions({
      explodes: () => { throw new Error('no board yet'); },
    }), ctx)).toThrow(/no board yet/);
  });

  it('stringifies a non-Error throw into the message', () => {
    expect(() => evaluateConditionWithTrace(conditions({
      explodes: () => { throw 'plain string'; },
    }), ctx)).toThrow(/plain string/);
  });

  it('keeps evaluating after a failure so the whole trace is reported', () => {
    const later = vi.fn().mockReturnValue(true);
    const { details } = evaluateConditionWithTrace(conditions({
      fails: () => false,
      later,
    }), ctx);
    expect(later).toHaveBeenCalled();
    expect(details).toHaveLength(2);
  });

  it('stops at a throw — later predicates may depend on what the crashing one read', () => {
    const later = vi.fn().mockReturnValue(true);
    expect(() => evaluateConditionWithTrace(conditions({
      throws: () => { throw new Error('x'); },
      later,
    }), ctx)).toThrow();
    expect(later).not.toHaveBeenCalled();
  });

  it('agrees with evaluateCondition on the verdict', () => {
    const config = conditions({ a: () => true, b: () => false });
    expect(evaluateConditionWithTrace(config, ctx).passed).toBe(evaluateCondition(config, ctx));
  });

  it('returns an empty trace and a pass for no conditions', () => {
    expect(evaluateConditionWithTrace(conditions({}), ctx)).toEqual({ passed: true, details: [] });
  });
});
