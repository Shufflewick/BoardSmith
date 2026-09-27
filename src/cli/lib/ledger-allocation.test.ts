import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  NUMBERED_LEDGER_SPECS,
  allocateProvisional,
  plainNumbersAdded,
  provisionalReferences,
} from './ledger-allocation.js';

/**
 * #294: chunks built at the same time on separate branches used to each take "the next" ruling
 * number and collide (sotf Ruling 138, Shufflewick/sotf#32). A branch now writes a provisional id,
 * `Ruling @<slug>.<n>`, and `boardsmith chunk-merge` allocates the real number on the combined
 * tree, one merge at a time. These pin the allocation and the refusals around it.
 */

const RULINGS = NUMBERED_LEDGER_SPECS.find((s) => s.file === 'RULINGS.md')!;
const CONSTRAINTS_G = NUMBERED_LEDGER_SPECS.find((s) => s.file === 'CONSTRAINTS.md' && s.kind === 'G')!;

describe('allocateProvisional', () => {
  it('numbers provisional entries after the highest real number, in file order', () => {
    const ledger = [
      '### Ruling 137',
      '- Decision: a.',
      '### Ruling 138',
      '- Decision: b.',
      '### Ruling @trading.1',
      '- Decision: c.',
      '### Ruling @trading.2',
      '- Decision: d. Supersedes Ruling 137.',
      '',
    ].join('\n');
    const result = allocateProvisional({ 'design/RULINGS.md': ledger }, [{ spec: RULINGS, path: 'design/RULINGS.md' }]);
    expect(result.mapping).toEqual({ 'Ruling @trading.1': 'Ruling 139', 'Ruling @trading.2': 'Ruling 140' });
    expect(result.files['design/RULINGS.md']).toContain('### Ruling 139\n');
    expect(result.files['design/RULINGS.md']).toContain('### Ruling 140\n');
    expect(result.files['design/RULINGS.md']).not.toContain('@trading');
  });

  it('rewrites every citation of a provisional id in every file it is handed', () => {
    const files = {
      'design/RULINGS.md': '### Ruling 4\n- Decision: a.\n### Ruling @auctions.1\n- Decision: b.\n',
      'src/auction.ts': '// Ruling @auctions.1: the reserve price is hidden.\n',
      'design/chunks/auctions/CHUNK.md': 'Per Ruling @auctions.1 and Ruling 4.\n',
    };
    const result = allocateProvisional(files, [{ spec: RULINGS, path: 'design/RULINGS.md' }]);
    expect(result.files['src/auction.ts']).toBe('// Ruling 5: the reserve price is hidden.\n');
    expect(result.files['design/chunks/auctions/CHUNK.md']).toBe('Per Ruling 5 and Ruling 4.\n');
  });

  it('allocates constraint ids, whose number follows the letter directly', () => {
    const text = '### G1\n- State: a\n### G@world.1\n- State: b\n';
    const result = allocateProvisional({ 'design/CONSTRAINTS.md': text }, [
      { spec: CONSTRAINTS_G, path: 'design/CONSTRAINTS.md' },
    ]);
    expect(result.mapping).toEqual({ 'G@world.1': 'G2' });
    expect(result.files['design/CONSTRAINTS.md']).toBe('### G1\n- State: a\n### G2\n- State: b\n');
  });

  it('starts at 1 in a ledger with no real entries, and ignores the template example in a comment', () => {
    const text = '<!--\n### Ruling 1\n- Decision: example\n-->\n### Ruling @a.1\n- Decision: x.\n';
    const result = allocateProvisional({ 'design/RULINGS.md': text }, [{ spec: RULINGS, path: 'design/RULINGS.md' }]);
    expect(result.mapping).toEqual({ 'Ruling @a.1': 'Ruling 1' });
  });
});

describe('the refusals around allocation', () => {
  it('finds provisional references left in a text, so a citation of an id nobody declared is caught', () => {
    expect(provisionalReferences('design/RULINGS.md', 'see Ruling @ghost.3 and G@world.2, not Ruling 3')).toEqual([
      'Ruling @ghost.3',
      'G@world.2',
    ]);
  });

  it('names the real numbers a branch added, which a parallel branch must never do', () => {
    const base = '### Ruling 1\n- a\n';
    const tip = '### Ruling 1\n- a\n### Ruling 2\n- b\n### Ruling @x.1\n- c\n';
    expect(plainNumbersAdded(base, tip, RULINGS)).toEqual(['Ruling 2']);
  });
});

/**
 * #437: a filing that describes a ledger bug quotes example ids (`### Filing @x.1`) in its
 * reproduction. Read as citations, they named entries nobody declared, and chunk-merge refused the
 * merge. The grammar: in a Markdown file, an id inside a code span, a fenced code block or an HTML
 * comment is quoted text, never a citation. It is neither a citation left unresolved nor rewritten
 * when the real number is allocated.
 */
describe('quoted ids are never citations (#437)', () => {
  const FILING_PROSE = [
    '### Filing @ranged.1',
    '- What happened: in a FILINGS.md with `### Filing 1`, then `### Filing @x.1` holding',
    '  `- Reported: recorded`, ledger-check reads Filing @x.1\'s lines as Filing 1\'s.',
    '',
    '```',
    '### Decision @x.1',
    'Supersedes Decision 1.',
    '```',
    '',
    '<!-- e.g. Ruling @x.2 -->',
    '',
  ].join('\n');

  it('finds no citation in a code span, a fenced block or a comment of a Markdown file', () => {
    expect(provisionalReferences('design/FILINGS.md', FILING_PROSE)).toEqual(['Filing @ranged.1', 'Filing @x.1']);
    const quotedOnly = FILING_PROSE.replace(/^### Filing @ranged\.1\n/, '').replace("reads Filing @x.1's", 'reads its');
    expect(provisionalReferences('design/FILINGS.md', quotedOnly)).toEqual([]);
  });

  it('still reads a backticked id as a citation in source code, where backticks are not Markdown', () => {
    expect(provisionalReferences('src/a.ts', 'const note = `Ruling @a.1 holds`;\n')).toEqual(['Ruling @a.1']);
  });

  it('leaves a quoted id as written when it allocates, and rewrites the citations around it', () => {
    const ledger = '### Filing 25\n- a\n### Filing @x.1\n- Reported: recorded\n';
    const prose = 'Per Filing @x.1, the heading `### Filing @x.1` is read as Filing 25\'s.\n';
    const result = allocateProvisional(
      { 'design/FILINGS.md': ledger, 'design/chunks/x/CHUNK.md': prose, 'src/x.ts': '// `Filing @x.1`\n' },
      [{ spec: NUMBERED_LEDGER_SPECS.find((s) => s.kind === 'Filing')!, path: 'design/FILINGS.md' }],
    );
    expect(result.files['design/chunks/x/CHUNK.md']).toBe(
      'Per Filing 26, the heading `### Filing @x.1` is read as Filing 25\'s.\n',
    );
    expect(result.files['src/x.ts']).toBe('// `Filing 26`\n');
  });

  it('holds across a code span that wraps a line, and a double-backtick span holding a backtick', () => {
    const text = 'see `Ruling\n@x.1` and ``a ` Ruling @x.2`` here\n';
    expect(provisionalReferences('design/RULINGS.md', text)).toEqual([]);
  });

  it('finds no citation in any shipped template or skill file, so they pass chunk-merge unchanged', async () => {
    const root = new URL('../slash-command/bs/', import.meta.url).pathname;
    const markdown = (await fs.readdir(root, { recursive: true })).filter((f) => f.endsWith('.md'));
    expect(markdown.length).toBeGreaterThan(10);
    for (const file of markdown) {
      const text = await fs.readFile(join(root, file), 'utf-8');
      expect({ file, cites: provisionalReferences(file, text) }).toEqual({ file, cites: [] });
    }
  });
});

/**
 * #439: prose also cites in list form, `Rulings 8 and @ranged-units.1`, where the kind word is
 * written once, plural, and the provisional id after it carries none. The grammar: every id in a
 * list that follows a kind word takes that kind, and a bare provisional id with no kind before it
 * in its list is still a provisional id, which the merge refuses to leave on the main line.
 */
describe('provisional ids in list citations (#439)', () => {
  const DECISIONS = NUMBERED_LEDGER_SPECS.find((s) => s.kind === 'Decision')!;
  const QUESTIONS = NUMBERED_LEDGER_SPECS.find((s) => s.kind === 'Question')!;
  // The three list citations Windup Warfare's chunk/ranged-units left unrewritten.
  const WINDUP_DECISION_Q =
    '- Rationale: pending designer review (Questions @ranged-units.14 and @ranged-units.15, issue #93).\n';
  const WINDUP_DECISION_R = '- Rationale: Audit round 1 F1 (rulebook p.20; Rulings 8 and @ranged-units.1) and F12.\n';
  const WINDUP_RESULTS =
    '{ "observed": "it plays at once under reduced motion too, Decisions 71 and @ranged-units.15); 6044 frames" }\n';

  it('reads every id in a list as the kind the list opens with', () => {
    expect(provisionalReferences('design/DECISIONS.md', WINDUP_DECISION_Q)).toEqual([
      'Question @ranged-units.14',
      'Question @ranged-units.15',
    ]);
    expect(provisionalReferences('design/DECISIONS.md', WINDUP_DECISION_R)).toEqual(['Ruling @ranged-units.1']);
    expect(provisionalReferences('design/playtests/ranged-units/results.json', WINDUP_RESULTS)).toEqual([
      'Decision @ranged-units.15',
    ]);
    expect(provisionalReferences('design/a.md', 'Rulings 3, @a.1, and\n@a.2; Decision @a.1 or @a.3')).toEqual([
      'Ruling @a.1',
      'Ruling @a.2',
      'Decision @a.1',
      'Decision @a.3',
    ]);
    expect(provisionalReferences('design/a.md', 'G4 and @w.1, C@w.2')).toEqual(['G@w.1', 'C@w.2']);
  });

  it('follows a citation wrapped onto the next line of a source comment, as Windup Warfare wraps them', () => {
    const movement = ' * 0 with the target inside the firing cone; outside the cone it is held at 0 (Ruling\n * @ranged-units.3), and the next blow waits.\n';
    const table = '  // then the check-in row (Decision\n  // @ranged-units.9), and Rulings 31 and\n  // @ranged-units.4.\n';
    expect(provisionalReferences('src/rules/sim/movement.ts', movement)).toEqual(['Ruling @ranged-units.3']);
    expect(provisionalReferences('src/ui/components/GameTable.vue', table)).toEqual([
      'Decision @ranged-units.9',
      'Ruling @ranged-units.4',
    ]);
    expect(provisionalReferences('design/a.md', 'per Ruling\n> @a.1 here')).toEqual(['Ruling @a.1']);
  });

  it('names a provisional id written with no kind before it, so the merge can refuse it', () => {
    expect(provisionalReferences('design/a.md', 'as settled in @a.1, and Ruling @a.2.')).toEqual([
      '@a.1',
      'Ruling @a.2',
    ]);
    expect(provisionalReferences('design/a.md', 'mail jt@example.com, pkg@1.2.3, or `see @a.1`')).toEqual([]);
  });

  it('rewrites the list citations Windup Warfare left behind, and only the provisional ids in them', () => {
    const files = {
      'design/RULINGS.md': '### Ruling 8\n- a\n### Ruling @ranged-units.1\n- b\n',
      'design/DECISIONS.md': `### Decision 71\n- a\n### Decision @ranged-units.15\n- b\n${WINDUP_DECISION_Q}${WINDUP_DECISION_R}`,
      'design/QUESTIONS.md': '### Question 30\n- a\n### Question @ranged-units.14\n- b\n### Question @ranged-units.15\n- c\n',
      'design/playtests/ranged-units/results.json': WINDUP_RESULTS,
    };
    const result = allocateProvisional(files, [
      { spec: RULINGS, path: 'design/RULINGS.md' },
      { spec: DECISIONS, path: 'design/DECISIONS.md' },
      { spec: QUESTIONS, path: 'design/QUESTIONS.md' },
    ]);
    expect(result.mapping).toEqual({
      'Ruling @ranged-units.1': 'Ruling 9',
      'Decision @ranged-units.15': 'Decision 72',
      'Question @ranged-units.14': 'Question 31',
      'Question @ranged-units.15': 'Question 32',
    });
    expect(result.files['design/DECISIONS.md']).toContain('(Questions 31 and 32, issue #93)');
    expect(result.files['design/DECISIONS.md']).toContain('(rulebook p.20; Rulings 8 and 9)');
    expect(result.files['design/playtests/ranged-units/results.json']).toContain('Decisions 71 and 72);');
    for (const text of Object.values(result.files)) expect(text).not.toContain('@ranged-units');
  });
});
