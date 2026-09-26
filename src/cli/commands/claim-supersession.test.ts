import { describe, it, expect, beforeAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { claimsInForce, parseSupersededClaims } from './build-manifest.js';
import { checkClaimQuotes, unquotedClaims } from './claim-quotes.js';
import { checkTestStep } from './test-step-check.js';
import { traceCheckCommand } from './trace-check.js';
import { parseClaimCitationAnchors } from './verify-classify.js';
import { tempTree } from '../../testing/temp-tree.test-helper.js';

/**
 * WHICH CLAIMS ARE SUPERSEDED (#410). One function decides it (`parseSupersededClaims`, beside
 * the claim rule in build-manifest.ts), and every reader of `## Interpretation` asks it, so a
 * claim can never be retired for one gate and live for another. This feeds one CHUNK.md to every
 * reader and holds each to the same answer.
 *
 * The chunk covers each way the readers used to disagree:
 *   - claim 1 is superseded in full by claim 5;
 *   - claim 2 is only partly corrected by claim 6 ("closing sentence"), so it still stands
 *     (claim-quote-check used to retire it);
 *   - claim 3 carries redteam's in-place marker (claim-quote-check used to miss it);
 *   - claim 4 is named only inside an HTML comment, which is not part of the section
 *     (the claim counter used to retire it).
 * Each claim cites its own page, so the citation-anchor reader shows which claims it read.
 */
const INTERPRETATION = [
  '1. Ties go to combatant 2. (p.1)',
  '2. Armour subtracts from damage. It never reaches zero. (p.2)',
  '3. [superseded by claim 7 — do not review] Healing is free. (p.3)',
  '4. A partial heal restores half. <!-- an old draft: supersedes claim 4. --> (p.4)',
  '5. Supersedes claim 1 per redteam objection: ties go to combatant 1. (p.5)',
  "6. Supersedes claim 2's closing sentence: armour can reach zero. (p.6)",
  '7. Healing costs one food. (p.7)',
].join('\n');

const CHUNK = `# Chunk: combat

Status: built

## Interpretation

${INTERPRETATION}

## Spec Manifest

| Test File | Claims Covered | RED Observed |
|-----------|----------------|--------------|
| tests/combat.test.ts | 1 | yes |

## Build Manifest

| File | Status |
|------|--------|
| tests/combat.test.ts | new |
`;

const SUPERSEDED = [1, 3];
const IN_FORCE = [2, 4, 5, 6, 7];

let project: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: project, stdio: 'ignore' });
}

beforeAll(async () => {
  const tree = tempTree('bs-claim-supersession-');
  project = join(tree, 'game');
  await fs.mkdir(join(project, 'design', 'chunks', 'combat'), { recursive: true });
  await fs.mkdir(join(project, 'tests'), { recursive: true });
  await fs.writeFile(join(project, 'design', 'chunks', 'combat', 'CHUNK.md'), CHUNK);
  await fs.writeFile(join(project, 'tests', 'combat.test.ts'), "import { it } from 'vitest';\nit('claim 1', () => {});\n");
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'T');
  git('add', '-A');
  git('commit', '-q', '-m', 'chunk-combat/step-build');
});

describe('which claims are superseded: one answer for every reader (#410)', () => {
  it('the one rule retires a claim superseded in full or marked in place, and nothing else', () => {
    expect(parseSupersededClaims(CHUNK)).toEqual(SUPERSEDED);
    expect(claimsInForce(CHUNK)).toEqual(IN_FORCE);
  });

  it('claim-quote-check skips exactly the superseded claims', async () => {
    const result = await checkClaimQuotes(project, 'combat');
    expect(result.claims.filter((c) => c.superseded).map((c) => c.number)).toEqual(SUPERSEDED);
  });

  it('the gate transition records exactly the claims in force', () => {
    expect(Object.keys(unquotedClaims(CHUNK)).map(Number)).toEqual(IN_FORCE);
  });

  it('test-step-check demands a test for exactly the claims in force', async () => {
    const { findings } = await checkTestStep(project, 'combat');
    const uncovered = findings.filter((f) => f.kind === 'claim-uncovered').map((f) => f.subject);
    expect(uncovered).toEqual(IN_FORCE.map((n) => `claim ${n}`));
  });

  it('trace-check reports untested exactly the claims in force', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const result = await traceCheckCommand({ project });
      const untested = result.findings.filter((f) => f.kind === 'claim-untested').map((f) => f.subject);
      expect(untested).toEqual(IN_FORCE.map((n) => `claim ${n}`));
      expect(result.totals.claims).toBe(IN_FORCE.length);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('the citation anchors come from exactly the claims in force', () => {
    expect(parseClaimCitationAnchors(CHUNK, []).pages).toEqual(IN_FORCE);
  });
});
