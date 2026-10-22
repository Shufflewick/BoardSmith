import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  NUMBERED_LEDGER_SPECS,
  allocateProvisional,
  plainNumbersAdded,
  provisionalReferences,
  unreadableShorthand,
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

/**
 * #446: prose cites a run of provisional ids with shorthand for the later ones, `Rulings @a.1 to .3`
 * or `Decisions @a.1, .2`. A `.N` directly after a provisional id in the same list is that slug's
 * id N, and `to` (or `through`, or a dash before a provisional id) makes a range. The merge
 * rewrites each one, or refuses one it cannot map one to one, so no stale `.3` reaches the main line.
 */
describe('shorthand ids and ranges after a provisional id (#446)', () => {
  const DECISIONS = NUMBERED_LEDGER_SPECS.find((s) => s.kind === 'Decision')!;
  const rulings = (...ids: string[]) =>
    ['### Ruling 1', '- a', ...ids.flatMap((id) => [`### Ruling @a.${id}`, '- x'])].join('\n') + '\n';
  const allocate = (files: Record<string, string>) =>
    allocateProvisional(files, [
      { spec: RULINGS, path: 'design/RULINGS.md' },
      { spec: DECISIONS, path: 'design/DECISIONS.md' },
    ]);

  it('reads a shorthand id as the provisional id it continues, of the same kind', () => {
    expect(provisionalReferences('src/a.ts', '// Rulings @a.1 to .3 apply here.\n// Decisions 4 and @a.1, .2\n')).toEqual([
      'Ruling @a.1',
      'Ruling @a.3',
      'Decision @a.1',
      'Decision @a.2',
    ]);
    expect(provisionalReferences('design/a.md', 'Rulings @a.1, .2 and .4; Ruling 3, .5')).toEqual([
      'Ruling @a.1',
      'Ruling @a.2',
      'Ruling @a.4',
    ]);
  });

  it('rewrites a shorthand list and a range whose ids became one unbroken run', () => {
    const result = allocate({
      'design/RULINGS.md': rulings('1', '2', '3'),
      'design/DECISIONS.md': '### Decision 4\n- a\n### Decision @a.1\n- b\n### Decision @a.2\n- c\n',
      'src/a.ts': '// Rulings @a.1 to .3 apply here.\n// Decisions 4 and @a.1, .2\n// Rulings @a.1 through @a.2, and @a.2-.3\n',
    });
    expect(result.problems).toEqual([]);
    expect(result.files['src/a.ts']).toBe('// Rulings 2 to 4 apply here.\n// Decisions 4 and 5, 6\n// Rulings 2 through 3, and 3-4\n');
  });

  it('refuses a range whose ids did not become one unbroken run, and leaves it as written', () => {
    const text = 'See Rulings @a.1 to .3.\n';
    // Allocated in heading order: @a.1 is 2, @a.3 is 3, @a.2 is 4, so "2 to 3" would drop @a.2.
    const result = allocate({ 'design/RULINGS.md': rulings('1', '3', '2'), 'design/notes.md': text });
    expect(result.files['design/notes.md']).toBe(text);
    expect(result.problems).toEqual([
      {
        path: 'design/notes.md',
        ids: ['Ruling @a.1', 'Ruling @a.3'],
        detail:
          'cites the range "Rulings @a.1 to .3", but those ids became Rulings 2, 4 and 3, which are not ' +
          'one unbroken run of numbers. Write each id out as a list on the branch (for example ' +
          '"Rulings @a.1, @a.2 and @a.3"), and merge again.',
      },
    ]);
  });

  it('refuses a range with an id in it that no entry is headed, or with a real number at one end', () => {
    const result = allocate({
      'design/RULINGS.md': rulings('1', '3'),
      'design/notes.md': 'See Rulings @a.1 to .3. Also Rulings 1 to @a.3.\n',
    });
    expect(result.files['design/notes.md']).toBe('See Rulings @a.1 to .3. Also Rulings 1 to @a.3.\n');
    expect(result.problems.map((p) => p.ids)).toEqual([['Ruling @a.1', 'Ruling @a.3'], ['Ruling @a.3']]);
    expect(result.problems[0].detail).toContain('no entry is headed Ruling @a.2');
    expect(result.problems[1].detail).toContain('runs from a real number to a provisional id');
  });

  it('reads no range before a real number: a range of real numbers, or a number after a provisional id', () => {
    const text = 'Rulings 1 to 3 hold. Ruling @a.1 - 2 players only. Ruling @a.1 to 3 players.\n';
    const result = allocate({ 'design/RULINGS.md': rulings('1'), 'design/notes.md': text });
    expect(result.problems).toEqual([]);
    expect(result.files['design/notes.md']).toBe('Rulings 1 to 3 hold. Ruling 2 - 2 players only. Ruling 2 to 3 players.\n');
  });
});

/**
 * #1363: a `.N` past a word or parenthetical after its provisional id (`Decision @a.2 supersedes .1`)
 * is not in the id's list, so it was left as written and named nothing after the merge. The merge
 * cannot tell such a `.N` from prose, so it refuses it when that slug's id N has an entry.
 */
describe('a shortened id outside its provisional id\'s list (#1363)', () => {
  const DECISIONS = NUMBERED_LEDGER_SPECS.find((s) => s.kind === 'Decision')!;
  const allocate = (notes: string) =>
    allocateProvisional(
      { 'design/DECISIONS.md': '### Decision 1\n\n### Decision @a.1\n\n### Decision @a.2\n', 'design/notes.md': notes },
      [{ spec: DECISIONS, path: 'design/DECISIONS.md' }],
    );

  it('refuses a .N separated from its provisional id by a word or a parenthetical', () => {
    const result = allocate('Decision @a.2 supersedes .1.\nDecisions @a.1 (first) and .2 (second).\n');
    expect(result.problems).toEqual([
      {
        path: 'design/notes.md',
        ids: [],
        detail:
          'writes ".1" after Decision @a.2, but not in a list with it, so the merge cannot read it as ' +
          'Decision @a.1 and would leave it naming nothing. Write the id in full on the branch (for example ' +
          '"Decision @a.1"), and merge again.',
      },
      {
        path: 'design/notes.md',
        ids: [],
        detail:
          'writes ".2" after Decision @a.1, but not in a list with it, so the merge cannot read it as ' +
          'Decision @a.2 and would leave it naming nothing. Write the id in full on the branch (for example ' +
          '"Decision @a.2"), and merge again.',
      },
    ]);
  });

  it('reads no id in a .N that names no entry, is part of a word or number, or is in another paragraph', () => {
    const notes = 'Decision @a.1 halves it to .5, per p.2 and 0.2 and .2em.\n\n.2 of the deck is drawn.\nDecision @a.1 and Decision .2\n';
    expect(allocate(notes).problems).toEqual([]);
  });

  it('reads no id in code past the comment that cites the provisional id, or in a quoted .N', () => {
    const code = "// Decision @a.1: halve the rate, split on '.2'\nconst rate = .2;\n";
    const result = allocateProvisional(
      { 'design/DECISIONS.md': '### Decision @a.1\n\n### Decision @a.2\n', 'src/game.ts': code },
      [{ spec: DECISIONS, path: 'design/DECISIONS.md' }],
    );
    expect(result.problems).toEqual([]);
  });

  it('reads a blank comment line, and a blank line in a CRLF file, as the end of the paragraph', () => {
    const files = {
      'design/DECISIONS.md': '### Decision @a.1\n\n### Decision @a.2\n',
      'src/game.ts': '/**\n * Decision @a.1 sets the deck.\n *\n * .2 of the deck is drawn.\n */\n',
      'design/notes.md': 'Decision @a.1 sets the deck.\r\n\r\n.2 of the deck is drawn.\r\n',
    };
    expect(allocateProvisional(files, [{ spec: DECISIONS, path: 'design/DECISIONS.md' }]).problems).toEqual([]);
  });

  it('refuses a .N on a later comment line of the same paragraph', () => {
    const files = {
      'design/DECISIONS.md': '### Decision @a.1\n\n### Decision @a.2\n',
      'src/game.ts': '// Decision @a.1 sets the deck, and\n// .2 draws from it.\nexport const x = 1;\n',
    };
    const result = allocateProvisional(files, [{ spec: DECISIONS, path: 'design/DECISIONS.md' }]);
    expect(result.problems.map((p) => p.detail)).toEqual([expect.stringMatching(/^writes "\.2" after Decision @a\.1,/)]);
  });
});

describe('shorthand the merge cannot read (#446)', () => {
  it('names a dash then a plain number after a provisional id, and a shortened id after a kind word', () => {
    const text = 'Rulings @a.1-3 apply. Rulings @a.1 and Decision .2 too. Ruling @a.1 - .2 and Ruling 4-5 are fine.\n';
    expect(unreadableShorthand('design/notes.md', text)).toEqual(['@a.1-3', 'Decision .2']);
    expect(unreadableShorthand('design/notes.md', 'quoted: `Rulings @a.1-3`, and 0.5 seconds\n')).toEqual([]);
  });
});

/**
 * #1389: a list may wrap after a kind word, so `Decision\n.2` is the same shortened id as `Decision .2`,
 * in an LF or CRLF file or on the next line of a comment. It was not caught, so it was refused under the
 * kind of the provisional id before it, or merged naming nothing.
 */
describe('a shortened id on the line after its kind word (#1389)', () => {
  it('names it as written on one line, in an LF or CRLF file or a wrapped comment', () => {
    expect(unreadableShorthand('design/notes.md', 'Rulings @a.1 and Decision\n.2.\n')).toEqual(['Decision .2']);
    expect(unreadableShorthand('design/notes.md', 'See Decisions\r\n.2 too.\r\n')).toEqual(['Decisions .2']);
    expect(unreadableShorthand('src/game.ts', '// See Decision\n//   .2 too.\n')).toEqual(['Decision .2']);
  });

  it('names nothing across a blank line', () => {
    expect(unreadableShorthand('design/notes.md', 'See Decision\n\n.2 of the deck.\n')).toEqual([]);
    expect(unreadableShorthand('design/notes.md', 'See Decision\r\n\r\n.2 of the deck.\r\n')).toEqual([]);
  });

  it('does not refuse it again under the kind of the provisional id before it', () => {
    const RULINGS = NUMBERED_LEDGER_SPECS.find((s) => s.kind === 'Ruling')!;
    const result = allocateProvisional(
      {
        'design/RULINGS.md': '### Ruling @trading.1\n\n### Ruling @trading.2\n',
        'design/notes.md': 'Prices follow Rulings @trading.1 and Decision\r\n.2.\r\n',
      },
      [{ spec: RULINGS, path: 'design/RULINGS.md' }],
    );
    expect(result.problems).toEqual([]);
  });

  it('reads a list that wraps after its kind word in a CRLF file as it does in an LF one', () => {
    expect(provisionalReferences('design/notes.md', 'Rulings 8 and\r\n@a.1.\r\n')).toEqual(['Ruling @a.1']);
  });
});

/**
 * #1390: `G.2` after a constraint letter was neither read as a citation nor refused, so it merged naming
 * nothing. It is refused only where it would name an id the merge allocated, since "Appendix G.2" is prose.
 */
describe('a shortened id straight after a constraint letter (#1390)', () => {
  const G = NUMBERED_LEDGER_SPECS.find((s) => s.kind === 'G')!;
  const problemsIn = (path: string, text: string) =>
    allocateProvisional({ 'design/CONSTRAINTS.md': '### G@a.1\n\n### G@a.2\n', [path]: text }, [
      { spec: G, path: 'design/CONSTRAINTS.md' },
    ]).problems.map((p) => p.detail);

  it('refuses it after a provisional id in its paragraph, as the id of the letter written', () => {
    expect(problemsIn('design/notes.md', 'See G@a.1 and G.2.\n')).toEqual([
      'writes "G.2" after G@a.1, but a shortened id is never read after a constraint letter, so the merge cannot ' +
        'read it as G@a.2 and would leave it naming nothing. Write the id in full on the branch (for example ' +
        '"G@a.2"), and merge again.',
    ]);
    expect(problemsIn('design/notes.md', 'Prices follow Ruling @a.1, within G.2.\n')).toEqual([
      expect.stringMatching(/^writes "G\.2" after Ruling @a\.1, .* read it as G@a\.2 /),
    ]);
  });

  it('leaves prose and code that name no allocated id alone', () => {
    expect(problemsIn('design/notes.md', 'See Appendix C.3, Table G.2 and G.2.1.\n')).toEqual([]);
    expect(problemsIn('design/notes.md', 'See G@a.1.\n\nAppendix G.2 has the rest.\n')).toEqual([]);
    expect(problemsIn('design/notes.md', 'See G@a.1 and G.5, `G.2`, PG.2.\n')).toEqual([]);
    expect(problemsIn('src/game.ts', '// See G@a.1.\nconst version = "G.2";\n')).toEqual([]);
  });
});
