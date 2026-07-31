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
  'verify/enumerate-facts.md',
  'verify/reconcile-facts.md',
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

  it('has exactly nine numbered steps, each tagged with a VERIFY or CHECK requirement ID', () => {
    // Steps 5 and 6 (Ruling Re-Check / Repair Dispatch) were added by Phase 176 — the count moved
    // from six to eight. Step 7 (Derived-Line Re-Check, CHECK-04) was added by Phase 177 — the
    // count moved from eight to nine. Pinning the exact number is intentional here (unlike the
    // disposition enumeration): a NEW step is a structural addition this test exists to catch, not
    // a free-floating count that drifts on its own.
    const skill = read('verify-game.md');
    const stepHeadings = skill.match(/^## Step \d+:.*$/gm) ?? [];
    expect(stepHeadings.length).toBe(9);
    for (const heading of stepHeadings) {
      expect(heading).toMatch(/VERIFY-0[1-8]|CHECK-0[1-4]/);
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

  it('has a Step 8 naming Close', () => {
    // Renumbered from Step 5 by Phase 176's Step 5 (Ruling Re-Check) and Step 6 (Repair Dispatch)
    // insertions, then from Step 7 to Step 8 by Phase 177's Step 7 (Derived-Line Re-Check)
    // insertion.
    const skill = read('verify-game.md');
    expect(skill).toMatch(/^## Step 8: Close/m);
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
  it('every marker declared in verify-classify.ts appears verbatim in classification-subagent.md', async () => {
    // Two representations exist for the same lexicon: a regex-source array in code, and its
    // literal prefix forms quoted in skill prose. A divergence here would mean the classifier's
    // code excludes a presentation form the prose never tells the subagent about, or vice versa.
    //
    // Read the constant through a real import rather than scraping the source text. A prior
    // source-scrape found the array's closing `]` with `indexOf(']')`, which silently truncated
    // to zero markers the moment a marker contained a `[^:]` character class — the pin passed
    // vacuously instead of failing. Importing is also what the sibling ENUMERATE_TOKEN pin
    // below already does.
    const { PRESENTATION_EXCLUSION_MARKERS } = await import('../../commands/verify-classify.js');
    const markers = [...PRESENTATION_EXCLUSION_MARKERS];
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

describe('enumerate-facts.md / reconcile-facts.md — CHECK-04\'s replacement judgment contracts (177-15)', () => {
  it('enumerate-facts.md carries the BS-ENUMERATE-V1 token and a DISPATCH REJECTED block', () => {
    const doc = read('verify/enumerate-facts.md');
    expect(doc).toContain('BS-ENUMERATE-V1');
    expect(doc).toContain('DISPATCH REJECTED');
  });

  it('reconcile-facts.md carries the BS-RECONCILE-V1 token and a DISPATCH REJECTED block', () => {
    const doc = read('verify/reconcile-facts.md');
    expect(doc).toContain('BS-RECONCILE-V1');
    expect(doc).toContain('DISPATCH REJECTED');
  });

  it('the two tokens are distinct: reconcile-facts.md never carries BS-ENUMERATE-V1 as its own token', () => {
    const doc = read('verify/reconcile-facts.md');
    expect(doc).not.toContain('BS-ENUMERATE-V1');
  });

  it('enumerate-facts.md\'s ENUMERATE_TOKEN pin matches the real exported constant (cross-file lexicon pin)', async () => {
    const { ENUMERATE_TOKEN } = await import('../../commands/verify-enumerate.js');
    expect(ENUMERATE_TOKEN).toBe('BS-ENUMERATE-V1');
    const doc = read('verify/enumerate-facts.md');
    expect(doc).toContain(ENUMERATE_TOKEN);
  });

  it('enumerate-facts.md never sees Derived/Visual/Named-but-undefined lines and never performs arithmetic', () => {
    const doc = flat(read('verify/enumerate-facts.md'));
    expect(doc).toMatch(/any `Derived \(p\.N\):` line from this slice or any other slice/);
    expect(doc).toMatch(/any `Visual \(p\.N\):` line at all/);
    expect(doc).toMatch(/any `Named-but-undefined \(p\.N\):` line at all/);
    expect(doc).toMatch(/Do NOT perform arithmetic/);
    expect(doc).toMatch(/You are an enumerator, not a calculator/);
  });

  it('enumerate-facts.md states the approximate flag is load-bearing, citing the measured false-precision fabrication', () => {
    const doc = flat(read('verify/enumerate-facts.md'));
    expect(doc).toMatch(/approximate.{0,20}flag is load-bearing/);
    expect(doc).toMatch(/about 7 minutes.{0,80}49 minutes/);
  });

  it('enumerate-facts.md RETURN block has no verdict/classification field, only facts', () => {
    const doc = read('verify/enumerate-facts.md');
    const idx = doc.indexOf('## RETURN a structured object only');
    expect(idx).toBeGreaterThan(-1);
    const returnSection = doc.slice(idx, doc.indexOf('## Scope limit'));
    const objectBlock = returnSection.slice(
      returnSection.indexOf('```'),
      returnSection.indexOf('```', returnSection.indexOf('```') + 3) + 3,
    );
    expect(objectBlock).toContain('facts');
    expect(objectBlock).not.toMatch(/\bverdict\b/);
    expect(objectBlock).not.toMatch(/\bclassification\b/);
  });

  it('reconcile-facts.md forbids computing values and requires verbatim per-list quotes for every "both" claim', () => {
    const doc = flat(read('verify/reconcile-facts.md'));
    expect(doc).toMatch(
      /You may never state a numeric value, a composed quantity, or any claim that is not literally\s*present/,
    );
    expect(doc).toMatch(/quotedFromA.{0,20}quotedFromB.{0,200}REQUIRED/);
    expect(doc).toMatch(/validateGrounding.{0,300}mechanically checks/);
  });

  it('reconcile-facts.md cites both measured reconciler fabrications by name ("5 cards each" and invented arithmetic grounding)', () => {
    const doc = flat(read('verify/reconcile-facts.md'));
    expect(doc).toMatch(/5 cards each/);
    expect(doc).toMatch(/invented operand grounding on an unrelated pairing/);
  });

  it('reconcile-facts.md states fabrications are detected and reported, never silently dropped', () => {
    const doc = flat(read('verify/reconcile-facts.md'));
    expect(doc).toMatch(/REJECTED and\s*REPORTED/);
    expect(doc).toMatch(/not silently dropped/);
  });

  it('reconcile-facts.md states it proposes Derived-line coverage and flags arithmetic for CODE, never evaluating it itself', () => {
    const doc = flat(read('verify/reconcile-facts.md'));
    expect(doc).toMatch(/corroborated-by-composition/);
    expect(doc).toMatch(/Flag this line for CODE to verify the arithmetic/);
    expect(doc).toMatch(/never compute or confirm the arithmetic yourself/);
    expect(doc).toMatch(/composeArithmeticClaim/);
  });

  it('reconcile-facts.md cites the quote-provenance guard (seven:11 CORRECTION) without asserting it decides that gate itself', () => {
    const doc = flat(read('verify/reconcile-facts.md'));
    expect(doc).toMatch(/QuoteVerifiedProvenance/);
    expect(doc).toMatch(/quote-unverified/);
    expect(doc).toMatch(/seven:11/);
  });

  it('reconcile-facts.md adds a machine-readable arithmeticSpec, additive to arithmeticNote (177.1-03)', () => {
    const doc = flat(read('verify/reconcile-facts.md'));
    expect(doc).toMatch(/arithmeticSpec/);
    expect(doc).toMatch(/operandStatements/);
    expect(doc).toMatch(/claimedResult/);
    expect(doc).toMatch(/arithmeticSpec.{0,400}never computed by you/);
  });

  it('reconcile-facts.md still carries arithmeticNote (additive, not replaced) alongside arithmeticSpec', () => {
    const doc = read('verify/reconcile-facts.md');
    expect((doc.match(/arithmeticNote/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((doc.match(/arithmeticSpec/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('reconcile-facts.md names MAX_ARITHMETIC_CHAIN_DEPTH by name rather than restating its value unsourced', () => {
    const doc = read('verify/reconcile-facts.md');
    expect(doc).toContain('MAX_ARITHMETIC_CHAIN_DEPTH');
  });

  it('reconcile-facts.md still carries its BS-RECONCILE-V1 token and DISPATCH REJECTED block after the arithmeticSpec addition', () => {
    const doc = read('verify/reconcile-facts.md');
    expect(doc).toContain('BS-RECONCILE-V1');
    expect(doc).toContain('DISPATCH REJECTED');
  });

  it('reconcile-facts.md names every member of the real exported ArithmeticOp union (cross-file lexicon pin)', async () => {
    // ArithmeticOp is not itself exported as a runtime value (it is a type), so this pins the
    // literal string union declared in verify-enumerate.ts against the contract's own prose,
    // rather than importing a type at runtime (which is not possible).
    const src = readFileSync(
      join(__dirname, '..', '..', 'commands', 'verify-enumerate.ts'),
      'utf-8',
    );
    const match = src.match(/export type ArithmeticOp = ([^;]+);/);
    expect(match).not.toBeNull();
    const ops = Array.from(match![1].matchAll(/'([a-z]+)'/g)).map((m) => m[1]);
    expect(ops.length).toBeGreaterThan(0);
    const doc = read('verify/reconcile-facts.md');
    for (const op of ops) {
      expect(doc).toContain(`'${op}'`);
    }
  });

  it('both new contracts carry a scope-limit sentence', () => {
    const enumerate = read('verify/enumerate-facts.md');
    const reconcile = read('verify/reconcile-facts.md');
    expect(enumerate).toContain('## Scope limit');
    expect(reconcile).toContain('## Scope limit');
  });

  it('verify-game.md Step 7 names both contracts by path (177.1-05)', () => {
    const skill = read('verify-game.md');
    const step7 = skill.slice(
      skill.indexOf('## Step 7: Derived-Line Re-Check'),
      skill.indexOf('## Step 8: Close'),
    );
    expect(step7).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/enumerate-facts.md');
    expect(step7).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/reconcile-facts.md');
  });

  it('verify-game.md Step 7 names verify-derive-check --json (177.1-05)', () => {
    const skill = read('verify-game.md');
    const step7 = skill.slice(
      skill.indexOf('## Step 7: Derived-Line Re-Check'),
      skill.indexOf('## Step 8: Close'),
    );
    expect(step7).toContain('boardsmith verify-derive-check --json');
  });

  it('verify-game.md Step 7 names all three pinned model ids (177.1-05)', () => {
    const skill = read('verify-game.md');
    const step7 = skill.slice(
      skill.indexOf('## Step 7: Derived-Line Re-Check'),
      skill.indexOf('## Step 8: Close'),
    );
    expect(step7).toContain('claude-opus-5');
    expect(step7).toContain('claude-haiku-4-5-20251001');
    expect(step7).toContain('claude-sonnet-5');
  });

  it('verify-game.md carve-out names BS-ENUMERATE-V1 and BS-RECONCILE-V1 and states TWO separate observables (177.1-05)', () => {
    const skill = read('verify-game.md');
    const carveOutIdx = skill.indexOf('Context-Economics carve-out for CHECK-04');
    expect(carveOutIdx).toBeGreaterThan(-1);
    const carveOut = skill.slice(carveOutIdx, skill.indexOf('## Step 0:'));
    expect(carveOut).toContain('BS-ENUMERATE-V1');
    expect(carveOut).toContain('BS-RECONCILE-V1');
    expect(carveOut).toContain('TWO separate observables');
  });

  it('ABSENCE gate: verify-game.md contains none of the retired CHECK-04 identifiers, after stripping comments (177.1-05)', () => {
    const skill = stripComments(read('verify-game.md'));
    for (const retired of [
      'BS-DERIVE-V1',
      'BS-DERIVE-COMPARE-V1',
      'buildBlindDerivePayload',
      'factAlignment',
      'verify-derive-recheck',
    ]) {
      expect(skill).not.toContain(retired);
    }
  });

  describe('installer leaf probes — real install proves both contracts ship (177-15)', () => {
    let tempDir: string;
    let origCwd: string;
    let skillsRoot: string;

    beforeAll(async () => {
      const { installClaudeCommand } = await import('../../commands/install-claude-command.js');
      origCwd = process.cwd();
      tempDir = mkdtempSync(join(tmpdir(), 'bs-install-enumerate-'));
      process.chdir(tempDir);
      await installClaudeCommand({ local: true, force: true, skipLink: true });
      skillsRoot = join(tempDir, '.claude', 'skills');
    });

    afterAll(() => {
      process.chdir(origCwd);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('both new contract files land under .claude/skills/bs-shared/verify/', () => {
      expect(existsSync(join(skillsRoot, 'bs-shared', 'verify', 'enumerate-facts.md'))).toBe(true);
      expect(existsSync(join(skillsRoot, 'bs-shared', 'verify', 'reconcile-facts.md'))).toBe(true);
    });

    it('deleting one installed contract file flips the installer to report a partial (not complete) install', async () => {
      const { installClaudeCommand } = await import('../../commands/install-claude-command.js');
      rmSync(join(skillsRoot, 'bs-shared', 'verify', 'enumerate-facts.md'), { force: true });
      await installClaudeCommand({ local: true, force: false, skipLink: true });
      expect(existsSync(join(skillsRoot, 'bs-shared', 'verify', 'enumerate-facts.md'))).toBe(true);
    });

    // ABSENCE PROBE (177.1-07): a real install must never ship the two retired contracts — this
    // is the only executed proof that removing them from the source tree (and from
    // install-claude-command.ts's SHARED_LEAF_PROBES manifest) actually keeps them off a
    // designer's machine, not merely off disk in this repo.
    it('the two retired contracts (derive-recheck.md, derive-compare.md) do NOT land under .claude/skills/bs-shared/verify/', () => {
      expect(existsSync(join(skillsRoot, 'bs-shared', 'verify', 'derive-recheck.md'))).toBe(false);
      expect(existsSync(join(skillsRoot, 'bs-shared', 'verify', 'derive-compare.md'))).toBe(false);
    });
  });
});

describe('verify-game.md — CHECK-04 routing and Reference Files (177.1-05)', () => {
  it('has a Step naming Derived-Line Re-Check, pointing at enumerate-facts.md and reconcile-facts.md', () => {
    const skill = read('verify-game.md');
    expect(skill).toMatch(/^## Step \d+: Derived-Line Re-Check \(CHECK-04\)/m);
    expect(skill).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/enumerate-facts.md');
    expect(skill).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/reconcile-facts.md');
  });

  it('Step 7 names both dispatch tokens, the report command, and the recording command', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain('BS-ENUMERATE-V1');
    expect(skill).toContain('BS-RECONCILE-V1');
    expect(skill).toContain('boardsmith verify-derive-check --json');
    expect(skill).toContain('boardsmith verify-derive-record');
  });

  it('Step 7 names all three pinned model ids (CONTEXT decision 4)', () => {
    const skill = read('verify-game.md');
    const step7 = skill.slice(
      skill.indexOf('## Step 7: Derived-Line Re-Check'),
      skill.indexOf('## Step 8: Close'),
    );
    expect(step7).toContain('claude-opus-5');
    expect(step7).toContain('claude-haiku-4-5-20251001');
    expect(step7).toContain('claude-sonnet-5');
  });

  it('states the check is project-wide and independent of staleness/repair scoping', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/independent of staleness and repair/);
    expect(skill).toMatch(/enumerated PROJECT-WIDE, all of them, never scoped to stale\s*chunks/);
  });

  it('states findings never gate the build', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/NEVER a verdict, and this check must not be used as a build gate/);
  });

  it('lists both new routes in Reference Files, in the existing one-line bullet style', () => {
    const skill = read('verify-game.md');
    const refSection = skill.slice(skill.indexOf('## Reference Files'));
    expect(refSection).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/enumerate-facts.md');
    expect(refSection).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/reconcile-facts.md');
    expect(refSection).not.toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/derive-recheck.md');
    expect(refSection).not.toContain('${CLAUDE_SKILL_DIR}/../bs-shared/verify/derive-compare.md');
  });
});

describe('verify-game.md — Context-Economics carve-out for CHECK-04 (177.1-05)', () => {
  it('still contains the original orchestrator-transcript observable sentence verbatim', () => {
    const skill = read('verify-game.md');
    expect(skill).toContain(
      'The observable a reviewer can check: this skill\'s own transcript\n' +
        'should never contain a quoted-rule line, a `Derived (p.` line, or a `Visual (p.` line',
    );
  });

  it('names the carve-out and names both observables checked separately, re-aimed at the new tokens', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toContain('Context-Economics carve-out for CHECK-04');
    expect(skill).toMatch(
      /enumerator prompt \(`BS-ENUMERATE-V1`\) must contain ZERO `Derived \(p\.`, ZERO `Visual \(p\.`, and ZERO\s*`Named-but-undefined \(p\.` lines/,
    );
    expect(skill).toMatch(
      /reconciler prompt and return \(`BS-RECONCILE-V1`\) are EXPECTED to\s*contain `Derived` line text/,
    );
    expect(skill).toMatch(/TWO separate observables/);
  });

  it('cites the quotedPass1/quotedPass2 precedent and 174-PROOF.md by name', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/quotedPass1.{0,10}quotedPass2/);
    expect(skill).toContain('174-PROOF.md');
  });

  it('never collapses the two-observable check into one blanket grep, per CONTEXT decision 7', () => {
    const skill = flat(read('verify-game.md'));
    expect(skill).toMatch(/never one blanket grep across both/);
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

describe('drift guard — every named boardsmith verify-* command actually exists in cli.ts (177-10, closing CR-05\'s failure mode)', () => {
  // CR-05's defect was skill text prescribing a call pattern (`recordDeriveVerdicts`) with no
  // registered CLI entry point. This guard makes that class of drift impossible to reintroduce
  // silently: every `verify-*` command name named across verify-game.md and bs/verify/*.md must
  // be a real `.command('verify-...')` registration in cli.ts, not a name that only ever existed
  // in prose.
  //
  // Matches a backtick-wrapped token starting with `verify-` (optionally preceded by
  // "boardsmith "), followed by either the closing backtick directly or a space and more content
  // before the closing backtick — deliberately excluding a bare `.ts`/`.md` file-reference suffix
  // (e.g. `verify-derive-check.ts`, `verify-run.ts`), which names a MODULE, not a CLI command.
  const CMD_MENTION_RE = /`(?:boardsmith )?(verify-[a-z][a-z-]*)(?:\s[^`]*)?`/g;

  function registeredCliCommands(): Set<string> {
    const cliSource = readFileSync(
      join(__dirname, '..', '..', 'cli.ts'),
      'utf-8',
    );
    const names = new Set<string>();
    for (const m of cliSource.matchAll(/\.command\('(verify-[a-z-]+)'\)/g)) {
      names.add(m[1]);
    }
    return names;
  }

  function mentionedCommands(text: string): Set<string> {
    const names = new Set<string>();
    for (const m of text.matchAll(CMD_MENTION_RE)) {
      names.add(m[1]);
    }
    return names;
  }

  it('every verify-* command mentioned in verify-game.md and bs/verify/*.md is registered in cli.ts', () => {
    const registered = registeredCliCommands();
    expect(registered.size).toBeGreaterThan(0);

    const unregistered: string[] = [];
    for (const file of ALL_VERIFY_FILES) {
      const mentioned = mentionedCommands(read(file));
      for (const name of mentioned) {
        if (!registered.has(name)) {
          unregistered.push(`${file}: ${name}`);
        }
      }
    }
    expect(unregistered).toEqual([]);
  });

  it('the guard is a real regression detector: removing verify-derive-record from cli.ts fails this guard (observed, then restored)', () => {
    const registered = registeredCliCommands();
    const withoutDeriveRecord = new Set(registered);
    withoutDeriveRecord.delete('verify-derive-record');

    const mentioned = mentionedCommands(read('verify-game.md'));
    const wouldFail = [...mentioned].some((name) => !withoutDeriveRecord.has(name));
    expect(wouldFail).toBe(true);
    expect(mentioned.has('verify-derive-record')).toBe(true);
  });
});
