import { describe, it, expect } from 'vitest';
import * as engine from '../engine/index.js';
import * as session from '../session/index.js';

/**
 * Regression guard for F2: the two unrelated "checkpoint" mechanisms must stay
 * disambiguated by name so the engine/session export surface has no bare,
 * domain-ambiguous "checkpoint" symbol.
 *
 *  - Dev/HMR family (every-N actions, in-memory, dev-only):
 *      createDevCheckpoint / restoreFromDevCheckpoint / DevCheckpoint
 *      + DevCheckpointManager (session)
 *  - Per-action undo family (carried inside the authoritative snapshot):
 *      createActionCheckpoint / ActionCheckpoint
 *
 * Before the rename, the dev/HMR family used bare names (createCheckpoint,
 * restoreFromCheckpoint, CheckpointManager) that collided with the action-undo
 * family in the same export surface. This test fails against that old naming.
 */
describe('checkpoint family naming (F2)', () => {
  it('exposes the dev/HMR checkpoint family under Dev-qualified names', () => {
    expect(typeof engine.createDevCheckpoint).toBe('function');
    expect(typeof engine.restoreFromDevCheckpoint).toBe('function');
    expect(typeof session.DevCheckpointManager).toBe('function');
  });

  it('exposes the per-action undo checkpoint family under Action-qualified names', () => {
    expect(typeof engine.createActionCheckpoint).toBe('function');
  });

  it('no longer exports bare, domain-ambiguous "checkpoint" symbols', () => {
    expect((engine as Record<string, unknown>).createCheckpoint).toBeUndefined();
    expect((engine as Record<string, unknown>).restoreFromCheckpoint).toBeUndefined();
    expect((session as Record<string, unknown>).CheckpointManager).toBeUndefined();
  });

  it('keeps the two families as distinct mechanisms', () => {
    expect(engine.createDevCheckpoint).not.toBe(engine.createActionCheckpoint);
  });
});
