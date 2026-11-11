/**
 * `dependentFilter` exists because a filter is handed `ctx.args` as they stand,
 * and there are two paths that evaluate one before the selection it narrows by
 * has been answered: the engine walking a DECLARED dependency (`dependsOn` /
 * `filterBy`), and a persistent world enumerating every selection of an offer in
 * a single frame. A filter that forgets that case dereferences `undefined`, so
 * the two branches are the whole point.
 *
 * What it is no longer for is keeping an action on the panel. Since #270 an
 * action is offered on its FIRST unsatisfied step, so `whenUndefined` is free to
 * be the truth rather than the union of every earlier answer's rows.
 */
import { describe, it, expect, vi } from 'vitest';
import { dependentFilter, not } from './helpers.js';
import type { ActionContext } from './types.js';

const ctx = (args: Record<string, unknown> = {}) => ({ args }) as unknown as ActionContext;

type Room = { id: number };
type Crew = { at: number };

const adjacency = dependentFilter<Room, Crew>({
  dependsOn: 'crew',
  whenUndefined: (room) => room.id <= 3,
  whenSelected: (room, crew) => Math.abs(room.id - crew.at) === 1,
});

describe('dependentFilter', () => {
  it('returns a filter function', () => {
    expect(adjacency).toBeTypeOf('function');
  });

  it('takes the undefined branch during an availability check', () => {
    expect(adjacency({ id: 2 }, ctx())).toBe(true);
    expect(adjacency({ id: 9 }, ctx())).toBe(false);
  });

  it('takes the selected branch once the dependency has a value', () => {
    const withCrew = ctx({ crew: { at: 5 } });
    expect(adjacency({ id: 4 }, withCrew)).toBe(true);
    expect(adjacency({ id: 6 }, withCrew)).toBe(true);
    expect(adjacency({ id: 9 }, withCrew)).toBe(false);
  });

  it('switches branches as the dependency is filled in', () => {
    // Room 2 is broadly reachable, so it passes the availability check, but
    // it is NOT adjacent to a crew at 5 — the two branches must disagree.
    expect(adjacency({ id: 2 }, ctx())).toBe(true);
    expect(adjacency({ id: 2 }, ctx({ crew: { at: 5 } }))).toBe(false);
  });

  it('hands the element and context to the undefined branch', () => {
    const whenUndefined = vi.fn().mockReturnValue(true);
    const filter = dependentFilter<Room, Crew>({
      dependsOn: 'crew', whenUndefined, whenSelected: () => true,
    });
    const context = ctx();
    filter({ id: 7 }, context);
    expect(whenUndefined).toHaveBeenCalledWith({ id: 7 }, context);
  });

  it('hands the element, the resolved dependency and the context to the selected branch', () => {
    const whenSelected = vi.fn().mockReturnValue(true);
    const filter = dependentFilter<Room, Crew>({
      dependsOn: 'crew', whenUndefined: () => true, whenSelected,
    });
    const context = ctx({ crew: { at: 5 } });
    filter({ id: 7 }, context);
    expect(whenSelected).toHaveBeenCalledWith({ id: 7 }, { at: 5 }, context);
  });

  it('calls exactly one branch per evaluation', () => {
    const whenUndefined = vi.fn().mockReturnValue(true);
    const whenSelected = vi.fn().mockReturnValue(true);
    const filter = dependentFilter<Room, Crew>({ dependsOn: 'crew', whenUndefined, whenSelected });

    filter({ id: 1 }, ctx());
    expect(whenUndefined).toHaveBeenCalledTimes(1);
    expect(whenSelected).not.toHaveBeenCalled();

    filter({ id: 1 }, ctx({ crew: { at: 1 } }));
    expect(whenSelected).toHaveBeenCalledTimes(1);
    expect(whenUndefined).toHaveBeenCalledTimes(1);
  });

  it('treats a falsy-but-present dependency as selected, not as missing', () => {
    // 0 and '' are legitimate selection values; routing them to the
    // availability branch would silently offer the wrong choices.
    const whenSelected = vi.fn().mockReturnValue(true);
    const filter = dependentFilter<Room, unknown>({
      dependsOn: 'crew', whenUndefined: () => false, whenSelected,
    });
    for (const value of [0, '', false, null]) {
      whenSelected.mockClear();
      expect(filter({ id: 1 }, ctx({ crew: value }))).toBe(true);
      expect(whenSelected).toHaveBeenCalledTimes(1);
    }
  });

  it('survives a context with no args at all', () => {
    const filter = dependentFilter<Room, Crew>({
      dependsOn: 'crew', whenUndefined: () => true, whenSelected: () => false,
    });
    expect(filter({ id: 1 }, {} as ActionContext)).toBe(true);
  });

  it('passes through whatever the branch returns, including false', () => {
    const filter = dependentFilter<Room, Crew>({
      dependsOn: 'crew', whenUndefined: () => false, whenSelected: () => false,
    });
    expect(filter({ id: 1 }, ctx())).toBe(false);
    expect(filter({ id: 1 }, ctx({ crew: { at: 1 } }))).toBe(false);
  });

  it('composes with not()', () => {
    const inverted = not(adjacency);
    expect(inverted({ id: 2 }, ctx())).toBe(false);
    expect(inverted({ id: 9 }, ctx())).toBe(true);
  });
});
