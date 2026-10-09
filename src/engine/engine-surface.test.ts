/**
 * Engine members removed because nothing could reach them (#500). Re-adding one
 * turns this red.
 *
 * - `Game.restoreFlow`: every restore goes through `restoreFlowState`.
 * - `FlowStepResult`: the flow engine's own step result. It is internal to the
 *   flow engine, so the type import below must fail; `boardsmith typecheck`
 *   reports an unused `@ts-expect-error` if the type is exported again.
 */
import { describe, it, expect } from 'vitest';
import { Game } from './index.js';
// @ts-expect-error -- FlowStepResult is not exported (#500)
import type { FlowStepResult as _FlowStepResult } from './index.js';

describe('engine surface (#500)', () => {
  it('Game has no restoreFlow; restoreFlowState is the one flow restore', () => {
    expect('restoreFlow' in Game.prototype).toBe(false);
    expect('restoreFlowState' in Game.prototype).toBe(true);
  });
});
