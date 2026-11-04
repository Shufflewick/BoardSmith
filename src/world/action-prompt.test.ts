import { describe, it, expect } from 'vitest';
import { worldAction } from './index.js';
import { offersFor, PARTITION } from './offer-fixture.test-helper.js';

describe('dynamic world action prompts (#1590)', () => {
  it('evaluates a prompt in the seated world context and carries its text over JSON', async () => {
    const action = worldAction('aim')
      .prompt((ctx) => `Seat ${ctx.player.seat}: aim in ${ctx.world.partition(PARTITION).name}`)
      .needs(() => [PARTITION])
      .execute(() => {});
    const wire = JSON.parse(JSON.stringify(await offersFor([action], 'action-prompt')));
    expect(wire[0].prompt).toBe('Seat 1: aim in yard');
  });

  it('names the world action when its prompt throws', async () => {
    const action = worldAction('brokenAim')
      .prompt(() => { throw new Error('upgrade is missing'); })
      .needs(() => [PARTITION])
      .execute(() => {});
    await expect(offersFor([action], 'broken-action-prompt')).rejects.toThrow(
      'The prompt function for action "brokenAim" threw an error: upgrade is missing',
    );
  });
});
