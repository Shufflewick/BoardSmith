/**
 * THE GUIDE'S PHONE SECTION NAMES ONLY WHAT EXISTS, AND SHOWS EACH PART WORKING (#1613).
 *
 * Game follow-up tickets point authors at "Playing on a Phone" in
 * `custom-ui-guide.md`. Every API it names in a code span must be real: a
 * `--bsg-*` token the theme defines, a class the shell renders, or a name
 * `boardsmith/ui` exports or its source declares. Every subsection links at
 * least one test or browser regression, and every such link resolves.
 */
import { describe, it, expect } from 'vitest';
import guide from './custom-ui-guide.md';
import uiIndex from '../src/ui/index.ts?raw';
import { themeCSS } from '../src/ui/theme.js';

const uiSources = import.meta.glob<string>(['/src/ui/**/*.{ts,vue}', '!/src/ui/**/*.test.ts', '!/src/ui/**/*.test-helper.ts'], { query: '?raw', import: 'default', eager: true });
const proofFiles = new Set(Object.keys(import.meta.glob(['/src/**/*.test.ts', '/scripts/*-browser.mjs'])));

const SUBSECTIONS = [
  'Touch input: tap first, pointer drag second',
  'Hover is a bonus, never the only way',
  'Responsive boards and the tap floor',
  'The layout size and a phone UI',
  'Safe areas come from the host',
  'Check it on a real phone',
];

const section = guide.split(/^## /m).find((part) => part.startsWith('Playing on a Phone\n'));
const subsections = (section ?? '').split(/^### /m).slice(1).map((part) => {
  const [title, ...body] = part.split('\n');
  return { title, body: body.join('\n') };
});

const exported = new Set(
  [...uiIndex.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)].flatMap(([, names]) =>
    names.split(',').map((name) => name.replace(/\/\/.*$/gm, '').trim().split(/\s+as\s+/).pop()!.trim()).filter(Boolean),
  ),
);
const declaredInUi = (name: string) =>
  Object.values(uiSources).some((text) => new RegExp(`(?:\\b(?:function|const|let)\\s+${name}\\b|\\b${name}\\??\\s*:)`).test(text));

/** Why a code span's name is not real, or null when it is. */
function unknownApi(span: string): string | null {
  if (/^--bsg-[\w-]+$/.test(span)) return themeCSS.includes(`${span}:`) ? null : 'no such theme token';
  if (/^\.[a-z][\w-]*$/.test(span)) return Object.values(uiSources).some((text) => text.includes(span.slice(1))) ? null : 'no such class in src/ui';
  const name = span.match(/^([A-Za-z_]\w*)(?:\(\))?$/)?.[1];
  if (!name) return null;
  return exported.has(name) || declaredInUi(name) ? null : 'not exported from boardsmith/ui nor declared in src/ui';
}

describe('custom-ui-guide.md "Playing on a Phone" (#1613)', () => {
  it('has the six subsections game tickets point at', () => {
    expect(section, 'custom-ui-guide.md has no "## Playing on a Phone" section').toBeDefined();
    expect(subsections.map(({ title }) => title)).toEqual(SUBSECTIONS);
  });

  it('names only APIs that exist', () => {
    const spans = [...(section ?? '').matchAll(/`([^`\n]+)`/g)].map(([, span]) => span);
    expect(spans.length).toBeGreaterThan(10);
    expect(spans.flatMap((span) => (unknownApi(span) ? [`\`${span}\`: ${unknownApi(span)}`] : []))).toEqual([]);
  });

  it.each(SUBSECTIONS)('"%s" links a test or browser regression that exists', (title) => {
    const body = subsections.find((sub) => sub.title === title)?.body ?? '';
    const links = [...body.matchAll(/\]\(\.\.(\/(?:src|scripts)\/[^)#\s]+)\)/g)].map(([, path]) => path);
    expect(links.filter((path) => proofFiles.has(path)), `"${title}" links no test or browser regression`).not.toEqual([]);
    expect(links.filter((path) => !proofFiles.has(path))).toEqual([]);
  });
});
