import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runHealthBaselineCheck } from './audit.js';

/**
 * Issue #159: a drifted health baseline must report ITSELF as drifted, with
 * the regeneration command, rather than showing up later as an unrelated file
 * becoming uneditable.
 */
describe('runHealthBaselineCheck', () => {
  async function withDir(fn: (dir: string) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), 'bs-health-'));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const counts = (n: number) => ({
    finding_counts: { 'src/engine/action/action.ts': { complexity_critical: { count: n } } },
    production_coverage_findings: [],
    target_keys: [],
  });

  it('passes when the committed baseline still describes the tree', async () => {
    await withDir(async (dir) => {
      writeFileSync(join(dir, '.fallow-health-baseline.json'), JSON.stringify(counts(7)));
      const result = await runHealthBaselineCheck(dir, async (path) => {
        writeFileSync(path, JSON.stringify(counts(7)));
        return 0;
      });
      expect(result.code).toBe(0);
    });
  });

  it('fails, naming the drifted file and the regeneration command', async () => {
    await withDir(async (dir) => {
      writeFileSync(join(dir, '.fallow-health-baseline.json'), JSON.stringify(counts(5)));
      const result = await runHealthBaselineCheck(dir, async (path) => {
        writeFileSync(path, JSON.stringify(counts(7)));
        return 0;
      });
      expect(result.code).not.toBe(0);
      expect(result.report).toContain('src/engine/action/action.ts');
      expect(result.report).toContain('fallow health --save-baseline');
    });
  });

  it('is skipped, not failed, in a project that keeps no health baseline', async () => {
    await withDir(async (dir) => {
      const result = await runHealthBaselineCheck(dir, async () => 0);
      expect(result.code).toBe(0);
      expect(result.report).toMatch(/no .fallow-health-baseline.json/);
    });
  });

  it('fails when fallow wrote no baseline to compare against', async () => {
    await withDir(async (dir) => {
      writeFileSync(join(dir, '.fallow-health-baseline.json'), JSON.stringify(counts(7)));
      const result = await runHealthBaselineCheck(dir, async () => 1);
      expect(result.code).not.toBe(0);
      expect(result.report).toMatch(/fallow health/);
    });
  });

  // `fallow health` exits non-zero on any above-threshold finding, which this
  // repo's backlog guarantees -- so a non-zero exit that still wrote the
  // baseline must be compared, not reported as a broken tool.
  it('compares a baseline fallow wrote while exiting non-zero on its own findings', async () => {
    await withDir(async (dir) => {
      writeFileSync(join(dir, '.fallow-health-baseline.json'), JSON.stringify(counts(7)));
      const result = await runHealthBaselineCheck(dir, async (path) => {
        writeFileSync(path, JSON.stringify(counts(7)));
        return 1;
      });
      expect(result.code).toBe(0);
    });
  });
});
