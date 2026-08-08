/**
 * Structural drift-protection test for the `/bs-ingest-rules` skill (INGEST-01..07).
 *
 * `bs/ingest-rules.md` (the lean orchestrator) and its four `bs/ingest/*.md` reference
 * files are plain markdown consumed by an agent session, NOT parsed by any runtime code
 * in this repo. This test pins the exact strings, citations, and cross-file pointers those
 * files depend on so a future reword/reorg fails loudly here instead of being discovered
 * only when a downstream ingest session misbehaves.
 *
 * Authored FIRST (Wave 0 gap in 142-VALIDATION.md), before Plans 02/03 author the four
 * `bs/ingest/*.md` reference files. Most tests below are RED (or ERROR, since the files
 * don't exist yet) until those files land — this is the intended Wave-0-first state.
 * INGEST-02, INGEST-06, and INGEST-07 assert only against `ingest-rules.md` itself and
 * turn (or stay) GREEN once Task 2 of this plan authors that file.
 *
 * Every `read()` call is made INSIDE its `it()` body (never at describe-level) so a
 * missing file fails only that one assertion instead of aborting the whole suite's
 * collection phase — required because several referenced files genuinely don't exist
 * yet in this Wave-0-first state.
 *
 * Mirrors `src/cli/slash-command/bs/templates.test.ts` (Phase 141): same `__dirname`/
 * `read()` helper, same named byte-identical-marker-constant technique, one `describe`
 * per requirement ID.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ shared-reference file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

/**
 * Collapse all runs of whitespace to a single space.
 *
 * Skill text is hand-wrapped Markdown prose, so a canonical phrase like "legality, scoring,
 * or sequencing" legitimately wraps across a line break. Assert on the flattened text when
 * pinning a phrase, so the phrase stays pinned without pinning the line breaks around it —
 * otherwise a harmless re-wrap fails the suite and trains people to loosen the assertion.
 */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * Sketch-level tail-entry marker (em-dash, not hyphen). Byte-identical across
 * state-machine.md, SKETCH.template.md, and any ingest reference file that
 * quotes it (e.g. sketch-derivation.md's 2-3-chunk detail cap explanation).
 */
const SKETCH_LEVEL_MARKER = 'Status: proposed (sketch-level — no CHUNK.md yet)';

/** The `ui:` tag values, exactly as SKETCH.template.md and templates.test.ts pin them. */
const UI_TAG_REGEX = /none *\| *touches *\| *major/;

/** Every path `ingest-rules.md` must cite by exact path (cross-file consistency, INGEST-*). */
const REFERENCED_PATHS = [
  'ingest/transcription.md',
  'ingest/interview-fallback.md',
  'ingest/sketch-derivation.md',
  'ingest/scaffold.md',
  'state-machine.md',
  'templates/SKETCH.template.md',
  'templates/ASSETS.template.md',
  'templates/INDEX.template.md',
] as const;

describe('INGEST-01 — transcription per-section confirmation', () => {
  it('ingest-rules.md references ingest/transcription.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/transcription.md');
  });

  it('transcription.md documents a per-section (not per-page, not bulk) confirmation protocol', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toMatch(/per[- ]section/i);
    expect(transcription).not.toMatch(/per[- ]page confirmation/i);
  });
});

describe('INGEST-02 — synthesis artifact list', () => {
  it('names INDEX.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('INDEX.md');
  });

  it('names variant/edition tagging', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/variant/i);
  });

  it('names component inventory + aspect ratio(s)', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/component inventory/i);
    expect(ingestRules).toMatch(/aspect ratio/i);
  });

  it('names ASSETS.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ASSETS.md');
  });

  it('names the visual identity survey', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/visual identity survey/i);
  });

  it('gives the survey a durable write target consumed by the first UI chunk ask (CR-01)', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('rulebook/00-visual-survey.md');
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('rulebook/00-visual-survey.md');
  });

  it('names player-count / min-max', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/min(?:imum)?\s*\/?\s*max(?:imum)?\s*player/i);
  });
});

describe('INGEST-03 — interview fallback', () => {
  it('ingest-rules.md references ingest/interview-fallback.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/interview-fallback.md');
  });

  it('interview-fallback.md outputs rulebook/ files, not PROJECT.md prose', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('rulebook/');
    expect(interviewFallback).not.toMatch(/Outputs?:?\s*PROJECT\.md/);
  });
});

describe('INGEST-04 — scaffold with compile+serve verification', () => {
  it('ingest-rules.md references ingest/scaffold.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/scaffold.md');
  });

  it('scaffold.md names boardsmith init, tsc --noEmit, and an explicit kill instruction', () => {
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain('boardsmith init');
    expect(scaffold).toContain('tsc --noEmit');
    expect(scaffold).toMatch(/kill/i);
  });
});

describe('INGEST-05 — sketch derivation heuristic', () => {
  it('ingest-rules.md references ingest/sketch-derivation.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/sketch-derivation.md');
  });

  it('sketch-derivation.md contains the byte-identical sketch-level marker', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toContain(SKETCH_LEVEL_MARKER);
  });

  it('sketch-derivation.md contains the ui: none|touches|major tag values', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toMatch(UI_TAG_REGEX);
  });

  it('sketch-derivation.md mandates core-event-loop-first, game-end, and final-acceptance chunks', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toMatch(/core event loop/i);
    expect(sketchDerivation).toMatch(/game-end/i);
    expect(sketchDerivation).toMatch(/final-acceptance/i);
  });
});

describe('INGEST-06 — UI strategy step', () => {
  it('references SKETCH.template.md\'s "## UI Strategy" section by name', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('## UI Strategy');
  });

  it('names both strategy values: custom-from-chunk-1 and autoui-with-cutover', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('custom-from-chunk-1');
    expect(ingestRules).toContain('autoui-with-cutover');
  });
});

describe('INGEST-07 — state detection', () => {
  it('names the re-run guard (existing SKETCH.md)', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('SKETCH.md');
    expect(ingestRules).toMatch(/re-run/i);
  });

  it('names the old-project migration trio: PROJECT.md, STATE.md, HISTORY.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('PROJECT.md');
    expect(ingestRules).toContain('STATE.md');
    expect(ingestRules).toContain('HISTORY.md');
  });
});

/**
 * The subagent structured-summary field names. ingest-rules.md and interview-fallback.md
 * depend on these by name; transcription.md defines them. Pinned here so a rename in one
 * file fails loudly instead of silently desynchronizing the three.
 */
const RETURN_SHAPE_FIELDS = [
  'slicePath',
  'sectionSummary',
  'citedTerms[]',
  'componentMentions[]',
  'visualEvidence[]',
  'variants[]',
  'openGaps[]',
] as const;

describe('SKILLAUTO-01 — milestone-chunk mandates', () => {
  it('sketch-derivation.md instructs setting the milestone flag on the core-loop chunk at sketch time', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toMatch(/milestone/i);
    expect(sketchDerivation).toMatch(/set the milestone flag/i);
  });

  it('sketch-derivation.md instructs setting the milestone flag on the scoring/endgame and final-acceptance anchor chunks', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toContain('Milestone: scoring');
    expect(sketchDerivation).toContain('Milestone: final-acceptance');
    expect(sketchDerivation).toContain('sketch-derivation time');
  });

  it('sketch-derivation.md cites SKETCH.template.md\'s Milestone field by name', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toContain('Milestone');
  });

  it('sketch-derivation.md assigns `none` as the milestone value for non-milestone chunks', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toMatch(/`none`/);
  });
});

describe('v4.9 INGEST-02 — Derived/Visual line-prefix split', () => {
  it('the subagent contract defines the Visual (p. prefix', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('Visual (p.');
  });

  it('the subagent contract defines the Derived (p. prefix', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('Derived (p.');
  });

  it('the subagent contract states the rule-bearing decision test verbatim', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('legality, scoring, or sequencing');
  });

  it('the subagent contract still cites rulebook/00-visual-survey.md (split does not retire the survey slice)', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('rulebook/00-visual-survey.md');
  });

  // Regression: the 170-03 proof run produced ZERO `Visual (p.` lines and misfiled art,
  // layout and typography notes under `Derived (p.` -- twice, across two wording fixes.
  //
  // Root cause was NOT the wording. A controlled probe (dispatching a subagent with the
  // contract delivered verbatim) produced the correct split on the same page that failed
  // twice in situ. The orchestrator was composing its own paraphrase of a ~70-line inline
  // block and dropping the VISUAL bullet in transit. The contract now lives in its own
  // file that the subagent reads directly, so it cannot degrade in transit.
  //
  // These tests pin the indirection, not the prose. A future editor who "simplifies" the
  // pointer back into an inline block reintroduces the exact defect.

  it('the dispatch does NOT inline the contract -- transcription.md carries no line-prefix bullets', () => {
    const transcription = read('ingest/transcription.md');
    // The contract's own section markers must not reappear in the dispatching file.
    expect(transcription).not.toContain('- QUOTE lines:');
    expect(transcription).not.toContain('- DERIVED lines:');
    expect(transcription).not.toContain('Return exactly:');
  });

  it('the dispatch points at the contract file and forbids restating it', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('ingest/transcription-subagent.md');
    expect(transcription).toMatch(/Do not compose, restate, or summarize the transcription contract/);
  });

  it('the contract file tells the subagent to read it in full rather than accept a paraphrase', () => {
    // Markdown prose wraps; collapse whitespace so a canonical phrase stays pinned
    // without pinning the line breaks around it.
    const contract = flat(read('ingest/transcription-subagent.md'));
    expect(contract).toContain('Do not accept a paraphrase of this file in place of the file');
  });

  it('the DERIVED bullet is self-limiting: its own definition carries the rule-bearing qualifier', () => {
    const contract = read('ingest/transcription-subagent.md');
    // Defect 1: DERIVED defined by provenance alone ("anything you condensed or inferred")
    // matches a layout inference exactly, so the reader never reaches the VISUAL rule.
    const derivedSection = flat(
      contract.slice(contract.indexOf('### DERIVED lines'), contract.indexOf('### VISUAL lines')),
    );
    expect(derivedSection).not.toBe('');
    expect(derivedSection).toContain('rule-bearing');
    expect(derivedSection).toContain('legality, scoring, or sequencing');
    expect(derivedSection).toMatch(/not by itself/i);
  });

  it('the visualEvidence[] weave instruction names the Visual (p.N): prefix at its own site', () => {
    const contract = read('ingest/transcription-subagent.md');
    // Defect 2: the weave instruction told the subagent to put visual descriptions in the
    // slice without naming a prefix, so it reached for the one whose definition fit.
    const weaveIdx = contract.indexOf('Weave those diagram/image descriptions');
    expect(weaveIdx).toBeGreaterThan(-1);
    const weaveInstruction = flat(contract.slice(weaveIdx, weaveIdx + 400));
    expect(weaveInstruction).toContain('Visual (p.N):');
    expect(weaveInstruction).toContain('never under `Derived (p.N):`');
  });

  it('the contract forbids the invented ## Visual notes heading the failing runs produced', () => {
    const contract = read('ingest/transcription-subagent.md');
    // Both failing runs invented a `## Visual notes` heading -- a string absent from all
    // skill text -- and wrote `Derived (p.N):` lines under it. The prefix is the marker.
    expect(contract).toContain('Visual notes');
    expect(flat(contract)).toContain('prefix is the marker, not the heading');
  });
});

describe('v4.9 INGEST-03 — openGaps[] return-field transport', () => {
  it('the subagent contract defines openGaps[]', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('openGaps[]');
  });

  it('the subagent contract still contains the Named-but-undefined marker', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('Named-but-undefined');
  });

  it('the Return exactly: enumeration line names openGaps[] in the same statement', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toMatch(/Return exactly:[\s\S]*?openGaps\[\][\s\S]*?\}/);
  });

  it('does not instruct re-reading the slice to collect gaps', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).not.toMatch(/re-read(ing)? the slice[^.]*gap/i);
  });
});

describe('178-01 (CHECK-06/TEST-01) — Example (p.N): worked-example marker (PROC-01 prose pin)', () => {
  it('the subagent contract defines the Example (p. prefix', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toMatch(/Example \(p\./);
  });

  it('the marker is a sibling of Named-but-undefined and Visual, anchored at the worked-examples section', () => {
    const contract = read('ingest/transcription-subagent.md');
    const idx = contract.indexOf('### Worked examples are transcription-critical');
    expect(idx).toBeGreaterThan(-1);
    const afterSection = contract.slice(idx);
    expect(afterSection).toMatch(/### EXAMPLE markers/);
  });

  it("marks the example IN ADDITION TO, never instead of, the quote/Derived/Visual line it illustrates", () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(flat(contract)).toContain('in addition to, never instead of,** the verbatim quoted text');
  });

  it('tolerates a multi-page citation body, same shape as Derived (p.N, continues on p.M):', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('Example (p.14, continues on p.15):');
  });

  it('instructs never resolving a contradiction between a printed example and its accompanying art — transcribe both', () => {
    const contract = read('ingest/transcription-subagent.md');
    const flatContract = flat(contract);
    expect(flatContract).toContain('do not resolve the contradiction and do not pick a side');
    expect(flatContract).toContain('Visual (p.N):');
  });

  it('the contract still defines Named-but-undefined and Visual after the Example section is added', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('Named-but-undefined');
    expect(contract).toContain('Visual (p.');
  });
});

// NOTE (Plan 173-03): these assertions prove the instruction EXISTS in skill text; they do not
// prove a live subagent RECEIVES or FOLLOWS it. The behavioural evidence for VERIFY-07 -- that
// the orchestrator never holds transcribed text -- is the transcript-absence proof in plan
// 173-06, not this file. See ingest.test.ts:352-356's identical caveat for the sibling contract.
describe('transcription-subagent.md — output directory is a dispatch input (VERIFY-07, decision 15)', () => {
  it('the write-instruction section names the assigned output directory, not a hardcoded rulebook/', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('WRITE the transcribed text to `NN-topic.md` in your assigned output directory');
    expect(contract).not.toMatch(/WRITE the transcribed text to `rulebook\//);
  });

  it('slicePath\'s description references the assigned output directory, not a hardcoded rulebook/', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('`slicePath`** — the `NN-topic.md` file you wrote, inside your assigned output directory');
    expect(contract).not.toMatch(/`slicePath`\*\* — the `rulebook\//);
  });

  it('the ## Your inputs block still enumerates exactly three dispatch inputs', () => {
    const contract = read('ingest/transcription-subagent.md');
    const inputsIdx = contract.indexOf('## Your inputs');
    expect(inputsIdx).toBeGreaterThan(-1);
    const nextSectionIdx = contract.indexOf('---', inputsIdx);
    const inputsSection = contract.slice(inputsIdx, nextSectionIdx);
    const bulletCount = (inputsSection.match(/^- \*\*/gm) ?? []).length;
    expect(bulletCount).toBe(3);
    expect(inputsSection).toContain('**Page range**');
    expect(inputsSection).toContain('**Rulebook path**');
    expect(inputsSection).toContain('**Output directory**');
  });

  it('still contains the rulebook/00-visual-survey.md reference verbatim (generalization did not over-reach)', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('rulebook/00-visual-survey.md');
  });

  it('ingest/transcription.md fills Write slices to: with the real on-disk design/rulebook/ path', () => {
    // `Write slices to:` is the ONE place these skills name a project-root-relative path rather
    // than a design-relative one: the transcription subagent has no project context to resolve
    // `rulebook/` against, so it must be handed the path it will actually write to (issue #6).
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('Write slices to: design/rulebook/');
  });

  it('transcription.md names the verify orchestrator as the other caller of this dispatch input', () => {
    const transcription = flat(read('ingest/transcription.md'));
    expect(transcription).toMatch(/verify orchestrator/i);
    expect(transcription).toContain('per-dispatch substitution');
  });

  it('no verify-side fork exists: no file under bs/verify/ restates the transcription contract body', () => {
    // Structural guard, not a comment asking people to be careful. Runs whether or not
    // bs/verify/ exists yet (it does not, until plan 173-04). If plan 173-04 ever adds a file
    // there that pastes in the BS-DISPATCH-V2 contract body instead of pointing at
    // ingest/transcription-subagent.md, this must fail loudly -- a fork here silently
    // reintroduces the copy-drift trap (f73153a3 and its Phase 172 recurrence) at the exact
    // point decision 15 forbids it.
    const verifyDir = join(__dirname, 'verify');
    if (!existsSync(verifyDir)) return;

    // Markers unique to the contract body itself (not merely a mention/citation of it).
    const CONTRACT_BODY_MARKERS = [
      'legality, scoring, or sequencing',
      'Do not accept a paraphrase of this file in place of the file',
    ];

    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) return walk(full);
        return entry.name.endsWith('.md') ? [full] : [];
      });

    for (const filePath of walk(verifyDir)) {
      const text = readFileSync(filePath, 'utf-8');
      for (const marker of CONTRACT_BODY_MARKERS) {
        expect(
          text,
          `${filePath} restates the transcription contract body ("${marker}") instead of ` +
            'pointing at ingest/transcription-subagent.md -- decision 15 forbids a verify-side fork.',
        ).not.toContain(marker);
      }
    }
  });
});

// NOTE (Plan 07): these assertions prove the instruction EXISTS in skill text; they do not
// prove an agent RECEIVES or FOLLOWS it. On 2026-07-27 every one of the blocks below (in
// their pre-Plan-07 form) was green while the real INGEST-01/03/04 run diverged on every
// specified string. The acceptance bar is `boardsmith harness-ingest`, not this file — see
// scripts/ingest-harness/README.md.

describe('v4.9 PROC-01 — synthesis runs via a pre-commit hook, not an instruction', () => {
  // Fourteenth mechanism, and the first the model does not choose. Thirteen instruction-shaped
  // attempts were all skipped on live runs, including this exact command reduced to a single
  // invocation. The bs- build protocol commits at every step, so a hook installed by `init`
  // (which is forced) runs the synthesis automatically. See src/cli/lib/ingest-hook.ts.

  it('scaffold.md documents the hook as an effect, not as a step to perform', () => {
    const scaffold = flat(read('ingest/scaffold.md'));
    expect(scaffold).toMatch(/init` also installs a `pre-commit` hook/);
    expect(scaffold).toMatch(/You do not need to invoke it/);
    expect(scaffold).toMatch(/not as a step to perform/);
  });

  it('Step 3 states synthesis runs itself and keeps the manual escape hatch', () => {
    const ingestRules = flat(read('ingest-rules.md'));
    expect(ingestRules).toMatch(/Synthesis runs itself — you do not need to invoke it/);
    // The manual command must remain documented: a session that never commits before the
    // approval gate still needs a way to run it.
    expect(read('ingest-rules.md')).toContain('npx boardsmith ingest-gaps');
  });
});

describe('v4.9 INGEST-02 — relabel command and shared lexicon', () => {
  it('synthesis is ONE command — relabel is folded into ingest-gaps', () => {
    // Two commands were tried. The archive landed (forced by an init flag) and the gaps sweep
    // landed, but ingest-relabel was simply never invoked — the same way every newly introduced
    // step in this pipeline has been skipped. One command removes the thing that gets forgotten.
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('npx boardsmith ingest-gaps');
    expect(ingestRules).not.toContain('npx boardsmith ingest-relabel');
    const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
    // ingest-gaps must actually call the relabel first, not just document that it does.
    // (The call captures a return value since 2026-07-28 — `ingest-check` needs to know whether
    // anything was relabelled — so this matches the guarded call, not one exact spelling of it.)
    expect(cmd).toMatch(/if \(!options\.skipRelabel\) \{[\s\S]{0,120}?ingestRelabelCommand\(/);
  });

  it('the relabel command changes only the prefix, never the text', () => {
    const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
    expect(flat(cmd)).toMatch(/the prefix changes, which is the marker the contract cares about/);
    // Judgment cases must be reported rather than guessed at.
    expect(flat(cmd)).toMatch(/left alone and reported, not guessed at/);
  });

  it('the presentation lexicon is identical in the command and the checker', () => {
    // Two copies exist because scripts/*.mjs cannot import from src/*.ts without a build step.
    // The relabel command ACTS on the same signal the checker FLAGS, so a divergence would mean
    // the harness fails lines the command refuses to fix, or vice versa.
    const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
    const checker = readFileSync(
      join(__dirname, '../../../../scripts/ingest-harness/check.mjs'),
      'utf-8',
    );
    const extract = (src: string) => {
      // Anchor on the DECLARATION, not the first mention of the name. `indexOf('PRESENTATION_LEXICON')`
      // matched prose too, so a doc comment mentioning the constant above its own declaration
      // silently redirected this extraction at the wrong bracket — which happened for real during
      // 171-01 and was worked around by rewording the comment. A check that fires on correct work
      // gets waived rather than fixed, so the check is fixed here instead.
      const decl = /(?:export\s+)?const\s+PRESENTATION_LEXICON\s*=\s*(?:Object\.freeze\(\s*)?\[/.exec(src);
      if (!decl) throw new Error('PRESENTATION_LEXICON declaration not found');
      const open = decl.index + decl[0].length - 1;
      const close = src.indexOf(']', open);
      return src
        .slice(open + 1, close)
        .split('\n')
        // Both copies carry rationale comments INSIDE the array (why a term was added, and why
        // 'numeral'/'pip'/'card face' were deliberately excluded). Strip them before comparing —
        // the terms must match; the prose explaining them need not.
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
        .split(',')
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
        .sort();
    };
    const fromCmd = extract(cmd);
    const fromChecker = extract(checker);
    expect(fromCmd.length).toBeGreaterThan(5);
    expect(fromCmd).toEqual(fromChecker);
    // Referential terms must stay out of both — they flagged correctly-filed rules.
    for (const banned of ['depicted', 'illustration', 'shown']) {
      expect(fromCmd, `"${banned}" must not be in the lexicon`).not.toContain(banned);
    }
  });
});

describe('v4.9 INGEST-02 — inline transcription path is contract-bound', () => {
  // Observed via stream-json capture: for a 2-page rulebook the orchestrator dispatches a
  // subagent nominally, then reads the PDF itself and writes every slice in the main stream,
  // transcribing from a recalled (superseded) contract with no Visual (p.N): at all.
  // Every rulebook in the ecosystem -- seven, one-two-punch, doom-machine -- is 2 pages, so
  // this was happening on every real run and the fan-out contract reached nothing.
  //
  // Rather than insist on a path the model reliably abandons at that size, the inline path is
  // now explicit AND bound by the same contract. A rule the system reliably breaks protects
  // nothing.

  it('transcription.md defines who transcribes before describing fan-out', () => {
    const transcription = read('ingest/transcription.md');
    const whoIdx = transcription.indexOf('## Who transcribes');
    const fanIdx = transcription.indexOf('## Fan-Out Dispatch');
    expect(whoIdx).toBeGreaterThan(-1);
    expect(fanIdx).toBeGreaterThan(whoIdx);
  });

  it('both paths are bound by the same contract file', () => {
    const transcription = flat(read('ingest/transcription.md'));
    expect(transcription).toMatch(/both are governed by/);
    expect(transcription).toMatch(/Whoever writes a slice file reads that contract first/);
  });

  it('the inline path is permitted only for short rulebooks and still requires the contract', () => {
    const transcription = flat(read('ingest/transcription.md'));
    expect(transcription).toMatch(/1-3 pages/);
    expect(transcription).toMatch(/read `transcription-subagent.md` in full first/);
    expect(transcription).toMatch(/held to the subagent's contract/);
  });

  it('the contract addresses the inline transcriber, not only a dispatched subagent', () => {
    const contract = flat(read('ingest/transcription-subagent.md'));
    expect(contract).toMatch(/or the orchestrator itself transcribing a short/);
    expect(contract).toMatch(/Skip this section if you are the orchestrator transcribing inline/);
  });
});

describe('v4.9 INGEST-02 — BS-DISPATCH-V2 handshake', () => {
  // Root cause, observed directly via stream-json tool-call capture: the orchestrator reads
  // transcription.md, sees the pointer block, and then dispatches a prompt it composed from
  // memory -- reproducing the superseded inline contract that opened "Slice text is made of
  // two visually distinct kinds of line". That wording exists in no file since 724befd7. The
  // composed prompt omits Visual (p.N): entirely, which is why five rewrites of the contract
  // changed nothing: the contract was never what reached the subagent.
  //
  // The token is unguessable from memory, so its presence proves the block was copied. The
  // subagent validates it and rejects a dispatch without it -- detection at the only point in
  // the system positioned to detect it.

  it('the pointer block carries the token', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('BS-DISPATCH-V2');
  });

  it('transcription.md explains why the token cannot be produced from memory', () => {
    const transcription = flat(read('ingest/transcription.md'));
    expect(transcription).toMatch(/subagent validates it/);
    expect(transcription).toMatch(/cannot produce the token from memory/);
  });

  it('the subagent validates the token before transcribing anything', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('BS-DISPATCH-V2');
    expect(flat(contract)).toMatch(/FIRST: validate your dispatch prompt/);
    expect(flat(contract)).toMatch(/DISPATCH REJECTED/);
  });

  it('the subagent is told not to be helpful about a missing token', () => {
    const contract = flat(read('ingest/transcription-subagent.md'));
    // A subagent that infers intent and transcribes anyway defeats the handshake entirely.
    expect(contract).toMatch(/Do not be helpful about a missing token/);
    expect(contract).toMatch(/Write no slice files/);
  });

  it('the rejection message names the two-kinds-of-line signature of a stale prompt', () => {
    const contract = flat(read('ingest/transcription-subagent.md'));
    expect(contract).toMatch(/TWO kinds of slice line/);
  });
});

describe('v4.9 PROC-01 — re-read gates at the long-session handoff', () => {
  // Measured: compliance with Step 3 decays with session length. A 1-turn session performs it
  // correctly; 5 turns partially; 8, 13, and a real designer's session fail almost completely
  // (archive skipped, INDEX.md composed freehand, delegation silently replaced by a direct
  // write). See 170-HARNESS-REPAIR-SUMMARY.md.
  //
  // Six prior fixes all changed text the session reads ONCE, EARLY, then drifts from. These
  // gates instead force a re-read at the moment of use. Removing them removes the only
  // mechanism aimed at the actual variable.

  it('Step 3 opens with a re-read gate naming SKILL.md as an actual file read', () => {
    const ingestRules = read('ingest-rules.md');
    const step3 = flat(
      ingestRules.slice(ingestRules.indexOf('## Step 3: Synthesis'), ingestRules.indexOf('## Step 4:')),
    );
    expect(step3).toMatch(/STOP\. Re-read this step from the file before doing anything in it/);
    expect(step3).toContain('SKILL.md');
    expect(step3).toMatch(/Do not proceed from memory/);
  });

  it('the Step 3 gate states the measured decay rather than generic caution', () => {
    const ingestRules = read('ingest-rules.md');
    const step3 = flat(
      ingestRules.slice(ingestRules.indexOf('## Step 3: Synthesis'), ingestRules.indexOf('## Step 4:')),
    );
    // A gate that reads as boilerplate gets skimmed; the evidence is what earns the re-read.
    expect(step3).toMatch(/one turn/i);
    expect(step3).toMatch(/13-turn|13 turn/);
  });

  it('the subagent return shape carries a nextStep re-read carrier', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('nextStep');
    expect(flat(contract)).toMatch(/BEFORE ANY STEP 3 ACTION/);
    // The carrier exists because returns are the only channel delivering content late and
    // fresh; a reminder in start-of-session text drifts exactly as much as what it protects.
    expect(flat(contract)).toMatch(/arrives in that session late and fresh/);
    expect(contract).toMatch(/openGaps\[\], nextStep \}/);
  });

  it('the orchestrator is told the returns carry nextStep and to act on it', () => {
    const transcription = flat(read('ingest/transcription.md'));
    expect(transcription).toMatch(/Every subagent return carries a `nextStep` field/);
    expect(transcription).toMatch(/Act on it/);
  });

  it('the confirmation loop hands off with its own re-read instruction', () => {
    const transcription = flat(read('ingest/transcription.md'));
    expect(transcription).toMatch(/When the last section is confirmed, do not continue from memory/);
    expect(transcription).toContain('SKILL.md');
    expect(transcription).toMatch(/highest-risk handoff/);
  });
});

describe('v4.9 INGEST-01 — optional rulebook path + archive scheduled in Step 1', () => {
  // Ten mechanisms were tried at Step 3 and none ever executed across ten measured live runs.
  // Step 1's sequence -- init, compile gate, serve-check, kill -- executed correctly in all ten
  // of those same runs. The work was never fragile; its scheduling was. Step 3 sits after Step
  // 2's many-turn confirmation loop, by which point the session works from recall; Step 1 runs
  // while the skill text is still fresh.
  //
  // Moving the archive into Step 1 requires the rulebook path to be known that early, which is
  // what the optional invocation argument provides.

  it('the skill documents an optional rulebook-path argument', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('## Invocation');
    expect(ingestRules).toMatch(/\/bs-ingest-rules \[path-to-rulebook\]/);
  });

  it('a supplied path resolves to absolute before Step 1 cds into the project', () => {
    const ingestRules = flat(read('ingest-rules.md'));
    expect(ingestRules).toMatch(/Resolve it to an \*\*absolute\*\* path immediately, before Step 1 runs/);
    expect(ingestRules).toMatch(/expanding a leading `~`/);
  });

  it('a supplied-but-unreadable path stops rather than falling through to the interview', () => {
    // Silently interviewing a designer whose PDF is on disk is worse than an error: nothing
    // looks wrong until much later.
    const ingestRules = flat(read('ingest-rules.md'));
    expect(ingestRules).toMatch(/STOP and say so, naming the path/);
    expect(ingestRules).toMatch(/Do not fall through to the structured interview/);
  });

  it('Step 2 skips the rulebook question when a path was supplied', () => {
    const ingestRules = flat(read('ingest-rules.md'));
    expect(ingestRules).toMatch(/If a rulebook path was supplied at invocation, skip this question/);
  });

  it('Step 3 fills the existing scaffold rather than creating INDEX.md', () => {
    const ingestRules = flat(read('ingest-rules.md'));
    expect(ingestRules).toMatch(/`rulebook\/INDEX.md` already exists: Step 1 created it/);
    expect(ingestRules).toMatch(/Your job here is to fill those sections, not to create the file/);
  });

  it('create-game forwards a supplied rulebook path', () => {
    const createGame = flat(read('create-game.md'));
    expect(createGame).toMatch(/If they gave a path to a rulebook file/);
    expect(createGame).toMatch(/do not let the path arrive only at Step 2/);
  });
});

describe('v4.9 INGEST-01 — command ownership of the mechanical contract', () => {
  it('the command owns copy, hash and the exact headings so no prose can drift them', () => {
    const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
    expect(cmd).toContain('rulebook/source/');
    expect(cmd).toContain('sha256');
    for (const heading of ['## Open Rules Gaps', '## Slices', '## Term → Slice']) {
      expect(cmd, `command must emit "${heading}"`).toContain(heading);
    }
  });

  it('the superseded synthesis-subagent contract is gone, not left as a second path', () => {
    // Two mechanisms for one job is how a fallback silently becomes the real path.
    expect(existsSync(join(__dirname, 'ingest/synthesis-subagent.md'))).toBe(false);
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).not.toContain('synthesis-subagent');
  });

  it('the archive is a --rulebook flag on the init command line, not a separate step', () => {
    // SUPERSEDED TWICE. First a negative guard (scaffold.md must never mention
    // rulebook/source/, because the path was unknown at Step 1). Then a conditional item 4 of
    // the Verification Sequence. That item was skipped by a session that had just read the file
    // and performed items 1-3 correctly -- its prior that the sequence is three steps beat the
    // file. `boardsmith init <name>` is never skipped, because the session needs it to create
    // the directory, so the archive rides on that invocation instead.
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain('npx boardsmith init <name> --rulebook');
    // And it must NOT have been re-split into its own numbered step.
    expect(scaffold).not.toContain('4. **Archive the source rulebook');
    expect(flat(scaffold)).toMatch(/all three steps have completed/);
  });

  it('scaffold.md states the flag is not optional-when-convenient', () => {
    const scaffold = flat(read('ingest/scaffold.md'));
    expect(scaffold).toMatch(/is part of this command line whenever a rulebook path is known/);
    expect(scaffold).toMatch(/not a separate step and not optional-when-convenient/);
  });

  it('scaffold.md records why a flag survives where a step did not, and forbids re-splitting', () => {
    const scaffold = flat(read('ingest/scaffold.md'));
    expect(scaffold).toMatch(/skipped item 4/);
    expect(scaffold).toMatch(/Do not split this back out into its own step/);
  });

  it('scaffold.md still covers the two legitimate no-path cases', () => {
    const scaffold = flat(read('ingest/scaffold.md'));
    expect(scaffold).toMatch(/interview path writes the header values itself/);
    expect(scaffold).toMatch(/supply a path later at Step 2/);
  });
});

describe('v4.9 INGEST-04 — INDEX.md header block (template fill)', () => {
  it('ingest-rules.md Step 3 cites templates/INDEX.template.md, the same citation form used for ASSETS.template.md', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/templates/INDEX.template.md');
    expect(ingestRules).toContain('${CLAUDE_SKILL_DIR}/../bs-shared/templates/ASSETS.template.md');
  });

  it('ingest-rules.md no longer enumerates the four header labels as prose instructions', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).not.toMatch(/^\s*-\s*`Edition:`/m);
    expect(ingestRules).not.toMatch(/^\s*-\s*`Source hash:`/m);
  });

  it('the command owns the header block, so no prose can drift it', () => {
    // The four labels are emitted by src/cli/commands/ingest-archive.ts and pinned by its own
    // test. Nothing here needs to instruct a session to type them correctly.
    const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
    for (const label of ['Edition:', 'Source:', 'Source hash:', 'Transcribed:']) {
      expect(cmd, `ingest-archive must emit "${label}"`).toContain(label);
    }
    expect(cmd).toContain('not stated in the rulebook');
  });

  it('interview-fallback.md cites templates/INDEX.template.md and contains the same four header labels plus the interview-path not-applicable value', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('templates/INDEX.template.md');
    for (const label of ['Edition:', 'Source:', 'Source hash:', 'Transcribed:']) {
      expect(interviewFallback, `interview-fallback.md must contain "${label}"`).toContain(label);
    }
    expect(interviewFallback).toContain('not applicable — no source rulebook (interview path)');
  });
});

describe('v4.9 INGEST-03 — ## Open Rules Gaps section (template fill)', () => {
  it('the command emits the exact Open Rules Gaps heading and empty token', () => {
    const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
    expect(cmd).toContain('## Open Rules Gaps');
    expect(cmd).toContain('_None._');
  });

  it('INDEX.template.md and the command agree on every heading', () => {
    // The command writes INDEX.md on the rulebook path; the template documents the same shape
    // for the interview path. Two sources for one shape is how they drift apart, so pin them
    // to agree rather than leaving it to review.
    const template = read('templates/INDEX.template.md');
    const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
    for (const heading of ['## Open Rules Gaps', '## Slices', '## Term → Slice']) {
      expect(template, `template must contain "${heading}"`).toContain(heading);
      expect(cmd, `command must contain "${heading}"`).toContain(heading);
    }
    for (const label of ['Edition:', 'Source:', 'Source hash:', 'Transcribed:']) {
      expect(template, `template must contain "${label}"`).toContain(label);
      expect(cmd, `command must contain "${label}"`).toContain(label);
    }
  });

  it('the gaps section is filled by a command that sweeps the slices, not from openGaps[] by hand', () => {
    // openGaps[] remains the transport for the per-section confirmation flow, but the INDEX
    // section is now written by `boardsmith ingest-gaps`, which greps the slice files directly.
    // A live session left the section empty while the slices carried four markers; the content
    // requires no judgment, so it does not belong in skill text.
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('npx boardsmith ingest-gaps');
    expect(flat(ingestRules)).toMatch(/Synthesis runs itself/);
    const cmd = readFileSync(join(__dirname, '../../commands/ingest-archive.ts'), 'utf-8');
    expect(cmd).toContain('Named-but-undefined');
    expect(cmd).toMatch(/NOT deduplicated/i);
  });

  it('interview-fallback.md also emits ## Open Rules Gaps by filling the template, on the same always/_None._ terms', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('## Open Rules Gaps');
    expect(interviewFallback).toContain('templates/INDEX.template.md');
  });
});

describe('return-shape field names — pinned across the file set (WR-07)', () => {
  it('the transcription subagent contract defines every return-shape field', () => {
    // The return shape moved out of transcription.md into the standalone subagent
    // contract when the dispatch became a pointer (see the v4.9 INGEST-02 block).
    const contract = read('ingest/transcription-subagent.md');
    for (const field of RETURN_SHAPE_FIELDS) {
      expect(contract, `transcription-subagent.md must define "${field}"`).toContain(field);
    }
  });

  it('ingest-rules.md consumes the synthesis-facing fields by the same names', () => {
    const ingestRules = read('ingest-rules.md');
    // openGaps[] is deliberately NOT in this list any more. The orchestrator no longer consumes
    // it to build INDEX.md's gaps section — `boardsmith ingest-gaps` sweeps the slice files
    // instead. The field still exists as the per-section transport and is pinned in the
    // transcription contract's own return-shape assertions.
    for (const field of ['citedTerms[]', 'componentMentions[]', 'visualEvidence[]', 'variants[]']) {
      expect(ingestRules, `ingest-rules.md must reference "${field}"`).toContain(field);
    }
  });

  it('openGaps[] is still pinned in the transcription contract even though INDEX no longer reads it', () => {
    const contract = read('ingest/transcription-subagent.md');
    expect(contract).toContain('openGaps[]');
  });

  it('interview-fallback.md produces the same citedTerms[]/componentMentions[] shape by name', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('citedTerms[]');
    expect(interviewFallback).toContain('componentMentions[]');
  });
});

describe('CLI string claims in scaffold.md match the CLI source (WR-07)', () => {
  it('init.ts still emits the already-exists error scaffold.md quotes', () => {
    const initSrc = read('../../commands/init.ts');
    expect(initSrc).toContain('Error: Directory "${name}" already exists');
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain('already exists');
  });

  it('dev.ts still emits the --no-open skip message scaffold.md quotes', () => {
    const devSrc = read('../../commands/dev.ts');
    const skipMessage = 'Skipping auto-open (--no-open): connect a client to claim seat 1 yourself.';
    expect(devSrc).toContain(skipMessage);
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain(skipMessage);
  });

  it('dev.ts still emits the load-bearing ready line scaffold.md waits for verbatim', () => {
    const devSrc = read('../../commands/dev.ts');
    const readyLine = 'Ready! Press Ctrl+C to stop.';
    expect(devSrc).toContain(readyLine);
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain(readyLine);
  });
});

describe('reference-file cross-citations resolve (WR-07)', () => {
  it('transcription.md cites templates/ASSETS.template.md, which exists', () => {
    const transcription = read('ingest/transcription.md');
    expect(transcription).toContain('templates/ASSETS.template.md');
    expect(existsSync(join(__dirname, 'templates/ASSETS.template.md'))).toBe(true);
  });

  it('sketch-derivation.md cites templates/SKETCH.template.md, which exists', () => {
    const sketchDerivation = read('ingest/sketch-derivation.md');
    expect(sketchDerivation).toContain('templates/SKETCH.template.md');
    expect(existsSync(join(__dirname, 'templates/SKETCH.template.md'))).toBe(true);
  });

  it('scaffold.md cites src/cli/lib/project-scaffold.ts, which exists', () => {
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).toContain('src/cli/lib/project-scaffold.ts');
    expect(existsSync(join(__dirname, '../../lib/project-scaffold.ts'))).toBe(true);
  });
});

describe('cross-file consistency — aspects reference (WR-04)', () => {
  it('interview-fallback.md cites aspects/index.md by its resolvable relative path', () => {
    const interviewFallback = read('ingest/interview-fallback.md');
    expect(interviewFallback).toContain('../aspects/index.md');
  });

  it('../aspects/index.md exists on disk (relative to bs/)', () => {
    expect(existsSync(join(__dirname, '../aspects/index.md'))).toBe(true);
  });
});

describe('cross-file consistency — every referenced path resolves on disk', () => {
  it('ingest-rules.md cites every reference path (contains the pointer string)', () => {
    const ingestRules = read('ingest-rules.md');
    for (const path of REFERENCED_PATHS) {
      expect(ingestRules, `ingest-rules.md must cite "${path}"`).toContain(path);
    }
  });

  for (const path of REFERENCED_PATHS) {
    it(`${path} exists on disk`, () => {
      expect(existsSync(join(__dirname, path)), `${path} must exist`).toBe(true);
    });
  }
});

/**
 * Context floor + ceiling at the ingest→build seam (SKILLAUTO-06).
 *
 * Regression: an ingest session wound down at 24% context ("this is a clean resume point,
 * run /clear then /bs-build-chunk") because `ingest-rules.md` carried no context rule at
 * all — the ≥50% floor lived only in `state-machine.md` and `build-chunk.md`, neither of
 * which the ingest orchestrator is required to consult before ending its turn.
 */
describe('context floor + ceiling — ingest-rules.md (SKILLAUTO-06)', () => {
  it('states both numbers: the >=50% wind-down floor and the ~60% ceiling', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toMatch(/50%/);
    expect(ingestRules).toMatch(/60%/);
  });

  it('forbids winding down below the floor on a self-assessed hunch', () => {
    const ingestRules = flat(read('ingest-rules.md'));
    expect(ingestRules).toMatch(/Below 50% used, this session never winds down/i);
    expect(ingestRules).toMatch(/never suggests a `\/clear`/i);
  });

  it('gives an authoritative harness warning precedence over the floor', () => {
    const ingestRules = flat(read('ingest-rules.md'));
    expect(ingestRules).toMatch(/harness.*signals below the floor, obey it immediately/i);
  });

  it('cites state-machine.md rather than restating the full rule', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('Context floor +\nceiling');
  });

  it('treats the ingest→build seam as a continuation seam, not a session terminus', () => {
    const ingestRules = flat(read('ingest-rules.md'));
    expect(ingestRules).toMatch(/continuation seam, not a session terminus/i);
    expect(ingestRules).toMatch(/auto-advance straight into the build in the same session/i);
    // The continuation target is the whole-game run, which dispatches each chunk into its own
    // fresh context — the seam must name the sibling instructions it reads, never re-dispatch.
    expect(ingestRules).toMatch(/bs-build-game\/SKILL\.md/);
    expect(ingestRules).toMatch(/Do not end the turn telling the designer to `\/clear`/i);
  });

  it('state-machine.md names the ingest→build seam and scopes the floor to every bs- session', () => {
    const stateMachine = flat(read('state-machine.md'));
    expect(stateMachine).toMatch(/ingest→build seam is a continuation seam/i);
    expect(stateMachine).toMatch(/govern \*\*every\*\* `bs-` session/i);
  });
});
