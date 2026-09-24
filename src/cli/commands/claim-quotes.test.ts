import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { checkClaimQuotes, claimQuoteCheckCommand, parseInterpretationQuotes } from './claim-quotes.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { spawnCli } from '../spawn-cli.test-helper.js';

/**
 * `claim-quote-check` is issue #289's code gate: every `## Interpretation` claim carries the exact
 * source passage it rests on and where that passage lives, and the passage must actually be there.
 * A claim the source does not back is not a claim at all; it is an open question for the ask step,
 * and it must show where the agent looked. Both rulebook-sourced and code-sourced projects are
 * covered, because a rulebook section and a line range in archived code are cited differently.
 */

let project: string;

const RULEBOOK_SLICE = `# Combat

## The exchange

All combat resolves through one exchange.
Ties favour combatant 2: an equal roll sends damage
to combatant 1.

## Armour

Armour subtracts from damage.
`;

const RULINGS = `# Rulings

## Ledger

### Ruling 1

Decision: a partial heal restores half, rounded down.
`;

const CODE_SOURCE = [
  'sub fight {',
  '  my ($roll1, $roll2) = @_;',
  '  if ($roll1 > $roll2) {',
  '    return 2;',
  '  }',
  '  return 1;',
  '}',
].join('\n');

async function write(rel: string, text: string): Promise<void> {
  const abs = join(project, rel);
  await fs.mkdir(dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
}

async function writeChunk(interpretation: string): Promise<void> {
  await write(
    'design/chunks/combat/CHUNK.md',
    `# Chunk: combat

## Interpretation
<!-- 1. **example inside a comment is never parsed** -->

${interpretation}

## Visibility Declaration

none — no hidden information in this chunk
`,
  );
}

/** Writes the Interpretation, runs the check, and returns its refusals. */
async function refusalsFor(interpretation: string): Promise<string[]> {
  await writeChunk(interpretation);
  return (await checkClaimQuotes(project, 'combat')).refusals;
}

beforeEach(async () => {
  project = tempTree('bs-claim-quotes-');
  await write('design/rulebook/08-combat.md', RULEBOOK_SLICE);
  await write('design/RULINGS.md', RULINGS);
  await write('old/lib/combat.pm', CODE_SOURCE);
});

describe('checkClaimQuotes: rulebook-sourced claims', () => {
  it('accepts a claim whose quote appears in the cited section, across wrapped lines', async () => {
    await writeChunk(`1. **Ties go against combatant 1.**
   > Ties favour combatant 2: an equal roll sends damage to combatant 1.
   Source: rulebook/08-combat.md §"The exchange"`);
    const result = await checkClaimQuotes(project, 'combat');
    expect(result.refusals).toEqual([]);
    expect(result.claims).toEqual([
      {
        number: 1,
        superseded: false,
        quotes: [
          {
            quote: 'Ties favour combatant 2: an equal roll sends damage to combatant 1.',
            source: 'rulebook/08-combat.md §"The exchange"',
            found: true,
          },
        ],
      },
    ]);
  });

  it('accepts a quote from a RULINGS.md entry cited by its heading', async () => {
    const refusals = await refusalsFor(`1. **A partial heal restores half.**
   > a partial heal restores half, rounded down.
   Source: RULINGS.md §"Ruling 1"`);
    expect(refusals).toEqual([]);
  });

  it('refuses a claim with no quote and routes it to an open question', async () => {
    const refusals = await refusalsFor(`1. **Ties go against combatant 1.** — cites rulebook/08-combat.md`);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/Claim 1 has no quoted passage/);
    expect(refusals[0]).toMatch(/open question/);
  });

  it('refuses a paraphrase: the quote is not in the cited section', async () => {
    await writeChunk(`1. **Ties go against the attacker.**
   > Ties favour the defender.
   Source: rulebook/08-combat.md §"The exchange"`);
    const result = await checkClaimQuotes(project, 'combat');
    expect(result.refusals).toHaveLength(1);
    expect(result.refusals[0]).toMatch(/Claim 1/);
    expect(result.refusals[0]).toMatch(/not found/);
    expect(result.claims[0].quotes[0].found).toBe(false);
  });

  it('refuses a quote that exists in the file but under a different section than cited', async () => {
    const refusals = await refusalsFor(`1. **Armour subtracts.**
   > Armour subtracts from damage.
   Source: rulebook/08-combat.md §"The exchange"`);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/not found/);
  });

  it('refuses a citation to a section that does not exist, naming the sections that do', async () => {
    const refusals = await refusalsFor(`1. **Armour subtracts.**
   > Armour subtracts from damage.
   Source: rulebook/08-combat.md §"Armor"`);
    expect(refusals[0]).toMatch(/no heading "Armor"/);
    expect(refusals[0]).toMatch(/Armour/);
  });

  it('refuses a citation to a file that does not exist', async () => {
    const refusals = await refusalsFor(`1. **Armour subtracts.**
   > Armour subtracts from damage.
   Source: rulebook/09-missing.md §"Armour"`);
    expect(refusals[0]).toMatch(/no file at design\/rulebook\/09-missing\.md/);
  });

  it('refuses a citation with no section or line range', async () => {
    const refusals = await refusalsFor(`1. **Armour subtracts.**
   > Armour subtracts from damage.
   Source: rulebook/08-combat.md`);
    expect(refusals[0]).toMatch(/does not say where in the file/);
  });

  it('refuses a quote with no Source line, and a Source line with no quote', async () => {
    const refusals = await refusalsFor(`1. **Armour subtracts.**
   > Armour subtracts from damage.

2. **Ties.**
   Source: rulebook/08-combat.md §"The exchange"`);
    expect(refusals.some((r) => /Claim 1: a quoted passage is not followed by a `Source:` line/.test(r))).toBe(true);
    expect(refusals.some((r) => /Claim 2: a `Source:` line has no quoted passage/.test(r))).toBe(true);
  });

  it('refuses a source path that leaves the project', async () => {
    const refusals = await refusalsFor(`1. **Armour subtracts.**
   > Armour subtracts from damage.
   Source: ../../elsewhere.md §"Armour"`);
    expect(refusals[0]).toMatch(/outside this project/);
  });

  it('does not check a claim a later claim supersedes', async () => {
    await writeChunk(`1. **Ties go against the attacker.**
   > Ties favour the defender.
   Source: rulebook/08-combat.md §"The exchange"

2. **Ties go against combatant 1.** Supersedes claim 1 per redteam objection.
   > Ties favour combatant 2
   Source: rulebook/08-combat.md §"The exchange"`);
    const result = await checkClaimQuotes(project, 'combat');
    expect(result.refusals).toEqual([]);
    expect(result.claims.find((c) => c.number === 1)?.superseded).toBe(true);
  });
});

describe('checkClaimQuotes: code-sourced claims', () => {
  it('accepts a quote found inside the cited line range', async () => {
    const refusals = await refusalsFor(`1. **The higher roll wins; a tie goes to combatant 1.**
   > if ($roll1 > $roll2) {
   Source: ../old/lib/combat.pm:2-4`);
    expect(refusals).toEqual([]);
  });

  it('refuses a quote outside the cited line range', async () => {
    const refusals = await refusalsFor(`1. **The higher roll wins.**
   > if ($roll1 > $roll2) {
   Source: ../old/lib/combat.pm:5-7`);
    expect(refusals[0]).toMatch(/not found/);
  });

  it('refuses a line range past the end of the file', async () => {
    const refusals = await refusalsFor(`1. **The higher roll wins.**
   > if ($roll1 > $roll2) {
   Source: ../old/lib/combat.pm:3-40`);
    expect(refusals[0]).toMatch(/has 7 lines/);
  });

  it('refuses a section citation into code: code is cited by line', async () => {
    const refusals = await refusalsFor(`1. **The higher roll wins.**
   > if ($roll1 > $roll2) {
   Source: ../old/lib/combat.pm §"fight"`);
    expect(refusals[0]).toMatch(/cite it by line/);
  });
});

describe('checkClaimQuotes: open questions', () => {
  it('accepts an open question that shows where it looked, and reports it for the ask step', async () => {
    await writeChunk(`1. **Ties go against combatant 1.**
   > Ties favour combatant 2
   Source: rulebook/08-combat.md §"The exchange"

Q1. **Does armour apply to healing?** The source is silent.
   Searched: rulebook/08-combat.md §"Armour"
   Searched: RULINGS.md §"Ruling 1"`);
    const result = await checkClaimQuotes(project, 'combat');
    expect(result.refusals).toEqual([]);
    expect(result.questions).toEqual([
      { id: 'Q1', searched: ['rulebook/08-combat.md §"Armour"', 'RULINGS.md §"Ruling 1"'] },
    ]);
  });

  it('refuses an open question that does not show where it looked', async () => {
    const refusals = await refusalsFor(`Q1. **Does armour apply to healing?** The rules are missing.`);
    expect(refusals[0]).toMatch(/Q1 does not show where it looked/);
  });

  it('refuses an open question whose searched location does not exist', async () => {
    const refusals = await refusalsFor(`Q1. **Where are the rumour texts?**
   Searched: rulebook/12-rumours.md §"Rumours"`);
    expect(refusals[0]).toMatch(/Q1/);
    expect(refusals[0]).toMatch(/no file at design\/rulebook\/12-rumours\.md/);
  });
});

describe('checkClaimQuotes: the section itself', () => {
  it('refuses an Interpretation with nothing in it', async () => {
    await writeChunk('');
    const result = await checkClaimQuotes(project, 'combat');
    expect(result.refusals[0]).toMatch(/no claims and no open questions/);
  });

  it('refuses a CHUNK.md with no Interpretation section', async () => {
    await write('design/chunks/combat/CHUNK.md', '# Chunk: combat\n');
    const result = await checkClaimQuotes(project, 'combat');
    expect(result.refusals[0]).toMatch(/has no "## Interpretation" section/);
  });

  it('parses nothing out of HTML comments', () => {
    const parsed = parseInterpretationQuotes(
      '## Interpretation\n<!-- 1. **not a claim**\n   > nor a quote\n   Source: x.md:1 -->\n',
    );
    expect(parsed).toEqual({ claims: [], questions: [] });
  });
});

describe('claimQuoteCheckCommand', () => {
  const exitCode = process.exitCode;
  afterEach(() => {
    process.exitCode = exitCode;
    vi.restoreAllMocks();
  });

  it('exits non-zero and explains every refusal', async () => {
    await writeChunk(`1. **Ties go against the attacker.**`);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((m: unknown) => void errors.push(String(m)));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await claimQuoteCheckCommand('combat', { project });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/Claim 1 has no quoted passage/);
  });

  it('exits zero when every claim is backed, and prints the quotes as JSON without claim text', async () => {
    await writeChunk(`1. **Ties go against combatant 1 (paraphrase).**
   > Ties favour combatant 2
   Source: rulebook/08-combat.md §"The exchange"`);
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    process.exitCode = 0;
    await claimQuoteCheckCommand('combat', { project, json: true });
    expect(process.exitCode).toBe(0);
    const out = JSON.parse(logs.join('\n'));
    expect(out.ok).toBe(true);
    expect(out.claims[0].quotes[0].quote).toBe('Ties favour combatant 2');
    expect(JSON.stringify(out)).not.toMatch(/paraphrase/);
  });

  it('refuses a slug that is a path', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((m: unknown) => void errors.push(String(m)));
    await claimQuoteCheckCommand('../combat', { project });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/is a path, not a name/);
  });

  it('explains a missing CHUNK.md', async () => {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((m: unknown) => void errors.push(String(m)));
    await claimQuoteCheckCommand('nope', { project });
    expect(process.exitCode).toBe(1);
    expect(errors.join('\n')).toMatch(/No CHUNK\.md at design\/chunks\/nope\/CHUNK\.md/);
  });
});

describe('claim-quote-check through the real CLI entry point', () => {
  vi.setConfig({ testTimeout: 60_000 });

  // One spawn: the refusal is what has to survive the real entry point. The exit-0 path is the
  // same command function, and the in-process tests above prove it (#340).
  it('is registered and exits 1 on an unquoted claim', async () => {
    await writeChunk(`1. **Ties go against combatant 1.**`);
    const refused = await spawnCli(['claim-quote-check', 'combat', '--project', project]);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toMatch(/Claim 1 has no quoted passage/);
  });
});

describe('the CHUNK.md template', () => {
  it('scaffolds an Interpretation the check refuses until a real quote and Source are written', async () => {
    const template = await fs.readFile(
      new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
      'utf-8',
    );
    await write('design/chunks/combat/CHUNK.md', template);
    const refusals = (await checkClaimQuotes(project, 'combat')).refusals;
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/Claim 1: a location line is empty/);
  });
});
