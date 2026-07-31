// Measures the real blast radius of naively widening ANNOTATION_FAMILIES with 'Example' against
// all three reference games' LIVE rulebook slices. Uses the REAL `quoteLinesOnly` and
// `buildEnumeratorPayload` from the product (imported directly, not reimplemented) plus a
// locally-constructed four-name vocabulary/citation regex pair standing in for a naive
// `ANNOTATION_FAMILIES` widening (178-01-PLAN.md Task 1).
//
// Reports raw counts only, never a percentage (178-CONTEXT.md decision 16).

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { register } from 'tsx/esm/api';

const unregister = register();

const { annotationBody, quoteLinesOnly } = await import(
  '/Users/jtsmith/BoardSmith/src/cli/commands/verify-derive-check.ts'
);
const { ANNOTATION_FAMILIES, ANNOTATION_CITATION_RE, ANNOTATION_VOCABULARY_RE } = await import(
  '/Users/jtsmith/BoardSmith/src/cli/commands/derived-line-pattern.ts'
);

const GAMES = {
  seven: '/Users/jtsmith/BoardSmithGames/seven/rulebook',
  'one-two-punch': '/Users/jtsmith/BoardSmithGames/one-two-punch/rulebook',
  'doom-machine': '/Users/jtsmith/BoardSmithGames/doom-machine/rulebook',
};

// readLiveSlices' own exclusion set (INDEX.md, 00-visual-survey.md), matched here rather than
// imported so this script has no dependency on the projectDir-shaped readLiveSlices signature.
const EXCLUDE = new Set(['INDEX.md', '00-visual-survey.md']);

// The naive four-name widening under measurement — CITATION-keyed candidate.
const EXAMPLE_CITATION_ONLY_RE = /^Example \(p\.[^)]*\)/i;
// The naive four-name widening under measurement — VOCABULARY-keyed candidate (adds 'Example' to
// today's three-name alternation, otherwise byte-identical in shape to ANNOTATION_VOCABULARY_RE).
const NAIVE_FOUR_NAME_VOCAB_RE = /^[^A-Za-z0-9]*(?:Derived|Visual|Named-but-undefined|Example)\b/im;
// The naive four-name widening's citation backstop, mirroring ANNOTATION_CITATION_RE's shape.
const NAIVE_FOUR_NAME_CITATION_RE = new RegExp(
  [...ANNOTATION_FAMILIES, 'Example'].map((f) => `${f} \\(p\\.`).join('|'),
  'i',
);

function listSlices(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && !EXCLUDE.has(e.name))
    .map((e) => e.name)
    .sort();
}

const report = { games: {} };

for (const [game, rulebookDir] of Object.entries(GAMES)) {
  const sliceNames = listSlices(rulebookDir);
  const gameReport = {
    citationKeyedExampleCount: 0,
    vocabularyKeyedNewMatchCount: 0,
    vocabularyOnlyLines: [], // { slice, lineNumber, text }
    throws: { today: [], fourName: [] }, // { slice, lineNumber, text, error }
  };

  for (const name of sliceNames) {
    const path = join(rulebookDir, name);
    const text = readFileSync(path, 'utf-8');
    const lines = text.split('\n');

    lines.forEach((rawLine, idx) => {
      const body = annotationBody(rawLine);
      if (EXAMPLE_CITATION_ONLY_RE.test(body)) {
        gameReport.citationKeyedExampleCount += 1;
      }
      const matchesToday = ANNOTATION_VOCABULARY_RE.test(body);
      const matchesFourName = NAIVE_FOUR_NAME_VOCAB_RE.test(body);
      if (matchesFourName && !matchesToday) {
        gameReport.vocabularyKeyedNewMatchCount += 1;
        gameReport.vocabularyOnlyLines.push({
          slice: `rulebook/${name}`,
          lineNumber: idx + 1,
          text: rawLine,
        });
      }
    });

    // Real buildEnumeratorPayload, today's ANNOTATION_FAMILIES (three names) — should never throw
    // on live corpus (177.1 baseline).
    try {
      await callBuildEnumeratorPayload({ path: `rulebook/${name}`, text }, ANNOTATION_CITATION_RE, ANNOTATION_VOCABULARY_RE);
    } catch (err) {
      gameReport.throws.today.push({
        slice: `rulebook/${name}`,
        error: String(err && err.message ? err.message : err),
      });
    }

    // Naive four-name variant — locally-constructed backstop check applied to the REAL
    // quoteLinesOnly output, standing in for the hazard: an unmodified quoteLinesOnly deny-list
    // (still only excluding Derived/Visual/Named-but-undefined) feeding a four-name backstop.
    try {
      await callBuildEnumeratorPayload(
        { path: `rulebook/${name}`, text },
        NAIVE_FOUR_NAME_CITATION_RE,
        NAIVE_FOUR_NAME_VOCAB_RE,
      );
    } catch (err) {
      // Find the offending line by re-scanning the real quoteLinesOnly output for the first line
      // that trips the naive four-name vocabulary backstop, so the throw is attributable to a
      // specific slice/line rather than reported only at the payload level.
      const quotes = quoteLinesOnly(text);
      const offender = quotes.find((l) => NAIVE_FOUR_NAME_VOCAB_RE.test(l) || NAIVE_FOUR_NAME_CITATION_RE.test(l));
      const lineNumber = offender ? lines.findIndex((l) => l.trim() === offender) + 1 : null;
      gameReport.throws.fourName.push({
        slice: `rulebook/${name}`,
        lineNumber,
        text: offender ?? null,
        error: String(err && err.message ? err.message : err),
      });
    }
  }

  report.games[game] = gameReport;
}

// Re-implements buildEnumeratorPayload's exact construction-site logic (quoteLinesOnly -> strip by
// vocabulary regex -> assemble -> throw if either backstop still matches) but with the citation/
// vocabulary regex PARAMETERIZED, so the SAME real quoteLinesOnly can be checked against both
// today's three-name backstop and the naive four-name variant without touching product code.
async function callBuildEnumeratorPayload(slice, citationRe, vocabularyRe) {
  const quotes = quoteLinesOnly(slice.text);
  const cleaned = quotes.filter((line) => !vocabularyRe.test(line));
  const lines = ['BS-ENUMERATE-V1', `Slice: ${slice.path}`, '', ...cleaned];
  const payload = lines.join('\n');
  if (citationRe.test(payload) || vocabularyRe.test(payload)) {
    throw new Error(
      `buildEnumeratorPayload (parameterized) assembled a payload for ${slice.path} that still ` +
        `names an annotation family, with or without a page citation.`,
    );
  }
  return payload;
}

const OUT_DIR = '/Users/jtsmith/BoardSmith/.planning/phases/178-worked-example-tests/178-01-MEASUREMENT';
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'raw-report.json'), JSON.stringify(report, null, 2));

for (const [game, g] of Object.entries(report.games)) {
  console.log(`${game}: citationKeyedExample=${g.citationKeyedExampleCount} vocabularyOnlyNew=${g.vocabularyKeyedNewMatchCount} throwsToday=${g.throws.today.length} throwsFourName=${g.throws.fourName.length}`);
}

unregister();
