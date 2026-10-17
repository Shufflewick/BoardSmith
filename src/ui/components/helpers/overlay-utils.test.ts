// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { buildSelector } from './overlay-utils.js';

it('builds a selector that finds an element whose name holds a newline, and nothing else', () => {
  const named = (name: string) => {
    const el = document.createElement('div');
    el.setAttribute('data-bs-el-name', name);
    document.body.appendChild(el);
    return el;
  };
  named('ab');
  const target = named('a\nb');
  const selector = buildSelector({ kind: 'element', ref: { name: 'a\nb' } });
  expect([...document.querySelectorAll(selector)]).toEqual([target]);
});
