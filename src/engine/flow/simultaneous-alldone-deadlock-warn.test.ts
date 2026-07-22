import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommitGame } from '../../session/testing/fixtures/simultaneous-fixture.js';
import { _clearShownWarnings } from '../../utils/dev.js';

/**
 * F-06 / SIM-03 regression: a simultaneous step whose CUSTOM `allDone` returns
 * false while every awaiting seat is already individually `completed` reaches a
 * state with no eligible actor that will NOT finalize on its own. Reached via
 * the POST-ACTION path (`resumeSimultaneousAction`'s allDone re-check after a
 * seat acts), this is a *silent* permanent hang today: the step just returns
 * `getState()` with `awaitingInput: true` and no diagnostic.
 *
 * Option C keeps `allDone` authoritative (the step legitimately stays open for
 * an external `resume()` / a context change that flips `allDone` to true), but
 * it must FAIL LOUD in dev: emit a single actionable `devWarn` so a genuine
 * `allDone`-can-never-be-true deadlock bug is visible instead of hanging
 * forever.
 */
describe('F-06 / SIM-03: post-action all-completed + allDone-false deadlock warns loud in dev', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    _clearShownWarnings();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    _clearShownWarnings();
  });

  it('emits a dev warning when every awaiting seat has completed but custom allDone is still false (post-action path)', () => {
    const game = new CommitGame({ playerCount: 2, seed: 't' });
    game.startFlow();

    // Seat 1 commits: individually done, but seat 2 can still act -> eligible
    // actor remains -> no deadlock, no warning yet.
    const first = game.continueFlow('commit', {}, 1);
    expect(first.awaitingInput).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();

    // Seat 2 commits: now EVERY awaiting seat is completed, yet allDone
    // (roundClosed) is still false. No eligible actor remains and nothing in
    // this step will finalize it -> the loud-in-dev warning must fire.
    const second = game.continueFlow('commit', {}, 2);
    expect(second.awaitingInput).toBe(true);
    expect(second.awaitingPlayers?.every((p) => p.completed)).toBe(true);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0]?.[0] as string;
    expect(message).toContain('[BoardSmith]');
    expect(message).toMatch(/allDone/);
    expect(message).toMatch(/completed/i);
  });
});
