import { describe, it, expect } from 'vitest';
import { SKILL_FILES, skillMarkdown } from '../slash-command/skill-markdown.test-helper.js';
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

/** Each `unreadableShorthand` as written, for the tests that pin what it reads, not where. */
const shorthandWritten = (path: string, text: string): string[] => unreadableShorthand(path, text).map((s) => s.written);

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

  // #1393: a CRLF blank line was not read as one, so a stray backtick quoted every paragraph up to the next.
  it('ends a code span at a blank line, and closes a wrapped span and a fenced block, in an LF or a CRLF file', () => {
    for (const eol of ['\n', '\r\n']) {
      const text = `a \`b${eol}${eol}See Decision${eol}.2 and Ruling @a.1 \`c.${eol}`;
      expect({ eol, shorthand: shorthandWritten('design/notes.md', text) }).toEqual({ eol, shorthand: ['Decision .2'] });
      expect({ eol, cites: provisionalReferences('design/notes.md', text) }).toEqual({ eol, cites: ['Ruling @a.1'] });
      const quoted = `\`Ruling${eol}@x.1\` and${eol}\`\`\`${eol}Ruling @x.2${eol}\`\`\`${eol}Ruling @a.1${eol}`;
      expect({ eol, cites: provisionalReferences('design/notes.md', quoted) }).toEqual({ eol, cites: ['Ruling @a.1'] });
    }
  });

  // #1396: a line holding only `>` ends a paragraph in a blockquote, but did not end a code span.
  it('ends a code span at a blockquote line holding only quote markers, in an LF or a CRLF file', () => {
    const quotes = [['> ', '>'], ['> ', ' > '], ['> > ', '> >'], ['>> ', '>>'], ['> > ', '>\t>']];
    for (const eol of ['\n', '\r\n']) {
      for (const [prefix, lone] of quotes) {
        const text = `${prefix}a \`b${eol}${lone}${eol}${prefix}See Ruling @a.1 and \`c${eol}`;
        expect({ eol, lone, cites: provisionalReferences('design/notes.md', text) }).toEqual({ eol, lone, cites: ['Ruling @a.1'] });
        const wrapped = `${prefix}see \`Ruling${eol}${prefix}@x.1\` here${eol}`;
        expect({ eol, lone, cites: provisionalReferences('design/notes.md', wrapped) }).toEqual({ eol, lone, cites: [] });
        for (const fence of ['```', '~~~']) {
          const block = `${prefix}${fence}${eol}${prefix}Ruling @x.1${eol}${lone}${eol}${prefix}${fence}${eol}${prefix}Ruling @a.1${eol}`;
          expect({ eol, lone, fence, cites: provisionalReferences('design/notes.md', block) }).toEqual({ eol, lone, fence, cites: ['Ruling @a.1'] });
          // A fence the quote ends without closing ends with the quote.
          const unclosed = `${prefix}${fence}${eol}${prefix}Ruling @x.1${eol}${lone}${eol}${eol}Ruling @a.1${eol}`;
          expect({ eol, lone, fence, cites: provisionalReferences('design/notes.md', unclosed) }).toEqual({ eol, lone, fence, cites: ['Ruling @a.1'] });
        }
      }
      // Indented four spaces, a `>` is paragraph text, so the span runs on past it.
      const indented = `see \`Ruling${eol}    >${eol}@x.1\` here${eol}`;
      expect({ eol, cites: provisionalReferences('design/notes.md', indented) }).toEqual({ eol, cites: [] });
    }
  });

  // #1397: a heading is a block of its own line(s), but a span ran into it and out of it.
  it('ends a code span at an ATX heading line and a setext = underline, in an LF or a CRLF file', () => {
    for (const eol of ['\n', '\r\n']) {
      const ended = [
        `## Uses \`x${eol}See Ruling @a.1 and \`y${eol}`,
        `#   Uses \`x ##${eol}See Ruling @a.1 and \`y${eol}`,
        `> ## Uses \`x${eol}> See Ruling @a.1 and \`y${eol}`,
        `a \`b${eol}## See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}#${eol}See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}   ###### c${eol}See Ruling @a.1 and \`d${eol}`,
        `a \`b${eol}===${eol}See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}  = ${eol}See Ruling @a.1 and \`c${eol}`,
        `> a \`b${eol}> ===${eol}> See Ruling @a.1 and \`c${eol}`,
      ];
      for (const text of ended) {
        expect({ text, cites: provisionalReferences('design/notes.md', text) }).toEqual({ text, cites: ['Ruling @a.1'] });
      }
      // Paragraph text, not a heading line, so the span runs on past it.
      const running = ['#hashtag', '####### seven', '    # indented', '\\# escaped', '= =', '=== x'];
      for (const line of running) {
        const text = `see \`Ruling${eol}${line}${eol}@x.1\` here${eol}`;
        expect({ line, cites: provisionalReferences('design/notes.md', text) }).toEqual({ line, cites: [] });
      }
    }
  });

  // #1401: a blockquote, a list item and a thematic break or - underline each end a paragraph, but a span ran past them.
  it('ends a code span at a line that starts a blockquote, a list item or a thematic break, in an LF or a CRLF file', () => {
    for (const eol of ['\n', '\r\n']) {
      const ended = [
        `a \`b${eol}> See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}   >See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}- See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}+\tSee Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}* See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}1. See Ruling @a.1 and \`c${eol}`,
        `- a \`b${eol}- See Ruling @a.1 and \`c${eol}`,
        `> a \`b${eol}> - See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}---${eol}See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}-${eol}See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}***${eol}See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol} _ _ _ ${eol}See Ruling @a.1 and \`c${eol}`,
        `a \`b${eol}- - -${eol}See Ruling @a.1 and \`c${eol}`,
        `> a \`b${eol}> ***${eol}> See Ruling @a.1 and \`c${eol}`,
      ];
      for (const text of ended) {
        expect({ text, cites: provisionalReferences('design/notes.md', text) }).toEqual({ text, cites: ['Ruling @a.1'] });
      }
      // Paragraph text, not a block start, so the span runs on past it.
      const running = ['-not a list', '+', '* ', '1.', '2. two', '1.5 apples', '-- two', '**bold**', '_ _', '    - indented', '\\- escaped', 'a > b'];
      for (const line of running) {
        const text = `see \`Ruling${eol}${line}${eol}@x.1\` here${eol}`;
        expect({ line, cites: provisionalReferences('design/notes.md', text) }).toEqual({ line, cites: [] });
      }
      // A comment over a quote's line breaks keeps them quoted, so the next quote line continues the span.
      const commented = `> x <!-- c${eol}> d --> \`Ruling${eol}> @x.1\` here${eol}`;
      expect({ eol, cites: provisionalReferences('design/notes.md', commented) }).toEqual({ eol, cites: [] });
    }
  });

  // micromark lets only a one-digit 1 interrupt a paragraph, though CommonMark's start number of 01 is 1 (micromark/micromark#254).
  it.fails('ends a code span at a list item numbered 01, once micromark/micromark#254 is fixed', () => {
    expect(provisionalReferences('design/notes.md', 'a `b\n  01) See Ruling @a.1 and `c\n')).toEqual(['Ruling @a.1']);
  });

  // #1401 review: a quote prefix the pattern could split two ways at each marker took twice as long per marker.
  it('reads a line of many quote markers in one pass', () => {
    const markers = '> '.repeat(48);
    expect(provisionalReferences('design/notes.md', `a \`b\n${markers}See Ruling @a.1 and \`c\n`)).toEqual(['Ruling @a.1']);
    expect(provisionalReferences('design/notes.md', `${markers}x\n${markers}See Ruling @a.1\n`)).toEqual(['Ruling @a.1']);
  });

  it('finds no citation in any shipped template or skill file, so they pass chunk-merge unchanged', async () => {
    const markdown = SKILL_FILES.filter((f) => f.startsWith('bs/')).map((f) => f.slice('bs/'.length));
    expect(markdown.length).toBeGreaterThan(10);
    for (const file of markdown) {
      const text = skillMarkdown(`bs/${file}`);
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
    expect(provisionalReferences('design/a.md', '> per Ruling\n> @a.1 here')).toEqual(['Ruling @a.1']);
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

  // #1400: a line holding only nested quote markers was not read as the end of the paragraph.
  it('reads a line holding only quote markers as the end of a blockquote paragraph, in an LF or a CRLF file', () => {
    const quotes = [['> ', '>'], ['> > ', '> >'], ['>> ', '>>'], ['> > ', ' >\t> ']];
    for (const eol of ['\n', '\r\n']) {
      for (const [prefix, lone] of quotes) {
        const split = `${prefix}Decision @a.1 sets the deck.${eol}${lone}${eol}${prefix}.2 of the deck is drawn.${eol}`;
        expect({ eol, lone, problems: allocate(split).problems }).toEqual({ eol, lone, problems: [] });
        const joined = `${prefix}Decision @a.1 sets the deck.${eol}${prefix}.2 of the deck is drawn.${eol}`;
        expect({ eol, lone, problems: allocate(joined).problems.length }).toEqual({ eol, lone, problems: 1 });
      }
    }
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
    expect(shorthandWritten('design/notes.md', text)).toEqual(['@a.1-3', 'Decision .2']);
    expect(shorthandWritten('design/notes.md', 'quoted: `Rulings @a.1-3`, and 0.5 seconds\n')).toEqual([]);
  });
});

/**
 * #1389: a list may wrap after a kind word, so `Decision\n.2` is the same shortened id as `Decision .2`,
 * in an LF or CRLF file or on the next line of a comment. It was not caught, so it was refused under the
 * kind of the provisional id before it, or merged naming nothing.
 */
describe('a shortened id on the line after its kind word (#1389)', () => {
  it('names it as written on one line, in an LF or CRLF file or a wrapped comment', () => {
    expect(shorthandWritten('design/notes.md', 'Rulings @a.1 and Decision\n.2.\n')).toEqual(['Decision .2']);
    expect(shorthandWritten('design/notes.md', 'See Decisions\r\n.2 too.\r\n')).toEqual(['Decisions .2']);
    expect(shorthandWritten('src/game.ts', '// See Decision\n//   .2 too.\n')).toEqual(['Decision .2']);
  });

  it('gives the lines it starts and ends on (#1399)', () => {
    expect(unreadableShorthand('design/notes.md', 'Intro.\nRulings @a.1 and Decision\n.2, and @a.1-3.\n')).toEqual([
      { written: 'Decision .2', firstLine: 2, lastLine: 3 },
      { written: '@a.1-3', firstLine: 3, lastLine: 3 },
    ]);
  });

  it('names nothing across a blank line', () => {
    expect(shorthandWritten('design/notes.md', 'See Decision\n\n.2 of the deck.\n')).toEqual([]);
    expect(shorthandWritten('design/notes.md', 'See Decision\r\n\r\n.2 of the deck.\r\n')).toEqual([]);
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

/**
 * #1394: a dash range may wrap after its dash, like a list after its kind word (#1389), so
 * `@a.1 -\n3` is the same unreadable shorthand as `@a.1 - 3`, and `@a.1 -\n.3` the same range as
 * `@a.1 - .3`. The wrapped number was not caught, so the merge rewrote `@a.1` and named nothing.
 */
describe('a dash range wrapped after its dash (#1394)', () => {
  const ledger = '### Ruling @a.1\n\n### Ruling @a.2\n\n### Ruling @a.3\n';
  const allocate = (notes: string) =>
    allocateProvisional({ 'design/RULINGS.md': ledger, 'design/notes.md': notes }, [{ spec: RULINGS, path: 'design/RULINGS.md' }]);

  it('names a dash then a plain number on the next line as written on one line, in an LF or CRLF file or a wrapped comment', () => {
    expect(shorthandWritten('design/notes.md', 'Rulings @a.1 -\n3 apply.\n')).toEqual(['@a.1 - 3']);
    expect(shorthandWritten('design/notes.md', 'Rulings @a.1-\r\n3 apply.\r\n')).toEqual(['@a.1- 3']);
    expect(shorthandWritten('src/game.ts', '// Rulings @a.1 –\n//   3 apply.\n')).toEqual(['@a.1 – 3']);
  });

  it('names nothing across a blank line', () => {
    expect(shorthandWritten('design/notes.md', 'Rulings @a.1 -\n\n3 players.\n')).toEqual([]);
    expect(shorthandWritten('design/notes.md', 'Rulings @a.1 -\r\n\r\n3 players.\r\n')).toEqual([]);
    expect(shorthandWritten('src/game.ts', '// Rulings @a.1 -\n//\n// 3 players.\n')).toEqual([]);
  });

  it('names nothing when the number opens a line of code after the comment', () => {
    expect(shorthandWritten('src/data.ts', 'const PRICES = [ // Ruling @a.1 -\n  3, 5, 8,\n];\n')).toEqual([]);
  });

  it('reads a range wrapped after its dash, in an LF or CRLF file, as it does on one line', () => {
    expect(allocate('Rulings @a.1 -\n.3 apply.\n')).toMatchObject({ files: { 'design/notes.md': 'Rulings 1 -\n3 apply.\n' }, problems: [] });
    expect(allocate('Rulings @a.1 -\r\n@a.3 apply.\r\n')).toMatchObject({
      files: { 'design/notes.md': 'Rulings 1 -\r\n3 apply.\r\n' },
      problems: [],
    });
    expect(allocateProvisional({ 'design/RULINGS.md': ledger, 'src/game.ts': '// Rulings @a.1 -\n//   .3 apply.\n' }, [{ spec: RULINGS, path: 'design/RULINGS.md' }])).toMatchObject({
      files: { 'src/game.ts': '// Rulings 1 -\n//   3 apply.\n' },
      problems: [],
    });
  });
});

/**
 * #1398: in Markdown a heading or a list item starts a new block, so it does not continue the line
 * before it, and a heading is one line. The line-wrap rule read `@a.1 -\n# 3 Player variant` as
 * `@a.1 - 3` and refused correct work.
 */
describe('a Markdown line that starts a block does not continue a wrapped line (#1398)', () => {
  it('reads no dash range or shortened id onto a heading, a list item or past a heading line, in an LF or CRLF file', () => {
    for (const eol of ['\n', '\r\n']) {
      for (const text of [
        `Changes since Ruling @a.1 -${eol}# 3 Player variant${eol}`,
        `Changes since Ruling @a.1 -${eol}1. Players draw first${eol}`,
        `Rulings @a.1 and Decision${eol}* .2 of the deck${eol}`,
        `## Changes since Ruling @a.1 -${eol}3 players draw first${eol}`,
      ]) {
        expect({ text, read: shorthandWritten('design/notes.md', text) }).toEqual({ text, read: [] });
      }
    }
  });

  it('gives an id on a list item or a new blockquote no kind from the line before it, in an LF or CRLF file', () => {
    for (const eol of ['\n', '\r\n']) {
      expect(provisionalReferences('design/notes.md', `Rulings @a.1 and${eol}* @b.2 is new${eol}`)).toEqual(['Ruling @a.1', '@b.2']);
      expect(provisionalReferences('design/notes.md', `per Ruling${eol}> @b.2 is new${eol}`)).toEqual(['@b.2']);
    }
  });

  it('reads no # or * on the next line as a comment marker, in an LF or CRLF file', () => {
    for (const eol of ['\n', '\r\n']) {
      expect(shorthandWritten('design/notes.md', `Rulings @a.1 -${eol}#3 players${eol}`)).toEqual([]);
      expect(shorthandWritten('design/notes.md', `Rulings @a.1 -${eol}*3 players*${eol}`)).toEqual([]);
    }
  });

  it('refuses no .N in the paragraph after a heading or on a list item as a stray of the id before it (#1398 review F1, F2)', () => {
    const allocate = (notes: string) =>
      allocateProvisional({ 'design/RULINGS.md': '### Ruling @a.1\n\n### Ruling @a.2\n', 'design/notes.md': notes }, [
        { spec: RULINGS, path: 'design/RULINGS.md' },
      ]).problems;
    for (const eol of ['\n', '\r\n']) {
      expect(allocate(`Rulings @a.1 and Decision${eol}* .2 of the deck${eol}`)).toEqual([]);
      expect(allocate(`## Changes since Ruling @a.1${eol}Players draw .2 cards first${eol}`)).toEqual([]);
    }
  });

  it('still reads a wrap inside a blockquote, nested or not, and a # comment line in source code', () => {
    expect(shorthandWritten('design/notes.md', '> Rulings @a.1 -\r\n> 3 apply.\r\n')).toEqual(['@a.1 - 3']);
    expect(shorthandWritten('design/notes.md', '> > Rulings @a.1 -\n> > 3 apply.\n')).toEqual(['@a.1 - 3']);
    expect(shorthandWritten('tools/deal.py', '# Rulings @a.1 -\n# 3 apply.\n')).toEqual(['@a.1 - 3']);
  });
});

/**
 * #1402, #1404: whether a line starts a block depends on the list item or blockquote it is in, and on
 * the columns a tab reaches, which no regex can track. A Markdown file is read with a CommonMark parser
 * (#1403), so a code span, a wrap and a stray `.N` each stay inside the paragraph the parser finds.
 */
describe('Markdown blocks inside lists and blockquotes (#1402, #1404)', () => {
  it('ends a code span where a list item or blockquote starts a block, and only there, in an LF or a CRLF file', () => {
    for (const eol of ['\n', '\r\n']) {
      const cases: Array<[string[], string[]]> = [
        // An unquoted = line after a quote or list paragraph continues it lazily, as text (#1402 case 1).
        [['> see `Ruling', '===', '@x.1` here'], []],
        [['- see `Ruling', '===', '@x.1` here'], []],
        // An underline may sit up to 3 spaces past the list item's content (#1402 case 2).
        [['1. a `b', '    ===', '    See Ruling @a.1 and `c'], ['Ruling @a.1']],
        // A > > line in a quote paragraph opens a nested quote (#1402 case 3).
        [['> a `b', '> > See Ruling @a.1 and `c'], ['Ruling @a.1']],
        // In a list, an item numbered 2 starts a sibling item (#1402 case 4).
        [['1. use `foo', '2. See Ruling @a.1 and `bar'], ['Ruling @a.1']],
        // A quote line after a lazy line is the same quote paragraph (#1402 case 5).
        [['> a `b', 'lazy text', '> See Ruling @a.1 and `c'], []],
        // A sublist at a content indent of 4 or more starts a block (#1402 case 6).
        [['10. a `b', '    - See Ruling @a.1 and `c'], ['Ruling @a.1']],
        // A space then a tab between quote markers reads as two markers (#1404).
        [['> > a `b', '> \t>', '> > See Ruling @a.1 and `c'], ['Ruling @a.1']],
        // An indented code block is code, as a fenced one is (#1403).
        [['Intro.', '', '    ### Ruling @x.1', '', 'Ruling @a.1'], ['Ruling @a.1']],
        // A comment the quote ends before its --> is still a comment, to the quote's end (#1403 review F1).
        [['> <!--', '> Ruling @x.1', '-->', '', 'Ruling @a.1'], ['Ruling @a.1']],
      ];
      for (const [lines, cites] of cases) {
        const text = lines.join(eol) + eol;
        expect({ text, cites: provisionalReferences('design/notes.md', text) }).toEqual({ text, cites });
      }
    }
  });

  it('reads no wrapped dash range onto the next list item or a nested one, in an LF or a CRLF file (#1402)', () => {
    for (const eol of ['\n', '\r\n']) {
      for (const lines of [
        ['1. Changes since Ruling @a.1 -', '2. Players draw first'],
        ['- Rules', '    - Ruling @a.1 -', '      1. three players'],
      ]) {
        const text = lines.join(eol) + eol;
        expect({ text, read: shorthandWritten('design/notes.md', text) }).toEqual({ text, read: [] });
      }
    }
  });

  it('reads a line of quote markers with a space then a tab between them as the end of a paragraph (#1404)', () => {
    const DECISIONS = NUMBERED_LEDGER_SPECS.find((s) => s.kind === 'Decision')!;
    for (const eol of ['\n', '\r\n']) {
      const notes = ['> > Decision @a.1 sets the deck.', '> \t>', '> > .2 of the deck is drawn.'].join(eol) + eol;
      const result = allocateProvisional(
        { 'design/DECISIONS.md': '### Decision @a.1\n\n### Decision @a.2\n', 'design/notes.md': notes },
        [{ spec: DECISIONS, path: 'design/DECISIONS.md' }],
      );
      expect({ eol, problems: result.problems }).toEqual({ eol, problems: [] });
    }
  });
});
