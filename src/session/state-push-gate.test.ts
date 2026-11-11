import { describe, it, expect } from 'vitest';
import { StatePushGate } from './state-push-gate.js';

// #487: a recipient is never pushed a frame identical to the last one it was
// sent. "Identical" is the frame as that recipient would receive it, except
// for what is stamped fresh on every push (a send time) and for animation
// events it has already been sent.

interface Frame {
  view: { state: { board: string; messages?: Array<{ text: string }>; messageOffset?: number; messagesFrom?: number; animationEvents?: Array<{ id: number; type: string }>; lastAnimationEventId?: number; view?: { animationEvents?: Array<{ id: number }> } } };
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

// #1614: a pushed frame carries only the log lines its recipient was not sent,
// from `messagesFrom`; a frame sent in full outside the push path counts too.
describe('StatePushGate cuts the log to what the recipient was not sent', () => {
  const said = (board: string, texts: string[], messageOffset?: number): Frame => ({
    view: { state: { board, messages: texts.map((text) => ({ text })), ...(messageOffset !== undefined && { messageOffset }) } },
    serverNow: 1,
  });
  const logOf = (f: Frame | undefined) => {
    const { messages, messageOffset, messagesFrom } = f!.view.state;
    return { messages: messages?.map((m) => m.text), messageOffset, messagesFrom };
  };

  it('pushes the first frame whole', () => {
    expect(logOf(gate().toPush('a', said('x', ['a', 'b'])))).toEqual({ messages: ['a', 'b'] });
  });

  it('pushes only the new lines, from the line after those it was sent', () => {
    const g = gate();
    g.toPush('a', said('x', ['a', 'b']));
    expect(logOf(g.toPush('a', said('y', ['a', 'b', 'c'])))).toEqual({ messages: ['c'], messagesFrom: 2 });
    expect(logOf(g.toPush('a', said('z', ['a', 'b', 'c'])))).toEqual({ messagesFrom: 3 });
  });

  it('still compares the whole log, so a frame with no new line and nothing else new is held back', () => {
    const g = gate();
    g.toPush('a', said('x', ['a']));
    expect(g.toPush('a', said('x', ['a']))).toBeUndefined();
  });

  it('counts from a frame sent outside the push path', () => {
    const g = gate();
    g.recordSent('a', said('x', ['a', 'b']));
    expect(logOf(g.toPush('a', said('y', ['a', 'b', 'c'])))).toEqual({ messages: ['c'], messagesFrom: 2 });
  });

  it('sends again from the first line an undo changed', () => {
    const g = gate();
    g.toPush('a', said('x', ['a', 'b', 'c']));
    expect(logOf(g.toPush('a', said('y', ['a', 'd'])))).toEqual({ messages: ['d'], messagesFrom: 1 });
  });

  it('sends the whole log when its first line changed, as in a new game', () => {
    const g = gate();
    g.toPush('a', said('x', ['a', 'b']));
    expect(logOf(g.toPush('a', said('y', ['n'])))).toEqual({ messages: ['n'] });
  });

  it('counts by line number once the game prunes the log', () => {
    const g = gate();
    g.toPush('a', said('x', ['a', 'b', 'c']));
    expect(logOf(g.toPush('a', said('y', ['c', 'd'], 2)))).toEqual({ messages: ['d'], messageOffset: 2, messagesFrom: 3 });
  });

  it('sends the whole log when it starts before the lines the recipient was sent', () => {
    const g = gate();
    g.toPush('a', said('x', ['b', 'c'], 1));
    expect(logOf(g.toPush('a', said('y', ['a', 'b', 'c', 'd'])))).toEqual({ messages: ['a', 'b', 'c', 'd'] });
  });

  it('leaves the frame it was handed as it was', () => {
    const g = gate();
    g.toPush('a', said('x', ['a']));
    const next = said('y', ['a', 'b']);
    g.toPush('a', next);
    expect(logOf(next)).toEqual({ messages: ['a', 'b'] });
  });
});
