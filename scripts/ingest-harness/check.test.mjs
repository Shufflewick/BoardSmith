/**
 * scripts/ingest-harness/check.test.mjs
 *
 * Deterministic self-test for the produced-artifact ingest checker (Phase 170).
 *
 * This pins two claims:
 *   1. checkIngestArtifacts() FAILS against the real, verbatim, non-conforming output the
 *      2026-07-27 proof run produced — the exact output that shipped green through every
 *      contract test (ingest.test.ts 69/69, full repo 3211/3211). See
 *      .planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN.md.
 *   2. checkIngestArtifacts() PASSES against a hand-built conforming project tree — proving
 *      the FAILs above are not vacuous (a checker that fails on everything is worthless).
 *
 * No mocks, no temp directories, no agent invocation, no subprocess. Fixtures are read
 * straight off disk as they are checked in.
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkIngestArtifacts, CHECK_IDS } from './check.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES_DIR = path.join(__dirname, '__fixtures__');
const NONCONFORMING_DIR = path.join(FIXTURES_DIR, 'nonconforming');
const CONFORMING_DIR = path.join(FIXTURES_DIR, 'conforming');

// The real seven/rules.pdf hash, verified 2026-07-27 and re-verified at the proof run
// (170-05-PLAN.md context block). Used only as the "expected" hash against the
// non-conforming fixture, which never archived a copy in the first place.
const SEVEN_SOURCE_HASH = '5138858e789452d6d366e3ba3a898b5d5417a3561ee23bd53123fd98fe337880';
const CONFORMING_SOURCE_HASH = '94b836814e8d4849fdff5f5e782a78a7c0a5b8f008808384096cb95359106a89';

function findCheck(result, id) {
  const check = result.checks.find((c) => c.id === id);
  if (!check) throw new Error(`no check with id "${id}" in result`);
  return check;
}

describe('ingest harness checker — non-conforming fixture (the real 2026-07-27 failed run)', () => {
  const result = checkIngestArtifacts({
    projectDir: NONCONFORMING_DIR,
    sourceFileName: 'rules.pdf',
    expectedSourceHash: SEVEN_SOURCE_HASH,
  });

  it('reports top-level pass: false', () => {
    expect(result.pass).toBe(false);
  });

  it('reports exactly 9 failing checks — a future loosening that quietly turns one green fails here', () => {
    const failing = result.checks.filter((c) => !c.pass);
    expect(failing.length).toBe(9);
    expect(result.checks.length).toBe(9);
  });

  it.each([
    'archive-exists',
    'archive-hash',
    'hash-recorded',
    'header-block',
    'gaps-heading',
    'tables-intact',
    'visual-lines',
    'derived-purity',
  ])('fails "%s"', (id) => {
    expect(findCheck(result, id).pass).toBe(false);
  });

  it('fails "gaps-reconciliation" — the section-side and slice-side counts disagree', () => {
    expect(findCheck(result, 'gaps-reconciliation').pass).toBe(false);
  });

  it('the "gaps-heading" detail names the actual heading the run emitted', () => {
    const detail = findCheck(result, 'gaps-heading').detail;
    expect(detail).toContain('## Open Questions');
  });

  it('the "tables-intact" detail names the actual "## Slice Manifest" heading found', () => {
    const detail = findCheck(result, 'tables-intact').detail;
    expect(detail).toContain('## Slice Manifest');
  });

  it('the "derived-purity" detail names 02-solo-variant.md', () => {
    const detail = findCheck(result, 'derived-purity').detail;
    expect(detail).toContain('02-solo-variant.md');
  });
});

describe('ingest harness checker — conforming fixture', () => {
  // Computed once from the checked-in fixture PDF: `shasum -a 256
  // scripts/ingest-harness/__fixtures__/conforming/rulebook/source/rules.pdf`

  const result = checkIngestArtifacts({
    projectDir: CONFORMING_DIR,
    sourceFileName: 'rules.pdf',
    expectedSourceHash: CONFORMING_SOURCE_HASH,
  });

  it('reports top-level pass: true', () => {
    expect(result.pass).toBe(true);
  });

  it.each(CHECK_IDS)('"%s" passes — enumerated by id so a new unsatisfied check surfaces immediately', (id) => {
    expect(findCheck(result, id).pass).toBe(true);
  });

  it('00-visual-survey.md contains a Derived (p. line matching the presentation lexicon, yet derived-purity still passes (the booby trap)', async () => {
    const fs = await import('node:fs');
    const surveyPath = path.join(CONFORMING_DIR, 'rulebook', '00-visual-survey.md');
    const surveyText = fs.readFileSync(surveyPath, 'utf8');
    const hasDerivedLine = /^Derived \(p\.\d+/m.test(surveyText);
    const hasLexiconHit = /sans-serif|full-bleed|palette|wordmark|rotated/i.test(surveyText);
    expect(hasDerivedLine).toBe(true);
    expect(hasLexiconHit).toBe(true);
    // This pair can only both hold while the slice-file helper in check.mjs still excludes
    // 00-visual-survey.md. If someone removes that exclusion, this assertion keeps holding
    // (the file still has the lexicon hit) but the assertion below would flip — proving the
    // exclusion is load-bearing.
    expect(findCheck(result, 'derived-purity').pass).toBe(true);
  });
});

describe('visual-lines (h) — separability, not an inline-line count', () => {
  // Reshaped on evidence: the old check required >=1 inline Visual line, which passed only when
  // a presentation line had been MISFILED for the synthesis hook to relabel, and failed a run
  // that classified correctly and routed presentation to 00-visual-survey.md. It rewarded sloppy
  // transcription and punished clean transcription.
  it('passes when presentation is recorded in the survey and Derived lines exist', () => {
    const r = checkIngestArtifacts({
      projectDir: CONFORMING_DIR,
      sourceFileName: 'rules.pdf',
      expectedSourceHash: CONFORMING_SOURCE_HASH,
    });
    const h = r.checks.find((c) => c.id === 'visual-lines');
    expect(h.pass).toBe(true);
  });

  it('fails when presentation is recorded NOWHERE', () => {
    const r = checkIngestArtifacts({
      projectDir: NONCONFORMING_DIR,
      sourceFileName: 'rules.pdf',
      expectedSourceHash: SEVEN_SOURCE_HASH,
    });
    const h = r.checks.find((c) => c.id === 'visual-lines');
    expect(h.pass).toBe(false);
    expect(h.detail).toContain('NOWHERE');
  });

  it('reports WHERE presentation was recorded, so a reader can tell the two cases apart', () => {
    const r = checkIngestArtifacts({
      projectDir: CONFORMING_DIR,
      sourceFileName: 'rules.pdf',
      expectedSourceHash: CONFORMING_SOURCE_HASH,
    });
    const h = r.checks.find((c) => c.id === 'visual-lines');
    expect(h.detail).toMatch(/presentation recorded in: (00-visual-survey\.md|\d+ inline Visual)/);
  });
});
