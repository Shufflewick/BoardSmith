/**
 * A SEAT'S CLIENT STATE IS THE HOST'S `PlayerGameState` (#1698).
 *
 * The client once kept a hand copy, `PlayerState`, that drifted: it lacked
 * seven fields the host sends, and nothing declared the demo fields the host
 * merges in, so GameShell read them through `as any`. Then it was an alias;
 * now `GameState.state` is the session's `PlayerGameState` and the alias is
 * gone (#1748). These checks are compiled by `boardsmith typecheck`.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { PlayerGameState, DemoControls } from '../session/types.js';
import type { GameState } from './index.js';
// Type imports are erased; these link the test to the files for verify's related-tests check.
import './types.js';
import './index.js';
import '../session/types.js';

describe('GameState.state', () => {
  it('is exactly the state the host builds and merges for a seat', () => {
    expectTypeOf<GameState['state']>().toEqualTypeOf<PlayerGameState>();
  });

  it('declares the demo and bot fields the host merges into every view', () => {
    expectTypeOf<PlayerGameState['demoControls']>().toEqualTypeOf<DemoControls | undefined>();
    expectTypeOf<PlayerGameState['hasBotPlayers']>().toEqualTypeOf<true | undefined>();
  });

  it('is named only PlayerGameState: boardsmith/client has no PlayerState alias (#1748)', () => {
    // @ts-expect-error boardsmith/client exports no PlayerState.
    expectTypeOf<import('./index.js').PlayerState>().toBeObject();
  });
});
