/**
 * A seat's in-progress action reaches its page as wire data (CR-01).
 *
 * The engine keeps which `onSelect` callbacks already fired as a
 * `Set<number>` on the live pending-action state. A Set silently serializes to
 * `{}` over JSON, so the view the host publishes must carry it as a plain
 * array. `createHeadlessSession` clones every broadcast with structuredClone,
 * which keeps a Set a Set, so an array here is the host's own doing.
 *
 * Per-seat isolation of the pending action and the flow-debug description are
 * held by snapshot-session-host.test.ts ("flowDebugInfo + pendingAction").
 */

import { describe, it, expect } from 'vitest';
import { Game, Player, Action, actionStep, type GameOptions } from '../engine/index.js';
import { createHeadlessSession } from './headless-session.js';

// An onSelect callback on the first selection, so `onSelectFired` is populated.
class OnSelectGame extends Game<OnSelectGame, Player> {
  constructor(options: GameOptions) {
    super(options);

    this.registerAction(
      Action.create('pick')
        .chooseFrom('color', { choices: ['red', 'blue', 'green'], onSelect: () => {} })
        .chooseFrom('size', { choices: ['S', 'M', 'L'] })
        .execute(() => {}),
    );

    this.setFlow({
      root: actionStep({
        actions: ['pick'],
        player: (ctx) => ctx.game.getPlayer(1)!,
      }),
    });
  }
}

describe('pendingAction on the wire (CR-01)', () => {
  it('a fired onSelect is published as a plain array, with the args picked so far', async () => {
    const session = createHeadlessSession(
      { gameClass: OnSelectGame, gameType: 'onselect-test', minPlayers: 2, maxPlayers: 2 },
      { playerCount: 2, seed: 'test', playerNames: ['Alice', 'Bob'] },
    );
    await session.start();

    const step = await session.send(1, {
      type: 'selectionStep', player: 1, selectionName: 'color', value: 'red', actionName: 'pick',
    });
    if (!step.success) throw new Error(step.error);
    expect(step.actionComplete).toBe(false);

    const pending = session.playerState(1).pendingAction;
    expect(pending).toBeDefined();
    expect(Array.isArray(pending!.onSelectFired)).toBe(true);
    expect(pending!.onSelectFired).toEqual([0]);
    expect(pending!.collectedArgs.color).toBe('red');
    // Nothing in it changes over a JSON round trip.
    expect(JSON.parse(JSON.stringify(pending))).toEqual(pending);
  });
});
