/**
 * A game's end and its winners are declared on `Game` only (#503): by
 * `finish(winners)`, or by overriding `isFinished()` and `getWinners()`.
 *
 * The flow definition used to carry its own `isComplete` and `getWinners`,
 * and only the flow's `getWinners` reached `settings.winners`, which the bot
 * and the benchmark read. A flow definition is now a plain object with no say
 * in the result, so `boardsmith typecheck` reports an unused
 * `@ts-expect-error` below if either field comes back.
 */
import { describe, it, expect } from 'vitest';
import * as engine from '../index.js';
import { FlowEngine } from './engine.js';
import { actionStep } from './builders.js';
import type { FlowDefinition } from './types.js';

describe('game end is declared on Game only (#503)', () => {
  it('a flow definition cannot declare winners', () => {
    const flow: FlowDefinition = {
      root: actionStep({ actions: ['move'] }),
      // @ts-expect-error -- winners are declared on Game, not the flow (#503)
      getWinners: () => [],
    };
    expect(flow.root.type).toBe('action-step');
  });

  it('a flow definition cannot declare the game over', () => {
    const flow: FlowDefinition = {
      root: actionStep({ actions: ['move'] }),
      // @ts-expect-error -- the end is declared on Game, not the flow (#503)
      isComplete: () => true,
    };
    expect(flow.root.type).toBe('action-step');
  });

  it('the flow engine has no winners of its own', () => {
    expect('getWinners' in FlowEngine.prototype).toBe(false);
  });

  it('there is no defineFlow: a flow definition is a plain object', () => {
    expect('defineFlow' in engine).toBe(false);
  });
});
