/**
 * Section-presence + citation-existence guard for docs/seed-to-state.md
 * (FEAT-01, the Phase 168 seed-to-state feasibility spike doc).
 *
 * This doc is plain markdown, not parsed by any runtime code. This test
 * exists to catch drift: if a future edit removes a required section, or
 * the doc's `src/...` citations rot as the codebase changes underneath it,
 * these assertions fail loudly instead of the doc silently going stale.
 *
 * Modeled on the repo's existing md-presence precedent:
 * src/cli/slash-command/bs/templates.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DOC_PATH = join(__dirname, 'seed-to-state.md');
const doc = readFileSync(DOC_PATH, 'utf-8');

const REQUIRED_SECTIONS = [
  '## Problem',
  '## Mechanism',
  '## Load path',
  '## Authoring surface',
  '## Pipeline request API',
  '## Dev-host wiring',
  '## Cost / shape recommendation',
  '## Proven vs deferred',
] as const;

const LOAD_PATH_ANCHORS = ['GameRunner.fromSnapshot', 'handleStart', 'TestGame.getSnapshot'] as const;

describe('FEAT-01: docs/seed-to-state.md section presence', () => {
  for (const heading of REQUIRED_SECTIONS) {
    it(`contains the "${heading}" section heading`, () => {
      expect(doc).toContain(heading);
    });
  }
});

describe('FEAT-01: docs/seed-to-state.md load-path anchors', () => {
  for (const anchor of LOAD_PATH_ANCHORS) {
    it(`mentions ${anchor}`, () => {
      expect(doc).toContain(anchor);
    });
  }
});

describe('FEAT-01: docs/seed-to-state.md citation existence', () => {
  // Extract path-shaped `src/...\.ts` tokens out of the markdown prose. Strips
  // any trailing markdown/punctuation (backticks, commas, closing parens,
  // periods) that would otherwise get swept into the captured path.
  const pathPattern = /src\/[A-Za-z0-9_\-./]+\.ts/g;
  const rawMatches = doc.match(pathPattern) ?? [];
  const citedPaths = Array.from(new Set(rawMatches.map((p) => p.replace(/[).,:;'"`]+$/, ''))));

  it('finds at least one src/*.ts citation in the doc', () => {
    expect(citedPaths.length).toBeGreaterThan(0);
  });

  for (const citedPath of citedPaths) {
    it(`cited file exists on disk: ${citedPath}`, () => {
      const absolute = join(REPO_ROOT, citedPath);
      expect(existsSync(absolute)).toBe(true);
    });
  }
});
