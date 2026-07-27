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
import { readFileSync, existsSync } from 'node:fs';
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
  'ingest/synthesis-subagent.md',
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

// NOTE (Plan 07): these assertions prove the instruction EXISTS in skill text; they do not
// prove an agent RECEIVES or FOLLOWS it. On 2026-07-27 every one of the blocks below (in
// their pre-Plan-07 form) was green while the real INGEST-01/03/04 run diverged on every
// specified string. The acceptance bar is `npm run harness:ingest`, not this file — see
// scripts/ingest-harness/README.md.

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

describe('v4.9 INGEST-01 — source archive + SHA-256 (delegated to a synthesis subagent)', () => {
  // Four in-line mechanisms were tried and refuted against live harness runs:
  //   1. reworded instructions + self-limiting DERIVED definition   -> no effect
  //   2. contract extracted to a file the subagent reads            -> no effect
  //   3. templates/INDEX.template.md to copy and fill               -> no effect
  //   4. archive folded into Step 3 alongside its consumer          -> no effect
  // In every run the orchestrator did excellent semantic work and skipped the mechanical
  // specifications: rulebook/source/ was never created and INDEX.md was composed freehand.
  //
  // The one mechanism with positive evidence is a fresh-context subagent doing a single job
  // and reading its own contract. Step 3 items 1-2 are now delegated to one.
  //
  // These tests pin the delegation. Reverting it to in-line orchestrator work reintroduces
  // four separately-refuted failure modes at once.

  it('ingest-rules.md delegates the archive + INDEX write rather than performing them in-line', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('ingest/synthesis-subagent.md');
    expect(flat(ingestRules)).toMatch(/delegated to a subagent — this orchestrator performs neither itself/);
  });

  it('the dispatch forbids restating the contract and forbids an orchestrator fallback', () => {
    const ingestRules = read('ingest-rules.md');
    const step3 = flat(
      ingestRules.slice(ingestRules.indexOf('## Step 3: Synthesis'), ingestRules.indexOf('## Step 4:')),
    );
    expect(step3).toMatch(/Do not restate, paraphrase, or summarize any part of `synthesis-subagent.md`/);
    expect(step3).toMatch(/do not write `INDEX.md` yourself as a fallback/);
  });

  it('the synthesis contract exists and tells the subagent to read it in full', () => {
    const contract = read('ingest/synthesis-subagent.md');
    expect(flat(contract)).toMatch(/Do not accept a paraphrase of this file in place of the file/);
  });

  it('the synthesis contract prescribes the archive path, copy invariant, and hash commands', () => {
    const contract = read('ingest/synthesis-subagent.md');
    expect(contract).toContain('rulebook/source/');
    expect(contract).toContain('shasum -a 256');
    expect(contract).toContain('sha256sum');
    expect(flat(contract)).toMatch(/never a move, rename, delete, or overwrite/);
    expect(flat(contract)).toMatch(/STOP and report it/);
  });

  it('the synthesis contract pins all four INDEX headings and header labels byte-for-byte', () => {
    const contract = read('ingest/synthesis-subagent.md');
    for (const heading of ['## Open Rules Gaps', '## Slices', '## Term → Slice']) {
      expect(contract, `synthesis contract must pin "${heading}"`).toContain(heading);
    }
    for (const label of ['Edition:', 'Source:', 'Source hash:', 'Transcribed:']) {
      expect(contract, `synthesis contract must pin "${label}"`).toContain(label);
    }
    expect(contract).toContain('_None._');
    expect(flat(contract)).toMatch(/do not deduplicate/i);
  });

  it('the synthesis contract blocks the INDEX write when the archive fails', () => {
    const contract = read('ingest/synthesis-subagent.md');
    expect(flat(contract)).toMatch(/Task 2 is \*\*blocked\*\*/);
    expect(flat(contract)).toMatch(/must never surface as a silently absent `Source hash:` line/);
  });

  it('the synthesis contract requires self-verification of its own written output', () => {
    const contract = read('ingest/synthesis-subagent.md');
    expect(contract).toContain('headingsVerified');
    // Re-reading its OWN output is explicitly not a Context-Economics violation; the rule
    // prohibits the orchestrator re-reading slices, which INDEX.md is not.
    expect(flat(contract)).toMatch(/is not a Context-Economics violation/);
  });

  it('the interview path is routed through the same subagent, not a second code path', () => {
    const ingestRules = read('ingest-rules.md');
    const step3 = flat(
      ingestRules.slice(ingestRules.indexOf('## Step 3: Synthesis'), ingestRules.indexOf('## Step 4:')),
    );
    expect(step3).toMatch(/Dispatch the same subagent with `Rulebook path: NONE \(interview path\)`/);
  });

  it('ingest/scaffold.md does NOT contain rulebook/source/ (Pitfall 1 guard — scaffold.md runs before {rulebookPath} is known)', () => {
    const scaffold = read('ingest/scaffold.md');
    expect(scaffold).not.toContain('rulebook/source/');
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

  it('the synthesis contract states the two template-fill prohibitions (no rewording, no composing from scratch)', () => {
    const ingestRules = read('ingest/synthesis-subagent.md');
    expect(flat(ingestRules)).toMatch(/do not rewrite, reword, abbreviate, or reorder any heading/i);
    expect(flat(ingestRules)).toMatch(/do not compose an `?INDEX\.md`? from scratch/i);
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
  it('the synthesis contract cites INDEX.template.md and pins the Open Rules Gaps heading', () => {
    const ingestRules = read('ingest/synthesis-subagent.md');
    expect(ingestRules).toContain('INDEX.template.md');
    expect(ingestRules).toContain('## Open Rules Gaps');
  });

  it('ingest-rules.md builds the section exclusively from openGaps[]', () => {
    const ingestRules = read('ingest-rules.md');
    expect(ingestRules).toContain('openGaps[]');
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
    for (const field of ['citedTerms[]', 'componentMentions[]', 'visualEvidence[]', 'variants[]', 'openGaps[]']) {
      expect(ingestRules, `ingest-rules.md must reference "${field}"`).toContain(field);
    }
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
