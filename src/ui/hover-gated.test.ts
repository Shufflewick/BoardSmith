import { it, expect } from 'vitest';

const sources = import.meta.glob<string>(['/src/ui/**/*.{vue,css}'], { query: '?raw', import: 'default', eager: true });

/** Every selector naming `:hover`, with the at-rules it sits inside. */
function hoverRules(css: string): { selector: string; within: string[] }[] {
  const found: { selector: string; within: string[] }[] = [];
  const stack: string[] = [];
  let prelude = '';
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') {
      const head = prelude.trim();
      if (head.includes(':hover')) found.push({ selector: head, within: [...stack] });
      stack.push(head);
      prelude = '';
    } else if (ch === '}') {
      stack.pop();
      prelude = '';
    } else if (ch === ';') {
      prelude = '';
    } else {
      prelude += ch;
    }
  }
  return found;
}

const styleOf = (path: string, text: string) =>
  path.endsWith('.css') ? text : [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');

// #1606: a tapped element keeps :hover until the next tap elsewhere, so a hover style must apply only where a pointer hovers.
it('every :hover style in the engine UI sits inside @media (hover: hover)', () => {
  const ungated = Object.entries(sources).flatMap(([path, text]) =>
    hoverRules(styleOf(path, text))
      .filter(rule => !rule.within.some(at => at.startsWith('@media') && at.includes('(hover: hover)')))
      .map(rule => `${path}: ${rule.selector}`),
  );
  expect(Object.keys(sources).length).toBeGreaterThan(50);
  expect(ungated).toEqual([]);
});

it('finds a :hover rule outside the media query and accepts one inside it', () => {
  expect(hoverRules('.a:hover { color: red; } @media (hover: hover) { .b:hover { color: red; } }')).toEqual([
    { selector: '.a:hover', within: [] },
    { selector: '.b:hover', within: ['@media (hover: hover)'] },
  ]);
});
