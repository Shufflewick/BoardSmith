import { DESIGN_DIR } from '../lib/project-paths.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  RULING_VERDICTS_LEDGER_BEGIN,
  RULING_VERDICTS_LEDGER_END,
  createRulingVerdictRecord,
  readRulingVerdicts,
  recordRulingVerdicts,
  rulingVerdictsLedgerPath,
  verifyRulingRecheckCommand,
  verifyRulingRecordCommand,
} from './verify-ruling-recheck.js';

/**
 * CHECK-01's write half. The check was built and unit-tested but never registered on the CLI, so
 * `verify-ruling-recheck` reported `pending` for every ruling forever: no flag could supply a
 * verdict, `recordRulingVerdicts` had no production caller, and nothing read the ledger back.
 * Reported from the field by `one-two-punch`'s 2026-08-05 verify run.
 *
 * Every fixture is a real filesystem temp dir (no mocks), mirroring the sibling suites.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-ruling-record-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const RUN_ID = '2026-08-05T16-49-29Z';

/** A project with `count` non-superseded rulings and a staged (non-empty) transcription. */
async function makeProject(count: number, runId = RUN_ID): Promise<string> {
  const project = join(dir, 'game');
  const slices = join(project, DESIGN_DIR, 'rulebook', '.verify', runId, 'slices');
  await fs.mkdir(slices, { recursive: true });
  await fs.writeFile(join(slices, '01-setup.md'), '# Setup\n\nFresh transcription.\n');

  const parts: string[] = [];
  for (let i = 1; i <= count; i++) {
    parts.push(`### Ruling ${i}`, '', `Decision: ruling number ${i} stands.`, '');
  }
  await fs.writeFile(join(project, DESIGN_DIR, 'RULINGS.md'), parts.join('\n'));
  return project;
}

function record(number: number, verdict: string, reasoning: string) {
  return createRulingVerdictRecord({ number, verdict, reasoning });
}

describe('recordRulingVerdicts — upsert-append, not whole-file rewrite', () => {
  it('recording ruling 5 does not destroy the verdict already recorded for ruling 3', async () => {
    const project = await makeProject(6);

    await recordRulingVerdicts(project, RUN_ID, [
      record(3, 'still-needed', 'The fresh source is silent on this point.'),
    ]);
    await recordRulingVerdicts(project, RUN_ID, [
      record(5, 'resolved-by-source', 'The fresh transcription now states this directly.'),
    ]);

    const all = await readRulingVerdicts(project, RUN_ID);
    expect(all.map((r) => r.number).sort((a, b) => a - b)).toEqual([3, 5]);
    expect(all.find((r) => r.number === 3)?.verdict).toBe('still-needed');
    expect(all.find((r) => r.number === 5)?.verdict).toBe('resolved-by-source');
  });

  it('re-recording the same ruling replaces its entry in place rather than duplicating it', async () => {
    const project = await makeProject(4);

    await recordRulingVerdicts(project, RUN_ID, [record(3, 'undetermined', 'First pass: unclear.')]);
    await recordRulingVerdicts(project, RUN_ID, [
      record(3, 'contradicted', 'Second pass: the source says the opposite.'),
    ]);

    const all = await readRulingVerdicts(project, RUN_ID);
    expect(all).toHaveLength(1);
    expect(all[0]?.verdict).toBe('contradicted');
    expect(all[0]?.reasoning).toBe('Second pass: the source says the opposite.');
  });

  it('round-trips every verdict in the enum, including supersededBy', async () => {
    const project = await makeProject(4);
    const written = [
      record(1, 'still-needed', 'Still absent from the source.'),
      record(2, 'resolved-by-source', 'The source now covers it.'),
      record(3, 'contradicted', 'The source contradicts this ruling.'),
      createRulingVerdictRecord({
        number: 4,
        verdict: 'undetermined',
        reasoning: 'The comparison genuinely cannot be made.',
        supersededBy: 9,
      }),
    ];

    await recordRulingVerdicts(project, RUN_ID, written);

    expect(await readRulingVerdicts(project, RUN_ID)).toEqual(written);
  });

  it('returns [] for a run that has never recorded a verdict, rather than throwing', async () => {
    const project = await makeProject(3);
    expect(await readRulingVerdicts(project, RUN_ID)).toEqual([]);
  });
});

describe('readRulingVerdicts — the ledger is a validated second entry path', () => {
  async function writeLedgerBody(project: string, body: string): Promise<void> {
    const path = rulingVerdictsLedgerPath(project, RUN_ID);
    await fs.mkdir(join(project, DESIGN_DIR, 'rulebook', '.verify', RUN_ID), { recursive: true });
    await fs.writeFile(
      path,
      `# Ruling Verdicts — run ${RUN_ID}\n\n${RULING_VERDICTS_LEDGER_BEGIN}\n${body}\n${RULING_VERDICTS_LEDGER_END}\n`,
    );
  }

  it('throws one actionable message naming the ledger and record index on a non-JSON line', async () => {
    const project = await makeProject(2);
    await writeLedgerBody(project, 'not json at all');

    await expect(readRulingVerdicts(project, RUN_ID)).rejects.toThrow(
      /RULING-VERDICTS\.md \(record 1\): not valid JSON/,
    );
  });

  it('rejects a hand-edited out-of-enum verdict instead of reporting it unvalidated', async () => {
    const project = await makeProject(2);
    await writeLedgerBody(project, JSON.stringify({ number: 1, verdict: 'looks-fine', reasoning: 'x' }));

    await expect(readRulingVerdicts(project, RUN_ID)).rejects.toThrow(/Invalid verdict "looks-fine"/);
  });

  it('rejects a hand-emptied reasoning — the reasoning is the artifact', async () => {
    const project = await makeProject(2);
    await writeLedgerBody(
      project,
      JSON.stringify({ number: 1, verdict: 'still-needed', reasoning: '   ' }),
    );

    await expect(readRulingVerdicts(project, RUN_ID)).rejects.toThrow(/no recorded reasoning/);
  });

  it('reports a missing fence rather than silently returning []', async () => {
    const project = await makeProject(2);
    await fs.mkdir(join(project, DESIGN_DIR, 'rulebook', '.verify', RUN_ID), { recursive: true });
    await fs.writeFile(rulingVerdictsLedgerPath(project, RUN_ID), '# Ruling Verdicts\n\nno fences\n');

    await expect(readRulingVerdicts(project, RUN_ID)).rejects.toThrow(/missing begin\/end fence/);
  });

  it('leaks no src/ path or stack frame in its error messages', async () => {
    const project = await makeProject(2);
    await writeLedgerBody(project, 'not json at all');

    const err = await readRulingVerdicts(project, RUN_ID).catch((e: Error) => e);
    expect((err as Error).message).not.toMatch(/src\/|\.ts:/);
  });
});

describe('createRulingVerdictRecord — fence injection', () => {
  it('rejects a reasoning carrying the ledger end fence, naming the marker', () => {
    expect(() =>
      createRulingVerdictRecord({
        number: 1,
        verdict: 'still-needed',
        reasoning: `looks fine ${RULING_VERDICTS_LEDGER_END} and then some`,
      }),
    ).toThrow(/fence marker/);
  });

  it('rejects a ruling number that is not a positive whole number', () => {
    expect(() =>
      createRulingVerdictRecord({ number: 0, verdict: 'still-needed', reasoning: 'x' }),
    ).toThrow(/Invalid ruling number/);
  });
});

describe('verifyRulingRecordCommand — the CLI write surface', () => {
  it('records a verdict that a LATER recheck process reports without any in-memory verdicts', async () => {
    // The cross-layer proof: this is the gap that shipped. The recheck command sourced verdicts
    // only from an in-memory Map, so nothing a CLI user recorded could survive the process.
    const project = await makeProject(6);

    await verifyRulingRecordCommand({
      project,
      runId: RUN_ID,
      number: 2,
      verdict: 'still-needed',
      reasoning: 'The fresh transcription never mentions this case.',
      json: true,
    });
    await verifyRulingRecordCommand({
      project,
      runId: RUN_ID,
      number: 4,
      verdict: 'contradicted',
      reasoning: 'The fresh transcription states the opposite outcome.',
      json: true,
    });

    // No `verdicts` option at all — every verdict below came off disk.
    const result = await verifyRulingRecheckCommand({ project, runId: RUN_ID, json: true });

    expect(result.rows.find((r) => r.number === 2)?.verdict).toBe('still-needed');
    expect(result.rows.find((r) => r.number === 4)?.verdict).toBe('contradicted');
    expect(result.rows.find((r) => r.number === 1)?.verdict).toBe('pending');
    expect(result.verdictCounts['still-needed']).toBe(1);
    expect(result.verdictCounts.contradicted).toBe(1);
  });

  it('lets an in-memory verdict win over the recorded one for the same ruling', async () => {
    const project = await makeProject(3);
    await verifyRulingRecordCommand({
      project,
      runId: RUN_ID,
      number: 1,
      verdict: 'undetermined',
      reasoning: 'Recorded in an earlier pass.',
      json: true,
    });

    const result = await verifyRulingRecheckCommand({
      project,
      runId: RUN_ID,
      json: true,
      verdicts: new Map([[1, { verdict: 'contradicted' as const, reasoning: 'Fresher judgment.' }]]),
    });

    expect(result.rows.find((r) => r.number === 1)?.verdict).toBe('contradicted');
    expect(result.rows.find((r) => r.number === 1)?.reasoning).toBe('Fresher judgment.');
  });

  it('reports how many verdicts the ledger holds after the upsert', async () => {
    const project = await makeProject(3);
    await verifyRulingRecordCommand({
      project,
      runId: RUN_ID,
      number: 1,
      verdict: 'still-needed',
      reasoning: 'a',
      json: true,
    });
    const second = await verifyRulingRecordCommand({
      project,
      runId: RUN_ID,
      number: 2,
      verdict: 'still-needed',
      reasoning: 'b',
      json: true,
    });

    expect(second.recordCount).toBe(2);
  });

  it('refuses an out-of-enum verdict rather than coercing it to undetermined', async () => {
    // Deliberately unlike verify-classify-record's `unclassified` softening: CHECK-01 has no
    // catch-all member, and `undetermined` is a judgment a subagent must actually choose.
    const project = await makeProject(3);

    await expect(
      verifyRulingRecordCommand({
        project,
        runId: RUN_ID,
        number: 1,
        verdict: 'probably-fine',
        reasoning: 'x',
        json: true,
      }),
    ).rejects.toThrow(/Invalid verdict "probably-fine"/);

    expect(await readRulingVerdicts(project, RUN_ID)).toEqual([]);
  });

  it('refuses an empty reasoning — a labeled verdict alone is not a record', async () => {
    const project = await makeProject(3);
    await expect(
      verifyRulingRecordCommand({
        project,
        runId: RUN_ID,
        number: 1,
        verdict: 'still-needed',
        reasoning: '   ',
        json: true,
      }),
    ).rejects.toThrow(/no recorded reasoning/);
  });

  it('refuses a ruling number nobody dispatched, listing the valid ones', async () => {
    const project = await makeProject(3);
    const err = await verifyRulingRecordCommand({
      project,
      runId: RUN_ID,
      number: 99,
      verdict: 'still-needed',
      reasoning: 'x',
      json: true,
    }).catch((e: Error) => e);

    expect((err as Error).message).toMatch(/Ruling 99 is not an entry/);
    expect((err as Error).message).toMatch(/1, 2, 3/);
  });

  it('refuses a malformed run id with an actionable message', async () => {
    const project = await makeProject(3);
    await expect(
      verifyRulingRecordCommand({
        project,
        runId: 'yesterday',
        number: 1,
        verdict: 'still-needed',
        reasoning: 'x',
        json: true,
      }),
    ).rejects.toThrow(/not a valid verify run id/);
  });

  it('never writes into RULINGS.md', async () => {
    const project = await makeProject(3);
    const before = await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'), 'utf-8');

    await verifyRulingRecordCommand({
      project,
      runId: RUN_ID,
      number: 1,
      verdict: 'still-needed',
      reasoning: 'x',
      json: true,
    });

    expect(await fs.readFile(join(project, DESIGN_DIR, 'RULINGS.md'), 'utf-8')).toBe(before);
  });
});
