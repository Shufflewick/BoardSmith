/**
 * A failed `typecheck` check in `boardsmith verify` prints the compiler's whole report (#532).
 * vue-tsc explains an error over several lines (where the expected type comes from, which member
 * is missing), and only the first of them says `error TS`; showing that line alone hides the part
 * that says what to fix.
 *
 * The real compiler runs while the file is collected, where no test timeout applies (#363).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { INSTALLED_MODULES } from '../../testing/installed-modules.test-helper.js';
import { writeFiles } from '../lib/verify-result.test-helper.js';
import { typeCheckProject, type TypeCheckRun } from './validate.js';
import { VERIFY_CHECKS } from './verify.js';

const project = join(tempTree('bs-verify-typecheck-output-'), 'game');
await fs.mkdir(project, { recursive: true });
await writeFiles(project, {
  'tsconfig.json': JSON.stringify({
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', noEmit: true, skipLibCheck: true },
    include: ['src'],
  }),
  'src/seats.ts': 'const given = { min: "two" };\nexport const range: { min: number } = given;\n',
});
await fs.symlink(INSTALLED_MODULES, join(project, 'node_modules'), 'dir');
const run = await typeCheckProject(project);

/** The `typecheck` check's printed lines, given `typeCheck` as the run's type check. */
async function typecheckPrints(typeCheck: TypeCheckRun): Promise<string[]> {
  const printed: string[] = [];
  const log = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => void printed.push(String(line)));
  try {
    await VERIFY_CHECKS.typecheck({ typeCheck: async () => typeCheck } as Parameters<typeof VERIFY_CHECKS.typecheck>[0]);
  } finally {
    log.mockRestore();
  }
  return printed;
}

describe("verify's typecheck check prints the compiler's whole report (#532)", () => {
  it('keeps every line of a diagnostic, and none of the file listing', () => {
    expect(run.result.passed).toBe(false);
    const report = run.compilerReport.join('\n');
    expect(report).toMatch(/seats\.ts\(2,\d+\): error TS2322/);
    expect(report).toMatch(/Types of property 'min' are incompatible/);
    expect(run.programFiles.length).toBeGreaterThan(0);
    for (const file of run.programFiles) expect(run.compilerReport).not.toContain(file);
  });

  it('prints that report when the check fails', async () => {
    expect(await typecheckPrints(run)).toEqual(run.compilerReport);
  });
});
