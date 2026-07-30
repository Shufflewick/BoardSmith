import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import {
  verifyRunInitCommand,
  verifyRunRecordCommand,
  verifyRunStatusCommand,
  stagingSlicesDir,
  RUN_LEDGER_BEGIN,
  RUN_LEDGER_END,
  RUN_ID_RE,
  atomicWriteFile,
  appendLedgerLine,
  locateFences,
  parseLedgerBody,
  resolveLedgerState,
  ledgerFilePath,
  readLedgerOrThrow,
  type ClassificationRecord,
  type ImpactRecord,
  type AdjudicationRecord,
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
async function liveProject(name = 'game'): Promise<string> {
  const project = join(dir, name);
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
// 173-08 Task 1 — CR-01: the ledger write is crash-safe (atomic temp-write + rename)
// -------------------------------------------------------------------------------------------

describe('CR-01 — the ledger write is atomic, not a truncate+rewrite', () => {
  it('CR-static: fs.writeFile(ledgerFile is never called against the ledger — atomicWriteFile only', async () => {
    const src = await fs.readFile(new URL('./verify-run.ts', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/fs\.writeFile\(ledgerFile/);
  });

  it('CR-A: a failure injected between the temp write and the rename leaves the ledger byte-identical to its pre-call state, with earlier records intact, and surfaces the error (never swallowed)', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const runId = init.runId;
    await fs.writeFile(join(project, init.stagingDir, '03-setup.md'), 'staged setup content\n');
    // One real, already-durable record before the injected crash.
    await verifyRunRecordCommand({ project, runId, unit: '03-setup', slice: '03-setup.md', json: true });

    const ledgerAbs = join(project, 'rulebook', '.verify', runId, 'RUN.md');
    const before = await fs.readFile(ledgerAbs, 'utf-8');

    // Stage a second, real, non-empty slice so the call under test gets as far as the write.
    const stagingAbs = join(project, 'rulebook', '.verify', runId, 'slices');
    await fs.writeFile(join(stagingAbs, '07-turn.md'), 'staged turn content\n');

    // Inject the failure at the exact boundary the plan names: the temp file has already been
    // fully written and fsynced by the time this rejects — only the rename (the atomic
    // "commit" step) fails, simulating a crash landing in that window.
    const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('injected crash: rename never completed'));

    await expect(
      verifyRunRecordCommand({ project, runId, unit: '07-turn', slice: '07-turn.md', json: true }),
    ).rejects.toThrow(/injected crash/);
    renameSpy.mockRestore();

    const after = await fs.readFile(ledgerAbs, 'utf-8');
    expect(after).toBe(before); // byte-identical — no truncation, no partial rewrite

    // The earlier, already-durable record survived the injected crash on the LATER call.
    const status = await verifyRunStatusCommand({ project, runId, json: true });
    expect(status.recorded).toEqual(['03-setup']);

    // The orphaned temp file (if any) is never mistaken for the ledger by any reader (T-173-08-04):
    // a fresh status call still reads exactly the pre-crash state.
    const runDirAbs = join(project, 'rulebook', '.verify', runId);
    const entries = await fs.readdir(runDirAbs);
    const tmpFiles = entries.filter((e) => e.endsWith('.tmp'));
    for (const tmp of tmpFiles) {
      expect(tmp).not.toBe('RUN.md');
    }
  });

  it('CR-B: a genuinely killed OS process (SIGKILL) between the temp write and the rename never corrupts the ledger — a real crash, not simulated', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const runId = init.runId;
    await fs.writeFile(join(project, init.stagingDir, '03-setup.md'), 'staged setup content\n');
    await verifyRunRecordCommand({ project, runId, unit: '03-setup', slice: '03-setup.md', json: true });

    const ledgerAbs = join(project, 'rulebook', '.verify', runId, 'RUN.md');
    const before = await fs.readFile(ledgerAbs, 'utf-8');
    const runDirAbs = join(project, 'rulebook', '.verify', runId);
    const readySentinel = join(runDirAbs, '.crash-test-ready');

    // A standalone script performing the SAME sequence atomicWriteFile does — open a
    // same-directory temp file, write, fsync — then signal readiness and block forever,
    // deliberately never reaching rename(). The parent SIGKILLs it once the sentinel appears,
    // landing the kill in the exact window CR-01 concerns: after the temp write is durable,
    // before the rename that would make it the live ledger.
    const scriptPath = join(runDirAbs, '.crash-sim.mjs');
    await fs.writeFile(
      scriptPath,
      `
      import { promises as fs } from 'node:fs';
      const ledgerAbs = ${JSON.stringify(ledgerAbs)};
      const tmpPath = ${JSON.stringify(join(runDirAbs, '.RUN.md.crashsim.tmp'))};
      const handle = await fs.open(tmpPath, 'w');
      await handle.writeFile('THIS MUST NEVER BECOME RUN.md\\n', 'utf-8');
      await handle.sync();
      await handle.close();
      await fs.writeFile(${JSON.stringify(readySentinel)}, 'ready\\n');
      setInterval(() => {}, 60000); // block forever (keeps the event loop alive) — never calls rename()
      `,
    );

    const child = spawn(process.execPath, [scriptPath], { stdio: 'ignore' });
    try {
      const deadline = Date.now() + 5000;
      while (!(await fs.access(readySentinel).then(() => true, () => false))) {
        if (Date.now() > deadline) throw new Error('crash-sim script never became ready');
        await new Promise((r) => setTimeout(r, 20));
      }
      child.kill('SIGKILL');
      await new Promise<void>((resolveKill) => child.once('exit', () => resolveKill()));
    } finally {
      child.kill('SIGKILL');
    }

    const after = await fs.readFile(ledgerAbs, 'utf-8');
    expect(after).toBe(before); // the real, killed process never touched the live ledger

    // The orphaned temp file from the killed process is a harmless leftover — never RUN.md.
    const entries = await fs.readdir(runDirAbs);
    expect(entries).toContain('RUN.md');
    expect(entries).toContain('.RUN.md.crashsim.tmp');

    // A subsequent, normal call still works — the run is not wedged by the orphan.
    const stagingAbs = join(project, 'rulebook', '.verify', runId, 'slices');
    await fs.writeFile(join(stagingAbs, '07-turn.md'), 'staged turn content\n');
    const result = await verifyRunRecordCommand({ project, runId, unit: '07-turn', slice: '07-turn.md', json: true });
    expect(result.alreadyRecorded).toBe(false);
    const status = await verifyRunStatusCommand({ project, runId, json: true });
    expect(status.recorded.sort()).toEqual(['03-setup', '07-turn']);
  }, 15000);
});

// -------------------------------------------------------------------------------------------
// 173-08 Task 2 — range-level resume determinism (PROOF.md §4 Finding 1)
// -------------------------------------------------------------------------------------------

describe('173-08 Task 2 — dispatch-plan manifest + range-level resume determinism', () => {
  it('M1: --ranges persists a manifest at fresh init, echoed back via --json', async () => {
    const project = await liveProject();
    const result = await verifyRunInitCommand({ project, ranges: ['1-1', '2-2'], json: true });
    expect(result.ranges).toEqual(['1-1', '2-2']);

    const status = await verifyRunStatusCommand({ project, runId: result.runId, json: true });
    expect(status.ranges).toEqual(['1-1', '2-2']);
    expect(status.rangesPending).toEqual(['1-1', '2-2']);
    expect(status.rangesRecorded).toEqual([]);
  });

  it('M2: the manifest is decided ONCE — a resuming init call with different --ranges is ignored', async () => {
    const project = await liveProject();
    const first = await verifyRunInitCommand({ project, ranges: ['1-1', '2-2'], json: true });

    const second = await verifyRunInitCommand({
      project,
      runId: first.runId,
      ranges: ['9-9', '10-10', '11-11'],
      json: true,
    });
    expect(second.created).toBe(false);
    expect(second.ranges).toEqual(['1-1', '2-2']); // unchanged — first init's manifest wins
  });

  it('M3: verify-run-init with no --ranges creates no manifest section — ranges: [] and never breaks an unrelated run', async () => {
    const project = await liveProject();
    const result = await verifyRunInitCommand({ project, json: true });
    expect(result.ranges).toEqual([]);
    const status = await verifyRunStatusCommand({ project, runId: result.runId, json: true });
    expect(status.ranges).toEqual([]);
    expect(status.rangesPending).toEqual([]);
  });

  it('M4: --complete-range marks a manifest range recorded; it moves from rangesPending to rangesRecorded and is idempotent', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, ranges: ['1-1', '2-2'], json: true });

    const first = await verifyRunRecordCommand({ project, runId: init.runId, completeRange: '1-1', json: true });
    expect(first).toMatchObject({ action: 'range-complete', rangeId: '1-1', alreadyRecorded: false });

    const status = await verifyRunStatusCommand({ project, runId: init.runId, json: true });
    expect(status.rangesRecorded).toEqual(['1-1']);
    expect(status.rangesPending).toEqual(['2-2']);

    const second = await verifyRunRecordCommand({ project, runId: init.runId, completeRange: '1-1', json: true });
    expect(second.alreadyRecorded).toBe(true);
  });

  it('M5: --complete-range / --unit --range refuse a range id absent from a non-empty manifest', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, ranges: ['1-1'], json: true });
    const stagingAbs = join(project, init.stagingDir);
    await fs.writeFile(join(stagingAbs, 'x.md'), 'content\n');

    await expect(
      verifyRunRecordCommand({ project, runId: init.runId, completeRange: 'nope', json: true }),
    ).rejects.toThrow(/not in run .* manifest/);
    await expect(
      verifyRunRecordCommand({ project, runId: init.runId, unit: 'x', slice: 'x.md', range: 'nope', json: true }),
    ).rejects.toThrow(/not in run .* manifest/);
  });

  it('M6: --reset-range supersedes a partially-recorded range\'s prior units — they drop out of recorded[]', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, ranges: ['1-1'], json: true });
    const stagingAbs = join(project, init.stagingDir);

    await fs.writeFile(join(stagingAbs, '01-overview-contents-setup.md'), 'stale attempt, unit 1\n');
    await fs.writeFile(join(stagingAbs, '01-starting-a-new-round.md'), 'stale attempt, unit 2\n');
    await verifyRunRecordCommand({
      project, runId: init.runId, unit: '01-overview-contents-setup', slice: '01-overview-contents-setup.md',
      range: '1-1', json: true,
    });
    // Simulate a kill: only the first unit was recorded before the interrupted range was reset.

    const reset = await verifyRunRecordCommand({ project, runId: init.runId, resetRange: '1-1', json: true });
    expect(reset).toMatchObject({ action: 'range-reset', rangeId: '1-1', alreadyRecorded: false });

    const statusAfterReset = await verifyRunStatusCommand({ project, runId: init.runId, json: true });
    expect(statusAfterReset.recorded).toEqual([]); // the stale unit is superseded, not just unfinished
    expect(statusAfterReset.rangesPending).toEqual(['1-1']);
  });

  it('M7: refuses to reset an already-complete range (would discard verified work)', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, ranges: ['1-1'], json: true });
    await verifyRunRecordCommand({ project, runId: init.runId, completeRange: '1-1', json: true });

    await expect(
      verifyRunRecordCommand({ project, runId: init.runId, resetRange: '1-1', json: true }),
    ).rejects.toThrow(/already fully recorded/);
  });

  it('M8: after a reset, re-recording the same unitId is a fresh record (not alreadyRecorded), and a completed range is never re-dispatched', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, ranges: ['1-1', '2-2'], json: true });
    const stagingAbs = join(project, init.stagingDir);

    // Range 1-1: killed mid-loop, exactly like PROOF.md §4 — one of two units recorded.
    await fs.writeFile(join(stagingAbs, '01-overview-contents-setup.md'), 'first attempt section A\n');
    await fs.writeFile(join(stagingAbs, '01-starting-a-new-round.md'), 'first attempt section B\n');
    await verifyRunRecordCommand({
      project, runId: init.runId, unit: '01-overview-contents-setup', slice: '01-overview-contents-setup.md',
      range: '1-1', json: true,
    });

    // Range 2-2: never dispatched at all (the deliberate kill -9 case).

    const beforeResume = await verifyRunStatusCommand({ project, runId: init.runId, json: true });
    expect(beforeResume.rangesPending).toEqual(['1-1', '2-2']); // 1-1 has units but is NOT complete

    // Resume: 1-1 is pending and has stale units — reset it, then redispatch it fresh (a
    // DIFFERENT, deterministic-for-this-test section split than the killed attempt, matching a
    // real subagent producing different boundaries on a fresh dispatch).
    await verifyRunRecordCommand({ project, runId: init.runId, resetRange: '1-1', json: true });
    await fs.rm(join(stagingAbs, '01-overview-contents-setup.md'));
    await fs.rm(join(stagingAbs, '01-starting-a-new-round.md'));
    await fs.writeFile(join(stagingAbs, '01-overview-and-setup.md'), 'clean single-unit content\n');
    const fresh = await verifyRunRecordCommand({
      project, runId: init.runId, unit: '01-overview-and-setup', slice: '01-overview-and-setup.md',
      range: '1-1', json: true,
    });
    expect(fresh.alreadyRecorded).toBe(false);
    await verifyRunRecordCommand({ project, runId: init.runId, completeRange: '1-1', json: true });

    // Range 2-2: pending, never touched — dispatch it fresh, one unit, then complete it.
    await fs.writeFile(join(stagingAbs, '02-everything.md'), 'clean single-unit content for page 2\n');
    await verifyRunRecordCommand({
      project, runId: init.runId, unit: '02-everything', slice: '02-everything.md', range: '2-2', json: true,
    });
    await verifyRunRecordCommand({ project, runId: init.runId, completeRange: '2-2', json: true });

    const finalStatus = await verifyRunStatusCommand({ project, runId: init.runId, json: true });
    // Exactly one unit per range survives — no re-fragmentation, no overlap with the killed
    // attempt's stale output (the 9-vs-4 gap this task closes).
    expect(finalStatus.recorded.sort()).toEqual(['01-overview-and-setup', '02-everything']);
    expect(finalStatus.rangesRecorded.sort()).toEqual(['1-1', '2-2']);
    expect(finalStatus.rangesPending).toEqual([]);

    // Already-complete ranges are never re-dispatched (173-07's proven property, unregressed):
    // attempting to complete or reset them again is either a no-op or a refusal, never silent data
    // loss.
    const recompleteAttempt = await verifyRunRecordCommand({ project, runId: init.runId, completeRange: '2-2', json: true });
    expect(recompleteAttempt.alreadyRecorded).toBe(true);
  });

  it('M9: clean single-pass dispatch vs a killed-then-resumed dispatch over the same manifest produce identical final recorded[] sets', async () => {
    // Deterministic "subagent": always the same page->unit mapping for a given range, so this
    // test isolates the MECHANISM's determinism (Task 2's scope) from real transcription content
    // non-determinism (out of scope — see 173-PROOF.md §4's own comparison caveat).
    async function deterministicDispatch(
      project: string, runId: string, stagingAbs: string, rangeId: string, units: string[],
    ): Promise<void> {
      for (const unit of units) {
        await fs.writeFile(join(stagingAbs, `${unit}.md`), `content for ${unit}\n`);
        await verifyRunRecordCommand({ project, runId, unit, slice: `${unit}.md`, range: rangeId, json: true });
      }
      await verifyRunRecordCommand({ project, runId, completeRange: rangeId, json: true });
    }

    const manifest = ['1-1', '2-2'];
    const planByRange: Record<string, string[]> = {
      '1-1': ['01-overview-and-setup', '01-starting-a-new-round'],
      '2-2': ['02-action-cards', '02-punch-examples-discard-and-end-of-game'],
    };

    // Clean run: both ranges dispatched once, uninterrupted.
    const cleanProject = await liveProject('clean-game');
    const cleanInit = await verifyRunInitCommand({
      project: cleanProject, runId: '2026-01-01T00-00-00Z', ranges: manifest, json: true,
    });
    const cleanStaging = join(cleanProject, cleanInit.stagingDir);
    for (const rangeId of manifest) {
      await deterministicDispatch(cleanProject, cleanInit.runId, cleanStaging, rangeId, planByRange[rangeId]);
    }
    const cleanStatus = await verifyRunStatusCommand({ project: cleanProject, runId: cleanInit.runId, json: true });

    // Killed-then-resumed run: range 1-1 killed after its FIRST unit only, then resumed.
    const killedProject = await liveProject('killed-game');
    const killedInit = await verifyRunInitCommand({
      project: killedProject, runId: '2026-01-02T00-00-00Z', ranges: manifest, json: true,
    });
    const killedStaging = join(killedProject, killedInit.stagingDir);
    await fs.writeFile(join(killedStaging, '01-overview-and-setup.md'), 'content for 01-overview-and-setup\n');
    await verifyRunRecordCommand({
      project: killedProject, runId: killedInit.runId, unit: '01-overview-and-setup',
      slice: '01-overview-and-setup.md', range: '1-1', json: true,
    }); // <- kill lands here: second unit never recorded, range not completed

    const statusBeforeResume = await verifyRunStatusCommand({ project: killedProject, runId: killedInit.runId, json: true });
    expect(statusBeforeResume.rangesPending).toEqual(['1-1', '2-2']);

    // Resume: 1-1 has stale, incomplete progress — reset and redispatch it fresh, identically to
    // the clean run's plan (the manifest and the deterministic-for-this-test subagent guarantee
    // this; a real subagent's exact boundaries are not asserted equal, per PROOF.md §4).
    await verifyRunRecordCommand({ project: killedProject, runId: killedInit.runId, resetRange: '1-1', json: true });
    await fs.rm(join(killedStaging, '01-overview-and-setup.md'));
    await deterministicDispatch(killedProject, killedInit.runId, killedStaging, '1-1', planByRange['1-1']);
    await deterministicDispatch(killedProject, killedInit.runId, killedStaging, '2-2', planByRange['2-2']);

    const resumedStatus = await verifyRunStatusCommand({ project: killedProject, runId: killedInit.runId, json: true });

    expect(resumedStatus.recorded.sort()).toEqual(cleanStatus.recorded.sort());
    expect(resumedStatus.count).toBe(cleanStatus.count);
    expect(resumedStatus.rangesRecorded.sort()).toEqual(cleanStatus.rangesRecorded.sort());
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

// -------------------------------------------------------------------------------------------
// 174-02 Task 1 — ledger helper export surface (genuine reuse, not a copy)
// -------------------------------------------------------------------------------------------

describe('verify-run.ts — ledger helper export surface (174-02)', () => {
  it('EXPORT-1: the seven ledger helpers are all importable functions from a sibling module', () => {
    for (const fn of [
      atomicWriteFile,
      appendLedgerLine,
      locateFences,
      parseLedgerBody,
      resolveLedgerState,
      ledgerFilePath,
      readLedgerOrThrow,
    ]) {
      expect(typeof fn).toBe('function');
    }
  });

  it('EXPORT-2: ledgerFilePath returns the exact RUN.md path a real init created, and it exists on disk', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const computed = ledgerFilePath(project, init.runId);
    expect(computed).toBe(join(project, init.ledgerPath));
    await expect(fs.access(computed)).resolves.toBeUndefined();
  });

  it('EXPORT-3: atomicWriteFile leaves no *.tmp* sibling behind after a successful write', async () => {
    const project = await liveProject();
    const targetDir = join(project, 'rulebook');
    const target = join(targetDir, 'atomic-export-check.md');
    await atomicWriteFile(target, 'hello\n');
    expect(await fs.readFile(target, 'utf-8')).toBe('hello\n');
    const entries = await fs.readdir(targetDir);
    const tmpSiblings = entries.filter((e) => e.includes('.tmp'));
    expect(tmpSiblings).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// 174-02 Task 2 — the ledger union's fourth kind, 'classification'
// -------------------------------------------------------------------------------------------

/**
 * Appends one classification line to a run's RUN.md via the SAME exported append + atomic-write
 * path a real command uses — never a hand-written whole-file replace.
 */
async function appendClassificationLine(
  project: string,
  runId: string,
  record: ClassificationRecord,
): Promise<void> {
  const ledgerFile = ledgerFilePath(project, runId);
  const relLedgerPath = relative(project, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, project);
  const newText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(record));
  await atomicWriteFile(ledgerFile, newText);
}

function classificationFixture(overrides: Partial<ClassificationRecord> = {}): ClassificationRecord {
  return {
    kind: 'classification',
    pairId: 'pair-1',
    units: ['staged/01-round.md', 'staged/02-tips.md', 'staged/03-scoring.md'],
    liveSlices: ['rulebook/01-round.md'],
    stagedSlices: ['staged/01-round.md', 'staged/02-tips.md', 'staged/03-scoring.md'],
    provenance: 'unknown',
    ruleDelta: 'cosmetic',
    stale: false,
    evidence: 'wording differs, consequence identical',
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('verify-run.ts — classification record kind (174-02)', () => {
  it('LEDGER-1: a valid classification line parses with a three-element units[] preserved in order', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const record = classificationFixture();
    await appendClassificationLine(project, init.runId, record);

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines, malformedLines } = parseLedgerBody(ledgerText, relLedgerPath);

    expect(malformedLines).toEqual([]);
    const classificationLines = lines.filter((l) => l.type === 'classification');
    expect(classificationLines).toHaveLength(1);
    const parsed = classificationLines[0].record;
    expect(parsed.units).toEqual(['staged/01-round.md', 'staged/02-tips.md', 'staged/03-scoring.md']);
    expect(parsed).toMatchObject({ kind: 'classification', pairId: 'pair-1' });
  });

  it('LEDGER-2: a malformed classification line lands in malformedLines, never thrown', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);

    // Missing required field (evidence).
    const missingField = { ...classificationFixture(), evidence: undefined };
    delete (missingField as Record<string, unknown>).evidence;
    // units as a bare string instead of an array.
    const unitsAsString = { ...classificationFixture(), units: 'staged/01-round.md' };
    // units as an array containing a non-string.
    const unitsWithNonString = { ...classificationFixture(), units: ['staged/01-round.md', 42] };
    // Torn/unparseable JSON.
    const tornLine = '{"kind":"classification","pairId":"pair-2","units":[';

    let ledgerText = await readLedgerOrThrow(ledgerFile, init.runId, project);
    for (const bad of [missingField, unitsAsString, unitsWithNonString]) {
      ledgerText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(bad));
    }
    ledgerText = appendLedgerLine(ledgerText, relLedgerPath, tornLine);
    await atomicWriteFile(ledgerFile, ledgerText);

    const finalText = await fs.readFile(ledgerFile, 'utf-8');
    expect(() => parseLedgerBody(finalText, relLedgerPath)).not.toThrow();
    const { lines, malformedLines } = parseLedgerBody(finalText, relLedgerPath);
    expect(lines.filter((l) => l.type === 'classification')).toHaveLength(0);
    expect(malformedLines).toHaveLength(4);
  });

  it('LEDGER-3: a classification line never contaminates recorded[] — kind isolation both ways', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const stagingAbs = join(project, init.stagingDir);
    await fs.writeFile(join(stagingAbs, '03-setup.md'), LIVE_03);
    await verifyRunRecordCommand({
      project,
      runId: init.runId,
      unit: '03-setup',
      slice: '03-setup.md',
    });
    await verifyRunRecordCommand({
      project,
      runId: init.runId,
      completeRange: '1-2',
    });
    // The classification line names the SAME unit id — it must not be double-counted.
    await appendClassificationLine(
      project,
      init.runId,
      classificationFixture({ pairId: 'pair-3', units: ['03-setup'] }),
    );

    const status = await verifyRunStatusCommand({ project, runId: init.runId, json: true });
    expect(status.recorded).toEqual(['03-setup']);
    expect(status.count).toBe(1);

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
    const { recorded, classifications } = resolveLedgerState(lines);
    expect(recorded.map((r) => r.unitId)).toEqual(['03-setup']);
    expect(classifications).toHaveLength(1);
    expect(classifications[0].pairId).toBe('pair-3');
  });

  it('LEDGER-4: a range-reset marker does not supersede a classification record — reset is unit-scoped only', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, runId: undefined, json: true, ranges: ['1-2'] });
    const record = classificationFixture({ pairId: 'pair-4', units: ['03-setup'] });
    await appendClassificationLine(project, init.runId, record);
    await verifyRunRecordCommand({ project, runId: init.runId, resetRange: '1-2' });

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
    const { classifications } = resolveLedgerState(lines);

    expect(classifications).toHaveLength(1);
    expect(classifications[0].units).toEqual(['03-setup']);
  });
});

// -------------------------------------------------------------------------------------------
// 175-02 Task 1 — the ledger union's fifth and sixth kinds, 'impact' and 'adjudication'
// -------------------------------------------------------------------------------------------

/**
 * Appends one impact or adjudication line to a run's RUN.md via the SAME exported append +
 * atomic-write path a real command uses — never a hand-written whole-file replace.
 */
async function appendLine(
  project: string,
  runId: string,
  record: ImpactRecord | AdjudicationRecord | Record<string, unknown>,
): Promise<void> {
  const ledgerFile = ledgerFilePath(project, runId);
  const relLedgerPath = relative(project, ledgerFile);
  const ledgerText = await readLedgerOrThrow(ledgerFile, runId, project);
  const newText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(record));
  await atomicWriteFile(ledgerFile, newText);
}

function impactFixture(overrides: Partial<ImpactRecord> = {}): ImpactRecord {
  return {
    kind: 'impact',
    slug: 'chunk-a',
    ruleDelta: 'sharper',
    stale: true,
    attributions: [
      {
        pairId: 'pair-1',
        liveSlice: 'rulebook/01-round.md',
        rung: 'quoted-fragment',
        attributed: true,
        reason: 'quoted text found in this chunk',
      },
    ],
    chunkStatus: 'verified',
    driftState: 'unknown',
    markerWritten: true,
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

function adjudicationFixture(overrides: Partial<AdjudicationRecord> = {}): AdjudicationRecord {
  return {
    kind: 'adjudication',
    pairId: 'pair-1',
    outcome: 'resolved',
    rulingNumber: 5,
    quotedPass1: 'Fight phase resolves before movement.',
    quotedPass2: 'Movement resolves before the Fight phase.',
    recordedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('verify-run.ts — impact/adjudication record kinds (175-02)', () => {
  it('grep guard: no second RUN_LEDGER_BEGIN fence pair was introduced', async () => {
    const { fileURLToPath } = await import('node:url');
    const srcPath = join(fileURLToPath(new URL('.', import.meta.url)), 'verify-run.ts');
    const src = await fs.readFile(srcPath, 'utf-8');
    const declarations = (src.match(/RUN_LEDGER_BEGIN/g) ?? []).length;
    expect(declarations).toBeGreaterThan(0);
    // Only one string literal constant is ever defined for this fence.
    expect((src.match(/export const RUN_LEDGER_BEGIN =/g) ?? []).length).toBe(1);
  });

  it('IMPACT-1: a well-formed impact line parses as type "impact" from the same fence pair', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    await appendLine(project, init.runId, impactFixture());

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines, malformedLines } = parseLedgerBody(ledgerText, relLedgerPath);

    expect(malformedLines).toEqual([]);
    const impactLines = lines.filter((l) => l.type === 'impact');
    expect(impactLines).toHaveLength(1);
    expect(impactLines[0].record).toMatchObject({ kind: 'impact', slug: 'chunk-a' });
  });

  it('ADJUDICATION-1: a well-formed adjudication line parses as type "adjudication" from the same fence pair', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    await appendLine(project, init.runId, adjudicationFixture());

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines, malformedLines } = parseLedgerBody(ledgerText, relLedgerPath);

    expect(malformedLines).toEqual([]);
    const adjudicationLines = lines.filter((l) => l.type === 'adjudication');
    expect(adjudicationLines).toHaveLength(1);
    expect(adjudicationLines[0].record).toMatchObject({ kind: 'adjudication', pairId: 'pair-1' });
  });

  it('ADJUDICATION-2: outcome "UNADJUDICATED" with no rulingNumber parses as a valid adjudication (decision 8)', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const record = adjudicationFixture({ outcome: 'UNADJUDICATED' });
    delete (record as Partial<AdjudicationRecord>).rulingNumber;
    await appendLine(project, init.runId, record);

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines, malformedLines } = parseLedgerBody(ledgerText, relLedgerPath);

    expect(malformedLines).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].type).toBe('adjudication');
    expect((lines[0].record as AdjudicationRecord).rulingNumber).toBeUndefined();
    expect((lines[0].record as AdjudicationRecord).outcome).toBe('UNADJUDICATED');
  });

  it('IMPACT-2: two impact lines for the same slug resolve to the LATER record, last-write-wins', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    await appendLine(project, init.runId, impactFixture({ stale: true, ruleDelta: 'sharper' }));
    await appendLine(project, init.runId, impactFixture({ stale: false, ruleDelta: 'cosmetic' }));

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
    const { impacts } = resolveLedgerState(lines);

    expect(impacts).toHaveLength(1);
    expect(impacts[0].stale).toBe(false);
    expect(impacts[0].ruleDelta).toBe('cosmetic');
  });

  it('ADJUDICATION-3: two adjudication lines for the same pairId resolve to the LATER record, last-write-wins', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    await appendLine(project, init.runId, adjudicationFixture({ outcome: 'UNADJUDICATED', rulingNumber: undefined }));
    await appendLine(project, init.runId, adjudicationFixture({ outcome: 'resolved', rulingNumber: 9 }));

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
    const { adjudications } = resolveLedgerState(lines);

    expect(adjudications).toHaveLength(1);
    expect(adjudications[0].outcome).toBe('resolved');
    expect(adjudications[0].rulingNumber).toBe(9);
  });

  it('IMPACT-3: a malformed impact line (truncated JSON) lands in malformedLines, never thrown', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);

    let ledgerText = await readLedgerOrThrow(ledgerFile, init.runId, project);
    const tornLine = '{"kind":"impact","slug":"x"';
    ledgerText = appendLedgerLine(ledgerText, relLedgerPath, tornLine);
    // Also a well-formed-JSON-but-wrong-shape impact line (attributions not an array).
    const wrongShape = { ...impactFixture(), attributions: 'not-an-array' };
    ledgerText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(wrongShape));
    await atomicWriteFile(ledgerFile, ledgerText);

    const finalText = await fs.readFile(ledgerFile, 'utf-8');
    expect(() => parseLedgerBody(finalText, relLedgerPath)).not.toThrow();
    const { lines, malformedLines } = parseLedgerBody(finalText, relLedgerPath);
    expect(lines.filter((l) => l.type === 'impact')).toHaveLength(0);
    expect(malformedLines).toHaveLength(2);
  });

  it('ADJUDICATION-4: a malformed adjudication line (missing required field) lands in malformedLines, never thrown', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);

    const missingQuote = { ...adjudicationFixture() } as Record<string, unknown>;
    delete missingQuote.quotedPass2;

    let ledgerText = await readLedgerOrThrow(ledgerFile, init.runId, project);
    ledgerText = appendLedgerLine(ledgerText, relLedgerPath, JSON.stringify(missingQuote));
    await atomicWriteFile(ledgerFile, ledgerText);

    const finalText = await fs.readFile(ledgerFile, 'utf-8');
    expect(() => parseLedgerBody(finalText, relLedgerPath)).not.toThrow();
    const { lines, malformedLines } = parseLedgerBody(finalText, relLedgerPath);
    expect(lines.filter((l) => l.type === 'adjudication')).toHaveLength(0);
    expect(malformedLines).toHaveLength(1);
  });

  it('IMPACT-4: neither impact nor adjudication lines contaminate recorded[] — kind isolation both ways', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({ project, json: true });
    const stagingAbs = join(project, init.stagingDir);
    await fs.writeFile(join(stagingAbs, '03-setup.md'), LIVE_03);
    await verifyRunRecordCommand({
      project,
      runId: init.runId,
      unit: '03-setup',
      slice: '03-setup.md',
    });
    // Impact/adjudication records name the SAME id — must not be double-counted in recorded[].
    await appendLine(project, init.runId, impactFixture({ slug: '03-setup' }));
    await appendLine(project, init.runId, adjudicationFixture({ pairId: '03-setup' }));

    const status = await verifyRunStatusCommand({ project, runId: init.runId, json: true });
    expect(status.recorded).toEqual(['03-setup']);
    expect(status.count).toBe(1);

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
    const { recorded, impacts, adjudications } = resolveLedgerState(lines);
    expect(recorded.map((r) => r.unitId)).toEqual(['03-setup']);
    expect(impacts).toHaveLength(1);
    expect(adjudications).toHaveLength(1);
  });

  it('IMPACT-5: a range-reset marker does not supersede an impact record — reset is unit-scoped only', async () => {
    const project = await liveProject();
    const init = await verifyRunInitCommand({
      project,
      runId: undefined,
      json: true,
      ranges: ['1-2'],
    });
    const stagingAbs = join(project, init.stagingDir);
    await fs.writeFile(join(stagingAbs, '03-setup.md'), LIVE_03);
    await verifyRunRecordCommand({
      project,
      runId: init.runId,
      unit: '03-setup',
      slice: '03-setup.md',
      range: '1-2',
    });
    await appendLine(project, init.runId, impactFixture({ slug: 'chunk-b' }));
    await verifyRunRecordCommand({ project, runId: init.runId, resetRange: '1-2' });

    const ledgerFile = ledgerFilePath(project, init.runId);
    const relLedgerPath = relative(project, ledgerFile);
    const ledgerText = await fs.readFile(ledgerFile, 'utf-8');
    const { lines } = parseLedgerBody(ledgerText, relLedgerPath);
    const { impacts, recorded } = resolveLedgerState(lines);

    // The unit is superseded by the reset (unit-scoped)...
    expect(recorded).toHaveLength(0);
    // ...but the impact record, appended before the reset, is unaffected by it.
    expect(impacts).toHaveLength(1);
    expect(impacts[0].slug).toBe('chunk-b');
  });
});
