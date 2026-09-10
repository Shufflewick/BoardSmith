import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  rekeyDupesBaseline,
  runChangedFilesAudit,
  runDupesBaselineCheck,
  runHealthBaselineCheck,
} from './audit.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * Issue #159: a drifted health baseline must report ITSELF as drifted, with
 * the regeneration command, rather than showing up later as an unrelated file
 * becoming uneditable.
 */
describe('runHealthBaselineCheck', () => {
  async function withDir(fn: (dir: string) => Promise<void>) {
    const dir = tempTree('bs-health-');
    await fn(dir);
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

/**
 * Issue #176: `boardsmith audit` ran a bare `fallow`, which reads none of the
 * three baselines in `.fallowrc.json` and is scoped to the whole repository —
 * so it reported the entire accepted backlog and exited 1 on every tree. The
 * gate everyone is told to run was the one that could never pass.
 *
 * The check now runs `fallow audit`: baseline-aware, scoped to the files the
 * branch changed. Its verdict is read from fallow's JSON report rather than
 * from its human output, so a rewording of that output cannot silently turn the
 * gate green.
 */
describe('runChangedFilesAudit', () => {
  /** A fake `fallow audit` that records the arguments each mode was given. */
  function fakeFallow(json: unknown, streamCode = 1) {
    const captured: string[][] = [];
    const streamed: string[][] = [];
    return {
      captured,
      streamed,
      runner: {
        capture: async (args: string[]) => {
          captured.push(args);
          return { code: 0, stdout: typeof json === 'string' ? json : JSON.stringify(json) };
        },
        stream: async (args: string[]) => {
          streamed.push(args);
          return streamCode;
        },
      },
    };
  }

  const verdict = (over: Record<string, unknown> = {}) => ({
    verdict: 'pass',
    changed_files_count: 4,
    base_ref: 'main',
    ...over,
  });

  it('runs `fallow audit`, so the repo\'s baselines and changed-file scope apply', async () => {
    const fallow = fakeFallow(verdict());

    const result = await runChangedFilesAudit(fallow.runner);

    expect(result.outcome).toBe('pass');
    expect(fallow.captured).toHaveLength(1);
    expect(fallow.captured[0]).toContain('--format');
    expect(fallow.captured[0]).toContain('json');
    expect(result.report).toContain('4 changed files');
    expect(result.report).toContain('main');
  });

  // A pass over nothing is not a pass. On `main` straight after a merge there
  // is no diff against the base branch, and a green tick there teaches people
  // the gate means something it does not.
  it('reports that it checked nothing when no file changed against the base', async () => {
    const fallow = fakeFallow(verdict({ changed_files_count: 0 }));

    const result = await runChangedFilesAudit(fallow.runner);

    expect(result.outcome).toBe('nothing-to-check');
    expect(result.report).toMatch(/checked nothing/i);
    expect(result.report).toContain('--since');
    // Nothing to audit means nothing to print a report about.
    expect(fallow.streamed).toHaveLength(0);
  });

  it('fails and streams the human report when the verdict is a fail', async () => {
    const fallow = fakeFallow(verdict({ verdict: 'fail' }));

    const result = await runChangedFilesAudit(fallow.runner);

    expect(result.outcome).toBe('fail');
    expect(fallow.streamed).toHaveLength(1);
    expect(fallow.streamed[0]).not.toContain('--format');
  });

  // fallow itself exits 0 on `warn`. Blocking on one here would make the gate
  // stricter than the tool it delegates to, which is how a gate becomes noise.
  it('shows a warn verdict without failing on it', async () => {
    const fallow = fakeFallow(verdict({ verdict: 'warn' }));

    const result = await runChangedFilesAudit(fallow.runner);

    expect(result.outcome).toBe('pass');
    expect(result.report).toContain('warn');
    expect(fallow.streamed).toHaveLength(1);
  });

  it('widens the scope to an explicit ref when one is given', async () => {
    const fallow = fakeFallow(verdict());

    await runChangedFilesAudit(fallow.runner, 'origin/main');

    expect(fallow.captured[0]).toEqual(expect.arrayContaining(['--changed-since', 'origin/main']));
  });

  it('fails with an actionable message when fallow returned no readable verdict', async () => {
    const result = await runChangedFilesAudit({
      capture: async () => ({ code: 127, stdout: 'command not found' }),
      stream: async () => 127,
    });

    expect(result.outcome).toBe('fail');
    expect(result.report).toContain('fallow audit');
    expect(result.report).toContain('127');
  });
});

/**
 * #232: the two questions the duplication baseline answers, and the order.
 *
 * Content first, because content that does not match is a finding about the
 * code. Addresses second, because addresses that moved are not a finding at
 * all -- that is the stale-key case that used to arrive as somebody else's
 * clone groups blocking your commit.
 */
describe('runDupesBaselineCheck and rekeyDupesBaseline', () => {
  async function withDir(fn: (dir: string) => Promise<void>) {
    const dir = tempTree('bs-dupes-');
    await fn(dir);
  }

  const FRAGMENT = 'const seated = () => 1;\nconst other = () => 2;';

  /** A scanner standing in for `fallow dupes`, reporting one group at `at`. */
  const scanner = (at: readonly number[], fragment = FRAGMENT) =>
    async (baselinePath: string) => {
      const instances = at.map((start, index) => ({
        file: `src/probe-${index}.ts`,
        start_line: start,
        end_line: start + 1,
        fragment,
      }));
      writeFileSync(
        baselinePath,
        JSON.stringify({
          clone_groups: [
            instances.map((i) => `${i.file}:${i.start_line}-${i.end_line}`).sort().join('|'),
          ],
        }),
      );
      return {
        code: 0,
        stdout: JSON.stringify({ clone_groups: [{ instances, line_count: 2 }] }),
      };
    };

  it('records the tree when there is no accepted file yet, and then passes', async () => {
    await withDir(async (dir) => {
      const written = await rekeyDupesBaseline(dir, scanner([10, 40]));
      expect(written.code).toBe(0);
      expect(written.report).toContain('Recorded 1 clone group');
      expect((await runDupesBaselineCheck(dir, scanner([10, 40]))).code).toBe(0);
    });
  });

  it('names moved addresses as a re-key, not as duplication', async () => {
    await withDir(async (dir) => {
      await rekeyDupesBaseline(dir, scanner([10, 40]));
      // The same clone, 25 lines further down both files: #230's own shape.
      const result = await runDupesBaselineCheck(dir, scanner([35, 65]));
      expect(result.code).not.toBe(0);
      expect(result.report).toContain('The duplication itself is unchanged');
      expect(result.report).toContain('--rekey-dupes');
      // And re-keying it is allowed, because the content matched.
      const rekeyed = await rekeyDupesBaseline(dir, scanner([35, 65]));
      expect(rekeyed.code).toBe(0);
      expect(rekeyed.report).toContain('no debt was forgiven');
      expect((await runDupesBaselineCheck(dir, scanner([35, 65]))).code).toBe(0);
    });
  });

  it('fails on duplication nothing accepted, and refuses to re-key it away', async () => {
    await withDir(async (dir) => {
      await rekeyDupesBaseline(dir, scanner([10, 40]));
      const changed = scanner([10, 40], `${FRAGMENT}\nconst third = () => 3;`);
      const result = await runDupesBaselineCheck(dir, changed);
      expect(result.code).not.toBe(0);
      expect(result.report).toContain('DUPLICATION NOTHING HAS ACCEPTED');

      const refused = await rekeyDupesBaseline(dir, changed);
      expect(refused.code).not.toBe(0);
      expect(refused.report).toContain('Nothing was written');
      // Still refusing after the attempt: nothing was quietly accepted.
      expect((await runDupesBaselineCheck(dir, changed)).code).not.toBe(0);
    });
  });

  it('skips a project that keeps no accepted record at all', async () => {
    await withDir(async (dir) => {
      const result = await runDupesBaselineCheck(dir, scanner([10, 40]));
      expect(result.code).toBe(0);
      expect(result.report).toContain('nothing to drift');
    });
  });

  it('says so when fallow reported nothing readable', async () => {
    await withDir(async (dir) => {
      await rekeyDupesBaseline(dir, scanner([10, 40]));
      const result = await runDupesBaselineCheck(dir, async () => ({ code: 2, stdout: 'not json' }));
      expect(result.code).not.toBe(0);
      expect(result.report).toContain('cannot be ruled out');
    });
  });
});
