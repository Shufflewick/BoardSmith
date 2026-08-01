import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { renderIndex } from './ingest-archive.js';
import {
  VERIFY_PIPELINE_STEPS,
  SOURCE_FREE_ADDITIONAL_CHECKS,
  computeSourceFreeReport,
} from './verify-source-free.js';

/**
 * Decision 7 (179-CONTEXT.md): "A test must FAIL when a pipeline step exists with no
 * unchecked-class mapping." This is this phase's version of the trap Phase 178 hit seven times
 * (178-PROOF.md §10) — an assertion whose falsifiability is claimed but never demonstrated. The
 * coverage test below was demonstrated live during 179-01's execution: `## Step 10: Anything` was
 * temporarily appended to `verify-game.md`, the failure was observed and recorded verbatim in
 * 179-01-SUMMARY.md, then reverted. This comment documents the exact edit for a future reader who
 * wants to reproduce that demonstration themselves — do not skip it, run it.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = join(__dirname, '../slash-command/bs');
const VERIFY_GAME_MD = join(SKILL_DIR, 'verify-game.md');

/** Parses every `## Step N: <title>` heading out of `verify-game.md`, at test time — never a
 * hand-copied list, so this test observes the real file, not a snapshot of it. */
function parseStepHeadings(text: string): Array<{ step: number; title: string }> {
  const headings: Array<{ step: number; title: string }> = [];
  const re = /^## Step (\d+): (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    headings.push({ step: Number(match[1]), title: match[2].trim() });
  }
  return headings;
}

describe('decision 7 — VERIFY_PIPELINE_STEPS coverage of the real pipeline', () => {
  it('every ## Step N: heading in verify-game.md has a VERIFY_PIPELINE_STEPS entry', () => {
    const text = readFileSync(VERIFY_GAME_MD, 'utf-8');
    const headings = parseStepHeadings(text);
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      const entry = VERIFY_PIPELINE_STEPS.find((s) => s.step === heading.step);
      expect(entry, `Step ${heading.step} ("${heading.title}") has no VERIFY_PIPELINE_STEPS entry`)
        .toBeDefined();
      expect(entry?.title).toBe(heading.title);
    }
  });

  it('every VERIFY_PIPELINE_STEPS entry names a step number present in verify-game.md (reverse drift)', () => {
    const text = readFileSync(VERIFY_GAME_MD, 'utf-8');
    const headings = parseStepHeadings(text);
    const headingSteps = new Set(headings.map((h) => h.step));
    for (const entry of VERIFY_PIPELINE_STEPS) {
      expect(
        headingSteps.has(entry.step),
        `VERIFY_PIPELINE_STEPS has step ${entry.step} ("${entry.id}") with no matching heading in verify-game.md`,
      ).toBe(true);
    }
  });

  it('every skipped step has at least one unchecked entry; every runs step has zero', () => {
    for (const entry of VERIFY_PIPELINE_STEPS) {
      if (entry.sourceFreeBehavior === 'skipped') {
        expect(
          entry.unchecked.length,
          `Step ${entry.step} ("${entry.id}") is 'skipped' but has zero unchecked entries`,
        ).toBeGreaterThanOrEqual(1);
      } else {
        expect(
          entry.unchecked.length,
          `Step ${entry.step} ("${entry.id}") is 'runs' but has a non-empty unchecked array`,
        ).toBe(0);
      }
    }
  });

  it('no defectClass or wouldHaveBeenCaughtBy string is empty, and no defectClass names a step number or requirement id', () => {
    for (const entry of VERIFY_PIPELINE_STEPS) {
      for (const unchecked of entry.unchecked) {
        expect(unchecked.defectClass.trim().length, `Step ${entry.step} has an empty defectClass`)
          .toBeGreaterThan(0);
        expect(
          unchecked.wouldHaveBeenCaughtBy.trim().length,
          `Step ${entry.step} has an empty wouldHaveBeenCaughtBy`,
        ).toBeGreaterThan(0);
        expect(unchecked.defectClass).not.toMatch(/Step \d/);
        expect(unchecked.defectClass).not.toMatch(/(VERIFY|CHECK|PROV|INGEST)-\d/);
      }
    }
  });

  it(
    'DEMONSTRATED LIVE during 179-01 execution: temporarily appending "## Step 10: Anything" to ' +
      'verify-game.md — with no matching VERIFY_PIPELINE_STEPS entry — made the first coverage ' +
      'test above fail. The verbatim failure output is recorded in 179-01-SUMMARY.md, not ' +
      're-asserted here (a self-testing test that mutates its own fixture would not be testing ' +
      'the real file). This test exists only to document, for a future reader, exactly what edit ' +
      'reproduces that demonstration.',
    () => {
      const text = readFileSync(VERIFY_GAME_MD, 'utf-8');
      expect(text).not.toContain('## Step 10:');
    },
  );

  it('VERIFY_PIPELINE_STEPS is declared in exactly one file under src/ (single-definition guard)', () => {
    const srcDir = join(__dirname, '../../..');
    const matches: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
        const full = join(dir, entry);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) {
          const content = readFileSync(full, 'utf-8');
          if (/export const VERIFY_PIPELINE_STEPS/.test(content)) {
            matches.push(full);
          }
        }
      }
    };
    walk(srcDir);
    expect(matches).toEqual([join(__dirname, 'verify-source-free.ts')]);
  });
});

describe('SOURCE_FREE_ADDITIONAL_CHECKS', () => {
  it('names trace-check (CHECK-03) and drift-check (CHECK-05), the two checks not dispatched by a numbered step', () => {
    const commands = SOURCE_FREE_ADDITIONAL_CHECKS.map((c) => c.command).sort();
    expect(commands).toEqual(['drift-check', 'trace-check']);
  });
});

describe('computeSourceFreeReport', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-source-free-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('project with a Source hash: line but no file at the recorded Source: path -> source-free, code-conformance-only, source-missing', async () => {
    const project = join(dir, 'game-source-missing');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: 'rulebook/source/rules.pdf',
        sourceHash,
        transcribed: '2026-08-01',
      }),
    );
    // Archived file deliberately never written.

    const report = await computeSourceFreeReport(project);
    expect(report.sourceFree).toBe(true);
    expect(report.scope).toBe('code-conformance-only');
    expect(report.reason).toBe('source-missing');
  });

  it('project with archived source whose sha256 matches -> not source-free, full, empty uncheckedDefectClasses', async () => {
    const project = join(dir, 'game-full');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes for the full-scope case\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-08-01',
      }),
    );
    await fs.mkdir(join(project, 'rulebook/source'), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);

    const report = await computeSourceFreeReport(project);
    expect(report.sourceFree).toBe(false);
    expect(report.scope).toBe('full');
    expect(report.uncheckedDefectClasses).toEqual([]);
    expect(report.stepsSkipped).toEqual([]);
    expect(report.stepsRun.length).toBe(VERIFY_PIPELINE_STEPS.length);
  });

  it('source-free fixture: uncheckedDefectClasses has at least 5 entries, all with non-empty fields', async () => {
    const project = join(dir, 'game-source-free-count');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: 'rulebook/source/rules.pdf',
        sourceHash,
        transcribed: '2026-08-01',
      }),
    );

    const report = await computeSourceFreeReport(project);
    expect(report.uncheckedDefectClasses.length).toBeGreaterThanOrEqual(5);
    for (const entry of report.uncheckedDefectClasses) {
      expect(entry.defectClass.trim().length).toBeGreaterThan(0);
      expect(entry.wouldHaveBeenCaughtBy.trim().length).toBeGreaterThan(0);
      expect(entry.stepId.trim().length).toBeGreaterThan(0);
    }
  });

  it('stepsRun and stepsSkipped never overlap and together cover VERIFY_PIPELINE_STEPS.length', async () => {
    const project = join(dir, 'game-partition');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: 'rulebook/source/rules.pdf',
        sourceHash,
        transcribed: '2026-08-01',
      }),
    );

    const report = await computeSourceFreeReport(project);
    const runIds = new Set(report.stepsRun.map((s) => s.id));
    const skippedIds = new Set(report.stepsSkipped.map((s) => s.id));
    for (const id of runIds) expect(skippedIds.has(id)).toBe(false);
    expect(runIds.size + skippedIds.size).toBe(VERIFY_PIPELINE_STEPS.length);
  });

  it('no rulebook/ at all -> source-free via no-rulebook-project, same honest-degradation path', async () => {
    const project = join(dir, 'game-no-rulebook');
    await fs.mkdir(project, { recursive: true });

    const report = await computeSourceFreeReport(project);
    expect(report.sourceFree).toBe(true);
    expect(report.scope).toBe('code-conformance-only');
    expect(report.reason).toBe('no-rulebook-project');
  });

  it('checksRun always lists the four source-free-by-construction checks, regardless of scope', async () => {
    const project = join(dir, 'game-checks-run');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-08-01',
      }),
    );
    await fs.mkdir(join(project, 'rulebook/source'), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);

    const report = await computeSourceFreeReport(project);
    const commands = report.checksRun.map((c) => c.command).sort();
    expect(commands).toEqual([
      'drift-check',
      'trace-check',
      'verify-derive-check',
      'verify-example-replay',
    ]);
  });
});
