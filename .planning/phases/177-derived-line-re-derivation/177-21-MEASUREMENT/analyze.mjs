// Analyzes one run's real dispatch output through the REAL, unmodified verify-enumerate.ts
// functions: createEnumeratedFact, validateGrounding, composeArithmeticClaim/Chain,
// classifyDerivedLines, QuoteVerifiedProvenance. No reimplementation of judgment logic.
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
const BASE = '/private/tmp/claude-501/-Users-jtsmith-BoardSmith/39655717-66f7-4931-ad0d-d86278ea06be/scratchpad/177-21';
const manifest = JSON.parse(readFileSync(join(BASE, 'manifest.json'), 'utf8'));

const GAME_PROJECT_DIRS = {
  seven: '/Users/jtsmith/BoardSmithGames/seven',
  'one-two-punch': '/Users/jtsmith/BoardSmithGames/one-two-punch',
  'doom-machine': '/Users/jtsmith/BoardSmithGames/doom-machine',
};

function tryParseJson(text) {
  // Strip any residual fence just in case.
  let t = text.trim();
  const fenceMatch = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) t = fenceMatch[1].trim();
  return JSON.parse(t);
}

function loadFacts(path, slicePath) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const parsed = tryParseJson(raw.facts);
  return (parsed.facts || []).map((f) =>
    createEnumeratedFact({
      statement: f.statement,
      sourceSentence: f.sourceSentence,
      numericValue: f.numericValue,
      slicePath,
    }),
  );
}

// Hand-identified arithmetic-bearing Derived lines, per prior measurements (177-15/17/18) — the
// operation shape is fixed by the Derived line's OWN literal text, not chosen after seeing this
// run's output. Matching is done by finding the grounded-both fact whose statement/sourceSentence
// most closely corresponds to each named operand's magnitude; composition itself runs through the
// real composeArithmeticClaim/composeArithmeticChain unmodified.
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

/**
 * Resolves each real GroundedBothFact this run's actual reconciler cited (via the SAME
 * groundedByStatement lookup classifyDerivedLines' own citedFactIds mechanism uses — not a
 * magnitude search), then picks the fact whose .matchedFactA or .matchedFactB numericValue has
 * the EXPECTED magnitude for that operand's role. This deliberately does NOT search the whole
 * grounded-both set by magnitude alone (that would silently mask a real defect this run found:
 * validateGrounding's findMatch can attach the WRONG fact's numericValue to a GroundedBothFact
 * when multiple facts in one enumerator's list share an identical or overlapping sourceSentence
 * — Array.prototype.find returns the FIRST match, not the intended one. Restricting the search to
 * only the facts the reconciler actually cited for THIS proposal reveals that defect precisely
 * (a magnitude genuinely missing among the cited facts, rather than borrowed from an uncited one).
 */
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

  // chain
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
    const reconcile = tryParseJson(reconcileRaw.reconcile);

    const claimedBoth = (reconcile.both || []).map((b) => ({
      statement: b.statement,
      quotedFromA: b.quotedFromA,
      quotedFromB: b.quotedFromB,
    }));

    const grounding = validateGrounding(listA, listB, claimedBoth);

    // Build ReconcilerDerivedLineClaim[] from the raw proposals, mapping cited statement text ->
    // grounded fact ids (matching on exact statement string, the reconciler's own vocabulary).
    const groundedByStatement = new Map(grounding.grounded.map((g) => [g.statement, g]));

    // Build the composed facts for any arithmetic-flagged proposals. Operand resolution is
    // restricted to the facts THIS proposal's own citedBothStatements names (see resolveOperand's
    // comment for why that restriction matters).
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

  // Summary
  const allClassifications = results.flatMap((r) => r.classifications.map((c) => ({ ...c, slug: r.slug })));
  const counts = {};
  for (const c of allClassifications) counts[c.classification] = (counts[c.classification] || 0) + 1;
  const totalRejected = results.reduce((s, r) => s + r.rejectedCount, 0);
  const totalGrounded = results.reduce((s, r) => s + r.groundedBothCount, 0);

  console.log(`=== ${RUN} summary ===`);
  console.log('Classification counts:', counts);
  console.log(`Grounding: ${totalRejected} rejected / ${totalGrounded + totalRejected} total "both" claims`);
  console.log(`Lines classified: ${allClassifications.length} (expected 28 dispatchable)`);
}

main();
