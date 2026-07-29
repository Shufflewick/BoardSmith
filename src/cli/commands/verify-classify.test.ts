import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  RULE_DELTA_KINDS,
  PRESENTATION_EXCLUSION_MARKERS,
  isPresentationLine,
  ruleBearingLines,
  deriveStale,
  type RuleDelta,
} from './verify-classify.js';

/**
 * `verify-classify.ts` is the mechanical core of VERIFY-03. Every fixture here is either a real
 * filesystem temp dir (`fs.mkdtemp`, no mocks) or the REAL archived pass-1-vs-pass-2 slices plan
 * 174-01 produced and committed under `174-FIXTURES/` — never invented slice bodies for the
 * presentation/pairing behavior this plan pins.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_ROOT = join(
  __dirname,
  '../../../.planning/phases/174-verify-classifier/174-FIXTURES',
);

async function readFixture(relPath: string): Promise<string> {
  return fs.readFile(join(FIXTURES_ROOT, relPath), 'utf-8');
}

async function listFixtureFiles(relDir: string): Promise<string[]> {
  const entries = await fs.readdir(join(FIXTURES_ROOT, relDir), { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== 'INDEX.md')
    .map((e) => e.name)
    .sort();
}

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-classify-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// -------------------------------------------------------------------------------------------
// presentation (Task 1)
// -------------------------------------------------------------------------------------------

describe('presentation — dual-schema exclusion filter, over REAL archived fixtures', () => {
  it('presentation-1: one-two-punch live rule slices — ruleBearingLines() equals total content lines minus citation headers minus legacy-qualified Derived lines', async () => {
    const files = ['01-setup-and-round-structure.md', '02-action-cards-and-resolution.md'];
    for (const file of files) {
      const text = await readFixture(`one-two-punch/live/${file}`);
      const rawLines = text.split('\n').map((l) => l.trim());
      const contentLines = rawLines.filter((l) => l.length > 0 && !l.startsWith('#'));
      const headerLines = contentLines.filter((l) => /^p\.\d+,.*:$/.test(l));
      const legacyLines = contentLines.filter(
        (l) =>
          /^Derived \(p\.\d+\) — diagram description:/i.test(l) ||
          /^Derived \(p\.\d+\) — art:/i.test(l),
      );
      const expectedCount = contentLines.length - headerLines.length - legacyLines.length;

      const result = ruleBearingLines(text);
      expect(result.length).toBe(expectedCount);
      // Neither citation headers nor legacy-qualified lines survive into the rule-bearing set.
      for (const excluded of [...headerLines, ...legacyLines]) {
        expect(result).not.toContain(excluded);
      }
    }
  });

  it('presentation-1b: the measured legacy-qualifier counts match 174-PROOF.md section 1 exactly (5 diagram description + 1 art, 12 total Derived, one-two-punch live)', async () => {
    const files = ['01-setup-and-round-structure.md', '02-action-cards-and-resolution.md'];
    let totalDerived = 0;
    let diagramCount = 0;
    let artCount = 0;
    let visualCount = 0;
    for (const file of files) {
      const text = await readFixture(`one-two-punch/live/${file}`);
      const lines = text.split('\n');
      totalDerived += lines.filter((l) => /^Derived \(p\.\d+\)/.test(l.trim())).length;
      diagramCount += lines.filter((l) =>
        /^Derived \(p\.\d+\) — diagram description/.test(l.trim()),
      ).length;
      artCount += lines.filter((l) => /^Derived \(p\.\d+\) — art/.test(l.trim())).length;
      visualCount += lines.filter((l) => /^Visual \(p\.\d+\):/.test(l.trim())).length;
    }
    expect(totalDerived).toBe(12);
    expect(diagramCount).toBe(5);
    expect(artCount).toBe(1);
    expect(visualCount).toBe(0);
  });

  it('presentation-2: seven staged units — Visual (p.N): lines are classified as presentation and excluded from ruleBearingLines()', async () => {
    const files = await listFixtureFiles('seven/staged');
    let sawAtLeastOneVisualLine = false;
    for (const file of files) {
      const text = await readFixture(`seven/staged/${file}`);
      const visualLines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => /^Visual \(p\.\d+\):/.test(l));
      if (visualLines.length > 0) sawAtLeastOneVisualLine = true;
      for (const line of visualLines) {
        expect(isPresentationLine(line)).toBe(true);
      }
      const result = ruleBearingLines(text);
      for (const line of visualLines) {
        expect(result).not.toContain(line);
      }
      expect(result.some((l) => l.startsWith('Visual (p.'))).toBe(false);
    }
    expect(sawAtLeastOneVisualLine).toBe(true);
  });

  it('presentation-3: a Derived line with no presentation qualifier is rule-bearing and IS returned', () => {
    const line = 'Derived (p.1): Rounds are simultaneous — every player acts before any reveal.';
    expect(isPresentationLine(line)).toBe(false);
    const result = ruleBearingLines(`# Heading\n\n${line}\n`);
    expect(result).toContain(line);
  });

  it('presentation-4 (pin): PRESENTATION_EXCLUSION_MARKERS is exactly the measured set, frozen', () => {
    expect(Object.isFrozen(PRESENTATION_EXCLUSION_MARKERS)).toBe(true);
    expect([...PRESENTATION_EXCLUSION_MARKERS]).toEqual([
      '^Visual \\(p\\.\\d+\\):',
      '^Derived \\(p\\.\\d+\\) — diagram description:',
      '^Derived \\(p\\.\\d+\\) — art:',
    ]);
  });
});

// -------------------------------------------------------------------------------------------
// staleness (Task 1)
// -------------------------------------------------------------------------------------------

describe('staleness — single-input derivation from the rule delta alone', () => {
  it('staleness-1: table-driven over RULE_DELTA_KINDS — cosmetic is not stale, every other code is stale', () => {
    const expected: Record<RuleDelta, boolean> = {
      cosmetic: false,
      sharper: true,
      contradictory: true,
      unclassified: true,
    };
    for (const code of RULE_DELTA_KINDS) {
      expect(deriveStale(code)).toBe(expected[code]);
    }
  });

  it('staleness-2 (SC-4 structural): deriveStale takes exactly one parameter, and provenance never appears in its source region', async () => {
    expect(deriveStale.length).toBe(1);
    const src = await fs.readFile(join(__dirname, 'verify-classify.ts'), 'utf-8');
    const start = src.indexOf('STALE_BY_RULE_DELTA');
    const pairIdx = src.indexOf('export function pairSlices');
    const end = pairIdx === -1 ? src.length : pairIdx;
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const region = src
      .slice(start, end)
      .split('\n')
      .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      .join('\n');
    expect(region).not.toMatch(/PROVENANCE_KINDS/);
    expect(region.replace(/^.*deriveStale\(ruleDelta: RuleDelta\).*$/m, '')).not.toMatch(
      /deriveStale\(.*provenance/i,
    );
  });
});
