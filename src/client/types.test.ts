/**
 * A SEAT'S CLIENT STATE IS THE HOST'S `PlayerGameState` (#1698).
 *
 * The client once kept a hand copy, `PlayerState`, that drifted: it lacked
 * seven fields the host sends, and nothing declared the demo fields the host
 * merges in, so GameShell read them through `as any`. Then it was an alias of
 * `PlayerGameState`; now `boardsmith/client` exports the one name (#1748).
 * These checks are compiled by `boardsmith typecheck`.
 */
import { describe, it, expectTypeOf } from 'vitest';
import type { DemoControls } from '../session/types.js';
import type { GameState, PlayerGameState } from './index.js';
// @ts-expect-error The alias is gone: a seat's state is named PlayerGameState (#1748).
import type { PlayerState } from './index.js';
// Type imports are erased; these link the test to the files for verify's related-tests check.
import './types.js';
import './index.js';
import '../session/types.js';

describe('PlayerGameState from boardsmith/client', () => {
  it('is the state a board receives for its seat', () => {
    expectTypeOf<GameState['state']>().toEqualTypeOf<PlayerGameState>();
  });

  it('declares the demo and bot fields the host merges into every view', () => {
    expectTypeOf<PlayerGameState['demoControls']>().toEqualTypeOf<DemoControls | undefined>();
    expectTypeOf<PlayerGameState['hasBotPlayers']>().toEqualTypeOf<true | undefined>();
  });
});
