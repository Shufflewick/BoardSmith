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
    const project = await makeProject({ [PUNCH]: PUNCH_TEXT });
    await writeOldLedger(project, [
      oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.'),
      oldTranslatedRecord(PUNCH, 5, 'If you are punched while EXHAUSTED, you stay EXHAUSTED.'),
    ]);

    const result = await upgrade(project);

    expect(result.upgraded).toEqual([`${PUNCH}:4`, `${PUNCH}:5`]);
    expect(result.dropped).toEqual([]);
    const records = await readExampleReplayVerdicts(project);
    expect(records.map((r) => [r.exampleId, r.lineText, r.verdict, r.recordedAt])).toEqual([
      [`${PUNCH}:4`, READY_LINE, 'unexecutable', '2026-09-24T04:02:35.674Z'],
      [`${PUNCH}:5`, TIRED_LINE, 'not-run', '2026-09-24T04:02:35.674Z'],
    ]);
  });

  it('names each record whose line no longer carries its quote and drops its slice, which is pending again', async () => {
    const project = await makeProject({
      // A line inserted above the examples: line 4 no longer holds the READY example.
      [PUNCH]: PUNCH_TEXT.replace('# Punch\n', '# Punch\n\nSource: rulebook/source/rules.pdf\n'),
      [TERRAIN]: TERRAIN_TEXT,
    });
    await writeOldLedger(project, [
      oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.'),
      oldRecord(PUNCH, 7, 'If you are punched while EXHAUSTED, you stay EXHAUSTED.'),
      oldRecord(TERRAIN, 4, 'A Crawler crossing a hill moves 1 space.'),
      oldRecord('rulebook/09-gone.md', 3, 'A slice that no longer exists.'),
    ]);

    const result = await upgrade(project);

    expect(result.upgraded).toEqual([`${TERRAIN}:4`]);
    expect(result.dropped).toEqual([
      { exampleId: `${PUNCH}:4`, reason: 'line-changed' },
      { exampleId: `${PUNCH}:7`, reason: 'slice-recorded-again' },
      { exampleId: 'rulebook/09-gone.md:3', reason: 'slice-gone' },
    ]);
    expect(result.slicesToRecordAgain).toEqual([PUNCH]);
    expect((await readExampleReplayVerdicts(project)).map((r) => r.exampleId)).toEqual([`${TERRAIN}:4`]);
    const report = await verifyExampleReplayCommand({ project, json: true });
    expect(report.slices.find((s) => s.slicePath === PUNCH)?.pending).toBe(true);
    expect(report.slices.find((s) => s.slicePath === TERRAIN)?.pending).toBe(false);
  });

  it('prints what it upgraded, what it dropped and why, and the slices to record again', async () => {
    const project = await makeProject({ [PUNCH]: PUNCH_TEXT.replace('READY, you', 'READY, then you') });
    await writeOldLedger(project, [oldRecord(PUNCH, 4, 'If you are punched while READY, you become EXHAUSTED.')]);
    const lines: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => lines.push(args.join(' '));
    try {
      await exampleLedgerUpgradeCommand({ project });
    } finally {
      console.log = log;
    }
    const printed = lines.join('\n');
    expect(printed).toContain(`${PUNCH}:4`);
    expect(printed).toMatch(/line 4 of rulebook\/02-punch\.md no longer carries/);
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
