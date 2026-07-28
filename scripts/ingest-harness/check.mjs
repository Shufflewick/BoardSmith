/**
 * scripts/ingest-harness/check.mjs
 *
 * Produced-artifact checker for the `/bs-ingest-rules` pipeline (Phase 170).
 *
 * Background: the 2026-07-27 proof run (see
 * .planning/phases/170-ingest-contract-upgrade/170-PROOF-RUN.md) failed 7 of 9 real-run
 * checks while every contract test for the same requirements stayed green. A contract test
 * proves an instruction exists in skill text; it cannot prove an agent received or followed
 * it. This module is the deterministic half of the fix: a pure filesystem + string function
 * that inspects a project directory an ingest run actually produced and reports, per named
 * check, whether the INGEST-01/02/03/04 contract landed in the artifacts themselves.
 *
 * It automates gate items (a)-(f), (h), (i) of 170-03-PLAN.md's Task 2 human checklist. Item
 * (g) — "~/BoardSmithGames/seven unmodified" — concerns an external git repository, not a
 * produced artifact, and deliberately belongs to the live-agent driver (Plan 06), not here.
 *
 * No dependencies beyond node builtins: this checker must never itself become a thing that
 * needs verifying.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Ordered list of check ids. Frozen so downstream consumers (Plan 06's driver, Plan 08's
 * additions) order their output from one source of truth instead of restating this list.
 */
export const CHECK_IDS = Object.freeze([
  'archive-exists',
  'archive-hash',
  'hash-recorded',
  'header-block',
  'gaps-heading',
  'gaps-reconciliation',
  'tables-intact',
  'visual-lines',
  'derived-purity',
]);

const CHECK_META = Object.freeze({
  'archive-exists': { letter: 'a', label: 'Archived source PDF exists at rulebook/source/' },
  'archive-hash': { letter: 'b', label: 'Archived source hash matches expected source hash' },
  'hash-recorded': { letter: 'c', label: 'INDEX.md Source hash: line matches the archive hash' },
  'header-block': { letter: 'd', label: 'INDEX.md four header lines present, ordered, non-empty' },
  'gaps-heading': { letter: 'e1', label: 'INDEX.md has the exact "## Open Rules Gaps" heading' },
  'gaps-reconciliation': { letter: 'e2', label: 'Gaps section entries reconcile with slice markers' },
  'tables-intact': { letter: 'f', label: 'INDEX.md has "## Slices" and "## Term → Slice" tables' },
  'visual-lines': { letter: 'h', label: 'Slices carry both Visual (p. and Derived (p. lines' },
  'derived-purity': { letter: 'i', label: 'No Derived (p. line is pure presentation description' },
});

// Case-insensitive presentation-description lexicon for the derived-purity heuristic (i).
// This is deliberately a HEURISTIC, not a parser. Its job is to flag candidates; the Plan 10
// human gate adjudicates. It is calibrated against the two real misfilings the 2026-07-27
// proof run produced (02-solo-variant.md and 01-components-and-credits.md), both of which
// still trip it — see 170-PROOF-RUN.md item (i).
//
// REFERENTIAL TERMS ARE DELIBERATELY EXCLUDED — 'depicted', 'illustration', 'shown', 'image'.
// They were in the original list and produced three false positives on a real run:
//
//   "Derived (p.1): Sets match on number only — the depicted Set example mixes two green
//    cards with one purple card, so color is not required to match within a Set."
//
// That line is correctly filed. It affects legality, and it references the diagram because
// it INFERS A RULE FROM the diagram — which is precisely the contract's own canonical
// Derived example ("a per-player starting-hand card count inferred from a setup diagram").
// A rule derived from a diagram must be able to mention the diagram. Flagging referential
// vocabulary penalizes the exact behavior INGEST-02 asks for, and a check that fires on
// correct work gets waived, taking its true positives with it.
//
// What remains are terms describing how the page LOOKS, which cannot carry a rule: no
// statement about legality, scoring, or sequencing needs to say 'sans-serif' or 'full-bleed'.
const PRESENTATION_LEXICON = [
  'sans-serif',
  'serif',
  'typograph',
  'full-bleed',
  'palette',
  'wordmark',
  'italic',
  'font',
  'aspect ratio',
  'iconograph',
  'art style',
  'rotated',
  'bold white',
];

function makeResult(id, pass, detail) {
  const meta = CHECK_META[id];
  return { id, letter: meta.letter, label: meta.label, pass, detail };
}

function rulebookDir(projectDir) {
  return path.join(projectDir, 'rulebook');
}

function readIndexText(projectDir) {
  const indexPath = path.join(rulebookDir(projectDir), 'INDEX.md');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) return null;
  return readFileSync(indexPath, 'utf8');
}

function sha256File(filePath) {
  const bytes = readFileSync(filePath);
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * "Slice files" are defined once, here, and used everywhere below: every
 * {projectDir}/rulebook/*.md file EXCEPT INDEX.md (which is the index, not a slice) and
 * 00-visual-survey.md (which is by design entirely presentation description — if it were
 * counted as a slice, `visual-lines` would become trivially passable off survey content
 * alone and `derived-purity` would become trivially failable off survey content alone;
 * excluding it is what makes both checks meaningful against real transcription slices).
 */
function getSliceFiles(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'INDEX.md' && name !== '00-visual-survey.md')
    .sort()
    .map((name) => {
      const fullPath = path.join(dir, name);
      return { name, fullPath, text: readFileSync(fullPath, 'utf8') };
    });
}

function findHeaderLabel(text, label) {
  const re = new RegExp(`^${label}\\s*(.*)$`, 'm');
  const m = text.match(re);
  if (!m) return null;
  return { index: m.index, value: m[1].trim() };
}

function checkArchiveExists({ projectDir, sourceFileName }) {
  const archivePath = path.join(rulebookDir(projectDir), 'source', sourceFileName);
  if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
    return makeResult('archive-exists', false, `missing: ${archivePath} does not exist as a regular file`);
  }
  const size = statSync(archivePath).size;
  return makeResult('archive-exists', true, `found: ${archivePath} (${size} bytes)`);
}

function checkArchiveHash({ projectDir, sourceFileName, expectedSourceHash }) {
  const archivePath = path.join(rulebookDir(projectDir), 'source', sourceFileName);
  if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
    return {
      result: makeResult('archive-hash', false, `cannot compute hash: ${archivePath} missing`),
      computedHash: null,
    };
  }
  const computedHash = sha256File(archivePath);
  const pass = computedHash.toLowerCase() === String(expectedSourceHash).toLowerCase();
  const detail = pass
    ? `matches: computed ${computedHash} equals expected ${expectedSourceHash.toLowerCase()}`
    : `mismatch: computed ${computedHash} vs expected ${String(expectedSourceHash).toLowerCase()}`;
  return { result: makeResult('archive-hash', pass, detail), computedHash };
}

function checkHashRecorded(indexText, computedHash) {
  if (indexText === null) {
    return makeResult('hash-recorded', false, 'cannot check: rulebook/INDEX.md missing');
  }
  const re = /^Source hash:\s*([0-9a-f]{64})\s*$/m;
  const m = indexText.match(re);
  if (!m) {
    return makeResult(
      'hash-recorded',
      false,
      'line absent: no "Source hash:" line with exactly 64 lowercase hex characters found',
    );
  }
  if (computedHash === null) {
    return makeResult(
      'hash-recorded',
      false,
      `recorded value ${m[1]} present but cannot be compared: archived source missing so no hash was computed`,
    );
  }
  const pass = m[1] === computedHash;
  const detail = pass
    ? `recorded ${m[1]} equals computed ${computedHash}`
    : `recorded ${m[1]} does NOT equal computed ${computedHash} — INDEX records a hash nobody ran`;
  return makeResult('hash-recorded', pass, detail);
}

function checkHeaderBlock(indexText, hasSourceDir) {
  if (indexText === null) {
    return makeResult('header-block', false, 'cannot check: rulebook/INDEX.md missing');
  }
  const labels = ['Edition:', 'Source:', 'Source hash:', 'Transcribed:'];
  const found = {};
  for (const label of labels) {
    found[label] = findHeaderLabel(indexText, label);
  }

  const failures = [];

  for (const label of labels) {
    if (!found[label] || found[label].value === '') {
      failures.push(`"${label}" line missing or has an empty value`);
    }
  }

  // Order check only meaningful if all four are present.
  if (failures.length === 0) {
    const indices = labels.map((l) => found[l].index);
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] <= indices[i - 1]) {
        failures.push(
          `header labels out of order: expected Edition:, Source:, Source hash:, Transcribed: in that order`,
        );
        break;
      }
    }
  }

  if (found['Source:'] && found['Source:'].value !== '') {
    const value = found['Source:'].value;
    if (!value.startsWith('rulebook/source/') || value.startsWith('/') || value.startsWith('~')) {
      failures.push(
        `"Source:" value "${value}" does not begin with "rulebook/source/" (must be an in-project archived path, never an external absolute path)`,
      );
    }
  }

  if (found['Transcribed:'] && found['Transcribed:'].value !== '') {
    const value = found['Transcribed:'].value;
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) {
      failures.push(`"Transcribed:" value "${value}" does not start with an ISO date (YYYY-MM-DD)`);
    }
  }

  // The exact (d) defect the 2026-07-27 proof run recorded: the interview-path Edition
  // wording emitted on the rulebook (has-source-file) path. Invisible to a bare presence
  // check because the label IS present and non-empty — the value is simply wrong for this
  // path.
  if (found['Edition:'] && found['Edition:'].value === 'unpublished — designer statement' && hasSourceDir) {
    failures.push(
      '"Edition:" reads "unpublished — designer statement" (the interview-path wording) while rulebook/source/ exists — this is the exact defect the 2026-07-27 proof run recorded',
    );
  }

  const pass = failures.length === 0;
  const detail = pass ? 'all four header labels present, ordered, and valid' : failures.join('; ');
  return makeResult('header-block', pass, detail);
}

function checkGapsHeading(indexText) {
  if (indexText === null) {
    return makeResult('gaps-heading', false, 'cannot check: rulebook/INDEX.md missing');
  }
  const hasExact = /^## Open Rules Gaps$/m.test(indexText);
  const hasParenthetical = indexText.includes('## Open Rules Gaps (');
  if (hasExact && !hasParenthetical) {
    return makeResult('gaps-heading', true, 'found exact "## Open Rules Gaps" heading');
  }
  // Report the actual gaps-shaped heading found, if any, so a failure is diagnosable.
  const lines = indexText.split('\n');
  const candidate = lines.find((line) => /^##\s.*(gap|question)/i.test(line));
  const detail = hasParenthetical
    ? `heading carries a parenthetical suffix (not exactly "## Open Rules Gaps"): "${lines.find((l) => l.includes('## Open Rules Gaps (')) ?? ''}"`
    : candidate
      ? `expected "## Open Rules Gaps" but found instead: "${candidate.trim()}"`
      : 'no gaps-shaped heading found at all';
  return makeResult('gaps-heading', false, detail);
}

function getGapsSectionBodyLines(indexText) {
  const lines = indexText.split('\n');
  const headingIdx = lines.findIndex((l) => l.trim() === '## Open Rules Gaps');
  if (headingIdx === -1) return null; // heading absent entirely
  const body = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) break;
    body.push(lines[i]);
  }
  return body;
}

/**
 * Count gap entries in the `## Open Rules Gaps` body.
 *
 * Counts BOTH forms, and takes whichever is larger:
 *   - a verbatim `Named-but-undefined (p.N): <rule>` line (what `boardsmith ingest-gaps` writes)
 *   - a numbered list item (what a session writing the section by hand tends to produce)
 *
 * Originally this counted numbered list items only. That was inferred from the incidental
 * formatting of the 2026-07-27 failed run, not from any requirement, and it made the
 * reconciliation an apples-to-oranges comparison: numbered markers on the section side versus
 * `Named-but-undefined` occurrences on the slice side. Counting the same token on both sides is
 * the comparison the check is actually trying to make. Accepting both forms is a superset of the
 * old behaviour — a hand-written numbered list still counts exactly as it did before.
 */
function countOrderedListEntries(bodyLines) {
  const numbered = bodyLines.filter((line) => /^\s*\d+[.)]\s+/.test(line)).length;
  const markers = bodyLines.filter((line) => /^\s*Named-but-undefined\b/.test(line)).length;
  return Math.max(numbered, markers);
}

function isExplicitNoneBody(bodyLines) {
  const substantive = bodyLines
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('<!--') && !l.startsWith('-->'));
  return substantive.length === 1 && substantive[0] === '_None._';
}

function checkGapsReconciliation(indexText, sliceFiles) {
  if (indexText === null) {
    return makeResult('gaps-reconciliation', false, 'cannot check: rulebook/INDEX.md missing');
  }

  const sliceMarkerCount = sliceFiles.reduce((sum, f) => {
    const matches = f.text.match(/Named-but-undefined/g);
    return sum + (matches ? matches.length : 0);
  }, 0);

  const bodyLines = getGapsSectionBodyLines(indexText);
  const sectionAbsent = bodyLines === null;
  const effectiveBody = bodyLines ?? [];
  const explicitNone = !sectionAbsent && isExplicitNoneBody(effectiveBody);
  const entryCount = explicitNone ? 0 : countOrderedListEntries(effectiveBody);

  // Run this comparison unconditionally, for every entry count — never gated on the count
  // looking low; a drop can land anywhere.
  const pass = entryCount === sliceMarkerCount;

  let direction = '';
  if (!pass) {
    direction =
      sliceMarkerCount > entryCount
        ? ' (markers greater than entries: the transport is dropping gaps)'
        : ' (entries greater than markers: the section is not built purely from openGaps[])';
  }
  const sectionNote = sectionAbsent ? ' [no "## Open Rules Gaps" section found; treated as 0 entries]' : '';
  const detail = `section entries=${entryCount}, slice Named-but-undefined markers=${sliceMarkerCount}${direction}${sectionNote}`;
  return makeResult('gaps-reconciliation', pass, detail);
}

function checkTablesIntact(indexText) {
  if (indexText === null) {
    return makeResult('tables-intact', false, 'cannot check: rulebook/INDEX.md missing');
  }
  const lines = indexText.split('\n');
  const hasSlices = lines.some((l) => l.trim() === '## Slices');
  const hasTermSlice = lines.some((l) => l.trim() === '## Term → Slice');

  if (hasSlices && hasTermSlice) {
    return makeResult('tables-intact', true, 'both "## Slices" and "## Term → Slice" headings present');
  }

  const missing = [];
  if (!hasSlices) {
    const found = lines.find((l) => /^##\s.*slice/i.test(l) && l.trim() !== '## Slices');
    missing.push(`"## Slices" missing${found ? ` (found instead: "${found.trim()}")` : ''}`);
  }
  if (!hasTermSlice) {
    const found = lines.find((l) => /^##\s.*term/i.test(l));
    missing.push(`"## Term → Slice" missing${found ? ` (found instead: "${found.trim()}")` : ''}`);
  }
  return makeResult('tables-intact', false, missing.join('; '));
}

function checkVisualLines(sliceFiles) {
  let visualTotal = 0;
  let derivedTotal = 0;
  const perFile = [];
  for (const f of sliceFiles) {
    const visualCount = (f.text.match(/^Visual \(p\.\d+/gm) || []).length;
    const derivedCount = (f.text.match(/^Derived \(p\.\d+/gm) || []).length;
    visualTotal += visualCount;
    derivedTotal += derivedCount;
    perFile.push(`${f.name}: Visual=${visualCount}, Derived=${derivedCount}`);
  }
  // Zero "Visual (p." lines is a FAIL. No waiver is encoded here — a waiver, if ever
  // justified, is a human judgment made at the Plan 10 gate, not something this checker
  // can grant itself.
  const pass = visualTotal >= 1 && derivedTotal >= 1;
  const detail = `totals: Visual=${visualTotal}, Derived=${derivedTotal} | per-file: ${perFile.join('; ') || '(no slice files found)'}`;
  return makeResult('visual-lines', pass, detail);
}

function checkDerivedPurity(sliceFiles) {
  const lexiconRe = new RegExp(`(${PRESENTATION_LEXICON.join('|')})`, 'i');
  const offenses = [];
  for (const f of sliceFiles) {
    const lines = f.text.split('\n');
    lines.forEach((line, idx) => {
      if (/^Derived \(p\.\d+/.test(line)) {
        const m = line.match(lexiconRe);
        if (m) {
          offenses.push(`${f.name}:${idx + 1} (matched "${m[1]}")`);
        }
      }
    });
  }
  const pass = offenses.length === 0;
  const detail = pass
    ? 'no Derived (p. line matches the presentation lexicon'
    : `offending lines: ${offenses.join('; ')}`;
  return makeResult('derived-purity', pass, detail);
}

/**
 * Read a project directory produced by an ingest run and report pass/fail per named check.
 *
 * @param {{ projectDir: string, sourceFileName: string, expectedSourceHash: string }} args
 * @returns {{ pass: boolean, checks: Array<{ id: string, letter: string, label: string, pass: boolean, detail: string }> }}
 */
export function checkIngestArtifacts({ projectDir, sourceFileName, expectedSourceHash }) {
  const dir = rulebookDir(projectDir);
  const indexText = readIndexText(projectDir);
  const hasSourceDir = existsSync(path.join(dir, 'source')) && statSync(path.join(dir, 'source')).isDirectory();
  const sliceFiles = getSliceFiles(dir);

  const archiveExists = checkArchiveExists({ projectDir, sourceFileName });
  const { result: archiveHash, computedHash } = checkArchiveHash({
    projectDir,
    sourceFileName,
    expectedSourceHash,
  });
  const hashRecorded = checkHashRecorded(indexText, computedHash);
  const headerBlock = checkHeaderBlock(indexText, hasSourceDir);
  const gapsHeading = checkGapsHeading(indexText);
  const gapsReconciliation = checkGapsReconciliation(indexText, sliceFiles);
  const tablesIntact = checkTablesIntact(indexText);
  const visualLines = checkVisualLines(sliceFiles);
  const derivedPurity = checkDerivedPurity(sliceFiles);

  const checks = [
    archiveExists,
    archiveHash,
    hashRecorded,
    headerBlock,
    gapsHeading,
    gapsReconciliation,
    tablesIntact,
    visualLines,
    derivedPurity,
  ];

  return {
    pass: checks.every((c) => c.pass),
    checks,
  };
}
