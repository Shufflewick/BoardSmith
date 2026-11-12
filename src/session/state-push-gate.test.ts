import { describe, it, expect } from 'vitest';
import { StatePushGate } from './state-push-gate.js';
import { applyViewPatch, stampRev, type ViewPatch } from './view-patch.js';

// #487: a recipient is never pushed a frame identical to the last one it was
// sent. "Identical" is the frame as that recipient would receive it, except
// for what is stamped fresh on every push (a send time) and for animation
// events it has already been sent.

interface Frame {
  view: { rev?: string; state: { board: string; animationEvents?: Array<{ id: number; type: string }>; lastAnimationEventId?: number; view?: { animationEvents?: Array<{ id: number }> } } };
  serverNow: number;
}

const gate = () => new StatePushGate<string, Frame>({ perPushFields: ['serverNow'] });

function frame(board: string, serverNow: number, events: number[] = []): Frame {
  const animationEvents = events.map((id) => ({ id, type: 'e' }));
  return {
    view: {
      state: {
        board,
        view: events.length > 0 ? { animationEvents } : {},
        ...(events.length > 0 ? { animationEvents, lastAnimationEventId: events.at(-1) } : {}),
      },
    },
    serverNow,
  };
}

describe('StatePushGate', () => {
  it('pushes the first frame a recipient is offered', () => {
    expect(gate().toPush('a', frame('x', 1))).toBeDefined();
  });

  it('holds back a frame identical to the last one pushed, even with a new send time', () => {
    const g = gate();
    g.toPush('a', frame('x', 1));
    expect(g.toPush('a', frame('x', 2))).toBeUndefined();
  });

  it('pushes a frame that differs', () => {
    const g = gate();
    g.toPush('a', frame('x', 1));
    expect(g.toPush('a', frame('y', 2))).toBeDefined();
    expect(g.toPush('a', frame('y', 3))).toBeUndefined();
  });

  it('keeps each recipient apart', () => {
    const g = gate();
    g.toPush('a', frame('x', 1));
    expect(g.toPush('b', frame('x', 1))).toBeDefined();
  });

  it('does not count a drained animation buffer as a change', () => {
    const g = gate();
    g.toPush('a', frame('x', 1, [4, 5]));
    // Another dispatch emptied the buffer; nothing this recipient may see moved.
    expect(g.toPush('a', frame('x', 2))).toBeUndefined();
    expect(g.toPush('a', frame('x', 3, [4, 5]))).toBeUndefined();
  });

  it('pushes an animation event the recipient has not been sent, even on an unchanged board', () => {
    const g = gate();
    g.toPush('a', frame('x', 1, [4]));
    expect(g.toPush('a', frame('x', 2, [6]))).toBeDefined();
    expect(g.toPush('a', frame('x', 3, [6]))).toBeUndefined();
  });

  it('a frame sent outside the push path (a connect, a reconnect) counts as sent', () => {
    const g = gate();
    g.recordSent('a', frame('x', 1));
    expect(g.toPush('a', frame('x', 2))).toBeUndefined();
  });

  it('a recipient it forgets is pushed in full again, as a new connection must be', () => {
    const g = gate();
    g.toPush('a', frame('x', 1));
    g.forget('a');
    expect(g.toPush('a', frame('x', 2))).toBeDefined();
  });

  it('retainOnly forgets every recipient that is no longer present', () => {
    const g = gate();
    g.toPush('a', frame('x', 1));
    g.toPush('b', frame('x', 1));
    g.retainOnly(['b']);
    expect(g.toPush('a', frame('x', 2))).toBeDefined();
    expect(g.toPush('b', frame('x', 2))).toBeUndefined();
  });

  it('a frame with no player state is compared whole', () => {
    const g = new StatePushGate<string, { view: undefined; n: number }>();
    g.toPush('a', { view: undefined, n: 1 });
    expect(g.toPush('a', { view: undefined, n: 1 })).toBeUndefined();
    expect(g.toPush('a', { view: undefined, n: 2 })).toBeDefined();
  });
});

// #1616: after the first frame, a recipient is pushed a patch against the
// view it was last sent, never the whole view again.
describe('StatePushGate pushes what changed', () => {
  const stamped = (board: string, serverNow = 1): Frame => ({ view: stampRev({ state: { board } }), serverNow });

  it('pushes the first frame whole', () => {
    const first = stamped('x');
    expect(gate().toPush('a', first)).toEqual(first);
  });

  it('pushes a patch against the view it last sent, which rebuilds the new view', () => {
    const g = gate();
    const first = stamped('x');
    g.toPush('a', first);
    const next = stamped('y', 2);
    const push = g.toPush('a', next);
    expect(push).toEqual({ serverNow: 2, patch: { base: first.view.rev, ops: expect.any(Array) } });
    expect(applyViewPatch(first.view, (push as { patch: ViewPatch }).patch)).toEqual(next.view);
  });

  it('counts from a frame sent outside the push path', () => {
    const g = gate();
    const first = stamped('x');
    g.recordSent('a', first);
    expect(g.toPush('a', stamped('y'))).toMatchObject({ patch: { base: first.view.rev } });
  });

  it('pushes a view without a rev whole, since a page could not tell what a patch of it was made against', () => {
    const g = gate();
    g.toPush('a', frame('x', 1));
    expect(g.toPush('a', frame('y', 2))).toEqual(frame('y', 2));
  });

  it('holds back a view whose only change is its rev', () => {
    const g = gate();
    g.toPush('a', stamped('x'));
    expect(g.toPush('a', { ...stamped('x'), view: { ...stamped('x').view, rev: 'other' } })).toBeUndefined();
  });
});
