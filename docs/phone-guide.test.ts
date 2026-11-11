/**
 * THE GUIDE'S PHONE SECTION NAMES ONLY WHAT EXISTS, AND SHOWS EACH PART WORKING (#1613).
 *
 * Game follow-up tickets point authors at "Playing on a Phone" in
 * `custom-ui-guide.md`. Every API it names in a code span must be real: a
 * `--bsg-*` token the theme defines, a class the shell's markup carries, a name
 * `boardsmith/ui` exports, or a member of the exported API that declares it.
 * Every subsection links at least one test or browser regression, and every
 * link in the section resolves, file and heading alike.
 */
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import guide from './custom-ui-guide.md';
import { themeCSS } from '../src/ui/theme.js';

const sources = import.meta.glob<string>(['/src/ui/**/*.{ts,vue}', '!/src/ui/**/*.test.ts', '!/src/ui/**/*.test-helper.ts'], { query: '?raw', import: 'default', eager: true });
const docs = import.meta.glob<string>('/docs/*.md', { import: 'default', eager: true });
const proofFiles = new Set(Object.keys(import.meta.glob(['/src/**/*.test.ts', '/scripts/*-browser.mjs'])));

const SUBSECTIONS = [
  'Touch input: tap first, pointer drag second',
  'Hover is a bonus, never the only way',
  'Responsive boards and the tap floor',
  'The layout size and a phone UI',
  'Safe areas come from the host',
  'Check it on a real phone',
];

/** A name the section uses that is a member of an API, not an export: where it is declared. */
const MEMBERS: Record<string, [file: string, iface: string]> = {
  drag: ['/src/ui/composables/useDragDrop.ts', 'UseDragDropReturn'],
  drop: ['/src/ui/composables/useDragDrop.ts', 'UseDragDropReturn'],
  formFactor: ['/src/ui/board-props.ts', 'BoardBaseProps'],
  orientation: ['/src/ui/board-props.ts', 'BoardBaseProps'],
};

const section = guide.split(/^## /m).find((part) => part.startsWith('Playing on a Phone\n'));
const subsections = (section ?? '').split(/^### /m).slice(1).map((part) => {
  const [title, ...body] = part.split('\n');
  return { title, body: body.join('\n') };
});

const parse = (file: string) => ts.createSourceFile(file, sources[file], ts.ScriptTarget.Latest, true);
const exported = new Set(
  parse('/src/ui/index.ts').statements.flatMap((s) =>
    ts.isExportDeclaration(s) && s.exportClause && ts.isNamedExports(s.exportClause) ? s.exportClause.elements.map((e) => e.name.text) : [],
  ),
);
const isMember = (name: string) => {
  const [file, iface] = MEMBERS[name] ?? [];
  if (!file) return false;
  const decl = parse(file).statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === iface);
  return !!decl?.members.some((m) => m.name && ts.isIdentifier(m.name) && m.name.text === name);
};
const markupClasses = new Set(
  Object.entries(sources)
    .filter(([path]) => path.endsWith('.vue'))
    .flatMap(([, text]) => [...text.matchAll(/\sclass="([^"]*)"/g)].flatMap(([, list]) => list.split(/\s+/))),
);

/** Why a code span's name is not real, or null when it is (or when the span names no API). */
function unknownApi(span: string): string | null {
  if (/^--bsg-[\w-]+$/.test(span)) return themeCSS.includes(`${span}:`) ? null : 'no such theme token in src/ui/theme.ts';
  if (/^\.[a-z][\w-]*$/.test(span)) return markupClasses.has(span.slice(1)) ? null : 'no element in src/ui carries this class';
  const name = span.match(/^([A-Za-z_]\w*)(?:\(\w*\))?(?:\.\w+)*$/)?.[1];
  if (!name) return null;
  return exported.has(name) || isMember(name) ? null : 'not exported from boardsmith/ui; if it is a member of an exported API, add it to MEMBERS';
}

/** GitHub's heading anchor. */
const slug = (heading: string) => heading.trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');
const anchorsOf = (text: string) => new Set([...text.matchAll(/^#+ (.+)$/gm)].map(([, heading]) => slug(heading)));

/** Why a link target does not resolve from docs/custom-ui-guide.md, or null when it does. */
function brokenLink(target: string): string | null {
  const [path, anchor] = target.split('#');
  if (path.startsWith('../')) return proofFiles.has(path.slice(2)) ? null : 'no such test or browser regression';
  const text = path === '' ? guide : docs[`/docs/${path.replace(/^\.\//, '')}`];
  if (text === undefined) return 'no such page in docs/';
  return anchor === undefined || anchorsOf(text).has(anchor) ? null : 'no such heading';
}

describe('custom-ui-guide.md "Playing on a Phone" (#1613)', () => {
  it('has the six subsections game tickets point at', () => {
    expect(section, 'custom-ui-guide.md has no "## Playing on a Phone" section').toBeDefined();
    expect(subsections.map(({ title }) => title)).toEqual(SUBSECTIONS);
  });

  it('names only APIs that exist', () => {
    const spans = [...(section ?? '').matchAll(/`([^`\n]+)`/g)].map(([, span]) => span);
    expect(spans.length).toBeGreaterThan(10);
    expect(spans.flatMap((span) => {
      const why = unknownApi(span);
      return why ? [`\`${span}\`: ${why}`] : [];
    })).toEqual([]);
  });

  it('links only files and headings that exist', () => {
    const targets = [...(section ?? '').matchAll(/\]\(([^)\s]+)\)/g)].map(([, target]) => target);
    expect(targets.length).toBeGreaterThan(SUBSECTIONS.length);
    expect(targets.flatMap((target) => {
      const why = brokenLink(target);
      return why ? [`${target}: ${why}`] : [];
    })).toEqual([]);
  });

  it.each(SUBSECTIONS)('"%s" links a test or browser regression', (title) => {
    const body = subsections.find((sub) => sub.title === title)?.body ?? '';
    const proofs = [...body.matchAll(/\]\(\.\.(\/[^)#\s]+)/g)].map(([, path]) => path).filter((path) => proofFiles.has(path));
    expect(proofs, `"${title}" links no test or browser regression`).not.toEqual([]);
  });
});
