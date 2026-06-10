import { describe, it, expect } from 'vitest';
import { createHeadlessSession } from './headless-harness.js';
import { collectFixtureDefinition } from './fixtures/collect-fixture.js';
import type { Op } from '../stateless-ops.js';

/**
 * Parity contract: drives the SAME SnapshotSessionHost + executeOp snapshot
 * round-trip that production uses, through the collect-equipment flow that
 * mirrors MERC. Diagnoses whether the known prod bugs reproduce through the
 * shared stateless core.
 */

const gameOptions = { playerCount: 1, seed: 't' };

type ValidElement = { id: number; display?: string };

function newSession() {
  return createHeadlessSession(collectFixtureDefinition, gameOptions);
}

describe('collect-equipment parity contract', () => {
  // KNOWN BUG (reproduced): fixed in Phase 5 of
  // docs/superpowers/plans/2026-06-09-dev-prod-parity-harness.md; flip it.fails -> it when green.
  it('A. equipment collected via selectionStep persists across the snapshot round-trip', async () => {
    const session = newSession();
    await session.start();

    const explore = await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} });
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    // Read the stash items currently available to collect.
    const before = await session.send(1, {
      type: 'resolveChoices',
      actionName: 'collect',
      player: 1,
      selectionName: 'item',
      args: {},
    });
    expect(before.success).toBe(true);
    const itemsBefore = (before.validElements as ValidElement[]) ?? [];
    expect(itemsBefore.length).toBeGreaterThan(0);
    const firstId = itemsBefore[0].id;

    // Collect the first item via a pending selection step.
    const step = await session.send(1, {
      type: 'selectionStep',
      player: 1,
      selectionName: 'item',
      value: firstId,
      actionName: 'collect',
      initialArgs: followUpArgs,
    } as Op);
    expect(step.success).toBe(true);

    // After equipping, the same item must NOT still be in the stash.
    const after = await session.send(1, {
      type: 'resolveChoices',
      actionName: 'collect',
      player: 1,
      selectionName: 'item',
      args: {},
    });
    expect(after.success).toBe(true);
    const idsAfter = ((after.validElements as ValidElement[]) ?? []).map((e) => e.id);
    expect(idsAfter).not.toContain(firstId);
  });

  // KNOWN BUG (reproduced): fixed in Phase 5 of
  // docs/superpowers/plans/2026-06-09-dev-prod-parity-harness.md; flip it.fails -> it when green.
  it('B. skipping the optional selection (null) completes the action ("Done collecting")', async () => {
    const session = newSession();
    await session.start();

    const explore = await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} });
    expect(explore.success).toBe(true);
    const followUpArgs = (explore.followUp as { args: Record<string, unknown> }).args;

    const res = await session.send(1, {
      type: 'selectionStep',
      player: 1,
      selectionName: 'item',
      value: null,
      actionName: 'collect',
      initialArgs: followUpArgs,
    } as Op);

    expect(res.success).toBe(true);
    expect(res.actionComplete).toBe(true);
  });

  it('C. the explore followUp is structured-cloneable (plain-id args)', async () => {
    const session = newSession();
    await session.start();

    const explore = await session.send(1, { type: 'action', actionName: 'explore', player: 1, args: {} });
    expect(explore.success).toBe(true);
    expect(() => structuredClone(explore.followUp)).not.toThrow();
  });
});
