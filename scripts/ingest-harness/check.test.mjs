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
import fs from 'node:fs';
import os from 'node:os';
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

  it('reports exactly 10 failing checks — a future loosening that quietly turns one green fails here', () => {
    // 10 since 2026-07-28: `gaps-machine-owned` (e0) joined the set, and this fixture — a real
    // failed run — has no machine-owned fences at all, so it fails that one too.
    const failing = result.checks.filter((c) => !c.pass);
    expect(failing.length).toBe(10);
    expect(result.checks.length).toBe(10);
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

/**
 * (e0) `gaps-machine-owned` — the check added on 2026-07-28 for the defect the harness missed.
 *
 * The 2026-07-28 human gate (170-PROOF-RUN-2.md) found an ingest orchestrator that filled
 * `## Open Rules Gaps` by hand with 2 entries while its slices carried 5. The harness scored that
 * run 10/10. Reading the section could not expose it — both entries were real gaps, correctly
 * worded, in the right format. The only observable difference between a hand-authored section and
 * a swept one is whether the writer respected the machine-owned fence, so that is the assertion.
 *
 * These build INDEX.md text inline rather than adding fixtures: the property under test is a
 * property of the gaps section alone, and a full fixture tree would obscure that.
 */
describe('gaps-machine-owned (e0)', () => {
  /** Clone the conforming fixture into a temp dir, with INDEX.md's gaps section replaced. */
  function withGapsSection(sectionBody) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-e0-'));
    fs.cpSync(CONFORMING_DIR, tmp, { recursive: true });
    const indexPath = path.join(tmp, 'rulebook', 'INDEX.md');
    const text = fs.readFileSync(indexPath, 'utf8');
    const start = text.indexOf('## Open Rules Gaps');
    const end = text.indexOf('## Slices');
    fs.writeFileSync(
      indexPath,
      `${text.slice(0, start)}## Open Rules Gaps\n\n${sectionBody}\n\n${text.slice(end)}`,
    );
    return checkIngestArtifacts({
      projectDir: tmp,
      sourceFileName: 'rules.pdf',
      expectedSourceHash: CONFORMING_SOURCE_HASH,
    });
  }

  it('fails a hand-authored section — the exact 2026-07-28 defect', () => {
    const result = withGapsSection(
      [
        'Named-but-undefined (p.1): "Ways to Score" card',
        'Named-but-undefined (p.2): the 7 scoring hands',
      ].join('\n'),
    );
    const check = findCheck(result, 'gaps-machine-owned');
    expect(check.pass).toBe(false);
    expect(check.detail).toMatch(/fences missing/i);
  });

  it('fails when entries are written outside intact fences', () => {
    const result = withGapsSection(
      [
        'Named-but-undefined (p.1): written above the fence',
        '<!-- boardsmith:gaps:begin -->',
        '_None._',
        '<!-- boardsmith:gaps:end -->',
      ].join('\n'),
    );
    const check = findCheck(result, 'gaps-machine-owned');
    expect(check.pass).toBe(false);
    expect(check.detail).toMatch(/OUTSIDE the machine-owned fences/);
  });

  it('fails on prose smuggled between the fences', () => {
    const result = withGapsSection(
      [
        '<!-- boardsmith:gaps:begin -->',
        'These are rules the rulebook names but never defines.',
        'Named-but-undefined (p.1): a gap',
        '<!-- boardsmith:gaps:end -->',
      ].join('\n'),
    );
    const check = findCheck(result, 'gaps-machine-owned');
    expect(check.pass).toBe(false);
    expect(check.detail).toMatch(/hand-authored line/);
  });

  it('passes the empty-but-fenced state a real ingest run leaves behind', () => {
    // This is what ingest now produces before any synthesis runs, and it must NOT be a failure:
    // `boardsmith ingest-check` at /bs-build-chunk Step 0 is what fills it. Failing here would
    // make the harness reject the correct post-ingest state.
    const result = withGapsSection(
      ['<!-- boardsmith:gaps:begin -->', '_None._', '<!-- boardsmith:gaps:end -->'].join('\n'),
    );
    expect(findCheck(result, 'gaps-machine-owned').pass).toBe(true);
  });
});
