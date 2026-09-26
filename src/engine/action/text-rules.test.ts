/**
 * #394: WHAT A TEXT ARGUMENT MAY CONTAIN, AND WHAT IT MAY WEIGH.
 *
 * `enterText` used to check only length and `pattern`, so a player could store
 * invisible control characters and unpaired UTF-16 surrogates, and `maxLength`
 * (UTF-16 code units) said nothing about the bytes the text adds to a world
 * partition, which is measured as the UTF-8 bytes of its JSON. 200 x U+0001 is
 * 200 characters and 1,200 stored bytes.
 *
 * The rule, in one place for the engine and the Action Panel:
 * - refused always: C0 controls (U+0000-U+001F), DEL (U+007F), C1 controls
 *   (U+0080-U+009F) and unpaired surrogates, except that a `multiline` field
 *   admits line feed (U+000A) and tab (U+0009);
 * - `maxBytes`, when set, bounds the text's UTF-8 bytes as it sits inside a
 *   partition's JSON, which is how the partition store measures it;
 * - a `pattern` carries the sentence a player is shown when it does not match.
 */
import { describe, expect, it } from 'vitest';

import { textRuleErrors, textStoredBytes } from './text-rules.js';
import { Action } from './action-builder.js';
import type { TextSelection } from './types.js';
import { partitionBytes } from '../../world/partition-store.js';

const UNSTORABLE =
  "message contains characters that can't be stored, such as invisible control characters. " +
  'Remove them and try again.';

describe('text a player may not store (#394)', () => {
  it.each([
    ['a C0 control', 'hi\u0001there'],
    ['NUL', 'a\u0000'],
    ['a carriage return', 'line\r'],
    ['escape', '\u001b[31mred'],
    ['DEL', 'x\u007f'],
    ['a C1 control', 'x\u0085y'],
    ['a lone high surrogate', 'x\ud800'],
    ['a lone low surrogate', '\udc00x'],
    ['a surrogate pair in the wrong order', '\udc00\ud800'],
    ['the issue report: 200 x U+0001', '\u0001'.repeat(200)],
    ['the issue report: 200 x a lone U+D800', '\ud800'.repeat(200)],
  ])('refuses %s, in words a player can act on', (_what, value) => {
    expect(textRuleErrors('message', value, { maxLength: 400 })).toEqual([UNSTORABLE]);
    expect(textRuleErrors('message', value, { maxLength: 400, multiline: true })).toEqual([UNSTORABLE]);
  });

  it('refuses a line feed or a tab in a single-line field', () => {
    expect(textRuleErrors('message', 'one\ntwo', { maxLength: 40 })).toEqual([UNSTORABLE]);
    expect(textRuleErrors('message', 'one\ttwo', { maxLength: 40 })).toEqual([UNSTORABLE]);
  });

  it('admits a line feed and a tab in a multiline field', () => {
    expect(textRuleErrors('message', 'one\ntwo\tthree', { maxLength: 40, multiline: true })).toEqual([]);
  });

  it('admits ordinary text in every script, and whole surrogate pairs', () => {
    for (const value of ['Hollow Oak', 'Ça va?', 'Здравствуйте', '日本語', 'fire 🔥 and ice ❄️', '"quoted" \\ back']) {
      expect(textRuleErrors('message', value, { maxLength: 40 }), value).toEqual([]);
    }
  });
});

describe('what text weighs where it is stored (#394)', () => {
  it('is what the text adds to a partition, as the partition store measures it', () => {
    const empty = partitionBytes(JSON.stringify({ attributes: { note: '' } }));
    for (const value of ['plain', '日本語', '🔥🔥', '"q" \\', 'one\ntwo\tthree', 'Ça va?']) {
      const stored = partitionBytes(JSON.stringify({ attributes: { note: value } }));
      expect(textStoredBytes(value), value).toBe(stored - empty);
    }
  });

  it('counts emoji and escapes at what they cost, not at their length', () => {
    expect(textStoredBytes('abc')).toBe(3);
    expect(textStoredBytes('🔥')).toBe(4);
    expect(textStoredBytes('日')).toBe(3);
    expect(textStoredBytes('"')).toBe(2);
    expect(textStoredBytes('\n')).toBe(2);
  });

  it('refuses text over maxBytes, saying why and what to do', () => {
    // 100 emoji: 200 characters, 400 bytes.
    const value = '🔥'.repeat(100);
    expect(textRuleErrors('message', value, { maxLength: 200 })).toEqual([]);
    expect(textRuleErrors('message', value, { maxLength: 200, maxBytes: 399 })).toEqual([
      'message is too long to store: it takes 400 bytes and the limit is 399. Some characters, ' +
        'such as emoji and accented letters, take more room than others. Shorten it and try again.',
    ]);
    expect(textRuleErrors('message', value, { maxLength: 200, maxBytes: 400 })).toEqual([]);
  });
});

describe('a pattern says what it wants (#394)', () => {
  it('refuses with the sentence the game gave it', () => {
    const pattern = { regex: /^[a-z]+$/, message: 'Use lowercase letters only.' };
    expect(textRuleErrors('handle', 'Bad1', { maxLength: 20, pattern })).toEqual(['Use lowercase letters only.']);
    expect(textRuleErrors('handle', 'good', { maxLength: 20, pattern })).toEqual([]);
  });
});

describe('maxBytes is checked when it is declared (#394)', () => {
  it.each([0, -1, 1.5, Number.NaN])('refuses maxBytes %s, saying what it must be', (maxBytes) => {
    expect(() => Action.create('post').enterText('message', { maxBytes })).toThrow(
      'maxBytes is the most bytes the text may take when stored, so it must be a whole number above zero.',
    );
  });

  it('records a usable one on the selection', () => {
    const action = Action.create('post').enterText('message', { maxBytes: 400 }).execute(() => {});
    expect((action.selections[0] as TextSelection).maxBytes).toBe(400);
  });
});
