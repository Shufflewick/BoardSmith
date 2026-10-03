import { describe, it, expect } from 'vitest';
import { executeOp } from './stateless-ops.js';
import { secretRoleDefinition } from './testing/fixtures/secret-role-fixture.js';

// #450 at its source: the engine's answer to a choices query carries no game
// state, so no host that passes it through can leak another seat's view or the
// snapshot. (The dev host also cuts its reply down; the platform passed the
// result through whole, ShufflewickPub#551.)

describe('the resolveChoices op result carries no state (#450)', () => {
  it("answers seat 2's pick with no snapshot, flow state or seat views, and nothing of seat 1's role", async () => {
    const options = { playerCount: 2, seed: 'bs450-engine' };
    const started = await executeOp(secretRoleDefinition, options, null, null, { type: 'start' });
    expect(started.success).toBe(true);

    const res = await executeOp(secretRoleDefinition, options, started.snapshot, null, {
      type: 'resolveChoices',
      actionName: 'pick',
      selectionName: 'color',
      player: 2,
      args: {},
    });

    expect(res.success).toBe(true);
    expect((res.choices as Array<{ value: unknown }>).map((c) => c.value)).toEqual(['red', 'blue']);
    expect(res.snapshot).toBeNull();
    expect(res.flowState).toBeNull();
    expect(res.playerViews).toEqual([]);
    expect(res).not.toHaveProperty('spectatorView');
    expect(res).not.toHaveProperty('flowDebugInfo');
    expect(JSON.stringify(res)).not.toContain('SEAT-ONE-SECRET-ROLE');
  });
});
