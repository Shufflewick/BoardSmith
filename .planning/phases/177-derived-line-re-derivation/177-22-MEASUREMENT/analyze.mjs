// Analyzes one run's real dispatch output through the REAL, unmodified verify-enumerate.ts
// functions: createEnumeratedFact, validateGrounding, composeArithmeticClaim/Chain,
// classifyDerivedLines, QuoteVerifiedProvenance. No reimplementation of judgment logic. Adapted
// from 177-21-MEASUREMENT/analyze.mjs (path/output changes + re-checked arithmetic-line specs
// for the current corpus's slugs, unchanged in content since neither seven nor
// doom-machine/01-objective-and-setup.md was touched by the CARDS.md split).
import {
  createEnumeratedFact,
  validateGrounding,
  composeArithmeticClaim,
  composeArithmeticChain,
  classifyDerivedLines,
  QuoteVerifiedProvenance,
} from '/Users/jtsmith/BoardSmith/src/cli/commands/verify-enumerate.ts';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const RUN = process.argv[2];
const BASE = '/private/tmp/claude-501/-Users-jtsmith-BoardSmith/39655717-66f7-4931-ad0d-d86278ea06be/scratchpad/177-22';
const manifest = JSON.parse(readFileSync(join(BASE, 'manifest.json'), 'utf8'));

const GAME_PROJECT_DIRS = {
  seven: '/Users/jtsmith/BoardSmithGames/seven',
  'one-two-punch': '/Users/jtsmith/BoardSmithGames/one-two-punch',
  'doom-machine': '/Users/jtsmith/BoardSmithGames/doom-machine',
};

// Disclosed, generic (not case-tuned) repair for a real live-dispatch failure mode this run
// found: an enumerator model (observed: haiku, run1, doom-machine__01-objective-and-setup)
// emitting a raw `sourceSentence` string that echoes the source document's own embedded quote
// marks (e.g. `"Doom Core"`) WITHOUT escaping them, producing syntactically invalid JSON. This is
// a live-dispatch data-quality finding, not a `verify-enumerate.ts` defect — the module's real
// `createEnumeratedFact` never receives raw unparsed text in production (a Task-tool dispatch
// returns already-structured output); this harness's own manual `--output-format json` + text
// parse is what exposes the raw model string. The repair walks the raw text once, character by
// character, tracking whether we are inside a JSON string; when a `"` is encountered, it is
// treated as the REAL string terminator only if immediately followed (after any whitespace) by a
// JSON structural character (`:`, `,`, `}`, `]`) or end of input — otherwise it is an embedded,
// unescaped quote and gets escaped in place. Repairs are counted and returned so callers can
// disclose exactly how many, and in which file, this run needed the repair.
function repairUnescapedQuotes(text) {
  let out = '';
  let inString = false;
  let repairCount = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && inString) {
      out += ch + (text[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '"') {
      if (!inString) {
        inString = true;
        out += ch;
        continue;
      }
      // Currently inside a string — decide if this quote is the real terminator.
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      const next = text[j];
      const isRealTerminator = next === undefined || [':', ',', '}', ']'].includes(next);
      if (isRealTerminator) {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
        repairCount++;
      }
      continue;
    }
    out += ch;
  }
  return { repaired: out, repairCount };
}

const REPAIR_LOG = [];

function tryParseJson(text, label) {
  let t = text.trim();
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) t = fenceMatch[1].trim();
  try {
    return JSON.parse(t);
  } catch (e) {
    const { repaired, repairCount } = repairUnescapedQuotes(t);
    const result = JSON.parse(repaired); // let this throw uncaught if repair didn't work — no silent data loss
    REPAIR_LOG.push({ label, repairCount, originalError: e.message });
    return result;
  }
}

function loadFacts(path, slicePath) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = tryParseJson(raw.facts, path);
  return (parsed.facts || []).map((f) =>
    createEnumeratedFact({
      statement: f.statement,
      sourceSentence: f.sourceSentence,
      numericValue: f.numericValue,
      slicePath,
    }),
  );
}

// Hand-identified arithmetic-bearing Derived lines, carried forward unchanged from 177-21's
// analyze.mjs — the operation shape is fixed by the Derived line's OWN literal text (confirmed
// byte-identical for these three lines' source files this run; neither `seven`'s two slices nor
// doom-machine/01-objective-and-setup.md was touched by the CARDS.md split). Matching is done by
// finding the grounded-both fact whose statement/sourceSentence most closely corresponds to each
// named operand's magnitude; composition itself runs through the real
// composeArithmeticClaim/composeArithmeticChain unmodified.
const ARITHMETIC_LINES = {
  'seven__01-definitions-and-components:21': {
    kind: 'single',
    operation: 'multiply',
    claimedResult: { magnitude: 112, unit: 'numbered cards', approximate: false },
    operandMagnitudes: [7, 4, 4], // 7 numbers x 4 colors x 4 copies
  },
  'seven__01-overview-setup-and-play:36': {
    kind: 'chain',
    claimedResult: { magnitude: 7, unit: 'rounds', approximate: false },
    // net = draw(2) - discard(1) = 1; span = end(10) - start(3) = 7; rounds = span / net = 7
    steps: [
      { operation: 'subtract', magnitudes: [2, 1] },
      { operation: 'subtract', magnitudes: [10, 3] },
      { operation: 'divide', stepRefs: [1, 0] }, // span(step1) / net(step0)
    ],
  },
  'doom-machine__01-objective-and-setup:34': {
    kind: 'single',
    operation: 'subtract',
    claimedResult: { magnitude: 6, unit: 'dice', approximate: false },
    operandMagnitudes: [9, 3],
  },
};

function resolveOperand(citedGroundedFacts, expectedMagnitude) {
  return citedGroundedFacts.find(
    (g) =>
      (g.matchedFactA.numericValue && g.matchedFactA.numericValue.magnitude === expectedMagnitude) ||
      (g.matchedFactB.numericValue && g.matchedFactB.numericValue.magnitude === expectedMagnitude),
  );
}

function tryCompose(slug, lineNumber, derivedLineText, citedGroundedFacts) {
  const key = `${slug}:${lineNumber}`;
  const spec = ARITHMETIC_LINES[key];
  if (!spec) return null;

  if (spec.kind === 'single') {
    const operands = spec.operandMagnitudes.map((m) => resolveOperand(citedGroundedFacts, m));
    if (operands.some((o) => !o)) {
      return {
        ok: false,
        reason:
          `Could not find, AMONG THE FACTS THIS RUN'S RECONCILER ACTUALLY CITED for this proposal, ` +
          `a grounded fact carrying one or more expected operand magnitudes [${spec.operandMagnitudes}]. ` +
          `Cited facts: ${citedGroundedFacts.map((g) => `"${g.statement}" (A:${JSON.stringify(g.matchedFactA.numericValue)}, B:${JSON.stringify(g.matchedFactB.numericValue)})`).join('; ')}`,
      };
    }
    return composeArithmeticClaim({
      derivedLineText,
      operation: spec.operation,
      operands,
      claimedResult: spec.claimedResult,
    });
  }

  const flatMagnitudes = [];
  for (const step of spec.steps) {
    if (step.magnitudes) flatMagnitudes.push(...step.magnitudes);
  }
  const uniqueMagnitudes = [...new Set(flatMagnitudes)];
  const operandsByMagnitude = new Map();
  for (const m of uniqueMagnitudes) {
    const f = resolveOperand(citedGroundedFacts, m);
    if (!f) {
      return {
        ok: false,
        reason: `Could not find, among cited facts, a grounded fact carrying expected magnitude ${m}.`,
      };
    }
    operandsByMagnitude.set(m, f);
  }
  const operands = [...operandsByMagnitude.values()];
  const indexOf = (m) => operands.indexOf(operandsByMagnitude.get(m));

  const steps = spec.steps.map((step) => {
    if (step.magnitudes) {
      return { operation: step.operation, operandRefs: step.magnitudes.map((m) => ({ kind: 'fact', index: indexOf(m) })) };
    }
    return { operation: step.operation, operandRefs: step.stepRefs.map((i) => ({ kind: 'stepResult', index: i })) };
  });

  return composeArithmeticChain({
    derivedLineText,
    steps,
    operands,
    claimedResult: spec.claimedResult,
  });
}

async function main() {
  const dispatchable = manifest.slices.filter((s) => s.payloadOk);
  const provenanceByGame = {};
  for (const [game, dir] of Object.entries(GAME_PROJECT_DIRS)) {
    provenanceByGame[game] = await QuoteVerifiedProvenance.obtain(dir);
  }

  const results = [];
  const rawByGame = {};

  for (const slice of dispatchable) {
    const slug = `${slice.game}__${basename(slice.slicePath, '.md')}`;
    const enumAPath = join(BASE, RUN, 'enum', `${slug}.A.json`);
    const enumBPath = join(BASE, RUN, 'enum', `${slug}.B.json`);
    const reconcilePath = join(BASE, RUN, 'reconcile', `${slug}.json`);

    const listA = loadFacts(enumAPath, slice.slicePath);
    const listB = loadFacts(enumBPath, slice.slicePath);
    const reconcileRaw = JSON.parse(readFileSync(reconcilePath, 'utf8'));
    const reconcile = tryParseJson(reconcileRaw.reconcile, reconcilePath);

    const claimedBoth = (reconcile.both || []).map((b) => ({
      statement: b.statement,
      quotedFromA: b.quotedFromA,
      quotedFromB: b.quotedFromB,
    }));

    const grounding = validateGrounding(listA, listB, claimedBoth);

    const groundedByStatement = new Map(grounding.grounded.map((g) => [g.statement, g]));

    const composed = [];
    const composeAttempts = [];
    for (const prop of reconcile.derivedLineProposals || []) {
      if (prop.proposedClassification !== 'corroborated-by-composition') continue;
      const citedGroundedFacts = (prop.citedBothStatements || [])
        .map((s) => groundedByStatement.get(s))
        .filter(Boolean);
      const outcome = tryCompose(slug, prop.lineNumber, prop.derivedLineText, citedGroundedFacts);
      composeAttempts.push({ slug, lineNumber: prop.lineNumber, outcome });
      if (outcome && outcome.ok) composed.push(outcome.composed);
    }
    const claims = (reconcile.derivedLineProposals || []).map((prop) => {
      const citedFactIds = (prop.citedBothStatements || [])
        .map((s) => groundedByStatement.get(s)?.id)
        .filter(Boolean);
      let composedFactId;
      if (prop.proposedClassification === 'corroborated-by-composition') {
        const matchingComposed = composed.find((c) => c.claimText === prop.derivedLineText);
        composedFactId = matchingComposed?.id;
      }
      return {
        slicePath: slice.slicePath,
        lineNumber: prop.lineNumber,
        derivedLineText: prop.derivedLineText,
        proposedClassification: prop.proposedClassification,
        citedFactIds,
        composedFactId,
        absenceTargets: prop.absenceTargets,
      };
    });

    const provenance = provenanceByGame[slice.game];
    const passageText = readFileSync(slice.fullPath, 'utf8');

    const classifyResult = classifyDerivedLines({
      claims,
      groundedBoth: grounding.grounded,
      composed,
      provenance,
      passages: { [slice.slicePath]: passageText },
    });

    results.push({
      slug,
      game: slice.game,
      slicePath: slice.slicePath,
      derivedLineCount: slice.derivedLines.length,
      enumACount: listA.length,
      enumBCount: listB.length,
      groundedBothCount: grounding.grounded.length,
      rejectedCount: grounding.rejected.length,
      rejected: grounding.rejected.map((r) => ({ statement: r.claim.statement, reason: r.reason })),
      composeAttempts,
      classifications: classifyResult.classifications,
      missedCount: classifyResult.missed.length,
      aOnlyCount: (reconcile.aOnly || []).length,
      bOnlyCount: (reconcile.bOnly || []).length,
    });

    rawByGame[slug] = { listA, listB, reconcile, grounding, provenanceUnarchived: provenance ? provenance.unarchivedSources : null, provenanceCovers: provenance ? provenance.covers(slice.slicePath) : null };
  }

  writeFileSync(join(BASE, `analysis-${RUN}.json`), JSON.stringify(results, null, 2));
  writeFileSync(join(BASE, `analysis-${RUN}-raw.json`), JSON.stringify(rawByGame, null, 2));
  writeFileSync(join(BASE, `repair-log-${RUN}.json`), JSON.stringify(REPAIR_LOG, null, 2));
  if (REPAIR_LOG.length > 0) {
    console.log(`=== ${RUN}: JSON repairs needed (disclosed live-dispatch finding) ===`);
    for (const r of REPAIR_LOG) console.log(`  ${r.label}: ${r.repairCount} unescaped-quote repair(s)`);
  }

  const allClassifications = results.flatMap((r) => r.classifications.map((c) => ({ ...c, slug: r.slug })));
  const counts = {};
  for (const c of allClassifications) counts[c.classification] = (counts[c.classification] || 0) + 1;
  const totalRejected = results.reduce((s, r) => s + r.rejectedCount, 0);
  const totalGrounded = results.reduce((s, r) => s + r.groundedBothCount, 0);

  console.log(`=== ${RUN} summary ===`);
  console.log('Classification counts:', counts);
  console.log(`Grounding: ${totalRejected} rejected / ${totalGrounded + totalRejected} total "both" claims`);
  console.log(`Lines classified: ${allClassifications.length} (expected 32 dispatchable)`);
  console.log(`Enumerator fact counts per slice:`);
  for (const r of results) console.log(`  ${r.slug}: A=${r.enumACount} B=${r.enumBCount}`);
}

main();
