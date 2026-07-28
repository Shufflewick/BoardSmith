import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  verifyRunInitCommand,
  verifyRunRecordCommand,
  verifyRunStatusCommand,
  stagingSlicesDir,
  RUN_LEDGER_BEGIN,
  RUN_LEDGER_END,
  RUN_ID_RE,
} from './verify-run.js';
import { computeVerificationScope } from './chunk-provenance.js';
import { chunkProvenanceStatusCommand } from './chunk-provenance.js';
import { traceCheckCommand } from './trace-check.js';
import { driftCheckCommand } from './drift-check.js';
import { ingestGapsCommand, renderIndex } from './ingest-archive.js';

/**
 * `verify-run.ts` is the mechanical half of VERIFY-02 (non-destructive staging tree) and
 * VERIFY-08 (append-only, machine-owned resume ledger). Every fixture here is a real filesystem
 * temp dir (`mkdtempSync`-shaped via `fs.mkdtemp`) — no mocks — mirroring `ingest-archive.test.ts`.
 *
 * This plan touches nothing under `~/BoardSmithGames/` — every fixture is built fresh in a temp
 * dir per test.
 */

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-run-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const LIVE_03 = '## 03-setup\n\nLive setup slice content.\n';
const LIVE_07 = '## 07-turn\n\nLive turn slice content.\n';

/** A fixture project with rulebook/INDEX.md and two distinctive live slices. */
async function liveProject(): Promise<string> {
  const project = join(dir, 'game');
  const rulebookDir = join(project, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  await fs.writeFile(
    join(rulebookDir, 'INDEX.md'),
    renderIndex({
      gameName: 'game',
      edition: undefined,
      archivedPath: 'rulebook/source/rules.pdf',
      sourceHash: 'deadbeef',
      transcribed: '2026-07-28',
    }),
  );
  await fs.writeFile(join(rulebookDir, '03-setup.md'), LIVE_03);
  await fs.writeFile(join(rulebookDir, '07-turn.md'), LIVE_07);
  return project;
}

function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text)).digest('hex');
}

// -------------------------------------------------------------------------------------------
// Staging + run allocation (S1-S7)
// -------------------------------------------------------------------------------------------

describe('verifyRunInitCommand — staging + run allocation', () => {
  it('S1: mints a run-id matching the fixed UTC shape and returns it via --json', async () => {
    const project = await liveProject();
    const result = await verifyRunInitCommand({ project, json: true });
    expect(result.runId).toMatch(RUN_ID_RE);
    expect(result).toMatchObject({ created: true });
    expect(result.stagingDir).toBeTruthy();
    expect(result.ledgerPath).toBeTruthy();
  });

  it('S2: creates rulebook/.verify/<run-id>/slices/ and RUN.md with exactly one fence pair and zero records', async () => {
    const project = await liveProject();
    const result = await verifyRunInitCommand({ project, json: true });

    const stagingAbs = join(project, result.stagingDir);
    await expect(fs.access(stagingAbs)).resolves.toBeUndefined();

    const ledgerAbs = join(project, result.ledgerPath);
    const text = await fs.readFile(ledgerAbs, 'utf-8');
    expect(text.split(RUN_LEDGER_BEGIN).length - 1).toBe(1);
    expect(text.split(RUN_LEDGER_END).length - 1).toBe(1);

    const begin = text.indexOf(RUN_LEDGER_BEGIN);
    const end = text.indexOf(RUN_LEDGER_END);
    const body = text.slice(begin + RUN_LEDGER_BEGIN.length, end).trim();
    expect(body).toBe('');
  });

  it('S3: re-running with the same --run-id is idempotent — created:false, no truncation, no deletion', async () => {
    const project = await liveProject();
    const first = await verifyRunInitCommand({ project, json: true });

    const stagingAbs = join(project, first.stagingDir);
    await fs.writeFile(join(stagingAbs, '03-setup.md'), 'staged content\n');

    const ledgerAbs = join(project, first.ledgerPath);
    await verifyRunRecordCommand({
      project,
      runId: first.runId,
      unit: '03-setup',
      slice: '03-setup.md',
      json: true,
    });
    const ledgerAfterRecord = await fs.readFile(ledgerAbs, 'utf-8');

    const second = await verifyRunInitCommand({ project, runId: first.runId, json: true });
    expect(second.created).toBe(false);
    expect(second.runId).toBe(first.runId);

    const ledgerAfterReinit = await fs.readFile(ledgerAbs, 'utf-8');
    expect(ledgerAfterReinit).toBe(ledgerAfterRecord);

    const stagedStillThere = await fs.readFile(join(stagingAbs, '03-setup.md'), 'utf-8');
    expect(stagedStillThere).toBe('staged content\n');
  });

  it('S4: stagingSlicesDir resolves under <projectDir>/rulebook/.verify/', async () => {
    const project = await liveProject();
    const runId = '2026-07-28T22-18-00Z';
    const result = stagingSlicesDir(project, runId);
    const prefix = join(project, 'rulebook', '.verify');
    expect(result.startsWith(prefix)).toBe(true);
  });

  it('S5: traversal refusal — invalid --run-id shapes are refused with an actionable error, nothing created outside rulebook/.verify/', async () => {
    const project = await liveProject();
    const badIds = ['../../etc', 'a/b', '..', '/etc/passwd', 'not-a-runid'];
    for (const bad of badIds) {
      await expect(verifyRunInitCommand({ project, runId: bad, json: true })).rejects.toThrow();
    }
    // stagingSlicesDir itself refuses too.
    for (const bad of badIds) {
      expect(() => stagingSlicesDir(project, bad)).toThrow(/run-id/i);
    }
    const verifyRoot = join(project, 'rulebook', '.verify');
    await expect(fs.access(verifyRoot)).rejects.toThrow();
  });

  it('S5b: an explicitly bad --run-id is refused even when non-empty and path-shaped', async () => {
    const project = await liveProject();
    await expect(
      verifyRunInitCommand({ project, runId: '../../escape', json: true }),
    ).rejects.toThrow(/run-id/i);
  });

  it('S6: non-destructive (VERIFY-02) — live slices stay byte-identical and invisible to a live-only readdir', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const stagingAbs = join(project, init.stagingDir);
    await fs.writeFile(join(stagingAbs, '03-setup.md'), 'staged, not live\n');
    await verifyRunRecordCommand({
      project,
      runId: init.runId,
      unit: '03-setup',
      slice: '03-setup.md',
      json: true,
    });

    const stillLive03 = await fs.readFile(join(project, 'rulebook', '03-setup.md'), 'utf-8');
    const stillLive07 = await fs.readFile(join(project, 'rulebook', '07-turn.md'), 'utf-8');
    expect(stillLive03).toBe(LIVE_03);
    expect(stillLive07).toBe(LIVE_07);

    const names = (await fs.readdir(join(project, 'rulebook'))).filter(
      (f) => f.endsWith('.md') && f !== 'INDEX.md',
    );
    expect(names.sort()).toEqual(['03-setup.md', '07-turn.md']);
  });

  it('S7: refuses with an actionable error when rulebook/ does not exist', async () => {
    const project = join(dir, 'no-rulebook-project');
    await fs.mkdir(project, { recursive: true });
    await expect(verifyRunInitCommand({ project, json: true })).rejects.toThrow(/rulebook/i);
  });
});

// -------------------------------------------------------------------------------------------
// Ledger (L1-L9)
// -------------------------------------------------------------------------------------------

describe('verifyRunRecordCommand / verifyRunStatusCommand — ledger', () => {
  async function initAndStage(): Promise<{ project: string; runId: string; stagingAbs: string }> {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const stagingAbs = join(project, init.stagingDir);
    await fs.writeFile(join(stagingAbs, '03-setup.md'), 'staged setup content\n');
    return { project, runId: init.runId, stagingAbs };
  }

  it('L1: appends exactly one record strictly between the fences, leaving outside-fence content byte-identical', async () => {
    const { project, runId } = await initAndStage();
    const ledgerAbs = join(project, 'rulebook', '.verify', runId, 'RUN.md');
    const before = await fs.readFile(ledgerAbs, 'utf-8');
    const beforeOutsideFences =
      before.slice(0, before.indexOf(RUN_LEDGER_BEGIN)) +
      before.slice(before.indexOf(RUN_LEDGER_END) + RUN_LEDGER_END.length);

    await verifyRunRecordCommand({ project, runId, unit: '03-setup', slice: '03-setup.md', json: true });

    const after = await fs.readFile(ledgerAbs, 'utf-8');
    const afterOutsideFences =
      after.slice(0, after.indexOf(RUN_LEDGER_BEGIN)) +
      after.slice(after.indexOf(RUN_LEDGER_END) + RUN_LEDGER_END.length);
    expect(afterOutsideFences).toBe(beforeOutsideFences);

    const body = after.slice(
      after.indexOf(RUN_LEDGER_BEGIN) + RUN_LEDGER_BEGIN.length,
      after.indexOf(RUN_LEDGER_END),
    );
    const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
    expect(lines.length).toBe(1);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });

  it('L2: refuses (no record written) when the slice file does not exist', async () => {
    const { project, runId } = await initAndStage();
    const ledgerAbs = join(project, 'rulebook', '.verify', runId, 'RUN.md');
    const before = await fs.readFile(ledgerAbs, 'utf-8');
    await expect(
      verifyRunRecordCommand({ project, runId, unit: 'missing', slice: 'nope.md', json: true }),
    ).rejects.toThrow();
    const after = await fs.readFile(ledgerAbs, 'utf-8');
    expect(after).toBe(before);
  });

  it('L2: refuses when the slice file is empty', async () => {
    const { project, runId, stagingAbs } = await initAndStage();
    await fs.writeFile(join(stagingAbs, 'empty.md'), '');
    await expect(
      verifyRunRecordCommand({ project, runId, unit: 'e', slice: 'empty.md', json: true }),
    ).rejects.toThrow();
  });

  it('L2: refuses when --slice resolves outside the run staging dir (T-173-14)', async () => {
    const { project, runId } = await initAndStage();
    await fs.writeFile(join(project, 'rulebook', 'escape-target.md'), 'not staged\n');
    await expect(
      verifyRunRecordCommand({
        project,
        runId,
        unit: 'escape',
        slice: '../../escape-target.md',
        json: true,
      }),
    ).rejects.toThrow();
  });

  it('L3: the record carries unit id, staging-relative slice path, sha256, and an ISO timestamp', async () => {
    const { project, runId, stagingAbs } = await initAndStage();
    const result = await verifyRunRecordCommand({
      project,
      runId,
      unit: '03-setup',
      slice: '03-setup.md',
      json: true,
    });
    expect(result.unitId).toBe('03-setup');
    expect(result.slicePath).toBe('03-setup.md');
    const bytes = await fs.readFile(join(stagingAbs, '03-setup.md'));
    expect(result.sha256).toBe(sha256(bytes.toString()));

    const ledgerAbs = join(project, 'rulebook', '.verify', runId, 'RUN.md');
    const text = await fs.readFile(ledgerAbs, 'utf-8');
    const body = text.slice(text.indexOf(RUN_LEDGER_BEGIN) + RUN_LEDGER_BEGIN.length, text.indexOf(RUN_LEDGER_END));
    const record = JSON.parse(body.trim());
    expect(record.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('L4: recording the same unit twice is an idempotent no-op returning alreadyRecorded:true', async () => {
    const { project, runId } = await initAndStage();
    const first = await verifyRunRecordCommand({ project, runId, unit: '03-setup', slice: '03-setup.md', json: true });
    expect(first.alreadyRecorded).toBe(false);

    const ledgerAbs = join(project, 'rulebook', '.verify', runId, 'RUN.md');
    const afterFirst = await fs.readFile(ledgerAbs, 'utf-8');

    const second = await verifyRunRecordCommand({ project, runId, unit: '03-setup', slice: '03-setup.md', json: true });
    expect(second.alreadyRecorded).toBe(true);

    const afterSecond = await fs.readFile(ledgerAbs, 'utf-8');
    expect(afterSecond).toBe(afterFirst);
  });

  it('L5: verifyRunStatusCommand --json returns { runId, stagingDir, recorded, count }', async () => {
    const { project, runId } = await initAndStage();
    await verifyRunRecordCommand({ project, runId, unit: '03-setup', slice: '03-setup.md', json: true });
    const status = await verifyRunStatusCommand({ project, runId, json: true });
    expect(status).toMatchObject({ runId, recorded: ['03-setup'], count: 1 });
    expect(status.stagingDir).toBeTruthy();
  });

  it('L6: with no --run-id, status reports the most recent run (lexicographic sort of fixed-width UTC ids)', async () => {
    const project = await liveProject();
    const older = await verifyRunInitCommand({ project, runId: '2026-01-01T00-00-00Z', json: true });
    const newer = await verifyRunInitCommand({ project, runId: '2026-06-15T12-30-00Z', json: true });
    void older;
    const status = await verifyRunStatusCommand({ project, json: true });
    expect(status.runId).toBe(newer.runId);
  });

  it('L7: a torn final in-fence line reads as that unit NOT recorded (crash safety), with a warning, no throw', async () => {
    const { project, runId } = await initAndStage();
    await verifyRunRecordCommand({ project, runId, unit: '03-setup', slice: '03-setup.md', json: true });

    const ledgerAbs = join(project, 'rulebook', '.verify', runId, 'RUN.md');
    const text = await fs.readFile(ledgerAbs, 'utf-8');
    const beforeFence = text.slice(0, text.indexOf(RUN_LEDGER_END));
    // Simulate a crash mid-append: a second record whose JSON is torn (truncated mid-object).
    const torn = beforeFence + '{"unitId":"07-turn","slicePath":"07-turn' + text.slice(text.indexOf(RUN_LEDGER_END));
    await fs.writeFile(ledgerAbs, torn);

    const status = await verifyRunStatusCommand({ project, runId, json: true });
    expect(status.recorded).toContain('03-setup');
    expect(status.recorded).not.toContain('07-turn');
  });

  it('L8: a recorded sha256 that no longer matches the file on disk is reported NOT recorded, with a warning', async () => {
    const { project, runId, stagingAbs } = await initAndStage();
    await verifyRunRecordCommand({ project, runId, unit: '03-setup', slice: '03-setup.md', json: true });

    // Mutate the staged slice after recording — simulating a hand-edit or re-write.
    await fs.writeFile(join(stagingAbs, '03-setup.md'), 'tampered content\n');

    const status = await verifyRunStatusCommand({ project, runId, json: true });
    expect(status.recorded).not.toContain('03-setup');
    expect(status.count).toBe(0);
  });

  it('L9: a RUN.md with its fences removed produces the actionable "missing its machine-owned fences" error', async () => {
    const { project, runId } = await initAndStage();
    const ledgerAbs = join(project, 'rulebook', '.verify', runId, 'RUN.md');
    await fs.writeFile(ledgerAbs, '# Verify Run Ledger\n\nno fences here\n');

    await expect(verifyRunStatusCommand({ project, runId, json: true })).rejects.toThrow(
      /machine-owned fences/,
    );
    await expect(
      verifyRunRecordCommand({ project, runId, unit: 'x', slice: '03-setup.md', json: true }),
    ).rejects.toThrow(/machine-owned fences/);
  });
});

// -------------------------------------------------------------------------------------------
// Task 3 — every existing rulebook/ consumer is blind to the staging tree (VERIFY-02's guarantee)
// -------------------------------------------------------------------------------------------

describe('the staging tree is invisible to every existing rulebook/ consumer', () => {
  async function fullProjectWithStagingAndGit(): Promise<string> {
    const project = await liveProject();
    execSync('git init', { cwd: project, stdio: 'ignore' });
    await fs.mkdir(join(project, 'chunks'), { recursive: true });
    execSync('git add -A', { cwd: project, stdio: 'ignore' });
    execSync('git -c user.email=t@t -c user.name=t commit -m init', { cwd: project, stdio: 'ignore' });

    const init = await verifyRunInitCommand({ project, json: true });
    const stagingAbs = join(project, init.stagingDir);
    // Staged files deliberately named like live slices, and one with a gap marker that must
    // never be swept into the live INDEX.md.
    await fs.writeFile(
      join(stagingAbs, '03-setup.md'),
      '## 03-setup\n\nNamed-but-undefined (p.99): staged phantom rule\n',
    );
    await fs.writeFile(join(stagingAbs, '07-turn.md'), '## 07-turn\n\nstaged turn text\n');
    return project;
  }

  it('computeVerificationScope never sees the staging dir', async () => {
    const project = await fullProjectWithStagingAndGit();
    const scope = await computeVerificationScope(project);
    // Whatever the scope resolves to (pre-provenance-project here — no Source hash: line), the
    // point is it must not reference or be influenced by the staging tree at all.
    expect(JSON.stringify(scope)).not.toContain('.verify');
  });

  it('chunkProvenanceStatusCommand --json never mentions the staged path, and its counts are live-only', async () => {
    const project = await fullProjectWithStagingAndGit();
    const result = await chunkProvenanceStatusCommand({ project, json: true });
    expect(JSON.stringify(result)).not.toContain('.verify');
  });

  it('traceCheckCommand --json never mentions the staged path', async () => {
    const project = await fullProjectWithStagingAndGit();
    const result = await traceCheckCommand({ project, json: true });
    expect(JSON.stringify(result)).not.toContain('.verify');
  });

  it('driftCheckCommand --json never mentions the staged path', async () => {
    const project = await fullProjectWithStagingAndGit();
    const result = await driftCheckCommand({ project, json: true });
    expect(JSON.stringify(result)).not.toContain('.verify');
  });

  it('ingestGapsCommand never sweeps a staged "Named-but-undefined" marker into the live INDEX.md', async () => {
    const project = await fullProjectWithStagingAndGit();
    const result = await ingestGapsCommand({ project, json: true, quiet: true });
    // Only the live slices (2) are scanned — the staged tree's phantom marker must not surface.
    expect(result.slicesScanned).toBe(2);
    expect(result.gapsWritten).toBe(0);

    const index = await fs.readFile(join(project, 'rulebook', 'INDEX.md'), 'utf-8');
    expect(index).not.toContain('staged phantom rule');
  });
});
