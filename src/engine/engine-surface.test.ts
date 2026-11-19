/**
 * Engine members removed because nothing could reach them (#500) or they only
 * passed through to another (#1727). Re-adding one turns this red.
 *
 * - `Game.restoreFlow`: every restore goes through `restoreFlowState`.
 * - `FlowStepResult`: the flow engine's own step result. It is internal to the
 *   flow engine, so the type import below must fail; `boardsmith typecheck`
 *   reports an unused `@ts-expect-error` if the type is exported again.
 * - `noop()`: it only returned `sequence()`, which is the empty node (#1727).
 * - `resolveVisibility`, `visibilityFromMode`, `DEFAULT_VISIBILITY`: engine
 *   internals no caller outside `src/engine` reached through the barrel (#1727).
 * - `FlowEngine.isOver`: it only returned `game.isFinished()` (#1727).
 */
import { describe, it, expect } from 'vitest';
import { Game, FlowEngine } from './index.js';
import * as engine from './index.js';
// @ts-expect-error -- FlowStepResult is not exported (#500)
import type { FlowStepResult as _FlowStepResult } from './index.js';

describe('engine surface (#500)', () => {
  it('Game has no restoreFlow; restoreFlowState is the one flow restore', () => {
    expect('restoreFlow' in Game.prototype).toBe(false);
    expect('restoreFlowState' in Game.prototype).toBe(true);
  });
});

describe('engine surface (#1727)', () => {
  it('exports no noop() builder; sequence() is the empty node', () => {
    expect('noop' in engine).toBe(false);
  });

  it('keeps visibility internals out of the barrel', () => {
    for (const name of ['resolveVisibility', 'visibilityFromMode', 'DEFAULT_VISIBILITY']) {
      expect(name in engine).toBe(false);
    }
  });

  it('FlowEngine has no isOver pass-through; game.isFinished() is the check', () => {
    expect('isOver' in FlowEngine.prototype).toBe(false);
  });
});
