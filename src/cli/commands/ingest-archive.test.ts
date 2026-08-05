import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ingestArchiveCommand,
  ingestCheckCommand,
  ingestGapsCommand,
  ingestRelabelCommand,
  renderIndex,
  normalizeEdition,
  EDITION_EMPTY_LEXICON,
  INDEX_HEADINGS,
  HEADER_LABELS,
  EDITION_UNKNOWN,
  GAPS_EMPTY,
  GAPS_BEGIN,
  GAPS_END,
  ADDITIONAL_SOURCES_HEADING,
  ADDITIONAL_SOURCES_BEGIN,
  ADDITIONAL_SOURCES_END,
  parseAdditionalSources,
} from './ingest-archive.js';
import { computeVerificationScope } from './chunk-provenance.js';

/**
 * `ingest-archive` exists because nine successive attempts to get an ingest session to perform
 * these steps from skill-text instructions failed against live runs — it reads its skill files
 * at the start, then executes from recall. Copying a file, hashing it, and emitting four exact
 * header lines have one correct output, so they belong in code.
 *
 * These tests pin that output. The headings in particular are parsed by downstream tooling and
 * by `scripts/ingest-harness/check.mjs`; a "nicer" heading is the single most repeated failure
 * in this step's history.
 */

let dir: string;
let sourcePath: string;
const SOURCE_BYTES = Buffer.from('%PDF-1.4 fake rulebook bytes for testing\n');
const SOURCE_HASH = createHash('sha256').update(SOURCE_BYTES).digest('hex');

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-ingest-archive-'));
  sourcePath = join(dir, 'src-rules.pdf');
  await fs.writeFile(sourcePath, SOURCE_BYTES);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function run(opts: Parameters<typeof ingestArchiveCommand>[1] = {}) {
  const project = join(dir, 'game');
  await fs.mkdir(project, { recursive: true });
  await ingestArchiveCommand(sourcePath, { project, json: true, ...opts });
  return project;
}

describe('ingest-archive — archiving', () => {
  it('copies the source into rulebook/source/ preserving the filename', async () => {
    const project = await run();
    const archived = await fs.readFile(join(project, 'rulebook', 'source', 'src-rules.pdf'));
    expect(archived.equals(SOURCE_BYTES)).toBe(true);
  });

  it('leaves the designer original in place — copy, never move', async () => {
    await run();
    const original = await fs.readFile(sourcePath);
    expect(original.equals(SOURCE_BYTES)).toBe(true);
  });

  it('records the archived copy hash, matching the source', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain(`Source hash: ${SOURCE_HASH}`);
  });

  it('fails loudly on an unreadable path rather than writing a header for a missing archive', async () => {
    const project = join(dir, 'game2');
    await fs.mkdir(project, { recursive: true });
    await expect(
      ingestArchiveCommand(join(dir, 'nope.pdf'), { project, json: true }),
    ).rejects.toThrow(/not found or unreadable/);
    // Critically: no INDEX.md claiming provenance for a file that was never archived.
    await expect(fs.access(join(project, 'rulebook', 'INDEX.md'))).rejects.toThrow();
  });

  it('refuses to clobber a different archived rulebook', async () => {
    const project = await run();
    await fs.writeFile(join(project, 'rulebook', 'source', 'src-rules.pdf'), 'different bytes');
    await expect(ingestArchiveCommand(sourcePath, { project, json: true })).rejects.toThrow(
      /already exists .* and differs/,
    );
  });

  it('is idempotent when the archived copy is byte-identical', async () => {
    const project = await run();
    await expect(
      ingestArchiveCommand(sourcePath, { project, json: true }),
    ).resolves.toBeUndefined();
  });
});

// ===========================================================================================
// ingest-archive — MULTIPLE sources (177-19: doom-machine measurement, rules.pdf + cards.pdf)
//
// Before this plan, a second `ingest-archive <different-file>` call silently overwrote the
// first source's Source:/Source hash: header — the first source's provenance record was
// discarded entirely, with no error and no trace it had happened.
// ===========================================================================================

describe('ingest-archive — multiple sources (177-19)', () => {
  let rulesPath: string;
  let cardsPath: string;
  const RULES_BYTES = Buffer.from('%PDF-1.4 fake rules bytes\n');
  const CARDS_BYTES = Buffer.from('%PDF-1.4 fake cards bytes, different content\n');
  const RULES_HASH = createHash('sha256').update(RULES_BYTES).digest('hex');
  const CARDS_HASH = createHash('sha256').update(CARDS_BYTES).digest('hex');

  beforeEach(async () => {
    rulesPath = join(dir, 'rules.pdf');
    cardsPath = join(dir, 'cards.pdf');
    await fs.writeFile(rulesPath, RULES_BYTES);
    await fs.writeFile(cardsPath, CARDS_BYTES);
  });

  async function twoSourceProject(): Promise<string> {
    const project = join(dir, 'doom-machine');
    await fs.mkdir(project, { recursive: true });
    await ingestArchiveCommand(rulesPath, { project, json: true });
    await ingestArchiveCommand(cardsPath, { project, json: true });
    return project;
  }

  it('a second, DIFFERENT source does NOT overwrite the primary Source:/Source hash: header', async () => {
    const project = await twoSourceProject();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    // The primary pair is still rules.pdf's, untouched.
    expect(/^Source:\s*(.*)$/m.exec(index)![1].trim()).toBe('rulebook/source/rules.pdf');
    expect(/^Source hash:\s*(.*)$/m.exec(index)![1].trim()).toBe(RULES_HASH);
  });

  it('the second source is archived to disk and recorded in ## Additional Sources', async () => {
    const project = await twoSourceProject();
    const archivedCards = await fs.readFile(join(project, 'rulebook', 'source', 'cards.pdf'));
    expect(archivedCards.equals(CARDS_BYTES)).toBe(true);

    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain(ADDITIONAL_SOURCES_HEADING);
    const records = parseAdditionalSources(index);
    expect(records).toEqual([{ path: 'rulebook/source/cards.pdf', sourceHash: CARDS_HASH }]);
  });

  it('computeVerificationScope reports the additional source, independently hash-verified, without disturbing the primary scope', async () => {
    const project = await twoSourceProject();
    const scope = await computeVerificationScope(project);
    expect(scope.scope).toBe('full');
    expect(scope.sourcePath).toBe('rulebook/source/rules.pdf');
    expect(scope.sourceHash).toBe(RULES_HASH);
    expect(scope.additionalSources).toEqual([
      { sourcePath: 'rulebook/source/cards.pdf', sourceHash: CARDS_HASH },
    ]);
  });

  it('a THIRD source appends a second row, never disturbing the first additional-source entry', async () => {
    const project = await twoSourceProject();
    const appendixPath = join(dir, 'appendix.pdf');
    const APPENDIX_BYTES = Buffer.from('%PDF-1.4 fake appendix bytes\n');
    await fs.writeFile(appendixPath, APPENDIX_BYTES);
    await ingestArchiveCommand(appendixPath, { project, json: true });

    const scope = await computeVerificationScope(project);
    expect(scope.additionalSources).toHaveLength(2);
    expect(scope.additionalSources).toEqual(
      expect.arrayContaining([
        { sourcePath: 'rulebook/source/cards.pdf', sourceHash: CARDS_HASH },
        {
          sourcePath: 'rulebook/source/appendix.pdf',
          sourceHash: createHash('sha256').update(APPENDIX_BYTES).digest('hex'),
        },
      ]),
    );
  });

  it('re-archiving the SAME additional source (byte-identical) is idempotent — no duplicate row', async () => {
    const project = await twoSourceProject();
    const before = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    await ingestArchiveCommand(cardsPath, { project, json: true });
    const after = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(after).toBe(before);
    expect(parseAdditionalSources(after)).toHaveLength(1);
  });

  it('re-archiving the additional source with CHANGED bytes updates its recorded hash in place', async () => {
    const project = await twoSourceProject();
    // "Never clobber" applies here too — remove the stale archived copy first, matching the
    // documented recovery path for the primary source.
    await fs.rm(join(project, 'rulebook', 'source', 'cards.pdf'));
    const changedCards = Buffer.from('%PDF-1.4 fake cards bytes, CHANGED\n');
    await fs.writeFile(cardsPath, changedCards);
    await ingestArchiveCommand(cardsPath, { project, json: true });

    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    const records = parseAdditionalSources(index);
    expect(records).toHaveLength(1);
    expect(records[0].sourceHash).toBe(createHash('sha256').update(changedCards).digest('hex'));
  });

  it('SINGLE-SOURCE projects are byte-identical to pre-177-19 output — no ## Additional Sources section appears', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).not.toContain(ADDITIONAL_SOURCES_HEADING);
    expect(index).not.toContain(ADDITIONAL_SOURCES_BEGIN);
    expect(index).not.toContain(ADDITIONAL_SOURCES_END);
  });

  it('the JSON result reports recordedAsAdditionalSource for the second call, not for the first', async () => {
    const project = join(dir, 'doom-machine-json');
    await fs.mkdir(project, { recursive: true });
    const firstOut: string[] = [];
    const origLog = console.log;
    console.log = (s: string) => firstOut.push(s);
    try {
      await ingestArchiveCommand(rulesPath, { project, json: true });
      await ingestArchiveCommand(cardsPath, { project, json: true });
    } finally {
      console.log = origLog;
    }
    const first = JSON.parse(firstOut[0]);
    const second = JSON.parse(firstOut[1]);
    expect(first.recordedAsAdditionalSource).toBe(false);
    expect(second.recordedAsAdditionalSource).toBe(true);
  });
});

describe('ingest-archive — INDEX.md contract', () => {
  it('writes all four header labels, in order, with non-empty values', async () => {
    const project = await run({ edition: '2nd edition, 2019 printing' });
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    let cursor = -1;
    for (const label of HEADER_LABELS) {
      const at = index.indexOf(`\n${label}`);
      expect(at, `${label} must be present on its own line`).toBeGreaterThan(cursor);
      cursor = at;
      const value = index.slice(at + label.length + 1).split('\n')[0].trim();
      expect(value, `${label} must have a value`).not.toBe('');
    }
    expect(index).toContain('Edition: 2nd edition, 2019 printing');
  });

  it('writes the explicit not-stated token rather than a blank edition', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain(`Edition: ${EDITION_UNKNOWN}`);
  });

  it('never emits the interview-path wording on the rulebook path', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).not.toContain('unpublished — designer statement');
  });

  it('writes the three exact headings downstream tooling parses', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    for (const heading of INDEX_HEADINGS) {
      expect(index, `must contain exactly "${heading}"`).toContain(`\n${heading}\n`);
    }
  });

  it('always emits the gaps section, with the empty token when unfilled', async () => {
    const project = await run();
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain(GAPS_EMPTY);
  });

  it('instructs against deduplicating gap entries', async () => {
    // The reconciliation check compares section entries to slice markers; dedup would make
    // a working transport look like a dropping one.
    const rendered = renderIndex({
      gameName: 'X',
      edition: undefined,
      archivedPath: 'rulebook/source/x.pdf',
      sourceHash: 'a'.repeat(64),
      transcribed: '2026-07-27',
    });
    expect(rendered).toMatch(/Do NOT deduplicate/i);
  });

  it('refreshes only the provenance header when INDEX.md already has filled sections', async () => {
    const project = await run();
    const indexPath = join(project, 'rulebook', 'INDEX.md');
    const filled = (await fs.readFile(indexPath, 'utf-8')).replace(
      GAPS_EMPTY,
      'Named-but-undefined (p.1): Ways to Score',
    );
    await fs.writeFile(indexPath, filled);

    await ingestArchiveCommand(sourcePath, { project, json: true, edition: 'later edition' });

    const after = await fs.readFile(indexPath, 'utf-8');
    expect(after).toContain('Named-but-undefined (p.1): Ways to Score');
    expect(after).toContain('Edition: later edition');
    expect(after).toContain(`Source hash: ${SOURCE_HASH}`);
  });
});

describe('init --rulebook — the archive rides on a command that is never skipped', () => {
  it('initCommand accepts a rulebook path and archives it', async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'bs-init-rulebook-'));
    const cwd = process.cwd();
    try {
      process.chdir(parent);
      const { initCommand } = await import('./init.js');
      await initCommand('archived-game', { rulebook: sourcePath });

      const archived = await fs.readFile(
        join(parent, 'archived-game', 'rulebook', 'source', 'src-rules.pdf'),
      );
      expect(archived.equals(SOURCE_BYTES)).toBe(true);

      const index = await fs.readFile(
        join(parent, 'archived-game', 'rulebook', 'INDEX.md'),
        'utf-8',
      );
      expect(index).toContain(`Source hash: ${SOURCE_HASH}`);
      expect(index).toContain('## Open Rules Gaps');
    } finally {
      process.chdir(cwd);
      await fs.rm(parent, { recursive: true, force: true });
    }
  }, 120_000);

  it('scaffolds normally when no rulebook is passed', async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'bs-init-norulebook-'));
    const cwd = process.cwd();
    try {
      process.chdir(parent);
      const { initCommand } = await import('./init.js');
      await initCommand('plain-game', { withoutRulebook: true });
      // No rulebook path means no archive and no INDEX.md — the interview path writes those.
      await expect(
        fs.access(join(parent, 'plain-game', 'rulebook', 'INDEX.md')),
      ).rejects.toThrow();
      await expect(fs.access(join(parent, 'plain-game', 'package.json'))).resolves.toBeUndefined();
    } finally {
      process.chdir(cwd);
      await fs.rm(parent, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('init — an explicit rulebook decision is required', () => {
  // Twelfth mechanism. The eleventh documented --rulebook on the init line in scaffold.md and a
  // live session still ran the bare `npx boardsmith init seven`, reproducing the command from
  // its prior rather than from the file it had just read. An omitted decision is now a hard
  // failure, because failing commands are the one signal these sessions reliably act on.
  it('exits non-zero with an actionable message when neither flag is given', async () => {
    const parent = await fs.mkdtemp(join(tmpdir(), 'bs-init-required-'));
    const cwd = process.cwd();
    const errors: string[] = [];
    const origError = console.error;
    const origExit = process.exit;
    try {
      process.chdir(parent);
      console.error = (msg?: unknown) => void errors.push(String(msg));
      // @ts-expect-error — test double for a non-returning function
      process.exit = (code?: number) => {
        throw new Error(`EXIT:${code}`);
      };
      const { initCommand } = await import('./init.js');
      await expect(initCommand('undeclared')).rejects.toThrow('EXIT:1');

      const combined = errors.join('\n');
      // The message must name both options and show a usable example — a bare "invalid
      // arguments" would leave a session guessing, which is how this failed for eleven rounds.
      expect(combined).toMatch(/--rulebook <path>/);
      expect(combined).toMatch(/--without-rulebook/);
      expect(combined).toMatch(/boardsmith init undeclared --rulebook/);

      // And it must not have scaffolded a half-project before refusing.
      await expect(fs.access(join(parent, 'undeclared'))).rejects.toThrow();
    } finally {
      console.error = origError;
      process.exit = origExit;
      process.chdir(cwd);
      await fs.rm(parent, { recursive: true, force: true });
    }
  }, 60_000);
});

/**
 * Regression suite for the 2026-07-28 human gate (`.planning/phases/170-ingest-contract-upgrade/
 * 170-PROOF-RUN-2.md`).
 *
 * That gate found the automated harness reporting 10/10 on a contract a real run failed three
 * items of. The cause was not a broken mechanism — `boardsmith ingest-gaps` worked perfectly when
 * invoked. It was that nothing ever invoked it: the pre-commit hook that runs synthesis needs a
 * commit, and `/bs-ingest-rules` has none. The ingest orchestrator filled `## Open Rules Gaps` by
 * hand instead, with 2 entries against 5 slice markers, and nothing could tell by reading it.
 *
 * Every test below fails against the pre-fix code.
 */
describe('v4.9 — machine-owned gaps section and ingest-check (170-PROOF-RUN-2)', () => {
  async function withSlices(entries: string[], derivedLines: string[] = []) {
    const project = await run();
    await fs.writeFile(
      join(project, 'rulebook', '01-core.md'),
      ['# Core', '', ...entries, '', ...derivedLines, ''].join('\n'),
    );
    return project;
  }

  const readIndex = (project: string) =>
    fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');

  it('scaffolds the gaps section fenced as machine-owned, holding only the empty token', async () => {
    const project = await run();
    const index = await readIndex(project);
    const begin = index.indexOf(GAPS_BEGIN);
    const end = index.indexOf(GAPS_END);
    expect(begin).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(begin);
    expect(index.slice(begin + GAPS_BEGIN.length, end).trim()).toBe(GAPS_EMPTY);
    // The scaffold must say the section is not the session's to fill. The 2026-07-28 orchestrator
    // filled it because the old scaffold told it to.
    expect(index).toMatch(/MACHINE-OWNED/);
  });

  it('sweeps EVERY slice marker, not the subset an orchestrator would summarise', async () => {
    // The exact shape of the failure: five markers in the slices, and a hand-written section
    // carrying the two that read as most important.
    const project = await withSlices([
      'Named-but-undefined (p.1): "Ways to Score" card',
      'Named-but-undefined (p.2): the 7 scoring hands',
      'Named-but-undefined (p.2): match',
      'Named-but-undefined (p.2): game',
      'Named-but-undefined (p.2): total score',
    ]);
    const result = await ingestGapsCommand({ project, quiet: true });
    expect(result.gapsWritten).toBe(5);

    const index = await readIndex(project);
    const inner = index.slice(index.indexOf(GAPS_BEGIN) + GAPS_BEGIN.length, index.indexOf(GAPS_END));
    expect(inner).toContain('total score');
    expect(inner.split('\n').filter((l) => l.startsWith('Named-but-undefined'))).toHaveLength(5);
  });

  it('overwrites a hand-authored section rather than appending to it', async () => {
    const project = await withSlices(['Named-but-undefined (p.1): real gap']);
    const index = await readIndex(project);
    await fs.writeFile(
      join(project, 'rulebook', 'INDEX.md'),
      index.replace(GAPS_EMPTY, 'Named-but-undefined (p.9): invented by the orchestrator'),
    );
    await ingestGapsCommand({ project, quiet: true });
    const after = await readIndex(project);
    expect(after).toContain('real gap');
    expect(after).not.toContain('invented by the orchestrator');
  });

  it('refuses to write if the fences were removed, naming how to restore them', async () => {
    // A wholesale section rewrite is indistinguishable from a correct one by reading. Losing the
    // fences is the observable signature, so it must be loud rather than silently re-fenced.
    const project = await withSlices(['Named-but-undefined (p.1): x']);
    const index = await readIndex(project);
    await fs.writeFile(
      join(project, 'rulebook', 'INDEX.md'),
      index.replace(GAPS_BEGIN, '').replace(GAPS_END, ''),
    );
    await expect(ingestGapsCommand({ project, quiet: true })).rejects.toThrow(
      /machine-owned fences/i,
    );
    await expect(ingestGapsCommand({ project, quiet: true })).rejects.toThrow(
      /ingest-archive/,
    );
  });

  describe('ingest-check', () => {
    let exitCode: number | undefined;
    beforeEach(() => {
      exitCode = process.exitCode;
      process.exitCode = undefined;
    });
    afterEach(() => {
      process.exitCode = exitCode;
    });

    it('exits non-zero when synthesis is stale — the signal that forces a re-read', async () => {
      const project = await withSlices(['Named-but-undefined (p.1): a gap the index has not seen']);
      await ingestCheckCommand({ project, json: true });
      expect(process.exitCode).toBe(1);
    });

    it('repairs on that same failing run, so the retry passes', async () => {
      // Repair-then-fail, not fail-and-tell-you-to-fix: a follow-up command is exactly what this
      // pipeline has never once executed. Re-running must therefore be able to succeed.
      const project = await withSlices(['Named-but-undefined (p.1): a gap']);
      await ingestCheckCommand({ project, json: true });
      expect(process.exitCode).toBe(1);

      process.exitCode = undefined;
      await ingestCheckCommand({ project, json: true });
      expect(process.exitCode).toBeUndefined();
      expect(await readIndex(project)).toContain('a gap');
    });

    it('exits zero on an already-synchronised project — it must be free to run every time', async () => {
      const project = await withSlices(['Named-but-undefined (p.1): a gap']);
      await ingestGapsCommand({ project, quiet: true });
      process.exitCode = undefined;
      await ingestCheckCommand({ project, json: true });
      expect(process.exitCode).toBeUndefined();
    });

    it('treats an unrelabelled presentation line as stale, not just a missing gap', async () => {
      const project = await withSlices(
        [],
        ['Derived (p.1): The page is set in a bold sans-serif with four columns.'],
      );
      await ingestGapsCommand({ project, quiet: true });
      process.exitCode = undefined;
      // Re-introduce the misfiled line after the section is already current.
      await fs.writeFile(
        join(project, 'rulebook', '01-core.md'),
        'Derived (p.1): The page is set in a bold sans-serif with four columns.\n',
      );
      await ingestCheckCommand({ project, json: true });
      expect(process.exitCode).toBe(1);
    });
  });

  it('relabels the card-art description that slipped past the typography-only lexicon', async () => {
    // Gate item (i), verbatim from the run. The pre-2026-07-28 lexicon matched none of it.
    const artLine =
      'Derived (p.1): Card art depicted on this page uses flat, fully saturated color fields — ' +
      'red, green, blue, purple, and black — with a large white numeral centered on the face, ' +
      'small white pip-like dots along the card edges, and slightly rounded corners.';
    const project = await withSlices([], [artLine]);
    const result = await ingestRelabelCommand({ project, quiet: true });
    expect(result.relabelled).toBe(1);
    expect(await fs.readFile(join(project, 'rulebook', '01-core.md'), 'utf-8')).toContain(
      'Visual (p.1): Card art depicted',
    );
  });

  it('leaves rule-bearing lines that merely mention a diagram alone', async () => {
    // The counterweight. 'depicted'/'shown' are deliberately absent from the lexicon: a rule
    // INFERRED FROM a diagram is the contract's own canonical Derived example, and a check that
    // fires on correct work gets waived rather than fixed.
    const ruleLine =
      'Derived (p.1): Sets match on number only — the depicted Set example mixes two green ' +
      'cards with one purple card, so color is not required to match within a Set.';
    const project = await withSlices([], [ruleLine]);
    const result = await ingestRelabelCommand({ project, quiet: true });
    expect(result.relabelled).toBe(0);
  });
});

/**
 * Regression suite for F-1 (`.planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN-2.md`),
 * fixed here per `171-CONTEXT.md` decision 5. `--edition` let a free-text paraphrase displace the
 * machine-checkable `EDITION_UNKNOWN` sentinel — and PROV-01/PROV-03 (Phase 171) both read this
 * field, so it must be machine-checkable before anything reads it.
 *
 * Every test below fails against the pre-fix code: `normalizeEdition` does not exist yet.
 */
describe('edition normalization (F-1)', () => {
  // Read live 2026-07-28 from ~/BoardSmithGames/seven/rulebook/INDEX.md (Phase 170's proof
  // target; read-only, never written by this suite).
  const SEVEN_EDITION =
    'not stated in the rulebook (no edition/printing on cover, title page, or colophon) — ' +
    'pending designer confirmation';
  // Read live 2026-07-28 from ~/BoardSmithGames/one-two-punch/rulebook/INDEX.md.
  const ONE_TWO_PUNCH_EDITION =
    'none stated in the rulebook — © 2020 Alright Games (transcribed from `rules.pdf`, 2 pages)';

  it('normalizes undefined to EDITION_UNKNOWN', () => {
    expect(normalizeEdition(undefined)).toBe(EDITION_UNKNOWN);
  });

  it('normalizes whitespace-only input to EDITION_UNKNOWN', () => {
    expect(normalizeEdition('   ')).toBe(EDITION_UNKNOWN);
  });

  it("normalizes seven's real free-text edition to EDITION_UNKNOWN", () => {
    expect(normalizeEdition(SEVEN_EDITION)).toBe(EDITION_UNKNOWN);
  });

  it("normalizes one-two-punch's real free-text edition to EDITION_UNKNOWN", () => {
    expect(normalizeEdition(ONE_TWO_PUNCH_EDITION)).toBe(EDITION_UNKNOWN);
  });

  it('preserves a real edition string verbatim, trimmed', () => {
    expect(normalizeEdition('Second Edition, 2019 printing')).toBe('Second Edition, 2019 printing');
  });

  it('matches lexicon phrases case-insensitively', () => {
    expect(normalizeEdition('NONE STATED')).toBe(EDITION_UNKNOWN);
  });

  it('never lists the bare word "edition" or "unknown" alone — both would fire on legitimate editions', () => {
    // A self-invalidating-lexicon guard. Compound phrases like "no edition" and "unknown
    // edition" are fine — they never appear as a substring of "First edition" or "Unknown
    // Armies 2nd printing" — but the bare words alone would match both.
    expect(EDITION_EMPTY_LEXICON).not.toContain('edition');
    expect(EDITION_EMPTY_LEXICON).not.toContain('unknown');
  });

  it('writes the machine-checkable sentinel for a free-text edition, preserving the original on Edition note:', async () => {
    const project = await run({ edition: ONE_TWO_PUNCH_EDITION });
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain(`Edition: ${EDITION_UNKNOWN}`);
    expect(index).toContain(`Edition note: ${ONE_TWO_PUNCH_EDITION}`);
  });

  it('writes a real edition string with no Edition note: line', async () => {
    const project = await run({ edition: 'Second Edition, 2019 printing' });
    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).toContain('Edition: Second Edition, 2019 printing');
    expect(index).not.toContain('Edition note:');
  });
});

/**
 * Regression suite for CONTEXT.md decision 1b (Phase 173, 2026-07-28): `ingest-archive` reports
 * success ("provenance header updated") on an already-ingested project while silently failing to
 * write `Source hash:`/`Transcribed:`, orphaning a wrapped `Source:` paragraph, and clobbering a
 * real `Edition:` value. Reproduced twice — by `173-RESEARCH.md` and independently by the phase
 * orchestrator against a `cp -R` copy of `seven`.
 *
 * The fixture below reproduces `seven`'s real shape verbatim (title, blank, real free-text
 * Edition:, blank, wrapped Source: paragraph, `## Slices` / `## Term → Slice` sections) — it
 * deliberately carries NO `Source hash:`, NO `Transcribed:`, and NO gaps fences, matching both
 * reference games as read live 2026-07-28.
 *
 * Every test below fails against the pre-fix code (Task 2 has not run yet).
 */
describe('ingest-archive — existing INDEX.md adoption (decision 1b)', () => {
  // A dedicated source path named `rules.pdf` (not the outer `src-rules.pdf`) so the canonical
  // Source: value this suite asserts on (`rulebook/source/rules.pdf`) matches what
  // computeVerificationScope's real-game payoff check (B10) actually reads.
  let rulesPdfPath: string;

  beforeEach(async () => {
    rulesPdfPath = join(dir, 'rules.pdf');
    await fs.writeFile(rulesPdfPath, SOURCE_BYTES);
  });

  const WRAPPED_SOURCE_LINE1 =
    'Source: `rules.pdf` (2 pages). This index is the term → slice cross-reference. It is built from the';
  const WRAPPED_SOURCE_LINE2 = "transcription subagents' returned `citedTerms[]` lists.";
  const SEVEN_EDITION =
    'not stated in the rulebook (no edition/printing on cover, title page, or colophon) — ' +
    'pending designer confirmation';

  /** Builds a synthetic pre-provenance INDEX.md reproducing seven's real shape. */
  async function writePreProvenanceIndex(
    baseDir: string,
    opts: {
      gameName?: string;
      edition?: string;
      sourceLines?: string[];
      sliceMarker?: string;
      projectName?: string;
      /** WR-01 fixture: omit the Edition: line entirely (not merely stale) from the header. */
      noEdition?: boolean;
      /** WR-01 fixture: omit the Source: line entirely (not merely stale) from the header. */
      noSource?: boolean;
    } = {},
  ): Promise<string> {
    const gameName = opts.gameName ?? 'seven';
    const edition = opts.edition ?? SEVEN_EDITION;
    const sourceLines = opts.sourceLines ?? [WRAPPED_SOURCE_LINE1, WRAPPED_SOURCE_LINE2];
    const sliceRow = `| \`01-core.md\` | p.1 | ${opts.sliceMarker ?? 'core rules'} |`;
    const headerLines = [
      ...(opts.noEdition ? [] : [`Edition: ${edition}`, '']),
      ...(opts.noSource ? [] : [...sourceLines, '']),
    ];
    const content = [
      `# Rulebook Index — ${gameName}`,
      '',
      ...headerLines,
      '## Slices',
      '',
      '| slice | pages | covers |',
      '|-------|-------|--------|',
      sliceRow,
      '',
      '## Term → Slice',
      '',
      '| term | slice |',
      '|------|-------|',
      '| example term | `01-core.md` |',
      '',
    ].join('\n');
    const project = join(baseDir, opts.projectName ?? 'game');
    await fs.mkdir(join(project, 'rulebook'), { recursive: true });
    await fs.writeFile(join(project, 'rulebook', 'INDEX.md'), content);
    return project;
  }

  const readIndex = (project: string) =>
    fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');

  it('B1 insert-if-absent (hash): inserts Source hash: with the independently-computed sha256', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);
    const match = /^Source hash: ([0-9a-f]{64})$/m.exec(index);
    expect(match, 'Source hash: line must be present and well-formed').not.toBeNull();
    const archived = await fs.readFile(join(project, 'rulebook', 'source', 'rules.pdf'));
    const expectedHash = createHash('sha256').update(archived).digest('hex');
    expect(match![1]).toBe(expectedHash);
    expect(expectedHash).toBe(SOURCE_HASH);
  });

  it('B2 insert-if-absent (transcribed): inserts a well-formed Transcribed: date', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);
    expect(index).toMatch(/^Transcribed: \d{4}-\d{2}-\d{2}$/m);
  });

  it('B3 header order/contiguity: the four HEADER_LABELS lines appear in order with nothing between Source: and Transcribed:', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);
    let cursor = -1;
    for (const label of HEADER_LABELS) {
      const at = index.search(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
      expect(at, `${label} must be present`).toBeGreaterThan(cursor);
      cursor = at;
    }
    const sourceIdx = index.search(/^Source hash:/m);
    const transcribedIdx = index.search(/^Transcribed:/m);
    const between = index.slice(sourceIdx, transcribedIdx).split('\n').slice(1, -1);
    expect(between.every((l) => l.trim() === ''), 'no non-empty line between Source hash: and Transcribed:').toBe(true);
  });

  it('B4 Edition preserved: with no --edition, the real free-text Edition: line is byte-identical afterward', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);
    expect(index).toContain(`Edition: ${SEVEN_EDITION}`);
  });

  it('B5 Edition still settable: with --edition supplied, the line updates', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true, edition: '2nd edition' });
    const index = await readIndex(project);
    expect(index).toContain('Edition: 2nd edition');
    expect(index).not.toContain(SEVEN_EDITION);
  });

  it('B6 F-1 unchanged: a recognizably-empty --edition normalizes to EDITION_UNKNOWN with an Edition note:', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, {
      project,
      json: true,
      edition: 'none stated in the rulebook',
    });
    const index = await readIndex(project);
    expect(index).toContain(`Edition: ${EDITION_UNKNOWN}`);
    expect(index).toContain('Edition note: none stated in the rulebook');
  });

  it('B7 wrap-safe: the wrapped Source: prose is intact, with its continuation on the next physical line', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);
    const prose =
      '(2 pages). This index is the term → slice cross-reference. It is built from the';
    const proseIdx = index.indexOf(prose);
    expect(proseIdx, 'wrapped prose must survive verbatim').toBeGreaterThan(-1);
    const restOfLine = index.slice(proseIdx).split('\n');
    expect(restOfLine[1]).toContain("transcription subagents' returned");
  });

  it('B8 canonical Source wins: the FIRST ^Source: match is the bare canonical path', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);
    const match = /^Source:\s*(.*)$/m.exec(index);
    expect(match).not.toBeNull();
    expect(match![1].trim()).toBe('rulebook/source/rules.pdf');
  });

  it('B9 bare-path in-place: an already-canonical Source: is replaced in place, never duplicated', async () => {
    const project = await writePreProvenanceIndex(dir, {
      sourceLines: ['Source: rulebook/source/rules.pdf'],
    });
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);
    const matches = index.match(/^Source:/gm) ?? [];
    expect(matches).toHaveLength(1);
    expect(/^Source:\s*(.*)$/m.exec(index)![1].trim()).toBe('rulebook/source/rules.pdf');
  });

  it('B10 payoff check: computeVerificationScope reports full for the repaired fixture', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const scope = await computeVerificationScope(project);
    expect(scope.scope).toBe('full');
  });

  it('B11 idempotence: running the command twice produces a byte-identical INDEX.md the second time', async () => {
    const project = await writePreProvenanceIndex(dir);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const afterFirst = await readIndex(project);
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const afterSecond = await readIndex(project);
    expect(afterSecond).toBe(afterFirst);
    // And it must not have accumulated a duplicate canonical Source: line either.
    expect((afterSecond.match(/^Source:/gm) ?? [])).toHaveLength(1);
  });

  it('WR-01: with Edition: absent entirely, the inserted sentinel lands BELOW the # title line, never above it', async () => {
    const project = await writePreProvenanceIndex(dir, { noEdition: true });
    const before = await readIndex(project);
    expect(before.indexOf('# Rulebook Index')).toBe(0); // fixture sanity: title is truly first

    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);

    const titleAt = index.indexOf('# Rulebook Index');
    const editionAt = index.search(/^Edition:/m);
    expect(titleAt).toBe(0);
    expect(editionAt).toBeGreaterThan(titleAt);
    expect(index).toMatch(/^Edition: not stated in the rulebook$/m);
  });

  it('WR-01: with Source: absent entirely (and no Edition: either), the inserted Source: sentinel also lands BELOW the title', async () => {
    const project = await writePreProvenanceIndex(dir, { noEdition: true, noSource: true });
    const before = await readIndex(project);
    expect(before.indexOf('# Rulebook Index')).toBe(0);

    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);

    const titleAt = index.indexOf('# Rulebook Index');
    const sourceAt = index.search(/^Source: rulebook\/source\/rules\.pdf$/m);
    expect(titleAt).toBe(0);
    expect(sourceAt).toBeGreaterThan(titleAt);
  });

  it('B12a no scaffold-overwrite: a normal run leaves a distinctive existing marker untouched', async () => {
    const project = await writePreProvenanceIndex(dir, { sliceMarker: 'DISTINCTIVE_MARKER_XYZ' });
    await ingestArchiveCommand(rulesPdfPath, { project, json: true });
    const index = await readIndex(project);
    expect(index).toContain('DISTINCTIVE_MARKER_XYZ');
  });

  it('B12b no scaffold-overwrite: a forced repair failure never falls through to a fresh scaffold', async () => {
    const project = await writePreProvenanceIndex(dir, { sliceMarker: 'DISTINCTIVE_MARKER_XYZ' });
    const indexPath = join(project, 'rulebook', 'INDEX.md');
    const before = await fs.readFile(indexPath, 'utf-8');
    // Write-only, no read permission: fs.access's existence probe (F_OK) still succeeds, but the
    // repair's own fs.readFile fails — forcing exactly the mid-repair throw this test exists to
    // prove is safe. (A fully write-blocked file would fail identically old vs. new code, since
    // both the repair write AND the scaffold write would be blocked; write-only-no-read isolates
    // the read failure so old code's catch-and-scaffold path is free to run if it still exists.)
    await fs.chmod(indexPath, 0o200);
    try {
      await expect(
        ingestArchiveCommand(rulesPdfPath, { project, json: true }),
      ).rejects.toThrow();
    } finally {
      await fs.chmod(indexPath, 0o644);
    }
    const after = await fs.readFile(indexPath, 'utf-8');
    expect(after).toBe(before);
    expect(after).toContain('DISTINCTIVE_MARKER_XYZ');
  });
});
