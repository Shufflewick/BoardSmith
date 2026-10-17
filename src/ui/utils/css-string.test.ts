// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { escapeCssString } from './css-string.js';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('escapeCssString', () => {
  it.each([
    ['a quote', 'say "hi"'],
    ['a backslash', 'a\\b'],
    ['a newline', 'line\nbreak'],
    ['a carriage return', 'line\rbreak'],
    ['a form feed', 'page\fbreak'],
  ])('finds an attribute value holding %s', (_label, value) => {
    const el = document.createElement('div');
    el.setAttribute('data-x', value);
    document.body.appendChild(el);
    expect(document.querySelector(`[data-x="${escapeCssString(value)}"]`)).toBe(el);
  });

  it('does not match a value that differs only by the escaped character', () => {
    const el = document.createElement('div');
    el.setAttribute('data-x', 'linebreak');
    document.body.appendChild(el);
    expect(document.querySelector(`[data-x="${escapeCssString('line\nbreak')}"]`)).toBeNull();
  });
});
