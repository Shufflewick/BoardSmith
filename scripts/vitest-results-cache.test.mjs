/**
 * vitest starts the test files that took longest last time first (#1333).
 *
 * It reads each file's last duration from its results cache. vitest 2.1.9
 * never read that cache, so it fell back to file size, and the small files
 * #1319 split out of the slowest ones started last and bounded the run.
 * This runs a fixture project twice and checks the second run starts the
 * small slow file before the large fast one.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempTree } from '../src/testing/temp-tree.test-helper.ts';

const VITEST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/vitest/vitest.mjs');

/** The fixture's test files, in the order the run started them. */
function startOrder(root) {
  const report = path.join(root, 'report.json');
  const run = spawnSync(
    process.execPath,
    [VITEST, 'run', '--root', root, '--globals', '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`],
    { encoding: 'utf8' },
  );
  expect(run.status, run.stderr).toBe(0);
  const { testResults } = JSON.parse(readFileSync(report, 'utf8'));
  return testResults.sort((a, b) => a.startTime - b.startTime).map((file) => path.basename(file.name));
}

describe('vitest results cache', () => {
  it('starts the file that took longest last time first', () => {
    const root = tempTree('bs-vitest-cache-');
    writeFileSync(path.join(root, 'large.test.js'), `${'// padding\n'.repeat(2000)}test('fast', () => {});\n`);
    writeFileSync(path.join(root, 'slow.test.js'), `test('slow', () => new Promise((done) => setTimeout(done, 500)));\n`);

    expect(startOrder(root)).toEqual(['large.test.js', 'slow.test.js']);
    expect(startOrder(root)).toEqual(['slow.test.js', 'large.test.js']);
  });
});
