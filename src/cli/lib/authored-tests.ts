import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { JsonTestResults } from 'vitest/reporters';
import { withCommandBuildDir } from './command-build-dir.js';
import { discardRecord, runVitestRecorded, testRunVerdict } from './vitest-run.js';
import { gitOutput as git, gitSucceeds } from './git-output.js';
import { existingConfigs } from './test-run-scope.js';

export interface AuthoredTest {
  file: string;
  names: string[];
}

export interface AuthoredSelection {
  ticket: string;
  base: string;
  tests: AuthoredTest[];
}

export interface FocusedVerificationScope {
  kind: 'focused';
  selection: AuthoredSelection & { path: string; hash: string };
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const plainPath = (value: unknown): value is string =>
  typeof value === 'string' && value !== '' && !isAbsolute(value) && !value.includes('\\') &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
const escapePattern = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function readSelection(projectDir: string, selectionPath: string): Promise<AuthoredSelection> {
  const fail = (message: string): never => { throw new Error(`${selectionPath}: ${message}`); };
  if (!plainPath(selectionPath)) return fail('use a plain relative path inside the project.');
  let raw: unknown;
  try { raw = JSON.parse(await fs.readFile(resolve(projectDir, selectionPath), 'utf8')); }
  catch { return fail('could not read a JSON authored-test selection. Check the path and its JSON.'); }
  if (!object(raw) || typeof raw.ticket !== 'string' || !/^[\w.-]+\/[\w.-]+#[1-9]\d*$/.test(raw.ticket) ||
    typeof raw.base !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(raw.base) || !Array.isArray(raw.tests) || raw.tests.length === 0) {
    return fail('declare a ticket, its full base commit and a non-empty tests list.');
  }
  const unknown = Object.keys(raw).find((key) => !['ticket', 'base', 'tests'].includes(key));
  if (unknown !== undefined) return fail(`unknown key "${unknown}". Use only ticket, base and tests.`);
  const files = new Set<string>();
  const tests: AuthoredTest[] = [];
  for (const entry of raw.tests) {
    if (!object(entry) || !plainPath(entry.file) || !Array.isArray(entry.names) || entry.names.length === 0) {
      return fail('each test entry must declare a file inside the project and non-empty full test names.');
    }
    const unknown = Object.keys(entry).find((key) => !['file', 'names'].includes(key));
    if (unknown !== undefined) return fail(`unknown key "${unknown}" in ${entry.file}. Use only file and names.`);
    if (files.has(entry.file)) return fail(`${entry.file} is listed more than once.`);
    files.add(entry.file);
    const names = entry.names.map((name: unknown) => {
      if (typeof name !== 'string' || name.trim() === '') return fail(`${entry.file} contains an empty or invalid full test name.`);
      return name;
    });
    if (new Set(names).size !== names.length) return fail(`${entry.file} repeats a full test name.`);
    const file = resolve(projectDir, entry.file);
    const actual = await fs.lstat(file).catch(() => undefined);
    if (!actual?.isFile()) return fail(`${entry.file} must be an existing regular test file.`);
    const real = relative(await fs.realpath(projectDir), await fs.realpath(file));
    if (real.startsWith('..') || isAbsolute(real)) return fail(`${entry.file} resolves outside the project.`);
    tests.push({ file: entry.file, names });
  }
  return { ticket: raw.ticket, base: raw.base, tests };
}

/** The committed opt-in, absent only when this project has not configured focused verification. */
export async function focusedSelectionPath(projectDir: string, revision = 'HEAD'): Promise<string | undefined> {
  const fail = (message: string): never => { throw new Error(`.agent-policy.json: ${message}`); };
  if ((await git(projectDir, ['ls-tree', revision, '--', '.agent-policy.json'])).trim() === '') return undefined;
  let policy: unknown;
  try { policy = JSON.parse(await git(projectDir, ['show', `${revision}:./.agent-policy.json`])); }
  catch { return fail('the committed policy must contain valid JSON.'); }
  if (!object(policy)) return fail('the committed policy must be an object.');
  if (!Object.hasOwn(policy, 'focused')) return undefined;
  const focused = policy.focused;
  if (!object(focused) || !plainPath(focused.selection) || focused.fullEvery !== 5 ||
    Object.keys(focused).some((key) => !['selection', 'fullEvery', 'verify'].includes(key)) ||
    !Array.isArray(focused.verify) || focused.verify.length === 0 || focused.verify.some((check) =>
      !object(check) || typeof check.name !== 'string' || check.name.trim() === '' || typeof check.run !== 'string' || check.run.trim() === '')) {
    return fail('focused must declare a plain selection path, fullEvery: 5 and non-empty named verification commands.');
  }
  return focused.selection;
}

/** A focused receipt is bound to the committed opt-in and the exact committed authored selection. */
export async function focusedVerificationScope(projectDir: string, selectionPath: string, revision = 'HEAD'): Promise<FocusedVerificationScope> {
  const selection = await readSelection(projectDir, selectionPath);
  const fail = (message: string): never => { throw new Error(`${selectionPath}: ${message}`); };
  if (await focusedSelectionPath(projectDir, revision) !== selectionPath) {
    return fail('the committed policy must explicitly opt into focused verification with this selection.');
  }
  let committed: string;
  try { committed = await git(projectDir, ['show', `${revision}:./${selectionPath}`]); }
  catch { return fail('commit the authored-test selection before running focused verification.'); }
  if (committed !== await fs.readFile(resolve(projectDir, selectionPath), 'utf8')) {
    return fail('the selection differs from its committed contents. Commit it before verification.');
  }
  if (!await gitSucceeds(projectDir, ['merge-base', '--is-ancestor', selection.base, revision])) {
    return fail('base must name a commit in this change\'s history.');
  }
  for (const test of selection.tests) {
    const mode = (await git(projectDir, ['ls-tree', revision, '--', test.file])).trim().split(/\s+/)[0];
    if (mode !== '100644' && mode !== '100755') return fail(`${test.file} must be a committed regular file.`);
    if ((await git(projectDir, ['diff', '--name-only', selection.base, revision, '--', test.file])).trim() === '') {
      return fail(`${test.file} has no authored change since the declared base.`);
    }
  }
  return {
    kind: 'focused',
    selection: { path: selectionPath, hash: createHash('sha256').update(committed).digest('hex'), ...selection },
  };
}

/** Runs exact authored cases and accepts only the cases Vitest actually reports as passed. */
export async function runAuthoredTests(projectDir: string, selectionPath: string): Promise<{
  selection: AuthoredSelection;
  counts: { files: number; tests: number; passed: number };
}> {
  const selection = await readSelection(projectDir, selectionPath);
  return withCommandBuildDir(projectDir, 'verify', async (workDir) => {
    const [projectConfig] = await existingConfigs(projectDir);
    let passed = 0;
    for (const [index, selected] of selection.tests.entries()) {
      const reportPath = join(workDir, `authored-${index}.json`);
      const configPath = join(workDir, `authored-${index}.config.mjs`);
      const include = resolve(projectDir, selected.file).replace(/([*?\[\]{}()!+@])/g, '\\$1');
      const importBase = projectConfig === undefined ? 'const base = {};' : `import base from ${JSON.stringify(resolve(projectDir, projectConfig))};`;
      await fs.writeFile(configPath, `${importBase}
export default async (env) => {
  const config = await (typeof base === 'function' ? base(env) : base);
  if (config.test?.workspace || config.test?.projects) throw new Error('Authored selection requires one project test config; workspace projects cannot guarantee an exact file selection.');
  return { ...config, test: { ...config.test, include: [${JSON.stringify(include)}], includeSource: [] } };
};
`);
      const pattern = `^(?:${selected.names.map(escapePattern).join('|')})$`;
      const run = await runVitestRecorded([
        '--config', configPath,
        '--reporter=json', `--outputFile.json=${reportPath}`,
        '--testNamePattern', pattern,
      ], projectDir);
      const verdict = testRunVerdict(run, run.progress, { cwd: projectDir, logPath: run.logPath });
      if (verdict !== undefined) throw new Error(verdict);
      const report: JsonTestResults = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      const expectedPath = await fs.realpath(resolve(projectDir, selected.file));
      const missing = new Set(selected.names);
      for (const file of report.testResults) {
        const sameFile = await fs.realpath(file.name) === expectedPath;
        for (const test of file.assertionResults) {
          if (test.status === 'skipped' || test.status === 'pending' || test.status === 'todo' || test.status === 'disabled') continue;
          if (!sameFile || test.status !== 'passed' || !missing.delete(test.fullName)) {
            throw new Error(`Authored selection ran an undeclared, repeated or unsuccessful test: ${file.name}: ${test.fullName}. Check ${selectionPath}. Log: ${run.logPath}`);
          }
          passed++;
        }
      }
      if (missing.size > 0) throw new Error(`${selected.file}: declared tests did not pass: ${[...missing].join(', ')}. Check their full names in ${selectionPath}. Log: ${run.logPath}`);
      discardRecord(run);
    }
    return { selection, counts: { files: selection.tests.length, tests: passed, passed } };
  });
}
