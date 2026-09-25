import { describe, it, expect, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { designProjectFixtures } from './design-project.test-helper.js';
import {
  EXAMPLE_REPLAY_LEDGER_BEGIN,
  EXAMPLE_REPLAY_LEDGER_END,
  exampleReplayLedgerPath,
  readExampleReplayVerdicts,
  verifyExampleReplayCommand,
} from './verify-example-replay.js';
import { exampleLedgerUpgradeCommand } from './example-ledger-upgrade.js';

/**
 * #371: a ledger written before #350 gave every record its `lineText`. The fixture below is a
 * ledger in that shape: the record lines are exactly what the earlier version wrote, with no
 * `lineText` field.
 */

const PUNCH = 'rulebook/02-punch.md';
const TERRAIN = 'rulebook/03-terrain.md';
const READY_LINE = 'Example (p.2): "If you are punched while READY, you become EXHAUSTED."';
const TIRED_LINE = 'Example (p.2): "If you are punched while EXHAUSTED, you stay EXHAUSTED."';
const HILL_LINE = 'Example (p.3): "A Crawler crossing a hill moves 1 space."';
const PUNCH_TEXT = `# Punch\n\np.2, Punch Examples:\n${READY_LINE}\n${TIRED_LINE}\n`;
const TERRAIN_TEXT = `# Terrain\n\np.3, Terrain:\n${HILL_LINE}\n`;
const LADDER = 'rulebook/05-ladders.md';
const LADDER_TEXT = '# Ladders\n\np.5, Ladders:\nExample (p.5): "A ladder lifts a unit one level."\n';

/** An `unexecutable` record as the pre-#350 version wrote it: no `lineText`. */
function oldRecord(slicePath: string, lineNumber: number, quote: string): Record<string, unknown> {
  return {
    exampleId: `${slicePath}:${lineNumber}`,
    slicePath,
    lineNumber,
    kind: 'transition',
    verdict: 'unexecutable',
    reason: 'no-matching-symbol: nothing does this yet.',
    expected: '',
    observed: '',
    contradictionA: '',
    contradictionB: '',
    supportingQuoteLines: [quote],
    provenance: 'quote-verified',
    recordedAt: '2026-09-24T04:02:35.674Z',
  };
}

/** A `not-run` record as the pre-#350 version wrote it, whose only quote is its sourceText. */
function oldTranslatedRecord(slicePath: string, lineNumber: number, sourceText: string): Record<string, unknown> {
  return {
    ...oldRecord(slicePath, lineNumber, ''),
    supportingQuoteLines: [],
    verdict: 'not-run',
    reason: 'Translated into a test that has not been run yet.',
    expected: 'It happens.',
    translation: {
      pageCitation: 'p.2',
      sourceText,
      testCode: "it('happens', () => {});",
      imports: [],
    },
  };
}

describe('example-ledger-upgrade (#371)', () => {
  let dir: string;

  beforeEach(() => {
    dir = tempTree('bs-example-ledger-upgrade-');
  });

  const { makeProject } = designProjectFixtures(() => dir);

  async function writeOldLedger(project: string, records: Record<string, unknown>[]): Promise<string> {
    const ledgerPath = exampleReplayLedgerPath(project);
    await fs.mkdir(join(ledgerPath, '..'), { recursive: true });
    const content =
      `# Example Replay Verdicts (CHECK-06) — project-level, not scoped to any run\n\n` +
      `${EXAMPLE_REPLAY_LEDGER_BEGIN}\n${records.map((r) => JSON.stringify(r)).join('\n')}\n` +
      `${EXAMPLE_REPLAY_LEDGER_END}\n`;
    await fs.writeFile(ledgerPath, content);
    return ledgerPath;
  }

  async function upgrade(project: string) {
    return exampleLedgerUpgradeCommand({ project, json: true });
  }

  /**
   * Upgrades PUNCH's two old records (the READY example recorded at line 4, the EXHAUSTED one at
   * 5) against `sliceText`, checking both were upgraded.
   */
  async function upgradePunchExamples(sliceText: string) {
    const project = await makeProject({ [PUNCH]: sliceText });
    await writeOldLedger(project, [
      oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.'),
      oldTranslatedRecord(PUNCH, 5, 'If you are punched while EXHAUSTED, you stay EXHAUSTED.'),
    ]);
    const result = await upgrade(project);
    expect(result.upgraded).toEqual([`${PUNCH}:4`, `${PUNCH}:5`]);
    return { project, result };
  }

  it('reading a ledger written before lineText names the upgrade command, never deleting the file', async () => {
    const project = await makeProject({ [PUNCH]: PUNCH_TEXT });
    await writeOldLedger(project, [oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.')]);

    const message = await readExampleReplayVerdicts(project).then(
      () => '',
      (err: Error) => err.message,
    );
    expect(message).toContain('1 record(s) written before');
    expect(message).toContain('npx boardsmith verify-example-ledger-upgrade');
    expect(message).not.toMatch(/Delete the file/);
  });

  it('fills lineText from the slice line each record names when that line still carries its quote', async () => {
    const { project, result } = await upgradePunchExamples(PUNCH_TEXT);
    expect(result.dropped).toEqual([]);
    const records = await readExampleReplayVerdicts(project);
    expect(records.map((r) => [r.exampleId, r.lineText, r.verdict, r.recordedAt])).toEqual([
      [`${PUNCH}:4`, READY_LINE, 'unexecutable', '2026-09-24T04:02:35.674Z'],
      [`${PUNCH}:5`, TIRED_LINE, 'not-run', '2026-09-24T04:02:35.674Z'],
    ]);
  });

  const SOURCE_LINE = '# Punch\n\nSource: rulebook/source/rules.pdf\n';

  it('re-anchors a record whose quote now sits on exactly one other line, the way ingest-check does', async () => {
    const { project, result } = await upgradePunchExamples(PUNCH_TEXT.replace('# Punch\n', SOURCE_LINE));
    expect(result.reanchored).toEqual([
      { from: `${PUNCH}:4`, to: `${PUNCH}:6` },
      { from: `${PUNCH}:5`, to: `${PUNCH}:7` },
    ]);
    expect(result.dropped).toEqual([]);
    expect(result.slicesToRecordAgain).toEqual([]);
    const records = await readExampleReplayVerdicts(project);
    expect(records.map((r) => [r.exampleId, r.lineNumber, r.lineText, r.verdict])).toEqual([
      [`${PUNCH}:6`, 6, READY_LINE, 'unexecutable'],
      [`${PUNCH}:7`, 7, TIRED_LINE, 'not-run'],
    ]);
    const report = await verifyExampleReplayCommand({ project, json: true });
    expect(report.unanchored).toEqual([]);
    expect(report.slices.find((s) => s.slicePath === PUNCH)?.pending).toBe(false);
  });

  it('does not count the citation header a record also quotes as a line its example could be on', async () => {
    // The extractor cites the section header beside the example line; a bare header is never the
    // example itself, so the example line is still the one place the record can go.
    const project = await makeProject({ [PUNCH]: PUNCH_TEXT.replace('# Punch\n', SOURCE_LINE) });
    await writeOldLedger(project, [
      {
        ...oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.'),
        supportingQuoteLines: [READY_LINE, 'p.2, Punch Examples:'],
      },
    ]);

    const result = await upgrade(project);

    expect(result.reanchored).toEqual([{ from: `${PUNCH}:4`, to: `${PUNCH}:6` }]);
    expect(result.dropped).toEqual([]);
  });

  it('does not keep a record in place on a citation header it quotes that has moved onto its line', async () => {
    // Two lines inserted above move the header the record also quotes onto line 5, the record's
    // old line. The READY example it recorded is now on line 6, which is where it belongs.
    const project = await makeProject({ [PUNCH]: PUNCH_TEXT.replace('# Punch\n', SOURCE_LINE) });
    await writeOldLedger(project, [
      {
        ...oldRecord(PUNCH, 5, 'If you are punched while READY, you become EXHAUSTED.'),
        supportingQuoteLines: [READY_LINE, 'p.2, Punch Examples:'],
      },
    ]);

    const result = await upgrade(project);

    expect(result.reanchored).toEqual([{ from: `${PUNCH}:5`, to: `${PUNCH}:6` }]);
  });

  it('drops a record whose quote is gone or ambiguous, with the rest of its slice, which is pending again', async () => {
    const HILL_VISUAL = 'Visual (p.3): A Crawler crossing a hill moves 1 space. Drawn as an arrow.';
    const project = await makeProject({
      // The READY example was reworded: its quote is in no line.
      [PUNCH]: PUNCH_TEXT.replace('become EXHAUSTED', 'become TIRED'),
      // The hill quote now sits on two different lines, so which is the example cannot be told.
      [TERRAIN]: `# Terrain\n\np.3, Terrain:\n\n${HILL_LINE}\n${HILL_VISUAL}\n`,
      [LADDER]: LADDER_TEXT,
    });
    await writeOldLedger(project, [
      oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.'),
      oldRecord(PUNCH, 5, 'If you are punched while EXHAUSTED, you stay EXHAUSTED.'),
      oldRecord(TERRAIN, 4, 'A Crawler crossing a hill moves 1 space.'),
      oldRecord(LADDER, 4, 'A ladder lifts a unit one level.'),
      oldRecord('rulebook/09-gone.md', 3, 'A slice that no longer exists.'),
    ]);

    const result = await upgrade(project);

    expect(result.upgraded).toEqual([`${LADDER}:4`]);
    expect(result.dropped).toEqual([
      { exampleId: `${PUNCH}:4`, reason: 'quote-gone' },
      { exampleId: `${PUNCH}:5`, reason: 'slice-recorded-again' },
      { exampleId: `${TERRAIN}:4`, reason: 'quote-ambiguous' },
      { exampleId: 'rulebook/09-gone.md:3', reason: 'slice-gone' },
    ]);
    expect(result.slicesToRecordAgain).toEqual([PUNCH, TERRAIN]);
    expect((await readExampleReplayVerdicts(project)).map((r) => r.exampleId)).toEqual([`${LADDER}:4`]);
    const report = await verifyExampleReplayCommand({ project, json: true });
    expect(report.slices.find((s) => s.slicePath === PUNCH)?.pending).toBe(true);
    expect(report.slices.find((s) => s.slicePath === TERRAIN)?.pending).toBe(true);
    expect(report.slices.find((s) => s.slicePath === LADDER)?.pending).toBe(false);
  });

  it('treats a quote whose only line is identical text on several lines, or a line another record holds, as ambiguous', async () => {
    const project = await makeProject({
      [TERRAIN]: `# Terrain\n\np.3, Terrain:\n\n${HILL_LINE}\n${HILL_LINE}\n`,
      [PUNCH]: PUNCH_TEXT,
    });
    await writeOldLedger(project, [
      oldRecord(TERRAIN, 4, 'A Crawler crossing a hill moves 1 space.'),
      // Line 4 still holds the READY example, so a second record quoting it cannot move there.
      oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.'),
      oldRecord(PUNCH, 3, 'If you are punched while READY, you become EXHAUSTED.'),
    ]);

    const result = await upgrade(project);

    expect(result.dropped).toEqual([
      { exampleId: `${TERRAIN}:4`, reason: 'quote-ambiguous' },
      { exampleId: `${PUNCH}:4`, reason: 'slice-recorded-again' },
      { exampleId: `${PUNCH}:3`, reason: 'quote-ambiguous' },
    ]);
  });

  it('prints what it upgraded, moved and dropped, why, and the slices to record again', async () => {
    const project = await makeProject({
      [PUNCH]: PUNCH_TEXT.replace('READY, you', 'READY, then you'),
      [LADDER]: LADDER_TEXT.replace('# Ladders\n', '# Ladders\n\nSource: rulebook/source/rules.pdf\n'),
    });
    await writeOldLedger(project, [
      oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.'),
      oldRecord(LADDER, 4, 'A ladder lifts a unit one level.'),
    ]);
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    try {
      await exampleLedgerUpgradeCommand({ project });
    } finally {
      console.log = log;
    }
    const printed = lines.join('\n');
    expect(printed).toContain(`${LADDER}:4 → ${LADDER}:6`);
    expect(printed).toContain(`${PUNCH}:4`);
    expect(printed).toMatch(/its quote is no longer in rulebook\/02-punch\.md/);
    expect(printed).toContain(`Record the worked examples of ${PUNCH} again`);
  });

  it('leaves a current ledger byte-identical and says there was nothing to upgrade', async () => {
    const project = await makeProject({ [PUNCH]: PUNCH_TEXT });
    const ledgerPath = await writeOldLedger(project, [oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.')]);
    await upgrade(project);
    const before = await fs.readFile(ledgerPath, 'utf-8');

    const again = await upgrade(project);

    expect(again).toMatchObject({ upgraded: [], dropped: [], slicesToRecordAgain: [] });
    expect(await fs.readFile(ledgerPath, 'utf-8')).toBe(before);
  });

  it('with no ledger at all, writes nothing', async () => {
    const project = await makeProject({ [PUNCH]: PUNCH_TEXT });

    expect(await upgrade(project)).toMatchObject({ upgraded: [], dropped: [] });
    await expect(fs.access(exampleReplayLedgerPath(project))).rejects.toThrow();
  });

  it('refuses, writing nothing, a record that is malformed for some other reason', async () => {
    const project = await makeProject({ [PUNCH]: PUNCH_TEXT });
    const ledgerPath = await writeOldLedger(project, [
      { ...oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.'), verdict: 'banana' },
    ]);
    const before = await fs.readFile(ledgerPath, 'utf-8');

    await expect(upgrade(project)).rejects.toThrow(/Invalid verdict "banana"/);
    expect(await fs.readFile(ledgerPath, 'utf-8')).toBe(before);
  });
});
