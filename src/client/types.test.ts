/**
 * A SEAT'S CLIENT STATE IS THE HOST'S `PlayerGameState` (#1698).
 *
 * `PlayerState` was once a hand copy that drifted: it lacked seven fields the
 * host sends, and nothing declared the demo fields the host merges in, so
 * GameShell read them through `as any`. These checks are compiled by
 * `boardsmith typecheck`.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { PlayerGameState, DemoControls } from '../session/types.js';
import type { PlayerState } from './types.js';
// Type imports are erased; these link the test to the files for verify's related-tests check.
import './types.js';
import '../session/types.js';

describe('PlayerState', () => {
  it('is exactly the state the host builds and merges for a seat', () => {
    expectTypeOf<PlayerState>().toEqualTypeOf<PlayerGameState>();
  });

  it('declares the demo and bot fields the host merges into every view', () => {
    expectTypeOf<PlayerGameState['demoControls']>().toEqualTypeOf<DemoControls | undefined>();
    expectTypeOf<PlayerGameState['hasBotPlayers']>().toEqualTypeOf<true | undefined>();
  });
});
