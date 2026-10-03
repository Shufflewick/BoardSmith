import { describe, it, expect } from 'vitest';
import { StatePushGate } from './state-push-gate.js';

// #487: a recipient is never pushed a frame identical to the last one it was
// sent. "Identical" is the frame as that recipient would receive it, except
// for what is stamped fresh on every push (a send time) and for animation
// events it has already been sent.

interface Frame {
  view: { state: { board: string; animationEvents?: Array<{ id: number; type: string }>; lastAnimationEventId?: number; view?: { animationEvents?: Array<{ id: number }> } } };
  serverNow: number;
}

const gate = () => new StatePushGate<string, Frame>({ playerState: (f) => f.view.state, perPushFields: ['serverNow'] });

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
    expect(gate().shouldPush('a', frame('x', 1))).toBe(true);
  });

  it('holds back a frame identical to the last one pushed, even with a new send time', () => {
    const g = gate();
    g.shouldPush('a', frame('x', 1));
    expect(g.shouldPush('a', frame('x', 2))).toBe(false);
  });

  it('pushes a frame that differs', () => {
    const g = gate();
    g.shouldPush('a', frame('x', 1));
    expect(g.shouldPush('a', frame('y', 2))).toBe(true);
    expect(g.shouldPush('a', frame('y', 3))).toBe(false);
  });

  it('keeps each recipient apart', () => {
    const g = gate();
    g.shouldPush('a', frame('x', 1));
    expect(g.shouldPush('b', frame('x', 1))).toBe(true);
  });

  it('does not count a drained animation buffer as a change', () => {
    const g = gate();
    g.shouldPush('a', frame('x', 1, [4, 5]));
    // Another dispatch emptied the buffer; nothing this recipient may see moved.
    expect(g.shouldPush('a', frame('x', 2))).toBe(false);
    expect(g.shouldPush('a', frame('x', 3, [4, 5]))).toBe(false);
  });

  it('pushes an animation event the recipient has not been sent, even on an unchanged board', () => {
    const g = gate();
    g.shouldPush('a', frame('x', 1, [4]));
    expect(g.shouldPush('a', frame('x', 2, [6]))).toBe(true);
    expect(g.shouldPush('a', frame('x', 3, [6]))).toBe(false);
  });

  it('a frame sent outside the push path (a connect, a reconnect) counts as sent', () => {
    const g = gate();
    g.recordSent('a', frame('x', 1));
    expect(g.shouldPush('a', frame('x', 2))).toBe(false);
  });

  it('a recipient it forgets is pushed in full again, as a new connection must be', () => {
    const g = gate();
    g.shouldPush('a', frame('x', 1));
    g.forget('a');
    expect(g.shouldPush('a', frame('x', 2))).toBe(true);
  });

  it('retainOnly forgets every recipient that is no longer present', () => {
    const g = gate();
    g.shouldPush('a', frame('x', 1));
    g.shouldPush('b', frame('x', 1));
    g.retainOnly(['b']);
    expect(g.shouldPush('a', frame('x', 2))).toBe(true);
    expect(g.shouldPush('b', frame('x', 2))).toBe(false);
  });

  it('a frame with no player state is compared whole', () => {
    const g = new StatePushGate<string, { view: undefined; n: number }>({ playerState: () => undefined });
    g.shouldPush('a', { view: undefined, n: 1 });
    expect(g.shouldPush('a', { view: undefined, n: 1 })).toBe(false);
    expect(g.shouldPush('a', { view: undefined, n: 2 })).toBe(true);
  });
});
