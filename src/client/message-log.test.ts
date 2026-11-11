import { describe, it, expect } from 'vitest';
import { mergeMessageLog } from './message-log.js';

// #1614: a pushed state may carry only the log lines from `messagesFrom`; the
// page keeps the lines it holds before that line and replaces the rest.

const lines = (...texts: string[]) => texts.map((text) => ({ text }));

describe('mergeMessageLog', () => {
  it('takes a whole log as it is', () => {
    const incoming = { messages: lines('a', 'b'), other: 1 };
    expect(mergeMessageLog({ messages: lines('x') }, incoming)).toBe(incoming);
    expect(mergeMessageLog(undefined, incoming)).toBe(incoming);
  });

  it('appends the lines after those the page holds', () => {
    expect(mergeMessageLog({ messages: lines('a', 'b') }, { messages: lines('c'), messagesFrom: 2, other: 1 }))
      .toEqual({ messages: lines('a', 'b', 'c'), other: 1 });
  });

  it('keeps what the page holds when no line is new', () => {
    expect(mergeMessageLog({ messages: lines('a') }, { messagesFrom: 1 })).toEqual({ messages: lines('a') });
  });

  it('replaces the lines an undo took back', () => {
    expect(mergeMessageLog({ messages: lines('a', 'b', 'c') }, { messages: lines('d'), messagesFrom: 1 }))
      .toEqual({ messages: lines('a', 'd') });
  });

  it('drops the lines the game pruned, counting by line number', () => {
    expect(mergeMessageLog(
      { messages: lines('b', 'c'), messageOffset: 1 },
      { messages: lines('d'), messageOffset: 2, messagesFrom: 3 },
    )).toEqual({ messages: lines('c', 'd'), messageOffset: 2 });
  });

  it('refuses a partial log the page has no start for', () => {
    expect(() => mergeMessageLog(undefined, { messages: lines('c'), messagesFrom: 2 }))
      .toThrow('The host sent game log lines from line 2, but this page holds lines 0 to 0');
    expect(() => mergeMessageLog({ messages: lines('a') }, { messages: lines('c'), messagesFrom: 2 }))
      .toThrow('holds lines 0 to 1');
  });
});
