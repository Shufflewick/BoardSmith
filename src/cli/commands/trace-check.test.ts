import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanTestCitations, resolveClaimCitation, traceCheckCommand } from './trace-check.js';

/**
 * `trace-check.ts` is CHECK-03: the source-free traceability sweep. This file covers, in task
 * order: the citation scanner + three-rung resolution ladder (Task 1), the sweep/findings/
 * read-only invariant (Task 2), and the `--json`/human-report contract (Task 3).
 */

describe('scanTestCitations', () => {
  it('parses a bare single claim: "claim 12"', () => {
    const result = scanTestCitations('// see claim 12 for details');
    expect(result.claims).toEqual([12]);
    expect(result.rulings).toEqual([]);
  });

  it('parses a comma-joined 4-wide claim list: "claims 3, 4, 5, 29"', () => {
    const result = scanTestCitations('// claims 3, 4, 5, 29 all apply here');
    expect(result.claims).toEqual([3, 4, 5, 29]);
  });

  it('parses a slash-joined claim pair: "claim 4/14"', () => {
    const result = scanTestCitations('// claim 4/14 — corrected');
    expect(result.claims).toEqual([4, 14]);
  });

  it('parses a capitalised "Claim 7"', () => {
    const result = scanTestCitations('// Claim 7 is basic');
    expect(result.claims).toEqual([7]);
  });

  it('treats "CHUNK.md claim 12" identically to a bare "claim 12" — the prefix names no slug', () => {
    const result = scanTestCitations('// CHUNK.md claim 12');
    expect(result.claims).toEqual([12]);
  });

  it('splits "claim 28 / Ruling 9/15" into claims [28] and rulings [9,15], never swallowing the ruling numbers as claims', () => {
    const result = scanTestCitations('// claim 28 / Ruling 9/15');
    expect(result.claims).toEqual([28]);
    expect(result.rulings).toEqual([9, 15]);
  });

  it('parses a bare single ruling: "Ruling 23"', () => {
    const result = scanTestCitations('// Ruling 23 applies');
    expect(result.rulings).toEqual([23]);
  });

  it('parses a slash-joined ruling pair: "rulings 21/22"', () => {
    const result = scanTestCitations('// rulings 21/22 both apply');
    expect(result.rulings).toEqual([21, 22]);
  });

  it('importsRules is true for a relative import from a src/rules/ path', () => {
    const result = scanTestCitations(`import { resolveJab } from '../../src/rules/jab.js';\n`);
    expect(result.importsRules).toBe(true);
  });

  it('importsRules is false for a file importing only engine/testing packages', () => {
    const result = scanTestCitations(
      `import { TestGame } from 'boardsmith/testing';\nimport { describe, it } from 'vitest';\n`,
    );
    expect(result.importsRules).toBe(false);
  });

  it('de-duplicates repeated citations of the same number', () => {
    const result = scanTestCitations('// claim 12 ... later, claim 12 again');
    expect(result.claims).toEqual([12]);
  });
});

describe('resolveClaimCitation — the three-rung ladder', () => {
  it('rung 1 alone: exactly one owner resolves to it', () => {
    const result = resolveClaimCitation(5, ['jab'], { jab: [5, 6, 7] }, { jab: true });
    expect(result).toEqual({ status: 'resolved', chunk: 'jab' });
  });

  it('rung 2 deciding: 3 owners, only one has claim N live', () => {
    const owners = ['jab', 'block', 'rest'];
    const liveClaims = { jab: [1, 2], block: [5], rest: [9, 10] };
    const authoring = { jab: false, block: false, rest: false };
    const result = resolveClaimCitation(5, owners, liveClaims, authoring);
    expect(result).toEqual({ status: 'resolved', chunk: 'block' });
  });

  it('rung 3 deciding: 2 owners both have claim N live, one authoring (NEW/written), one editing', () => {
    const owners = ['punch', 'discard'];
    const liveClaims = { punch: [5], discard: [5] };
    const authoring = { punch: true, discard: false };
    const result = resolveClaimCitation(5, owners, liveClaims, authoring);
    expect(result).toEqual({ status: 'resolved', chunk: 'punch' });
  });

  it('ambiguous: 2 owners both live and both authoring — reports both survivors, names them', () => {
    const owners = ['a', 'b'];
    const liveClaims = { a: [5], b: [5] };
    const authoring = { a: true, b: true };
    const result = resolveClaimCitation(5, owners, liveClaims, authoring);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.sort()).toEqual(['a', 'b']);
    }
  });

  it('zero owners -> unresolved, reason no-owner', () => {
    const result = resolveClaimCitation(5, [], {}, {});
    expect(result).toEqual({ status: 'unresolved', reason: 'no-owner' });
  });

  it('all owners discarded at rung 2 (stale citation: every owning chunk stops below N) -> unresolved, no-live-claim', () => {
    const owners = ['jab', 'block'];
    const liveClaims = { jab: [1, 2, 3], block: [1, 2, 3, 4, 5] };
    const authoring = { jab: false, block: false };
    const result = resolveClaimCitation(40, owners, liveClaims, authoring);
    expect(result).toEqual({ status: 'unresolved', reason: 'no-live-claim' });
  });

  it('rung 3 empties a non-empty rung-2 set (no candidate is authoring) -> the rung-2 survivors REMAIN, ambiguous, never silently dropped', () => {
    const owners = ['a', 'b'];
    const liveClaims = { a: [5], b: [5] };
    // Neither candidate is marked authoring for this file — both are "edited".
    const authoring = { a: false, b: false };
    const result = resolveClaimCitation(5, owners, liveClaims, authoring);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      expect(result.candidates.sort()).toEqual(['a', 'b']);
    }
  });
});

// -------------------------------------------------------------------------------------------
// traceCheckCommand — sweep, findings, and the read-only invariant (Task 2)
// -------------------------------------------------------------------------------------------

/**
 * Minimal-but-real fixture builder, mirroring `chunk-provenance.test.ts:395`'s `makeChunk`
 * convention but writing the exact section shapes `trace-check.ts` reads, rather than the full
 * CHUNK.template.md (this plan's fixtures don't need `## Verified Against`/provenance blocks).
 */
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-trace-check-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function makeProject(): Promise<string> {
  const project = join(dir, 'game');
  await fs.mkdir(join(project, 'chunks'), { recursive: true });
  return project;
}

interface ManifestRow {
  files: string;
  status: string;
}

async function makeChunk(
  project: string,
  slug: string,
  opts: { claims?: number[]; manifestRows?: ManifestRow[]; manifestProse?: string } = {},
): Promise<void> {
  const chunkDir = join(project, 'chunks', slug);
  await fs.mkdir(chunkDir, { recursive: true });

  const interpretation = (opts.claims ?? [])
    .map((n) => `${n}. **Claim ${n}** — cites rulebook/foo.md`)
    .join('\n\n');

  const manifestBody =
    opts.manifestProse ??
    ['| File | Status |', '|---|---|', ...(opts.manifestRows ?? []).map((r) => `| ${r.files} | ${r.status} |`)].join(
      '\n',
    );

  const text = [
    `# Chunk: ${slug}`,
    '',
    'Status: verified',
    '',
    '## Interpretation',
    '',
    interpretation,
    '',
    '## Build Manifest',
    '',
    manifestBody,
    '',
  ].join('\n');

  await fs.writeFile(join(chunkDir, 'CHUNK.md'), text);
}

async function writeTestFile(project: string, relPath: string, content: string): Promise<void> {
  const full = join(project, relPath);
  await fs.mkdir(dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

async function writeRulings(project: string, body: string): Promise<void> {
  await fs.writeFile(join(project, 'RULINGS.md'), body);
}

/** Whole-project content hash: every file's relative path + bytes, in sorted order. */
async function hashProject(root: string): Promise<string> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  }
  await walk(root);
  files.sort();
  const hash = createHash('sha256');
  for (const f of files) {
    hash.update(f.slice(root.length));
    hash.update(await fs.readFile(f));
  }
  return hash.digest('hex');
}

describe('traceCheckCommand', () => {
  it('a test file in no chunk manifest is unassociated-test, and its claim refs are recorded unresolved, never dropped', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', { claims: [1, 2], manifestRows: [{ files: 'tests/other.test.ts', status: 'NEW' }] });
    await writeTestFile(project, 'tests/orphan.test.ts', '// claim 5\n');

    const result = await traceCheckCommand({ project });

    const unassociated = result.findings.filter((f) => f.kind === 'unassociated-test');
    expect(unassociated.map((f) => f.subject)).toContain('tests/orphan.test.ts');

    const unresolved = result.findings.filter((f) => f.kind === 'unresolved-claim-ref');
    expect(unresolved.some((f) => f.subject === 'claim 5' && f.detail.includes('orphan.test.ts'))).toBe(true);
  });

  it('a citation to a claim number no owning chunk still lists is a stale unresolved-claim-ref, not ambiguous', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', { claims: [1, 2, 3], manifestRows: [{ files: 'tests/jab.test.ts', status: 'NEW' }] });
    await writeTestFile(project, 'tests/jab.test.ts', '// claim 40\n');

    const result = await traceCheckCommand({ project });

    const unresolved = result.findings.filter((f) => f.kind === 'unresolved-claim-ref');
    expect(unresolved.some((f) => f.subject === 'claim 40')).toBe(true);
    expect(result.findings.some((f) => f.kind === 'ambiguous-claim-ref')).toBe(false);
  });

  it('rung 2 discriminates: a test owned by two chunks resolves cleanly to the one with a live claim, no ambiguity', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', { claims: [1, 2], manifestRows: [{ files: 'tests/shared.test.ts', status: 'edited' }] });
    await makeChunk(project, 'block', { claims: [9], manifestRows: [{ files: 'tests/shared.test.ts', status: 'edited' }] });
    await writeTestFile(project, 'tests/shared.test.ts', '// claim 9\n');

    const result = await traceCheckCommand({ project });

    expect(result.findings.some((f) => f.kind === 'ambiguous-claim-ref')).toBe(false);
    expect(result.findings.some((f) => f.kind === 'claim-untested' && f.chunk === 'block')).toBe(false);
  });

  it('two owners both live and both authoring for the same claim -> ambiguous-claim-ref naming both, counting as coverage for neither', async () => {
    const project = await makeProject();
    await makeChunk(project, 'a', { claims: [5], manifestRows: [{ files: 'tests/shared.test.ts', status: 'NEW' }] });
    await makeChunk(project, 'b', { claims: [5], manifestRows: [{ files: 'tests/shared.test.ts', status: 'NEW' }] });
    await writeTestFile(project, 'tests/shared.test.ts', '// claim 5\n');

    const result = await traceCheckCommand({ project });

    const ambiguous = result.findings.filter((f) => f.kind === 'ambiguous-claim-ref');
    expect(ambiguous.length).toBe(1);
    expect(ambiguous[0].detail).toContain('a');
    expect(ambiguous[0].detail).toContain('b');
    // Ambiguous coverage counts for NEITHER — both chunks still report claim-untested for claim 5.
    expect(result.findings.some((f) => f.kind === 'claim-untested' && f.chunk === 'a' && f.subject === 'claim 5')).toBe(
      true,
    );
    expect(result.findings.some((f) => f.kind === 'claim-untested' && f.chunk === 'b' && f.subject === 'claim 5')).toBe(
      true,
    );
  });

  it('a live claim with no resolved citing test is claim-untested', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', { claims: [1, 2, 3], manifestRows: [{ files: 'tests/jab.test.ts', status: 'NEW' }] });
    await writeTestFile(project, 'tests/jab.test.ts', '// claim 1\n');

    const result = await traceCheckCommand({ project });

    const untested = result.findings.filter((f) => f.kind === 'claim-untested' && f.chunk === 'jab');
    expect(untested.map((f) => f.subject).sort()).toEqual(['claim 2', 'claim 3']);
  });

  it('a ruling with no citing test is ruling-untested; a superseded ruling is not demanded one', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', { claims: [] });
    await writeRulings(
      project,
      [
        '### Ruling 1',
        '',
        'Decision: jabs block.',
        '',
        '### Ruling 2',
        '',
        'Decision: superseded by Ruling 3. superseded by Ruling 3.',
        '',
        '### Ruling 3',
        '',
        'Decision: replaces Ruling 2.',
        '',
      ].join('\n'),
    );
    await writeTestFile(project, 'tests/jab.test.ts', '// Ruling 3\n');

    const result = await traceCheckCommand({ project });

    const untested = result.findings.filter((f) => f.kind === 'ruling-untested');
    // Ruling 1 has no citation and is not superseded -> untested.
    expect(untested.some((f) => f.subject === 'Ruling 1')).toBe(true);
    // Ruling 2 is superseded (by Ruling 3) -> must NOT be demanded a test.
    expect(untested.some((f) => f.subject === 'Ruling 2')).toBe(false);
    // Ruling 3 is cited -> not untested.
    expect(untested.some((f) => f.subject === 'Ruling 3')).toBe(false);
  });

  it('no RULINGS.md -> zero ruling findings, no crash; the claim half still reports', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', { claims: [1], manifestRows: [{ files: 'tests/jab.test.ts', status: 'NEW' }] });
    await writeTestFile(project, 'tests/jab.test.ts', '// nothing cited\n');

    const result = await traceCheckCommand({ project });

    expect(result.findings.some((f) => f.kind === 'ruling-untested')).toBe(false);
    expect(result.totals.rulings).toBe(0);
    expect(result.findings.some((f) => f.kind === 'claim-untested')).toBe(true);
  });

  it('test-unlinked fires only for a manifest-listed test that imports src/rules/ and cites nothing', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', {
      claims: [],
      manifestRows: [
        { files: 'tests/jab.test.ts', status: 'NEW' },
        { files: 'tests/a11y.test.ts', status: 'NEW' },
      ],
    });
    await writeTestFile(
      project,
      'tests/jab.test.ts',
      `import { resolveJab } from '../src/rules/jab.js';\n// no citation here\n`,
    );
    // a11y-shaped test: imports nothing from rules, cites nothing -> must NOT fire.
    await writeTestFile(project, 'tests/a11y.test.ts', `import { render } from 'boardsmith/testing';\n`);

    const result = await traceCheckCommand({ project });

    const unlinked = result.findings.filter((f) => f.kind === 'test-unlinked');
    expect(unlinked.map((f) => f.subject)).toEqual(['tests/jab.test.ts']);
  });

  it('manifest-file-missing: a table row yielding zero path tokens', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', {
      claims: [],
      manifestRows: [{ files: '(no file named here)', status: 'NEW' }],
    });

    const result = await traceCheckCommand({ project });

    const missing = result.findings.filter((f) => f.kind === 'manifest-file-missing' && f.chunk === 'jab');
    expect(missing.some((f) => f.detail.includes('no path token'))).toBe(true);
  });

  it('manifest-file-missing: a whole-chunk manifest that is not table-shaped', async () => {
    const project = await makeProject();
    await makeChunk(project, 'ai-opponent', {
      claims: [],
      manifestProse: '- **src/rules/ai.ts** (new) — the AI opponent logic',
    });

    const result = await traceCheckCommand({ project });

    const missing = result.findings.filter((f) => f.kind === 'manifest-file-missing' && f.chunk === 'ai-opponent');
    expect(missing.some((f) => f.detail.includes('not table-shaped'))).toBe(true);
  });

  it('a manifest-listed test path that escapes the project root is reported, never read', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', {
      claims: [],
      manifestRows: [{ files: '../../../etc/evil.test.ts', status: 'NEW' }],
    });

    const result = await traceCheckCommand({ project });

    const missing = result.findings.filter((f) => f.kind === 'manifest-file-missing' && f.chunk === 'jab');
    expect(missing.some((f) => f.detail.includes('escapes'))).toBe(true);
  });

  it('READ-ONLY: a whole-project byte-hash taken before and after a run is identical', async () => {
    const project = await makeProject();
    await makeChunk(project, 'jab', { claims: [1, 2], manifestRows: [{ files: 'tests/jab.test.ts', status: 'NEW' }] });
    await writeTestFile(project, 'tests/jab.test.ts', '// claim 1\n');
    await writeRulings(project, '### Ruling 1\n\nDecision: jabs block.\n');

    const before = await hashProject(project);
    await traceCheckCommand({ project });
    const after = await hashProject(project);

    expect(after).toBe(before);
  });

  it('throws a one-line actionable error when there is no chunks/ directory', async () => {
    const project = join(dir, 'not-a-bs-project');
    await fs.mkdir(project, { recursive: true });

    await expect(traceCheckCommand({ project })).rejects.toThrow(/No chunks\/ directory/);
  });
});
