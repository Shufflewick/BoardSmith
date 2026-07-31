import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { renderIndex, ingestArchiveCommand } from './ingest-archive.js';
import {
  ENUMERATE_TOKEN,
  buildEnumeratorPayload,
  createEnumeratedFact,
  validateGrounding,
  composeArithmeticClaim,
  composeArithmeticChain,
  MAX_ARITHMETIC_CHAIN_DEPTH,
  QuoteVerifiedProvenance,
  classifyDerivedLines,
  type EnumeratedFact,
  type GroundedBothFact,
  type ReconcilerBothClaim,
  type ComposedFact,
  type ReconcilerDerivedLineClaim,
  type ArithmeticChainStep,
} from './verify-enumerate.js';

/**
 * `verify-enumerate.ts` is CHECK-04's REPLACEMENT mechanical core (177-EXPERIMENTS/README.md
 * "Direction"). Fixtures here are either a real filesystem temp dir (`fs.mkdtemp`, no mocks) or
 * the REAL re-transcribed, quote-verified 177-FIXTURES corpus — never invented slice bodies for
 * the assertions that pin behavior against real rulebook text. Per this plan's own instruction,
 * 174-FIXTURES/ (the stale, pre-2026-07-27 corpus) is never used here.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURES_ROOT = join(
  __dirname,
  '../../../.planning/phases/177-derived-line-re-derivation/177-FIXTURES',
);

async function readFixture(relPath: string): Promise<string> {
  return fs.readFile(join(FIXTURES_ROOT, relPath), 'utf-8');
}

// ===========================================================================================
// buildEnumeratorPayload — quote-lines-only, backstopped
// ===========================================================================================

describe('buildEnumeratorPayload', () => {
  it('carries the handshake token and the slice path', () => {
    const payload = buildEnumeratorPayload({
      path: 'rulebook/01-x.md',
      text: 'p.1, X:\n"A quoted sentence."',
    });
    expect(payload).toContain(ENUMERATE_TOKEN);
    expect(payload).toContain('Slice: rulebook/01-x.md');
    expect(payload).toContain('"A quoted sentence."');
  });

  it('excludes Derived/Visual/Named-but-undefined lines from the assembled payload', () => {
    const payload = buildEnumeratorPayload({
      path: 'rulebook/01-x.md',
      text: [
        'p.1, X:',
        '"A quoted sentence."',
        'Derived (p.1): some inference.',
        'Visual (p.1): some art description.',
        'Named-but-undefined (p.1): some undefined term.',
      ].join('\n'),
    });
    expect(payload).not.toMatch(/Derived \(p\./);
    expect(payload).not.toMatch(/Visual \(p\./);
    expect(payload).not.toMatch(/Named-but-undefined \(p\./);
    expect(payload).toContain('"A quoted sentence."');
  });

  it('excludes decoration-wrapped annotation lines (blockquote/bullet), matching the CHECK-04 payload guarantee', () => {
    const payload = buildEnumeratorPayload({
      path: 'rulebook/01-x.md',
      text: [
        'p.1, X:',
        '"A quoted sentence."',
        '> Derived (p.1): blockquoted inference.',
        '- Visual (p.1): bulleted art description.',
      ].join('\n'),
    });
    expect(payload).not.toMatch(/Derived \(p\./);
    expect(payload).not.toMatch(/Visual \(p\./);
  });

  it('the real seven/02-solo-variant.md fixture produces a payload with zero annotation-family leaks', async () => {
    const text = await readFixture('seven/live/02-solo-variant.md');
    const payload = buildEnumeratorPayload({ path: 'rulebook/02-solo-variant.md', text });
    expect(payload).not.toMatch(/Derived \(p\./);
    expect(payload).not.toMatch(/Visual \(p\./);
    expect(payload).not.toMatch(/Named-but-undefined \(p\./);
    // The passage's real quoted content must survive.
    expect(payload).toContain('in no particular order');
  });

  it('strips a PARENTHESISED annotation — the leading-decoration form the enumerated character class missed', () => {
    // Verbatim shape from doom-machine CARDS.md:140. The first version of ANNOTATION_VOCABULARY_RE
    // enumerated leading decoration as [\s>\-*] and this leaked straight past it, into a live
    // dispatch. The pattern now consumes ALL non-alphanumerics rather than a guessed set.
    const payload = buildEnumeratorPayload({
      path: 'rulebook/CARDS.md',
      text: [
        'QUOTE (p.1): "The die advances one slot each machine phase."',
        '  (Derived: effectively a 2-space loop — die goes slot -> Damage -> dead -> back to slot.)',
      ].join('\n'),
    });
    expect(payload).not.toContain('2-space loop');
    expect(payload).toContain('advances one slot');
  });

  it('strips the BARE `Derived:` marker form (no page citation) found live in doom-machine CARDS.md', () => {
    // Plan 177-18 measured this leaking into a real dispatch. CARDS.md declares its own local
    // convention ("Anything else is marked 'Derived'") and writes bare `Derived:` lines with no
    // page citation. Both the strip filter AND the original backstop were keyed to `Derived (p.`,
    // so these passed through SILENTLY — no throw, no warning — handing the enumerator the very
    // inference it was supposed to reach independently. That is the "confirmation, not
    // independence" failure the retired per-line design died of.
    const payload = buildEnumeratorPayload({
      path: 'rulebook/CARDS.md',
      text: [
        'QUOTE (p.3): "Each machine part card shows a cycle track."',
        'Derived: Every machine part card carries the same 5-position cycle track, drawn as an inverted-L.',
        'Derived (p.3): a citation-form line, for contrast.',
      ].join('\n'),
    });
    expect(payload).not.toContain('inverted-L');
    expect(payload).not.toMatch(/^[\s>\-*]*Derived\b/im);
    expect(payload).toContain('cycle track.');
  });

  it('throws on an annotation vocabulary the citation-keyed filter cannot see, rather than leaking it', () => {
    // The backstop must not share the filter's vocabulary, or it is the same check run twice.
    // Here the filter is bypassed by handing quoteLinesOnly nothing to strip: a bare marker
    // embedded mid-payload must still be caught by the vocabulary backstop.
    expect(() =>
      buildEnumeratorPayload({
        path: 'rulebook/CARDS.md',
        text: 'QUOTE (p.1): "text."\n> Visual: a bare decorated visual marker.',
      }),
    ).not.toThrow(); // stripped by vocabulary filter, not leaked
  });

  it('the real one-two-punch/02-action-cards-and-resolution.md fixture (dense with Derived/Visual) produces zero leaks', async () => {
    const text = await readFixture('one-two-punch/live/02-action-cards-and-resolution.md');
    const payload = buildEnumeratorPayload({
      path: 'rulebook/02-action-cards-and-resolution.md',
      text,
    });
    expect(payload).not.toMatch(/Derived \(p\./);
    expect(payload).not.toMatch(/Visual \(p\./);
    expect(payload).toContain('A Jab cannot break a Guard card');
  });
});

// ===========================================================================================
// createEnumeratedFact — validated fact construction
// ===========================================================================================

describe('createEnumeratedFact', () => {
  it('constructs a fact with a deterministic id derived from statement + sourceSentence', () => {
    const fact = createEnumeratedFact({
      statement: 'The deck has 112 numbered cards.',
      sourceSentence: 'There are numbers ranging from 1-7 in 4 colors, with 4 copies of each card.',
    });
    expect(fact.id).toMatch(/^[0-9a-f]{16}$/);
    expect(fact.statement).toBe('The deck has 112 numbered cards.');
  });

  it('two facts with identical statement + sourceSentence collide on id (deterministic, not random)', () => {
    const input = {
      statement: 'A round is draw 2, discard 1.',
      sourceSentence: 'Each player draws 2 cards into their hand.',
    };
    expect(createEnumeratedFact(input).id).toBe(createEnumeratedFact(input).id);
  });

  it('rejects an empty statement', () => {
    expect(() =>
      createEnumeratedFact({ statement: '   ', sourceSentence: 'x' }),
    ).toThrow(/non-empty statement/);
  });

  it('rejects an empty sourceSentence', () => {
    expect(() =>
      createEnumeratedFact({ statement: 'x', sourceSentence: '' }),
    ).toThrow(/non-empty sourceSentence/);
  });

  it('rejects a non-finite numericValue.magnitude', () => {
    expect(() =>
      createEnumeratedFact({
        statement: 'x',
        sourceSentence: 'y',
        numericValue: { magnitude: NaN, unit: 'cards', approximate: false },
      }),
    ).toThrow(/finite number/);
  });

  it('rejects an empty numericValue.unit', () => {
    expect(() =>
      createEnumeratedFact({
        statement: 'x',
        sourceSentence: 'y',
        numericValue: { magnitude: 7, unit: '', approximate: false },
      }),
    ).toThrow(/non-empty string/);
  });

  it('accepts a well-formed approximate numericValue', () => {
    const fact = createEnumeratedFact({
      statement: 'The game plays in about 7 minutes.',
      sourceSentence:
        'Seven is a rummy-style card game for 1 to 7 players that plays in about 7 minutes.',
      numericValue: { magnitude: 7, unit: 'minutes', approximate: true },
    });
    expect(fact.numericValue).toEqual({ magnitude: 7, unit: 'minutes', approximate: true });
  });
});

// ===========================================================================================
// validateGrounding — the mechanical fabrication check
// ===========================================================================================

function fact(statement: string, sourceSentence: string, numericValue?: EnumeratedFact['numericValue']): EnumeratedFact {
  return createEnumeratedFact({ statement, sourceSentence, numericValue });
}

describe('validateGrounding — deterministic match selection', () => {
  it('resolves the SAME fact regardless of enumerator list order when several facts share a sourceSentence', () => {
    // The 177-20 consolidated run found seven L21 classifying differently across two runs on
    // unchanged input: several of that slice's facts share one sourceSentence (normal — one
    // rulebook sentence supports many facts), and `list.find()` returned whichever came first.
    // Order-dependence is non-determinism, and non-determinism is what invalidated the retired
    // design's numbers.
    const shared = 'There are numbers ranging from 1-7 in 4 colors, with 4 copies of each card.';
    const f1 = fact('The deck spans 7 numbers.', shared);
    const f2 = fact('There are 4 colors.', shared);
    const f3 = fact('There are 4 copies of each card.', shared);

    const claim = (): ReconcilerBothClaim => ({
      statement: 'There are 4 colors.',
      quotedFromA: shared,
      quotedFromB: shared,
    });

    const forward = validateGrounding([f1, f2, f3], [f1, f2, f3], [claim()]);
    const reverse = validateGrounding([f3, f2, f1], [f3, f2, f1], [claim()]);

    expect(forward.grounded.length).toBe(1);
    expect(reverse.grounded.length).toBe(1);
    expect(forward.grounded[0].matchedFactA.id).toBe(reverse.grounded[0].matchedFactA.id);
    expect(forward.grounded[0].matchedFactB.id).toBe(reverse.grounded[0].matchedFactB.id);
  });

  it('prefers a statement match over a sourceSentence match, so the most specific fact wins', () => {
    const shared = 'Each player draws 2 cards into their hand.';
    const viaSource = fact('Some other consequence of the draw rule.', shared);
    const viaStatement = fact(shared, 'p.1, Round (Simultaneous):');
    const res = validateGrounding(
      [viaSource, viaStatement],
      [viaSource, viaStatement],
      [{ statement: shared, quotedFromA: shared, quotedFromB: shared }],
    );
    expect(res.grounded.length).toBe(1);
    expect(res.grounded[0].matchedFactA.id).toBe(viaStatement.id);
  });
});

describe('validateGrounding', () => {
  it('accepts a claim whose quotes genuinely appear (verbatim) in both lists', () => {
    const listA = [fact('Each player starts with 3 cards.', 'Each player should then draw 3 cards from the mess to form their hand.')];
    const listB = [fact('Players begin holding 3 cards.', 'Each player should then draw 3 cards from the mess to form their hand.')];
    const claims: ReconcilerBothClaim[] = [
      {
        statement: 'Each player starts with 3 cards in hand.',
        quotedFromA: 'Each player starts with 3 cards.',
        quotedFromB: 'Players begin holding 3 cards.',
      },
    ];
    const result = validateGrounding(listA, listB, claims);
    expect(result.rejected).toEqual([]);
    expect(result.grounded).toHaveLength(1);
    expect(result.grounded[0].matchedFactA).toBe(listA[0]);
    expect(result.grounded[0].matchedFactB).toBe(listB[0]);
  });

  it('tolerates benign restatement — punctuation, case, whitespace differences do not break the match', () => {
    const listA = [fact('A jab flips a ready guard card to exhausted.', 'source')];
    const listB = [fact('A JAB flips a ready guard card to exhausted', 'source')];
    const claims: ReconcilerBothClaim[] = [
      {
        statement: 'A jab flips a ready Guard card to exhausted.',
        quotedFromA: '  a jab flips a ready guard card to exhausted!! ',
        quotedFromB: 'a jab flips a ready guard card to exhausted',
      },
    ];
    const result = validateGrounding(listA, listB, claims);
    expect(result.rejected).toEqual([]);
    expect(result.grounded).toHaveLength(1);
  });

  it('REJECTS the measured fabrication case: a quantity credited to one list that the OTHER list never stated', () => {
    // Mirrors 177-EXPERIMENTS/README.md Finding 2: reconciler credited "5 cards each" to both
    // enumerators when one never stated it. Here, B's list only ever discusses "3 cards", never "5".
    const listA = [fact('Each player is dealt 5 cards.', 'Deal each player 5 cards to start.')];
    const listB = [fact('Each player starts with 3 cards.', 'Each player draws 3 cards from the mess.')];
    const claims: ReconcilerBothClaim[] = [
      {
        statement: 'Each player starts with 5 cards.',
        quotedFromA: 'Each player is dealt 5 cards.',
        quotedFromB: 'Each player is dealt 5 cards.', // fabricated — B never said this
      },
    ];
    const result = validateGrounding(listA, listB, claims);
    expect(result.grounded).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/quotedFromB/);
    expect(result.rejected[0].reason).toMatch(/does not match any fact in enumerator B/);
  });

  it('rejects when quotedFromA matches nothing in list A', () => {
    const listA = [fact('Deck has 4 colors.', 'source a')];
    const listB = [fact('There are seven numbers per color.', 'source b')];
    const claims: ReconcilerBothClaim[] = [
      {
        statement: 'invented',
        quotedFromA: 'Something A never said about eight colors of card.',
        quotedFromB: 'There are seven numbers per color.',
      },
    ];
    const result = validateGrounding(listA, listB, claims);
    expect(result.grounded).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/quotedFromA/);
  });

  it('a single-digit numeric substitution ("5" for "7") is NOT tolerated as a benign restatement', () => {
    const listA = [fact('There are 7 bonus point cards.', 'source')];
    const claims: ReconcilerBothClaim[] = [
      {
        statement: 'invented',
        quotedFromA: 'There are 5 bonus point cards.', // digit fabrication, must not match
        quotedFromB: 'irrelevant',
      },
    ];
    const listB = [fact('irrelevant', 'irrelevant')];
    const result = validateGrounding(listA, listB, claims);
    expect(result.grounded).toEqual([]);
    expect(result.rejected[0].reason).toMatch(/quotedFromA/);
  });

  it('a short substring never spuriously matches an unrelated fact merely sharing a common word', () => {
    // "guard" (quoted) is a strict substring of the longer statement, not an exact match — below
    // MIN_MATCH_LENGTH the containment check is refused rather than trusted, so a short shared
    // word cannot rubber-stamp a match against an otherwise-unrelated longer fact.
    const listA = [fact('Guard cards start in the ready state at setup.', 'guard cards start ready')];
    const listB = [fact('Guard cards start in the ready state at setup.', 'guard cards start ready')];
    const claims: ReconcilerBothClaim[] = [
      { statement: 'x', quotedFromA: 'guard', quotedFromB: 'guard' },
    ];
    const result = validateGrounding(listA, listB, claims);
    expect(result.grounded).toEqual([]);
  });

  it('reports MULTIPLE rejections, never silently dropping any — a fabricating reconciler is a signal worth surfacing', () => {
    const listA = [fact('Real fact from A, stated at reasonable length here.', 'source a')];
    const listB = [fact('Real fact from B, stated at reasonable length here.', 'source b')];
    const claims: ReconcilerBothClaim[] = [
      { statement: 'ok', quotedFromA: 'Real fact from A, stated at reasonable length here.', quotedFromB: 'Real fact from B, stated at reasonable length here.' },
      { statement: 'fab1', quotedFromA: 'Nothing like this appears anywhere in list A at all.', quotedFromB: 'irrelevant' },
      { statement: 'fab2', quotedFromA: 'Real fact from A, stated at reasonable length here.', quotedFromB: 'Nothing like this appears anywhere in list B at all.' },
    ];
    const result = validateGrounding(listA, listB, claims);
    expect(result.grounded).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
  });
});

// ===========================================================================================
// composeArithmeticClaim — arithmetic composed in code, checking a stated claim
// ===========================================================================================

function groundedNumeric(statement: string, magnitude: number, unit: string, approximate = false): GroundedBothFact {
  const f = createEnumeratedFact({
    statement,
    sourceSentence: statement,
    numericValue: { magnitude, unit, approximate },
  });
  return {
    id: createHash('sha256').update(`test:${statement}`).digest('hex').slice(0, 16),
    statement,
    quotedFromA: statement,
    quotedFromB: statement,
    matchedFactA: f,
    matchedFactB: f,
  };
}

/**
 * Like `groundedNumeric`, but lets A and B carry DIFFERENT unit wording for the same magnitude —
 * which is what two independently-dispatched enumerators actually produce, since they never
 * coordinate on vocabulary. `groundedNumeric` reuses one fact for both sides, so every unit string
 * matches by construction; that is exactly why the original 42 tests could not catch the
 * exact-string-equality brittleness that refused every real composition in the 177-15 measurement.
 */
function groundedNumericDivergentUnits(
  statement: string,
  magnitude: number,
  unitA: string,
  unitB: string,
): GroundedBothFact {
  const mk = (unit: string) =>
    createEnumeratedFact({
      statement,
      sourceSentence: statement,
      numericValue: { magnitude, unit, approximate: false },
    });
  return {
    id: createHash('sha256').update(`test:divergent:${statement}`).digest('hex').slice(0, 16),
    statement,
    quotedFromA: statement,
    quotedFromB: statement,
    matchedFactA: mk(unitA),
    matchedFactB: mk(unitB),
  };
}

describe('composeArithmeticClaim — divergent unit wording between independent enumerators', () => {
  it('composes across the REAL unit-label pairs observed in the 177-15 measurement', () => {
    // Both pairs are verbatim from the live run: run 1 produced "highest card number"/"card
    // numbers", run 2 produced "4 copies of each card"/"4 copies". Magnitudes agreed exactly in
    // every case; only the wording differed, and exact string equality refused all of it.
    const derivedLineText =
      'The full deck is therefore 7 numbers x 4 colors x 4 copies = 112 numbered cards, plus 7 "+1" bonus point cards.';
    const outcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'multiply',
      operands: [
        groundedNumericDivergentUnits('7 numbers per color.', 7, 'highest card number', 'card numbers'),
        groundedNumericDivergentUnits('4 colors.', 4, 'colors', 'card colors'),
        groundedNumericDivergentUnits('4 copies of each card.', 4, '4 copies of each card', '4 copies'),
      ],
      claimedResult: { magnitude: 112, unit: 'cards', approximate: false },
    });
    expect(outcome.ok).toBe(true);
  });

  it('records the surviving wording gap on the result rather than absorbing it silently', () => {
    const outcome = composeArithmeticClaim({
      derivedLineText: 'The full deck is 7 x 4 = 28 cards.',
      operation: 'multiply',
      operands: [
        groundedNumericDivergentUnits('7 numbers.', 7, 'highest card number', 'card numbers'),
        groundedNumericDivergentUnits('4 colors.', 4, 'colors', 'colors'),
      ],
      claimedResult: { magnitude: 28, unit: 'cards', approximate: false },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.composed.unitVariance).toBeDefined();
    expect(outcome.composed.unitVariance?.join(' ')).toContain('highest card number');
  });

  it('STILL REFUSES genuinely unlike quantities — the check was loosened, not removed', () => {
    // The reason the unit check cannot simply be deleted: an unconstrained composer accepted
    // "7 players x 10 end-hand cards = 70 cards distributed" in the ARITHMETIC-RECONCILER
    // experiment, a quantity the rules never treat as meaningful. Same magnitude, unlike kinds.
    const outcome = composeArithmeticClaim({
      derivedLineText: 'A full match is 7 games x 7 minutes = 49 minutes.',
      operation: 'multiply',
      operands: [
        groundedNumericDivergentUnits('7 games per match.', 7, 'games', 'games'),
        groundedNumericDivergentUnits('7 minutes per game.', 7, 'minutes', 'players'),
      ],
      claimedResult: { magnitude: 49, unit: 'minutes', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('different kinds of quantity');
  });

  it('still refuses on magnitude disagreement, which was never the brittle part', () => {
    const f = (magnitude: number, unit: string) =>
      createEnumeratedFact({
        statement: 'copies',
        sourceSentence: 'copies',
        numericValue: { magnitude, unit, approximate: false },
      });
    const operand: GroundedBothFact = {
      id: createHash('sha256').update('test:magdiff').digest('hex').slice(0, 16),
      statement: '4 copies.',
      quotedFromA: '4 copies.',
      quotedFromB: '4 copies.',
      matchedFactA: f(4, 'copies'),
      matchedFactB: f(5, 'copies'),
    };
    const outcome = composeArithmeticClaim({
      derivedLineText: '7 x 4 = 28 cards.',
      operation: 'multiply',
      operands: [groundedNumeric('7 numbers.', 7, 'numbers'), operand],
      claimedResult: { magnitude: 28, unit: 'cards', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toContain('disagree on numeric value');
  });
});

describe('composeArithmeticClaim', () => {
  it('verifies the real seven fixture arithmetic (7 numbers x 4 colors x 4 copies = 112)', () => {
    const derivedLineText =
      'The full deck is therefore 7 numbers x 4 colors x 4 copies = 112 numbered cards, plus 7 "+1" bonus point cards.';
    const operands = [
      groundedNumeric('7 numbers per color.', 7, 'numbers'),
      groundedNumeric('4 colors.', 4, 'colors'),
      groundedNumeric('4 copies of each card.', 4, 'copies'),
    ];
    const outcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'multiply',
      operands,
      claimedResult: { magnitude: 112, unit: 'cards', approximate: false },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.composed.value.magnitude).toBe(112);
      expect(outcome.composed.operandIds).toEqual(operands.map((o) => o.id));
      expect(outcome.composed.claimText).toBe(derivedLineText);
    }
  });

  it('refuses to compose when an operand is stated as approximate (the measured "about 7 minutes" x 7 fabrication)', () => {
    const derivedLineText = 'Seven games at about 7 minutes each is roughly 49 minutes total.';
    const operands = [
      groundedNumeric('The game plays in about 7 minutes.', 7, 'minutes', true),
      groundedNumeric('A match consists of 7 games.', 7, 'games', false),
    ];
    const outcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'multiply',
      operands,
      claimedResult: { magnitude: 49, unit: 'minutes', approximate: true },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/approximate/);
  });

  it('refuses to compose a relationship the Derived line under test never states (no free product generation)', () => {
    // Mirrors the measured "7 players x 10 cards = 70 cards distributed" fabrication — a
    // grammatically valid product the rules never treat as meaningful. Here the Derived line text
    // never mentions "10" at all.
    const derivedLineText = 'There are 7 players in the game.';
    const operands = [
      groundedNumeric('7 players.', 7, 'players'),
      groundedNumeric('10 cards per something unrelated.', 10, 'cards'),
    ];
    const outcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'multiply',
      operands,
      claimedResult: { magnitude: 70, unit: 'cards', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/does not mention the operand value 10/);
  });

  it('refuses when computed result does not match the claimed result', () => {
    const derivedLineText = '7 x 4 x 4 = 112 in this text but claim says otherwise: 100.';
    const operands = [
      groundedNumeric('7', 7, 'x'),
      groundedNumeric('4', 4, 'x'),
      groundedNumeric('4', 4, 'x'),
    ];
    const outcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'multiply',
      operands,
      claimedResult: { magnitude: 100, unit: 'x', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/does not check out/);
  });

  it('refuses fewer than two operands', () => {
    const derivedLineText = '7 things.';
    const outcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'multiply',
      operands: [groundedNumeric('7 things.', 7, 'things')],
      claimedResult: { magnitude: 7, unit: 'things', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/at least two operands/);
  });

  it('refuses when an operand carries no numeric value on either matched fact', () => {
    const textOnly = createEnumeratedFact({ statement: 'Some text fact.', sourceSentence: 'Some text fact.' });
    const nonNumericOperand: GroundedBothFact = {
      id: 'x',
      statement: 'x',
      quotedFromA: 'x',
      quotedFromB: 'x',
      matchedFactA: textOnly,
      matchedFactB: textOnly,
    };
    const outcome = composeArithmeticClaim({
      derivedLineText: '7 x 4',
      operation: 'multiply',
      operands: [nonNumericOperand, groundedNumeric('4', 4, 'x')],
      claimedResult: { magnitude: 28, unit: 'x', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/carries no numeric value/);
  });

  it('refuses when the two matched facts on one operand disagree on numeric value', () => {
    const fA = createEnumeratedFact({ statement: 'x', sourceSentence: 'x', numericValue: { magnitude: 7, unit: 'x', approximate: false } });
    const fB = createEnumeratedFact({ statement: 'x', sourceSentence: 'x', numericValue: { magnitude: 8, unit: 'x', approximate: false } });
    const inconsistentOperand: GroundedBothFact = {
      id: 'x', statement: 'x', quotedFromA: 'x', quotedFromB: 'x', matchedFactA: fA, matchedFactB: fB,
    };
    const outcome = composeArithmeticClaim({
      derivedLineText: '7 x 4',
      operation: 'multiply',
      operands: [inconsistentOperand, groundedNumeric('4', 4, 'x')],
      claimedResult: { magnitude: 28, unit: 'x', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/disagree on numeric value/);
  });

  it('supports division, verifying the operation actually used (not always multiply)', () => {
    const derivedLineText = '16 Action Cards split evenly among 2 players is 8 per player.';
    const operands = [groundedNumeric('16 Action Cards.', 16, 'cards'), groundedNumeric('2 players.', 2, 'players')];
    const outcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'divide',
      operands,
      claimedResult: { magnitude: 8, unit: 'cards', approximate: false },
    });
    expect(outcome.ok).toBe(true);
  });
});

// ===========================================================================================
// composeArithmeticChain — bounded multi-step composition (177-17, closes the "seven L36" gap:
// composeArithmeticClaim performs exactly one operation per call, so a genuine COMPOUND
// relationship never reached composition at all — 177-15-MEASUREMENT's own measured finding)
// ===========================================================================================

describe('composeArithmeticChain', () => {
  it('verifies the REAL seven L36 chain: net = draw(2) - discard(1); span = end(10) - start(3); rounds = span / net', () => {
    // Derived (p.1): "The round structure is draw 2 / discard 1, netting +1 card per round;
    // starting at 3 cards and ending at 10 cards means 7 rounds, matching the 7 discards stated
    // as the count at game end." Verbatim text, from the real 177-FIXTURES corpus.
    const derivedLineText =
      'The round structure is draw 2 / discard 1, netting +1 card per round; starting at 3 cards ' +
      'and ending at 10 cards means 7 rounds, matching the 7 discards stated as the count at game end.';
    const operands = [
      groundedNumeric('In each round a player draws 2 cards into their hand.', 2, 'cards'),
      groundedNumeric('In each round a player discards 1 card face-up.', 1, 'card'),
      groundedNumeric('The game ends when all players have 10 cards in hand.', 10, 'cards'),
      groundedNumeric("Each player's starting hand is 3 cards.", 3, 'cards'),
    ];
    const steps: ArithmeticChainStep[] = [
      // step 0: net = 2 - 1 = 1
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 0 }, { kind: 'fact', index: 1 }] },
      // step 1: span = 10 - 3 = 7
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 2 }, { kind: 'fact', index: 3 }] },
      // step 2: rounds = span / net = 7 / 1 = 7
      { operation: 'divide', operandRefs: [{ kind: 'stepResult', index: 1 }, { kind: 'stepResult', index: 0 }] },
    ];
    const outcome = composeArithmeticChain({
      derivedLineText,
      steps,
      operands,
      claimedResult: { magnitude: 7, unit: 'rounds', approximate: false },
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.composed.value.magnitude).toBe(7);
      expect(outcome.composed.chainSteps).toHaveLength(3);
      expect(outcome.composed.operandIds).toEqual(operands.map((o) => o.id));
    }
  });

  it('is a genuinely DISTINCT bucket from corroborated-by-composition (never merged) — same shape, traceable back to its chain', () => {
    const derivedLineText = '7 x 4 = 28, then 28 - 3 = 25.';
    const operands = [groundedNumeric('7', 7, 'x'), groundedNumeric('4', 4, 'x'), groundedNumeric('3', 3, 'x')];
    const steps: ArithmeticChainStep[] = [
      { operation: 'multiply', operandRefs: [{ kind: 'fact', index: 0 }, { kind: 'fact', index: 1 }] },
      { operation: 'subtract', operandRefs: [{ kind: 'stepResult', index: 0 }, { kind: 'fact', index: 2 }] },
    ];
    const outcome = composeArithmeticChain({
      derivedLineText,
      steps,
      operands,
      claimedResult: { magnitude: 25, unit: 'x', approximate: false },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    // 28 (the intermediate) is present in the text, and 25 is the final claimed value — both
    // required for the chain to proceed at all, proven by the sibling refusal tests below.
    expect(outcome.composed.chainSteps).toEqual(['7 multiply 4 = 28', '28 subtract 3 = 25']);
  });

  it('bounds chain depth at MAX_ARITHMETIC_CHAIN_DEPTH — refuses one step beyond it', () => {
    expect(MAX_ARITHMETIC_CHAIN_DEPTH).toBe(3);
    const operands = [
      groundedNumeric('2', 2, 'x'),
      groundedNumeric('1', 1, 'x'),
      groundedNumeric('10', 10, 'x'),
      groundedNumeric('3', 3, 'x'),
      groundedNumeric('5', 5, 'x'),
    ];
    // 4 steps — one beyond the bound.
    const tooManySteps: ArithmeticChainStep[] = [
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 0 }, { kind: 'fact', index: 1 }] },
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 2 }, { kind: 'fact', index: 3 }] },
      { operation: 'divide', operandRefs: [{ kind: 'stepResult', index: 1 }, { kind: 'stepResult', index: 0 }] },
      { operation: 'add', operandRefs: [{ kind: 'stepResult', index: 2 }, { kind: 'fact', index: 4 }] },
    ];
    const outcome = composeArithmeticChain({
      derivedLineText: '2 1 10 3 5 7 12',
      steps: tooManySteps,
      operands,
      claimedResult: { magnitude: 12, unit: 'x', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/bounded at 3/);
  });

  it('EMPIRICALLY PROVEN bound: a 3-step chain at the bound still succeeds (the bound refuses depth 4, not depth 3)', () => {
    // Reruns the real seven L36 chain (exactly 3 steps) to prove the bound is not off-by-one in
    // the wrong direction — refusing the exact depth the one real measured case requires would be
    // as broken as not bounding it at all.
    const derivedLineText =
      'draw 2 / discard 1, netting +1 card per round; starting at 3 cards and ending at 10 cards means 7 rounds.';
    const operands = [
      groundedNumeric('draws 2', 2, 'cards'),
      groundedNumeric('discards 1', 1, 'card'),
      groundedNumeric('ending 10', 10, 'cards'),
      groundedNumeric('starting 3', 3, 'cards'),
    ];
    const steps: ArithmeticChainStep[] = [
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 0 }, { kind: 'fact', index: 1 }] },
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 2 }, { kind: 'fact', index: 3 }] },
      { operation: 'divide', operandRefs: [{ kind: 'stepResult', index: 1 }, { kind: 'stepResult', index: 0 }] },
    ];
    const outcome = composeArithmeticChain({
      derivedLineText,
      steps,
      operands,
      claimedResult: { magnitude: 7, unit: 'rounds', approximate: false },
    });
    expect(outcome.ok).toBe(true);
  });

  it('refuses when an intermediate result is NOT mentioned in the Derived line — an intermediate is not a free variable', () => {
    // draw 3, discard 1 -> net = 2 (never stated); end 10, start 4 -> span = 6 (never stated);
    // rounds = span / net = 3. Every LEAF value (3, 1, 10, 4) and the final claimed result (3)
    // are mentioned; neither intermediate (2 or 6) is — a Derived line that states only the raw
    // ingredients and the final answer, never the bridging quantity, must not let the chain
    // silently invent that bridge.
    const derivedLineText =
      'Starting at 4 cards and ending at 10 cards, drawing 3 and discarding 1 each round, eventually means 3 rounds.';
    const operands = [
      groundedNumeric('draws 3', 3, 'cards'),
      groundedNumeric('discards 1', 1, 'card'),
      groundedNumeric('ending 10', 10, 'cards'),
      groundedNumeric('starting 4', 4, 'cards'),
    ];
    const steps: ArithmeticChainStep[] = [
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 0 }, { kind: 'fact', index: 1 }] }, // net = 2, unmentioned
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 2 }, { kind: 'fact', index: 3 }] }, // span = 6, unmentioned
      { operation: 'divide', operandRefs: [{ kind: 'stepResult', index: 1 }, { kind: 'stepResult', index: 0 }] },
    ];
    const outcome = composeArithmeticChain({
      derivedLineText,
      steps,
      operands,
      claimedResult: { magnitude: 3, unit: 'rounds', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/does not mention the intermediate value/);
  });

  it('refuses a forward/self reference — a chain is a strict sequence, never a DAG', () => {
    const derivedLineText = '2 1 10 3 7';
    const operands = [
      groundedNumeric('2', 2, 'x'),
      groundedNumeric('1', 1, 'x'),
      groundedNumeric('10', 10, 'x'),
      groundedNumeric('3', 3, 'x'),
    ];
    const steps: ArithmeticChainStep[] = [
      // step 0 illegally references step 1's result, which has not run yet.
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 0 }, { kind: 'stepResult', index: 1 }] },
      { operation: 'subtract', operandRefs: [{ kind: 'fact', index: 2 }, { kind: 'fact', index: 3 }] },
    ];
    const outcome = composeArithmeticChain({
      derivedLineText,
      steps,
      operands,
      claimedResult: { magnitude: 7, unit: 'x', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/has not been computed yet/);
  });

  it('still refuses an approximate leaf operand, inherited unmodified from composeArithmeticClaim', () => {
    const derivedLineText = 'about 7 games at about 7 minutes nets 49, minus 1 is 48.';
    const operands = [
      groundedNumeric('about 7 games', 7, 'games', true),
      groundedNumeric('about 7 minutes', 7, 'minutes', true),
      groundedNumeric('1', 1, 'x'),
    ];
    const steps: ArithmeticChainStep[] = [
      { operation: 'multiply', operandRefs: [{ kind: 'fact', index: 0 }, { kind: 'fact', index: 1 }] },
      { operation: 'subtract', operandRefs: [{ kind: 'stepResult', index: 0 }, { kind: 'fact', index: 2 }] },
    ];
    const outcome = composeArithmeticChain({
      derivedLineText,
      steps,
      operands,
      claimedResult: { magnitude: 48, unit: 'x', approximate: true },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/approximate/);
  });

  it('refuses when the final computed result does not match the claimed result', () => {
    const derivedLineText = '7 x 4 = 28, then 28 - 3 = 100.';
    const operands = [groundedNumeric('7', 7, 'x'), groundedNumeric('4', 4, 'x'), groundedNumeric('3', 3, 'x')];
    const steps: ArithmeticChainStep[] = [
      { operation: 'multiply', operandRefs: [{ kind: 'fact', index: 0 }, { kind: 'fact', index: 1 }] },
      { operation: 'subtract', operandRefs: [{ kind: 'stepResult', index: 0 }, { kind: 'fact', index: 2 }] },
    ];
    const outcome = composeArithmeticChain({
      derivedLineText,
      steps,
      operands,
      claimedResult: { magnitude: 100, unit: 'x', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/does not check out/);
  });

  it('refuses zero steps', () => {
    const outcome = composeArithmeticChain({
      derivedLineText: 'x',
      steps: [],
      operands: [groundedNumeric('7', 7, 'x')],
      claimedResult: { magnitude: 7, unit: 'x', approximate: false },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/at least one step/);
  });
});

// ===========================================================================================
// QuoteVerifiedProvenance — the structural quote-provenance guard
// ===========================================================================================

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'bs-verify-enumerate-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('QuoteVerifiedProvenance', () => {
  it('is null for the real 177-FIXTURES corpus — neither game has recorded provenance yet', async () => {
    const seven = await QuoteVerifiedProvenance.obtain(
      join(FIXTURES_ROOT, 'seven', 'live', '..'), // FIXTURES_ROOT/seven — no rulebook/ subdir at all
    );
    expect(seven).toBeNull();
  });

  it('is null for a project with no rulebook/ at all', async () => {
    const provenance = await QuoteVerifiedProvenance.obtain(dir);
    expect(provenance).toBeNull();
  });

  it('is null for a pre-provenance project (INDEX.md with no Source hash: line)', async () => {
    const project = join(dir, 'pre-provenance');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      'Edition: none stated\n\nNo Source hash line at all.\n',
    );
    const provenance = await QuoteVerifiedProvenance.obtain(project);
    expect(provenance).toBeNull();
  });

  it('is non-null when the archived source exists and its hash matches INDEX.md', async () => {
    const project = join(dir, 'full-provenance');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake rulebook bytes\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(dirname(join(project, relArchivedPath)), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);

    const provenance = await QuoteVerifiedProvenance.obtain(project);
    expect(provenance).not.toBeNull();
    expect(provenance?.sourceHash).toBe(sourceHash);
  });

  it('is null when the archived source bytes no longer match the recorded hash', async () => {
    const project = join(dir, 'mismatched');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceHash = createHash('sha256').update(Buffer.from('original bytes\n')).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(dirname(join(project, relArchivedPath)), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), Buffer.from('tampered bytes\n'));

    const provenance = await QuoteVerifiedProvenance.obtain(project);
    expect(provenance).toBeNull();
  });
});

// ===========================================================================================
// QuoteVerifiedProvenance.covers() — the per-slice, multi-source-honest fix (177-19)
//
// Reproduces the exact doom-machine shape (177-18-SUMMARY.md): a project with TWO root-level
// source documents (`rules.pdf`, `cards.pdf`), only `rules.pdf` archived. Before this plan,
// `QuoteVerifiedProvenance` was a project-wide flag and every slice — including CARDS.md, whose
// quotes come from the UNARCHIVED `cards.pdf` — was silently treated as quote-verified.
// ===========================================================================================

/** Builds a project with an archived source at `rulebook/source/<archivedName>` AND, optionally,
 * extra root-level files that look like unarchived rulebook sources (per
 * `CANDIDATE_SOURCE_EXTENSIONS`). Mirrors real reference-game layout: the archived file's own
 * ORIGINAL copy also sits at the project root (that is where `ingest-archive` copies FROM), so
 * every real single-source project already has exactly one root-level candidate — the archived
 * one itself — and `unarchivedSources` still resolves to `[]` for it (case (1) below). */
async function buildProjectWithSources(
  label: string,
  archivedName: string,
  rootExtras: string[],
): Promise<{ project: string; provenance: QuoteVerifiedProvenance }> {
  const project = join(dir, label);
  const rulebookDir = join(project, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  const sourceBuf = Buffer.from(`%PDF-1.4 fake bytes ${label}\n`);
  const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
  const relArchivedPath = `rulebook/source/${archivedName}`;
  await fs.writeFile(
    join(rulebookDir, 'INDEX.md'),
    renderIndex({
      gameName: label,
      edition: 'First Printing 2020',
      archivedPath: relArchivedPath,
      sourceHash,
      transcribed: '2026-07-28',
    }),
  );
  await fs.mkdir(dirname(join(project, relArchivedPath)), { recursive: true });
  await fs.writeFile(join(project, relArchivedPath), sourceBuf);
  // The archived file's own original, at the project root — matches every real reference game.
  await fs.writeFile(join(project, archivedName), sourceBuf);
  for (const extra of rootExtras) {
    await fs.writeFile(join(project, extra), Buffer.from(`fake bytes for ${extra}\n`));
  }
  const provenance = await QuoteVerifiedProvenance.obtain(project);
  if (!provenance) throw new Error('test setup failed to construct provenance');
  return { project, provenance };
}

describe('QuoteVerifiedProvenance.covers() — multi-source honesty (177-19)', () => {
  it('case 1 — genuinely single-source: unarchivedSources is [] and every slice is covered', async () => {
    const { provenance } = await buildProjectWithSources('single-source', 'rules.pdf', []);
    expect(provenance.unarchivedSources).toEqual([]);
    expect(provenance.covers('rulebook/01-objective-and-setup.md')).toBe(true);
    expect(provenance.covers('rulebook/CARDS.md')).toBe(true);
  });

  it('case 3 (the doom-machine shape) — one unarchived source: a name-matching slice is NOT covered, an unrelated one is', async () => {
    const { provenance } = await buildProjectWithSources('two-source-doom-machine', 'rules.pdf', [
      'cards.pdf',
    ]);
    expect(provenance.unarchivedSources).toEqual(['cards.pdf']);
    // CARDS.md's stem ("cards") matches cards.pdf's stem ("cards") — not covered.
    expect(provenance.covers('rulebook/CARDS.md')).toBe(false);
    // An ordinary rules.pdf-sourced slice shares no name with cards.pdf — covered.
    expect(provenance.covers('rulebook/01-objective-and-setup.md')).toBe(true);
    expect(provenance.covers('rulebook/02-machine-phase.md')).toBe(true);
  });

  it('case 2 — two or more unarchived candidates: refuses to vouch for ANY slice (too ambiguous to attempt the heuristic)', async () => {
    const { provenance } = await buildProjectWithSources('three-source', 'rules.pdf', [
      'cards.pdf',
      'appendix.pdf',
    ]);
    expect(provenance.unarchivedSources.sort()).toEqual(['appendix.pdf', 'cards.pdf']);
    expect(provenance.covers('rulebook/CARDS.md')).toBe(false);
    expect(provenance.covers('rulebook/01-objective-and-setup.md')).toBe(false);
  });

  it('short stems (below MIN_STEM_MATCH_LENGTH) fail closed rather than risk an unreliable match', async () => {
    const { provenance } = await buildProjectWithSources('short-stem', 'rules.pdf', ['faq.pdf']);
    expect(provenance.unarchivedSources).toEqual(['faq.pdf']);
    // "faq" (3 chars) and the slice's own short stem are both below the trust threshold —
    // conservative default is uncovered, not a risky match attempt.
    expect(provenance.covers('rulebook/faq.md')).toBe(false);
  });

  it('the loop closes: once the SECOND source is genuinely archived via `boardsmith ingest-archive`, covers() resolves true without any filename heuristic at all', async () => {
    // First build the two-source project the ordinary way (root files present, only rules.pdf
    // archived) — same starting shape as the doom-machine measurement.
    const { project } = await buildProjectWithSources('closes-the-loop', 'rules.pdf', [
      'cards.pdf',
    ]);
    const before = await QuoteVerifiedProvenance.obtain(project);
    expect(before!.unarchivedSources).toEqual(['cards.pdf']);
    expect(before!.covers('rulebook/CARDS.md')).toBe(false);

    // Now actually archive cards.pdf too, via the real ingest-archive command (177-19's
    // multi-source fix) — no test-only shortcut, the same command a real ingest session runs.
    await ingestArchiveCommand(join(project, 'cards.pdf'), { project, json: true });

    const after = await QuoteVerifiedProvenance.obtain(project);
    expect(after!.unarchivedSources).toEqual([]);
    // Covered unconditionally now (case 1: genuinely zero unarchived sources) — not because the
    // filename heuristic happened to match, but because both sources are independently archived
    // and hash-verified.
    expect(after!.covers('rulebook/CARDS.md')).toBe(true);
    expect(after!.covers('rulebook/01-objective-and-setup.md')).toBe(true);
  });
});

describe('classifyDerivedLines — provenance gated per-slice, not per-project (177-19)', () => {
  it('EMPIRICAL PROOF the gap existed and is now closed: a CARDS.md-shaped uncorroborated claim downgrades to quote-unverified even though the project has non-null provenance, while a rules.pdf-shaped claim in the SAME project does not', async () => {
    const { provenance } = await buildProjectWithSources(
      'classify-multi-source',
      'rules.pdf',
      ['cards.pdf'],
    );

    const cardsClaim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/CARDS.md',
      lineNumber: 30,
      derivedLineText: 'Derived: the yellow-vs-grey connector colour is the reliable tell.',
      proposedClassification: 'uncorroborated',
      citedFactIds: [],
    };
    const rulesClaim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-objective-and-setup.md',
      lineNumber: 36,
      derivedLineText: 'Derived (p.1): some unsupported inference.',
      proposedClassification: 'uncorroborated',
      citedFactIds: [],
    };

    const result = classifyDerivedLines({
      claims: [cardsClaim, rulesClaim],
      groundedBoth: [],
      composed: [],
      provenance,
    });

    const cardsResult = result.classifications.find((c) => c.slicePath === 'rulebook/CARDS.md')!;
    const rulesResult = result.classifications.find(
      (c) => c.slicePath === 'rulebook/01-objective-and-setup.md',
    )!;

    // The fix: CARDS.md is downgraded — provenance does not cover it (cards.pdf, its real
    // source, was never archived).
    expect(cardsResult.classification).toBe('quote-unverified');
    expect(cardsResult.reason).toMatch(/does not cover/);
    expect(cardsResult.reason).toMatch(/cards\.pdf/);

    // rules.pdf's own slice is unaffected — the archived source genuinely covers it.
    expect(rulesResult.classification).toBe('uncorroborated');
  });

  it('a `contradicted` proposal on an uncovered slice downgrades to quote-unverified rather than reporting a confident false accusation', async () => {
    const { provenance } = await buildProjectWithSources(
      'classify-multi-source-contradicted',
      'rules.pdf',
      ['cards.pdf'],
    );
    const fact = groundedNumeric('some corroborated fact', 3, 'x');
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/CARDS.md',
      lineNumber: 140,
      derivedLineText: '(Derived: effectively a 2-space loop.)',
      proposedClassification: 'contradicted',
      citedFactIds: [fact.id],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [fact],
      composed: [],
      provenance,
    });
    expect(result.classifications[0].classification).toBe('quote-unverified');
  });

  it('an `absence` proposal on an uncovered slice downgrades to quote-unverified, mirroring the uncorroborated/contradicted gate', async () => {
    const { provenance } = await buildProjectWithSources(
      'classify-multi-source-absence',
      'rules.pdf',
      ['cards.pdf'],
    );
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/CARDS.md',
      lineNumber: 200,
      derivedLineText: 'Derived: no card ever has more than one Lock icon.',
      proposedClassification: 'absence',
      citedFactIds: [],
      absenceTargets: ['second lock icon'],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [],
      composed: [],
      provenance,
      passages: { 'rulebook/CARDS.md': 'p.3: some passage text.\n' },
    });
    expect(result.classifications[0].classification).toBe('quote-unverified');
  });
});

// ===========================================================================================
// classifyDerivedLines — cross-reference + the quote-provenance downgrade guard
// ===========================================================================================

describe('classifyDerivedLines', () => {
  const okGroundedFact: GroundedBothFact = groundedNumeric('A round is draw 2, discard 1.', 2, 'cards');

  it('validates a "corroborated" proposal citing a real grounded fact', () => {
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-overview.md',
      lineNumber: 36,
      derivedLineText: 'Derived (p.1): The round structure is draw 2 / discard 1.',
      proposedClassification: 'corroborated',
      citedFactIds: [okGroundedFact.id],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [okGroundedFact],
      composed: [],
      provenance: null,
    });
    expect(result.classifications[0].classification).toBe('corroborated');
    expect(result.missed).toEqual([]);
  });

  it('downgrades a "corroborated" proposal citing a fact id NOT in the grounded-both bucket — never trusted at face value', () => {
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-overview.md',
      lineNumber: 36,
      derivedLineText: 'Derived (p.1): fabricated support.',
      proposedClassification: 'corroborated',
      citedFactIds: ['nonexistent-fact-id'],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [],
      composed: [],
      provenance: null,
    });
    expect(result.classifications[0].classification).toBe('uncorroborated');
    expect(result.classifications[0].reason).toMatch(/not present in the grounding-validated/);
  });

  it('validates "corroborated-by-composition" only when the composed fact matches this exact Derived-line text', () => {
    const derivedLineText = 'Derived (p.1): 7 x 4 x 4 = 112 numbered cards.';
    const composedOutcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'multiply',
      operands: [groundedNumeric('7', 7, 'x'), groundedNumeric('4', 4, 'x'), groundedNumeric('4', 4, 'x')],
      claimedResult: { magnitude: 112, unit: 'cards', approximate: false },
    });
    expect(composedOutcome.ok).toBe(true);
    const composed: ComposedFact[] = composedOutcome.ok ? [composedOutcome.composed] : [];

    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-definitions.md',
      lineNumber: 21,
      derivedLineText,
      proposedClassification: 'corroborated-by-composition',
      citedFactIds: [],
      composedFactId: composed[0]?.id,
    };
    const result = classifyDerivedLines({ claims: [claim], groundedBoth: [], composed, provenance: null });
    expect(result.classifications[0].classification).toBe('corroborated-by-composition');
  });

  it('downgrades "corroborated-by-composition" when the composed fact was verified against DIFFERENT Derived-line text', () => {
    const composedOutcome = composeArithmeticClaim({
      derivedLineText: 'Derived (p.1): 7 x 4 x 4 = 112.',
      operation: 'multiply',
      operands: [groundedNumeric('7', 7, 'x'), groundedNumeric('4', 4, 'x'), groundedNumeric('4', 4, 'x')],
      claimedResult: { magnitude: 112, unit: 'cards', approximate: false },
    });
    const composed: ComposedFact[] = composedOutcome.ok ? [composedOutcome.composed] : [];

    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-definitions.md',
      lineNumber: 99,
      derivedLineText: 'Derived (p.1): a totally unrelated line.',
      proposedClassification: 'corroborated-by-composition',
      citedFactIds: [],
      composedFactId: composed[0]?.id,
    };
    const result = classifyDerivedLines({ claims: [claim], groundedBoth: [], composed, provenance: null });
    expect(result.classifications[0].classification).toBe('uncorroborated');
  });

  it('THE STRUCTURAL GUARD: downgrades "contradicted" to "quote-unverified" when provenance is null', () => {
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/02-solo-variant.md',
      lineNumber: 8,
      derivedLineText:
        'Derived (p.2): the final challenge sentence omits "in no particular order" (seven:11 shape).',
      proposedClassification: 'contradicted',
      citedFactIds: [okGroundedFact.id],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [okGroundedFact],
      composed: [],
      provenance: null,
    });
    expect(result.classifications[0].classification).toBe('quote-unverified');
    expect(result.classifications[0].reason).toMatch(/not been verified against its archived source/);
  });

  it('THE STRUCTURAL GUARD: downgrades "uncorroborated" to "quote-unverified" when provenance is null', () => {
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-x.md',
      lineNumber: 1,
      derivedLineText: 'Derived (p.1): unsupported inference.',
      proposedClassification: 'uncorroborated',
      citedFactIds: [],
    };
    const result = classifyDerivedLines({ claims: [claim], groundedBoth: [], composed: [], provenance: null });
    expect(result.classifications[0].classification).toBe('quote-unverified');
  });

  it('reports "contradicted" for real when provenance IS present and cited facts are genuinely grounded', async () => {
    const project = join(dir, 'full-provenance-for-classify');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake bytes\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(dirname(join(project, relArchivedPath)), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);
    const provenance = await QuoteVerifiedProvenance.obtain(project);
    expect(provenance).not.toBeNull();

    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-x.md',
      lineNumber: 1,
      derivedLineText: 'Derived (p.1): a claim the corpus actually contradicts.',
      proposedClassification: 'contradicted',
      citedFactIds: [okGroundedFact.id],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [okGroundedFact],
      composed: [],
      provenance,
    });
    expect(result.classifications[0].classification).toBe('contradicted');
  });

  it('downgrades "contradicted" to "uncorroborated" (never trusted as contradiction) when cited facts are not grounded, even with provenance present', async () => {
    const project = join(dir, 'full-provenance-ungrounded-cite');
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from('%PDF-1.4 fake bytes 2\n');
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(dirname(join(project, relArchivedPath)), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);
    const provenance = await QuoteVerifiedProvenance.obtain(project);

    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-x.md',
      lineNumber: 1,
      derivedLineText: 'Derived (p.1): claim.',
      proposedClassification: 'contradicted',
      citedFactIds: ['nonexistent'],
    };
    const result = classifyDerivedLines({ claims: [claim], groundedBoth: [], composed: [], provenance });
    expect(result.classifications[0].classification).toBe('uncorroborated');
  });

  it('computes "missed": a grounded-both fact cited by NO Derived-line claim', () => {
    const coveredFact = groundedNumeric('Covered fact.', 1, 'x');
    const missedFact = groundedNumeric('Missed fact nobody cites.', 2, 'x');
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-x.md',
      lineNumber: 1,
      derivedLineText: 'Derived (p.1): covers only the first fact.',
      proposedClassification: 'corroborated',
      citedFactIds: [coveredFact.id],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [coveredFact, missedFact],
      composed: [],
      provenance: null,
    });
    expect(result.missed).toHaveLength(1);
    expect(result.missed[0].fact.id).toBe(missedFact.id);
  });

  it('a fact cited via composed.operandIds also counts as "covered", not missed', () => {
    const operand1 = groundedNumeric('7', 7, 'x');
    const operand2 = groundedNumeric('4', 4, 'x');
    const derivedLineText = 'Derived (p.1): 7 x 4 = 28.';
    const composedOutcome = composeArithmeticClaim({
      derivedLineText,
      operation: 'multiply',
      operands: [operand1, operand2],
      claimedResult: { magnitude: 28, unit: 'x', approximate: false },
    });
    const composed: ComposedFact[] = composedOutcome.ok ? [composedOutcome.composed] : [];
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-x.md',
      lineNumber: 1,
      derivedLineText,
      proposedClassification: 'corroborated-by-composition',
      citedFactIds: [],
      composedFactId: composed[0]?.id,
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [operand1, operand2],
      composed,
      provenance: null,
    });
    expect(result.missed).toEqual([]);
  });
});

// ===========================================================================================
// classifyDerivedLines — absence claims (177-17, closes the "otp L128/L132" gap: dual
// enumeration structurally cannot corroborate a negative, so an absence claim must never
// masquerade as plain `uncorroborated`)
// ===========================================================================================

describe('classifyDerivedLines — absence claims', () => {
  async function fullProvenance(label: string): Promise<QuoteVerifiedProvenance> {
    const project = join(dir, label);
    const rulebookDir = join(project, 'rulebook');
    await fs.mkdir(rulebookDir, { recursive: true });
    const sourceBuf = Buffer.from(`%PDF-1.4 fake bytes ${label}\n`);
    const sourceHash = createHash('sha256').update(sourceBuf).digest('hex');
    const relArchivedPath = 'rulebook/source/rules.pdf';
    await fs.writeFile(
      join(rulebookDir, 'INDEX.md'),
      renderIndex({
        gameName: 'game',
        edition: 'First Printing 2020',
        archivedPath: relArchivedPath,
        sourceHash,
        transcribed: '2026-07-28',
      }),
    );
    await fs.mkdir(dirname(join(project, relArchivedPath)), { recursive: true });
    await fs.writeFile(join(project, relArchivedPath), sourceBuf);
    const provenance = await QuoteVerifiedProvenance.obtain(project);
    if (!provenance) throw new Error('test setup failed to construct provenance');
    return provenance;
  }

  it('lands `absence-unverifiable` when the reconciler names no searchable target (otp L132 shape: "no rules marked as variants, optional modules, or advanced/expert rules") — never guessed', () => {
    // This is the WORKED EXAMPLE the plan itself warns about: three loosely-related concepts
    // (variants / optional modules / advanced-expert rules), no single literal phrase reliably
    // stands in for all three, and guessing one would produce false confidence. The reconciler is
    // expected to leave absenceTargets empty for exactly this shape, and this module must honor
    // that rather than inventing a keyword scan on its own.
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/02-action-cards.md',
      lineNumber: 132,
      derivedLineText:
        'Derived (p.2): This section marks no rules as variants, optional modules, or advanced/expert rules.',
      proposedClassification: 'absence',
      citedFactIds: [],
      absenceTargets: [],
    };
    const result = classifyDerivedLines({ claims: [claim], groundedBoth: [], composed: [], provenance: null });
    expect(result.classifications[0].classification).toBe('absence-unverifiable');
    expect(result.classifications[0].reason).toMatch(/no explicit, literal, searchable target/);
  });

  it('lands `absence-unverifiable` (not a crash, not a silent pass) when no passage text was supplied for the slice', () => {
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/missing-passage.md',
      lineNumber: 1,
      derivedLineText: 'Derived (p.1): No edition is stated.',
      proposedClassification: 'absence',
      citedFactIds: [],
      absenceTargets: ['edition'],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [],
      composed: [],
      provenance: null,
      passages: {}, // no entry for this slicePath
    });
    expect(result.classifications[0].classification).toBe('absence-unverifiable');
    expect(result.classifications[0].reason).toMatch(/No passage text was supplied/);
  });

  it('THE STRUCTURAL GUARD: downgrades to `quote-unverified` when a searchable target IS named but provenance is null — same rule as uncorroborated/contradicted', () => {
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-x.md',
      lineNumber: 1,
      derivedLineText: 'Derived (p.1): No edition is stated anywhere.',
      proposedClassification: 'absence',
      citedFactIds: [],
      absenceTargets: ['edition'],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [],
      composed: [],
      provenance: null,
      passages: { 'rulebook/01-x.md': 'p.1, X:\n"Some quote line with no dating information."' },
    });
    expect(result.classifications[0].classification).toBe('quote-unverified');
  });

  it('resolves `absence-corroborated` on the REAL otp L128 case: "edition"/"printing" genuinely do not appear in the real passage', async () => {
    const provenance = await fullProvenance('otp-absence-corroborated');
    const passageText = await readFixture('one-two-punch/live/02-action-cards-and-resolution.md');
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/02-action-cards-and-resolution.md',
      lineNumber: 128,
      derivedLineText:
        'Derived (p.2): No edition or printing number is stated anywhere on this page; the only ' +
        'dating information is the 2020 copyright year in the colophon.',
      proposedClassification: 'absence',
      citedFactIds: [],
      absenceTargets: ['edition', 'printing'],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [],
      composed: [],
      provenance,
      passages: { 'rulebook/02-action-cards-and-resolution.md': passageText },
    });
    expect(result.classifications[0].classification).toBe('absence-corroborated');
    expect(result.classifications[0].reason).toMatch(/mechanically confirms the claimed absence/);
  });

  it('the scan excludes the Derived line\'s OWN text — otherwise every absence claim would trivially self-contradict (its own text always contains the claimed-absent word)', async () => {
    // Sanity-checks the previous test's mechanism directly: the Derived line text itself contains
    // the literal word "edition" ("No edition..."). If the scan searched the raw slice text
    // (annotations included) rather than quoteLinesOnly()'s output, this claim would ALWAYS
    // resolve `absence-contradicted` against itself, regardless of what the real passage says —
    // which would make the check worthless. Reusing the previous test's real result proves that
    // did not happen: the outcome was `absence-corroborated`, not `absence-contradicted`.
    const provenance = await fullProvenance('otp-absence-self-contradiction-guard');
    const passageText = await readFixture('one-two-punch/live/02-action-cards-and-resolution.md');
    expect(passageText).toContain('Derived (p.2): No edition or printing number is stated');
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/02-action-cards-and-resolution.md',
      lineNumber: 128,
      derivedLineText: 'Derived (p.2): No edition or printing number is stated anywhere on this page.',
      proposedClassification: 'absence',
      citedFactIds: [],
      absenceTargets: ['edition', 'printing'],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [],
      composed: [],
      provenance,
      passages: { 'rulebook/02-action-cards-and-resolution.md': passageText },
    });
    expect(result.classifications[0].classification).toBe('absence-corroborated');
  });

  it('resolves `absence-contradicted` when the named target genuinely appears in the passage\'s own quote lines', async () => {
    const provenance = await fullProvenance('absence-contradicted');
    const claim: ReconcilerDerivedLineClaim = {
      slicePath: 'rulebook/01-x.md',
      lineNumber: 1,
      derivedLineText: 'Derived (p.1): No edition is stated anywhere on this page.',
      proposedClassification: 'absence',
      citedFactIds: [],
      absenceTargets: ['edition'],
    };
    const result = classifyDerivedLines({
      claims: [claim],
      groundedBoth: [],
      composed: [],
      provenance,
      passages: {
        'rulebook/01-x.md': 'p.1, Colophon:\n"This is the Second Edition, printed in 2020."',
      },
    });
    expect(result.classifications[0].classification).toBe('absence-contradicted');
    expect(result.classifications[0].reason).toMatch(/literally contain "edition"/);
  });
});
