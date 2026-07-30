/**
 * Structural drift-protection test for the `/bs-verify-game` skill (VERIFY-01/02/07/08).
 *
 * `bs/verify-game.md` (the lean orchestrator) and its two `bs/verify/*.md` reference files are
 * plain markdown consumed by an agent session, NOT parsed by any runtime code in this repo. This
 * test pins the exact strings, citations, and cross-file pointers those files depend on so a
 * future reword/reorg fails loudly here instead of being discovered only when a downstream verify
 * session misbehaves.
 *
 * NOTE (honesty about what this file proves): these assertions prove the instruction EXISTS in
 * skill text; they do NOT prove a live session receives or follows it. Phase 170 found twelve
 * instruction-shaped mechanisms that were skipped on live runs while every automated check
 * (including tests exactly like this one) stayed green. The acceptance bar for VERIFY-01,
 * VERIFY-07, and VERIFY-08 is the live-session proof owed by plans 173-06 and 173-07, recorded in
 * `173-PROOF.md` — not this file. See `ingest.test.ts:352-356` for the identical caveat on the
 * sibling ingest contract.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

/** Collapse all runs of whitespace to a single space, so a pinned phrase survives hand-wrapping. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Strip HTML/Markdown comment lines before scanning for forbidden vocabulary, so a comment
 * mentioning a forbidden word in passing cannot self-invalidate the absence gate. */
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

const ALL_VERIFY_FILES = [
  'verify-game.md',
  'verify/source-resolution.md',
  'verify/staging-dispatch.md',
  'verify/classification-dispatch.md',
  'verify/classification-subagent.md',
  'verify/adjudication-gate.md',
  'verify/ruling-recheck.md',
  'verify/repair-dispatch.md',
  'verify/derive-recheck.md',
  'verify/derive-compare.md',
];

describe('verify-game.md — entry point shape (VERIFY-01)', () => {
  it('frontmatter names bs-verify-game', () => {
    const skill = read('verify-game.md');
    expect(skill.slice(0, 200)).toContain('name: bs-verify-game');
  });

  it('cites the shared state-machine.md rather than restating it', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/state-machine.md');
  });

  it('cites the Consistency Check by name', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('Consistency Check');
  });

  it('has an Invocation block naming /bs-verify-game with no required arguments', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('## Invocation');
    expect(skill).toContain('/bs-verify-game');
  });

  it('states plainly it never scaffolds a new chunk the BUILD pipeline\'s way, but repair MAY change an existing chunk\'s code (176-04)', () => {
    // Phase 176 made the old "It never runs a build and never edits a chunk's design" claim
    // false: repair (Step 6) MAY change an existing chunk's already-built code. Pin the narrowed,
    // still-true claim instead, and pin the absence of the retired absolute claim.
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(
      /does NOT run the BUILD pipeline's `investigate`\/`redteam`\/`ask`\/`build` steps to scaffold a new chunk/,
    );
    expect(skill).toMatch(/Repair \(Step 6, below\) MAY change an EXISTING stale chunk's already-built code/);
    expect(skill).not.toContain("never edits a chunk's design");
  });

  it('has exactly eight numbered steps, each tagged with a VERIFY or CHECK requirement ID', () => {
    // Steps 5 and 6 (Ruling Re-Check / Repair Dispatch) were added by Phase 176 — the count moved
    // from six to eight. Pinning the exact number is intentional here (unlike the disposition
    // enumeration): a NEW step is a structural addition this test exists to catch, not a
    // free-floating count that drifts on its own.
    const skill = read('verify-game.md');
    const stepHeadings = skill.match(/^## Step \d+:.*$/gm) ?? [];
    expect(stepHeadings.length).toBe(8);
    for (const heading of stepHeadings) {
      expect(heading).toMatch(/VERIFY-0[1-8]|CHECK-0[1-2]/);
    }
  });

  it('has a Reference Files footer', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('## Reference Files');
  });
});

describe('verify-game.md — session lock reuse (decision 12)', () => {
  it('names a verify-shaped lock identity distinct from a chunk slug', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/verify:<run-id>|verify:\d{4}-\d{2}-\d{2}/);
  });

  it('states the timestamp comes from date -u, never fabricated', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('date -u +%Y-%m-%dT%H:%M:%SZ');
  });

  it('states the 24-hour staleness rule and the resume-refresh path', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/24.hour/);
    expect(skill).toMatch(/refresh/i);
  });

  it('states a clean close releases the lock line to exactly none', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/Session Lock:.*none|to exactly `none`/);
  });

  it('cites the shared Session Lock section rather than restating its full grammar', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/\("Session\s*Lock"\)/);
    // The lock section is cited by name, not reproduced from templates/SKETCH.template.md.
    expect(skill).not.toContain('PARSE CONTRACT (TMPL-02)');
  });
});

describe('verify-game.md — negative case: not a bs-built project', () => {
  it('states it stops and names what was missing, rather than offering to build one', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/STOP and say so, naming what was missing/);
    expect(skill).toMatch(/Do not offer to build one/);
  });
});

describe('verify/source-resolution.md — gated adoption flow (decision 1)', () => {
  it('exists and covers all four resolution cases plus the negative case', () => {
    const doc = read('verify/source-resolution.md');
    expect(doc).toContain('Case 1');
    expect(doc).toContain('Case 2');
    expect(doc).toContain('Case 3');
    expect(doc).toContain('Case 4');
    expect(flat(doc)).toMatch(/no candidate|Negative case/i);
  });

  it('requires designer confirmation before ingest-archive runs', () => {
    const doc = flat(read('verify/source-resolution.md'));
    const stopIdx = doc.indexOf('STOP AND ASK the designer once');
    const archiveIdx = doc.indexOf('boardsmith ingest-archive');
    expect(stopIdx).toBeGreaterThan(-1);
    expect(archiveIdx).toBeGreaterThan(stopIdx);
  });

  it('runs ingest-archive with no --edition flag', () => {
    const doc = read('verify/source-resolution.md');
    expect(doc).toMatch(/no `--edition` flag/);
  });

  it('requires an independent Source hash: re-check after adoption, not trusting exit code', () => {
    const doc = flat(read('verify/source-resolution.md'));
    expect(doc).toMatch(/independently re-check `rulebook\/INDEX\.md`/);
    expect(doc).toMatch(/Do not infer that\s*adoption succeeded from `ingest-archive`'s exit code alone|Do not infer/);
  });

  it('forbids using chunk-provenance-status projectProvenanceState for the post-adoption re-check (173-06 live finding)', () => {
    // Live proof 173-06 found `projectProvenanceState` never flips away from "pre-provenance" from
    // ingest-archive alone (only a later chunk-check does) — using it here produces a false STOP
    // on every successful Case-2 adoption. See 173-PROOF.md section 3.
    const doc = flat(read('verify/source-resolution.md'));
    expect(doc).toMatch(/Do NOT use `chunk-provenance-status --json`'s `projectProvenanceState` field/);
  });

  it('treats a hash mismatch as a signal to record and proceed, never to overwrite the archive', () => {
    const doc = flat(read('verify/source-resolution.md'));
    expect(doc).toMatch(/source-changed/);
    expect(doc).toMatch(/Never overwrite the archived file/);
  });

  it('forbids mtime/size heuristics for multiple candidates', () => {
    const doc = flat(read('verify/source-resolution.md'));
    expect(doc).toMatch(/Newest-mtime and largest-file are\s*guesses wearing results' clothing/);
  });

  it('cites the Cold-Resume Parse Contract rather than restating it', () => {
    const doc = read('verify/source-resolution.md');
    expect(doc).toContain('Cold-Resume Parse Contract');
  });
});

describe('verify/staging-dispatch.md — run allocation, resume, dispatch, recording (decisions 9-11)', () => {
  it('invokes all three verify-run-* commands', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('verify-run-init');
    expect(doc).toContain('verify-run-status');
    expect(doc).toContain('verify-run-record');
  });

  it('carries the BS-DISPATCH-V2 token', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('BS-DISPATCH-V2');
  });

  it('fills Write slices to: with the staging directory, not a hardcoded rulebook/', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('Write slices to: {stagingDir}');
    expect(doc).not.toMatch(/Write slices to: rulebook\//);
  });

  it('states the run-id is minted by the command, never composed by the session', () => {
    const doc = flat(read('verify/staging-dispatch.md'));
    expect(doc).toMatch(/run-id is minted BY THE COMMAND/);
  });

  it('forbids inferring resume state from which files exist on disk', () => {
    const doc = flat(read('verify/staging-dispatch.md'));
    expect(doc).toMatch(/Do not decide what is done by looking at which files exist/);
  });

  it('cites the same slice-unit granularity ingest/transcription.md dispatches, without redefining it', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('Unit Granularity');
    expect(doc).toMatch(/ingest\/[\s\S]{0,20}transcription\.md/);
  });

  it('does not compose, restate, or summarize the transcription contract in the dispatch prompt', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain(
      'Do not compose, restate, or\nsummarize the transcription contract in the dispatch prompt.',
    );
  });

  it('records from the subagent-returned slicePath, never by opening the file', () => {
    const doc = flat(read('verify/staging-dispatch.md'));
    expect(doc).toMatch(/it does not open the file to check/);
  });

  it('an Orchestrator Records section states slices are never written or re-read by the orchestrator', () => {
    const doc = read('verify/staging-dispatch.md');
    expect(doc).toContain('Orchestrator Records (never writes slices, never re-reads them)');
  });

  it('states staging is kept and nothing is compared, classified, or promoted at close', () => {
    const doc = flat(read('verify/staging-dispatch.md'));
    expect(doc).toMatch(/Staging is KEPT/);
    expect(doc).toMatch(/no comparison, no\s*classification, and no promotion/);
  });
});

describe('VERIFY-07 structural enforcement — the dispatch is a pointer, not a restatement', () => {
  it('reuses ingest/transcription-subagent.md unchanged, parameterized by output directory', () => {
    const dispatch = read('verify/staging-dispatch.md');
    expect(dispatch).toContain(
      '${CLAUDE_SKILL_DIR}/../bs-shared/ingest/transcription-subagent.md',
    );
  });

  it('no file under bs/verify/ restates the transcription contract body verbatim', () => {
    // Structural guard mirroring the no-fork check plan 173-03 added to ingest.test.ts. If this
    // file ever pastes in the contract body instead of pointing at
    // ingest/transcription-subagent.md, it must fail loudly — a fork here silently reintroduces
    // the copy-drift trap (f73153a3 and its Phase 172 recurrence) at exactly the point decision
    // 15 forbids it.
    const CONTRACT_BODY_MARKERS = [
      'legality, scoring, or sequencing',
      'Do not accept a paraphrase of this file in place of the file',
    ];
    const verifyDir = join(__dirname, 'verify');
    const files = readdirSync(verifyDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => join(verifyDir, e.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      for (const marker of CONTRACT_BODY_MARKERS) {
        expect(text).not.toContain(marker);
      }
    }
  });

  it('verify-game.md names the transcript-absence observable a reviewer can check', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/quoted-rule line/);
    expect(skill).toMatch(/Derived \(p\./);
    expect(skill).toMatch(/Visual \(p\./);
  });
});

describe('Decision 16 — this phase never promotes a staged slice over a live one (structural absence)', () => {
  it('no verify file contains --apply, promote, or cutover (decision 8)', () => {
    const FORBIDDEN = ['--apply', 'promote', 'cutover'];
    for (const relPath of ALL_VERIFY_FILES) {
      const text = stripComments(read(relPath)).toLowerCase();
      for (const word of FORBIDDEN) {
        expect(text).not.toContain(word.toLowerCase());
      }
    }
  });
});

describe('verify-game.md — Step 3 classification routing (VERIFY-03)', () => {
  it('has a Step naming classification, pointing at classification-dispatch.md', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/^## Step \d+: Classification/m);
    expect(skill).toContain(
      '${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-dispatch.md',
    );
  });

  it('deletes the Phase 173 no-classification/no-comparison boundary statements', () => {
    const skill = read('verify-game.md');
    expect(skill).not.toContain('The pass ends here');
    expect(skill).not.toContain('never compares the staged output');
    expect(skill).not.toMatch(/no classification/);
  });

  it('states Close formats, never computes, the verdict report', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/formatting\s*`verify-classify-status --json`|formatted, never computed/);
  });
});

describe('verify-game.md — Step 0 citing without a hardcoded item count (VERIFY-01)', () => {
  // Plan 175-01 added a 5th item to state-machine.md's Consistency Check. Step 0 used to cite
  // "its four items" — that count is now false. Rather than bump the number to five (a
  // self-invalidating claim that falsifies itself on the NEXT addition too), the count was
  // dropped outright. Pin against ANY hardcoded count re-appearing, not just the stale "four".
  it('cites the Consistency Check without restating a hardcoded item count', () => {
    const skill = read('verify-game.md');
    expect(skill).not.toMatch(/restate its (four|five|\d+) items/);
    expect(skill).toMatch(/restate its items/);
  });
});

describe('VERIFY-04/05/06 — Step 4 exists and the Phase 175 boundary statement is gone', () => {
  // 174-05 made this identical class of fix to this identical file for Phase 173's boundary
  // statements, and Phase 170 found (fourteen live runs) that self-contradicting skill text gets
  // half-followed rather than fully ignored. These negatives are what stop the same defect
  // recurring for Phase 175's boundary claim.
  it('has a Step 4 naming the Adjudication Gate and Impact Map, pointing at adjudication-gate.md', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/^## Step 4: Adjudication Gate and Impact Map/m);
    expect(skill).toContain(
      '${CLAUDE_SKILL_DIR}/../bs-shared/verify/adjudication-gate.md',
    );
  });

  it('has a Step 7 naming Close', () => {
    // Renumbered from Step 5 by Phase 176's Step 5 (Ruling Re-Check) and Step 6 (Repair Dispatch)
    // insertions.
    const skill = read('verify-game.md');
    expect(skill).toMatch(/^## Step 7: Close/m);
  });

  it('deletes the now-false Phase 175 no-staleness-marker/no-repair-loop boundary claim', () => {
    const skill = read('verify-game.md');
    expect(skill).not.toContain('flips no staleness marker');
    expect(skill).not.toContain('Phase 175');
    expect(skill).not.toContain('opens no repair loop');
    expect(skill).not.toContain('records verdicts only: it flips');
  });

  it('names all four verify-impact-* commands between the router and its delegate', () => {
    const skill = read('verify-game.md');
    const gate = read('verify/adjudication-gate.md');
    const combined = skill + gate;
    for (const cmd of [
      'verify-impact-gate',
      'verify-impact-adjudicate',
      'verify-impact-apply',
      'verify-impact-status',
    ]) {
      expect(combined).toContain(cmd);
    }
  });

  it('adjudication-gate.md carries the hard-gate discipline and both terminal answers, with no bypass vocabulary', () => {
    const doc = read('verify/adjudication-gate.md');
    expect(doc).toContain('Presenting is not');
    expect(doc).toContain('UNADJUDICATED');
    expect(doc).toContain('formatted, never computed');
    expect(doc).toMatch(/no flag, option, or unattended/);

    const stripped = stripComments(doc);
    for (const forbidden of ['--force', '--yes', '--skip', 'bypass']) {
      expect(stripped.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

describe('classification-subagent.md — the one judgment contract', () => {
  it('carries the BS-CLASSIFY-V1 token and a DISPATCH REJECTED block', () => {
    const doc = read('verify/classification-subagent.md');
    expect(doc).toContain('BS-CLASSIFY-V1');
    expect(doc).toContain('DISPATCH REJECTED');
    expect(doc).toMatch(/Read no slice|Do not read either slice|read either slice/i);
  });

  it('contains all three labels', () => {
    const doc = read('verify/classification-subagent.md');
    expect(doc).toMatch(/\bcosmetic\b/);
    expect(doc).toMatch(/\bsharper\b/);
    expect(doc).toMatch(/\bcontradictory\b/);
  });

  it('states the consequence-vs-wording decision test', () => {
    const doc = flat(read('verify/classification-subagent.md'));
    expect(doc).toMatch(/equivalence of CONSEQUENCE, not similarity of\s*WORDING/);
  });

  it('carries the RETURN field names', () => {
    const doc = read('verify/classification-subagent.md');
    for (const field of ['pairId', 'label', 'evidence', 'quotedPass1', 'quotedPass2', 'lineFindings']) {
      expect(doc).toContain(field);
    }
  });

  it('carries the dual-schema exclusion worked example, quoted from the real fixture', () => {
    const doc = read('verify/classification-subagent.md');
    expect(doc).toContain('Visual (p.N):');
    expect(doc).toContain('Derived (p.N) — diagram description:');
    expect(doc).toContain('Derived (p.N) — art:');
    expect(doc).toContain(
      'Derived (p.1) — diagram description: A layout diagram of the ring showing three dashed-outline areas in a row',
    );
  });

  it('states the scope-limit sentence that it never computes staleness, with no other staleness vocabulary', () => {
    const doc = read('verify/classification-subagent.md');
    expect(doc).toContain('never computes staleness');
    const staleOccurrences = (doc.match(/stale/gi) ?? []).length;
    expect(staleOccurrences).toBe(1);
  });
});

describe('classification-dispatch.md — pointer, not restatement (VERIFY-07)', () => {
  it('points at classification-subagent.md rather than restating its contract', () => {
    const doc = read('verify/classification-dispatch.md');
    expect(doc).toContain(
      '${CLAUDE_SKILL_DIR}/../bs-shared/verify/classification-subagent.md',
    );
  });

  it('carries the BS-CLASSIFY-V1 token in the dispatch block', () => {
    const doc = read('verify/classification-dispatch.md');
    expect(doc).toContain('BS-CLASSIFY-V1');
  });

  it('invokes all three verify-classify-* commands', () => {
    const doc = read('verify/classification-dispatch.md');
    expect(doc).toContain('verify-classify-pairs');
    expect(doc).toContain('verify-classify-status');
    expect(doc).toContain('verify-classify-record');
  });

  it('no file under bs/verify/ other than classification-subagent.md carries its decision-procedure marker', () => {
    // Mirrors the no-fork guard VERIFY-07's earlier test applies to the transcription contract —
    // a fork of the classification contract's own body is exactly the copy-drift trap decision 15
    // (of this phase) forbids.
    const CONTRACT_BODY_MARKER = 'equivalence of CONSEQUENCE, not similarity of';
    const verifyDir = join(__dirname, 'verify');
    const files = readdirSync(verifyDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => join(verifyDir, e.name));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (file.endsWith('classification-subagent.md')) continue;
      const text = flat(readFileSync(file, 'utf-8'));
      expect(text).not.toContain(CONTRACT_BODY_MARKER);
    }
  });
});

describe('SC-4 — no skill file derives staleness in prose', () => {
  it('no verify file states a staleness derivation rule', () => {
    const FORBIDDEN = [/marks stale/i, /→\s*stale/i, /\bis stale\b/i, /\bnot stale\b/i];
    for (const relPath of ALL_VERIFY_FILES) {
      const text = stripComments(read(relPath));
      for (const pattern of FORBIDDEN) {
        expect(text).not.toMatch(pattern);
      }
    }
  });
});

describe('PRESENTATION_EXCLUSION_MARKERS — cross-file lexicon pin (decision 12b)', () => {
  it('every marker declared in verify-classify.ts appears verbatim in classification-subagent.md', () => {
    // Two representations exist for the same lexicon: a regex-source array in code, and its
    // literal prefix forms quoted in skill prose. A divergence here would mean the classifier's
    // code excludes a presentation form the prose never tells the subagent about, or vice versa.
    const src = readFileSync(
      join(__dirname, '../../commands/verify-classify.ts'),
      'utf-8',
    );
    const decl = /(?:export\s+)?const\s+PRESENTATION_EXCLUSION_MARKERS\s*=\s*(?:Object\.freeze\(\s*)?\[/.exec(
      src,
    );
    if (!decl) throw new Error('PRESENTATION_EXCLUSION_MARKERS declaration not found');
    const open = decl.index + decl[0].length - 1;
    const close = src.indexOf(']', open);
    const arrayBody = src.slice(open + 1, close);
    const markers = [...arrayBody.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(markers.length).toBeGreaterThan(0);

    // Each regex-source marker names a literal prefix once its regex escaping is undone — assert
    // that literal prefix appears verbatim in the contract's prose. The source string itself
    // carries doubled backslashes (a regex-source string embedded in a TS string literal), so
    // every backslash is stripped outright before re-inserting the one non-literal token (`\d+`,
    // which collapses to `N` after backslash-stripping becomes `d+`). 177-CONTEXT.md decision 13
    // widened two markers with an optional `(?: \([^)]+\))?` parenthetical-qualifier group — that
    // group is erased BEFORE the backslash-strip so the widened marker still normalizes to the
    // same literal prefix the prose has always contained (the qualifier's presence is the rule;
    // its exact wording is never quoted verbatim in the constant itself).
    const literalPrefixes = markers.map((source) =>
      source
        .replace(/\(\?:[\s\S]*?\)\?/, '')
        .replace(/\\/g, '')
        .replace(/^\^/, '')
        .replace(/d\+/g, 'N'),
    );
    const doc = read('verify/classification-subagent.md');
    for (const literal of literalPrefixes) {
      expect(doc).toContain(literal);
    }
  });

  it('the qualified-parenthetical form named in the prose is itself matched by isPresentationLine (decision 13)', async () => {
    const { isPresentationLine } = await import('../../commands/verify-classify.js');
    const doc = read('verify/classification-subagent.md');
    expect(doc).toContain('Plan phase');
    const line =
      'Derived (p.1) — diagram description (Plan phase): Two boxer cards are shown at top...';
    expect(doc).toContain(line);
    expect(isPresentationLine(line)).toBe(true);
  });
});

describe('derive-recheck.md / derive-compare.md — the two CHECK-04 judgment contracts (177-04)', () => {
  it('derive-recheck.md carries the BS-DERIVE-V1 token and a DISPATCH REJECTED block', () => {
    const doc = read('verify/derive-recheck.md');
    expect(doc).toContain('BS-DERIVE-V1');
    expect(doc).toContain('DISPATCH REJECTED');
  });

  it('derive-compare.md carries the BS-DERIVE-COMPARE-V1 token and a DISPATCH REJECTED block', () => {
    const doc = read('verify/derive-compare.md');
    expect(doc).toContain('BS-DERIVE-COMPARE-V1');
    expect(doc).toContain('DISPATCH REJECTED');
  });

  it('the two tokens are distinct: derive-compare.md never carries BS-DERIVE-V1 as its own token', () => {
    const doc = read('verify/derive-compare.md');
    expect(doc).not.toContain('BS-DERIVE-V1');
  });

  it('derive-recheck.md states the never-given list in one place', () => {
    const doc = flat(read('verify/derive-recheck.md'));
    expect(doc).toMatch(
      /you are NEVER given[\s\S]*?the `Derived` line you are re-deriving/,
    );
    expect(doc).toContain('any OTHER `Derived` line from this slice or any other slice');
    expect(doc).toContain('any `Visual` line at all');
  });

  it('derive-recheck.md\'s RETURN block has no verdict field and no agrees/disagrees as something it returns', () => {
    const doc = read('verify/derive-recheck.md');
    const idx = doc.indexOf('## RETURN a structured object only');
    expect(idx).toBeGreaterThan(-1);
    const returnSection = doc.slice(idx, doc.indexOf('## Scope limit'));
    expect(returnSection).toContain('rederivedValue');
    expect(returnSection).toContain('sourceQuotes');
    // The RETURN OBJECT itself — the fenced code block declaring the shape — must not declare a
    // verdict field or an agrees/disagrees value; explanatory prose stating "there is NO verdict
    // field" is fine and expected (asserted separately below).
    const objectBlock = returnSection.slice(
      returnSection.indexOf('```'),
      returnSection.indexOf('```', returnSection.indexOf('```') + 3) + 3,
    );
    expect(objectBlock).not.toMatch(/\bverdict\b/);
    expect(objectBlock).not.toMatch(/\bagrees\b|\bdisagrees\b/);
    expect(returnSection).toMatch(/NO verdict field/);
  });

  it('derive-recheck.md\'s two worked examples are quoted verbatim from the committed seven fixtures', () => {
    const doc = read('verify/derive-recheck.md');
    const notRuleBearingFixture = readFileSync(
      join(
        __dirname,
        '../../../../.planning/phases/174-verify-classifier/174-FIXTURES/seven/live/02-solo-variant.md',
      ),
      'utf-8',
    );
    const underivableFixture = readFileSync(
      join(
        __dirname,
        '../../../../.planning/phases/174-verify-classifier/174-FIXTURES/seven/live/01-definitions-and-components.md',
      ),
      'utf-8',
    );
    const notRuleBearingLine =
      'Derived (p.2): Page 2 is a wide landscape panel with a solid purple background, white bold sans-serif heading and white body text in a single left-hand column. The right side is empty except for the word "SEVEN" set in white bold italic sans-serif, rotated diagonally (reading upward at roughly 45 degrees). No diagrams or component images appear on this page.';
    const underivableLine =
      'Derived (p.1): The full deck is therefore 7 numbers x 4 colors x 4 copies = 112 numbered cards, plus 7 "+1" bonus point cards.';
    expect(notRuleBearingFixture).toContain(notRuleBearingLine);
    expect(underivableFixture).toContain(underivableLine);
    expect(doc).toContain(notRuleBearingLine);
    expect(doc).toContain(underivableLine);
  });

  it('derive-recheck.md contains no enumerated keyword/trigger-phrase list for not-rule-bearing or underivable', () => {
    // Mirrors the absence-of-source-trap discipline: judge each line on what the quote lines
    // support, not on a fixed vocabulary. A bullet list of trigger words/phrases immediately
    // preceding either outcome's heading would be the same defect class as an absence-phrase list.
    const doc = read('verify/derive-recheck.md');
    expect(doc).not.toMatch(/keywords?:\s*["'`]/i);
    expect(doc).not.toMatch(/trigger[- ]phrases?:/i);
  });

  it('derive-compare.md states the four-verdict pin, matching DERIVE_VERDICTS exactly (cross-file lexicon pin)', async () => {
    const { DERIVE_VERDICTS } = await import('../../commands/verify-derive-recheck.js');
    expect(DERIVE_VERDICTS.length).toBe(4);
    const doc = read('verify/derive-compare.md');
    for (const verdict of DERIVE_VERDICTS) {
      expect(doc).toMatch(new RegExp(`\`${verdict}\``));
    }
  });

  it('derive-compare.md states the never-collapse rule for underivable/not-rule-bearing', () => {
    const doc = flat(read('verify/derive-compare.md'));
    expect(doc).toMatch(
      /underivable.{0,40}not-rule-bearing.{0,400}never be collapsed into.{0,20}agrees.{0,20}disagrees/,
    );
  });

  it('derive-compare.md states it never re-derives and never opens the live slice', () => {
    const doc = read('verify/derive-compare.md');
    expect(doc).toContain('You re-derive nothing yourself');
    expect(doc).toContain('never opens the live slice');
  });

  it('derive-compare.md RETURN section names all four fields and the byte-for-byte requirement for disagrees', () => {
    const doc = read('verify/derive-compare.md');
    const idx = doc.indexOf('## RETURN a structured object only');
    expect(idx).toBeGreaterThan(-1);
    const returnSection = doc.slice(idx, doc.indexOf('## Scope limit'));
    for (const field of ['verdict', 'reasoning', 'originalReading', 'rederivedReading']) {
      expect(returnSection).toContain(field);
    }
    expect(returnSection).toMatch(/byte-for-byte verbatim for a\s*\n?\s*`disagrees` verdict/);
  });

  it('derive-compare.md carries the Context-Economics carve-out sentence citing the quotedPass1/quotedPass2 precedent', () => {
    const doc = flat(read('verify/derive-compare.md'));
    expect(doc).toContain('Context-Economics carve-out');
    expect(doc).toMatch(/quotedPass1.{0,10}quotedPass2/);
    expect(doc).toContain('174-PROOF.md');
  });

  it('both contracts carry a scope-limit sentence', () => {
    const recheck = read('verify/derive-recheck.md');
    const compare = read('verify/derive-compare.md');
    expect(recheck).toContain('## Scope limit');
    expect(compare).toContain('## Scope limit');
  });

  describe('installer leaf probes — real install proves both contracts ship (177-04)', () => {
    let tempDir: string;
    let origCwd: string;
    let skillsRoot: string;

    beforeAll(async () => {
      const { installClaudeCommand } = await import('../../commands/install-claude-command.js');
      origCwd = process.cwd();
      tempDir = mkdtempSync(join(tmpdir(), 'bs-install-derive-'));
      process.chdir(tempDir);
      await installClaudeCommand({ local: true, force: true, skipLink: true });
      skillsRoot = join(tempDir, '.claude', 'skills');
    });

    afterAll(() => {
      process.chdir(origCwd);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('both new contract files land under .claude/skills/bs-shared/verify/', () => {
      expect(existsSync(join(skillsRoot, 'bs-shared', 'verify', 'derive-recheck.md'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'bs-shared', 'verify', 'derive-compare.md'))).toBe(true);
    });

    it('deleting one installed contract file flips the installer to report a partial (not complete) install', async () => {
      const { installClaudeCommand } = await import('../../commands/install-claude-command.js');
      rmSync(join(skillsRoot, 'bs-shared', 'verify', 'derive-recheck.md'), { force: true });
      // A non-force install over a partial tree must NOT short-circuit as "already installed" —
      // it must detect the missing leaf and repopulate it.
      await installClaudeCommand({ local: true, force: false, skipLink: true });
      expect(existsSync(join(skillsRoot, 'bs-shared', 'verify', 'derive-recheck.md'))).toBe(true);
    });
  });
});

describe('CHECK-02 no-fork guard — lens/repair prose sourced from build/*.md at test time (176-04)', () => {
  /** Every `bs/verify/*.md` file, absolute paths. */
  function verifyFiles(): string[] {
    const verifyDir = join(__dirname, 'verify');
    return readdirSync(verifyDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => join(verifyDir, e.name));
  }

  it('no file under bs/verify/ contains a lens-template marker phrase (read from build/audit.md, not re-typed)', () => {
    const audit = flat(read('build/audit.md'));
    // Two stable sentences unique to the fidelity and visibility templates. Read out of the real
    // file's own content (companion assertions below) rather than trusted-blind literals, so a
    // reworded template fails this test loudly instead of silently disarming the guard. Matched
    // against `flat()`-collapsed text on both sides so hand-wrapped line breaks inside the
    // template's own prose can't defeat either the presence or absence check.
    const fidelityMarker = 'you are checking the CODE against the RAW SOURCE';
    const visibilityMarker = 'These raw sources, NOT the Visibility Declaration';
    expect(audit).toContain(fidelityMarker);
    expect(audit).toContain(visibilityMarker);

    const files = verifyFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = flat(readFileSync(file, 'utf-8'));
      expect(text).not.toContain(fidelityMarker);
      expect(text).not.toContain(visibilityMarker);
    }
  });

  it('no file under bs/verify/ restates build/repair.md\'s round-bound sentence or its three triage option labels as its own policy', () => {
    const repair = read('build/repair.md');
    const boundSentence = 'Maximum 3 audit rounds per chunk.';
    const triageLabels = ['Real blocker', 'Defer to a later chunk', 'Auditor was wrong (refuted)'];
    // Companion assertion: fail loudly if build/repair.md itself stops carrying this exact
    // sentence/labels, rather than let the guard below pass vacuously against a moved target.
    expect(repair).toContain(boundSentence);
    for (const label of triageLabels) expect(repair).toContain(label);

    const files = verifyFiles();
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      expect(text).not.toContain(boundSentence);
      // All three triage labels co-occurring in one verify/ file would mean a forked restatement
      // of the round-3 triage script; any single label alone is plausible incidental prose (e.g.
      // "real blocker" used generically), so the fork signal is all three appearing together.
      const allThreePresent = triageLabels.every((label) => text.includes(label));
      expect(allThreePresent).toBe(false);
    }
  });

  it('repair-dispatch.md DOES contain both build/audit.md and build/repair.md delegation paths (positive pin)', () => {
    // A no-fork guard that would also pass if the delegation itself were deleted is worthless —
    // pin that the by-reference pointers actually exist.
    const doc = read('verify/repair-dispatch.md');
    expect(doc).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/build/audit.md');
    expect(doc).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/build/repair.md');
  });

  it('no file under bs/verify/ instructs reading ## Interpretation (decision 11)', () => {
    const NEGATORS = /\b(not|never|forbidden|do not|does not|no)\b/i;
    const files = verifyFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf-8');
      let idx = text.indexOf('## Interpretation');
      while (idx !== -1) {
        const window = text.slice(Math.max(0, idx - 150), idx);
        expect(NEGATORS.test(window)).toBe(true);
        idx = text.indexOf('## Interpretation', idx + 1);
      }
    }
  });
});

describe('verify-game.md — repair/ruling-recheck routing and swept boundary claims (176-04)', () => {
  it('does not contain either retired boundary sentence', () => {
    const skill = read('verify-game.md');
    expect(skill).not.toContain("never edits a chunk's design");
    expect(skill).not.toContain("Performing the repair itself is Phase 176's job");
  });

  it('has a step dispatching verify/repair-dispatch.md and a route to verify/ruling-recheck.md', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/^## Step \d+: Repair Dispatch/m);
    expect(skill).toMatch(/^## Step \d+: Ruling Re-Check/m);
    expect(skill).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/repair-dispatch.md');
    expect(skill).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/ruling-recheck.md');
  });

  it('lists both new routes in Reference Files, in the existing one-line bullet style', () => {
    const skill = read('verify-game.md');
    const refSection = skill.slice(skill.indexOf('## Reference Files'));
    expect(refSection).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/repair-dispatch.md');
    expect(refSection).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/ruling-recheck.md');
  });

  it('step headings are contiguous and 0-indexed with no gap or duplicate', () => {
    const skill = read('verify-game.md');
    const nums = [...skill.matchAll(/^## Step (\d+):/gm)].map((m) => Number(m[1]));
    expect(nums.length).toBeGreaterThan(0);
    expect(nums[0]).toBe(0);
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBe(nums[i - 1] + 1);
    }
  });

  it('does not reintroduce a hardcoded step count or reference-file count', () => {
    const skill = read('verify-game.md');
    expect(skill).not.toMatch(/\b(five|six|seven|eight|nine)[- ]step/i);
    expect(skill).not.toMatch(/\b(five|six|seven|eight|nine)\s+reference\s+files/i);
  });

  it('does not restate a hardcoded repair-gate disposition list; cites the source array instead', () => {
    // 175's own "four items" defect class: an inline three-value (or any-value) enumeration of
    // REPAIR_GATE_DISPOSITIONS would go stale the next time that array gains or loses a member.
    const skill = read('verify-game.md');
    expect(skill).not.toMatch(
      /\(`reopen-playtest`,\s*`close-without-replaytest`,\s*or\s*`unknown-drift`\)/,
    );
    expect(skill).toMatch(/REPAIR_GATE_DISPOSITIONS/);
  });
});
