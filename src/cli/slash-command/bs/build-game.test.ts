/**
 * Structural drift-protection test for the `/bs-build-game` skill and its `bs/orchestrate/`
 * reference files (issue #16).
 *
 * `bs/build-game.md` and `bs/orchestrate/*.md` are plain markdown consumed by an agent session,
 * never parsed by runtime code — so the only way a broken contract fails loudly is here. This
 * suite pins the load-bearing strings: the dispatch brief's rules, the return shape's field
 * names, the resume algorithm's inputs, the answer-cache discipline, the upstream repo slug, and
 * the authority boundaries that keep `RUN.md` from becoming a second source of truth.
 *
 * Every `read()` happens INSIDE its `it()` body (never at describe level), mirroring
 * `build-chunk.test.ts`, so a missing file fails one assertion rather than aborting collection.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Read a bs/ file relative to this test file's directory. */
function read(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf-8');
}

/** Collapse markdown line wrapping so a pinned phrase matches across a wrapped line. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * The BoardSmith repository a filing is posted to. Pinned as a constant because it appears in
 * both the reference file's `gh` commands and its designer-facing fallback URL; a typo in either
 * silently sends a bug report nowhere.
 */
const UPSTREAM_REPO = 'Shufflewick/BoardSmith';

/**
 * The return-shape field names the orchestrator consumes by name. A rename on one side of this
 * contract without the other is exactly the drift this list exists to catch.
 */
const RETURN_FIELDS = [
  'chunk',
  'outcome',
  'stepsCompleted',
  'gate',
  'questions',
  'filings',
  'assetsRequested',
  'designerSummary',
  'stuckDetail',
];

/** The `outcome` enum every dispatch return carries exactly one of. */
const OUTCOME_VALUES = ['closed', 'gate', 'filing', 'context-ceiling', 'stuck'];

describe('WF-01 — the skill and its reference tree exist and are wired', () => {
  it('build-game.md exists with the bs-build-game frontmatter name', () => {
    const skill = read('build-game.md');
    expect(skill).toMatch(/^---\nname: bs-build-game\n/);
    expect(skill).toMatch(/description: .+/);
  });

  it('every orchestrate/ reference file build-game.md cites exists on disk', () => {
    for (const file of ['chunk-dispatch.md', 'run-state.md', 'questions.md', 'filings.md']) {
      expect(existsSync(join(__dirname, 'orchestrate', file)), `orchestrate/${file}`).toBe(true);
    }
  });

  it('the three new templates exist on disk', () => {
    for (const file of ['RUN.template.md', 'RUN-LOG.template.md', 'QUESTIONS.template.md', 'FILINGS.template.md']) {
      expect(existsSync(join(__dirname, 'templates', file)), `templates/${file}`).toBe(true);
    }
  });

  it('build-game.md cites reporting.md, so the designer-facing voice is not optional', () => {
    expect(read('build-game.md')).toContain('bs-shared/reporting.md');
  });

  it('build-game.md names all four orchestrate/ reference files', () => {
    const skill = read('build-game.md');
    for (const file of ['chunk-dispatch.md', 'run-state.md', 'questions.md', 'filings.md']) {
      expect(skill).toContain(`orchestrate/${file}`);
    }
  });
});

describe('WF-02 — one fresh subagent per chunk', () => {
  it('chunk-dispatch.md dispatches with the Agent tool, one subagent per chunk', () => {
    const dispatch = flat(read('orchestrate/chunk-dispatch.md'));
    expect(dispatch).toMatch(/Agent tool/);
    expect(dispatch).toMatch(/one agent per dispatch/i);
  });

  it('the subagent runs the pipeline by READING the sibling SKILL.md, never a re-dispatch', () => {
    const dispatch = read('orchestrate/chunk-dispatch.md');
    expect(dispatch).toContain('bs-build-chunk/SKILL.md');
    expect(dispatch).toContain('bs-build-bot/SKILL.md');
    expect(dispatch).toContain('bs-insert-chunk/SKILL.md');
    expect(flat(dispatch)).toMatch(/Reading the sibling instructions is the only sanctioned handoff/i);
  });

  it('the brief declares orchestrated mode explicitly and forbids auto-advancing', () => {
    const dispatch = flat(read('orchestrate/chunk-dispatch.md'));
    expect(dispatch).toMatch(/You are running in orchestrated mode/);
    expect(dispatch).toMatch(/Do not auto-advance into the next chunk/i);
  });

  it('the brief carries the answered-questions digest so no question is re-asked', () => {
    const dispatch = flat(read('orchestrate/chunk-dispatch.md'));
    expect(dispatch).toMatch(/answered-questions digest/i);
    expect(dispatch).toMatch(/re-asking a question the designer already answered/i);
  });

  it('the brief forbids the subagent asking, waiting for, or assuming approval', () => {
    const dispatch = flat(read('orchestrate/chunk-dispatch.md'));
    expect(dispatch).toMatch(/never asks a question, never waits for approval, and never assumes approval/i);
  });

  it('the return shape pins every field the orchestrator consumes by name', () => {
    const dispatch = read('orchestrate/chunk-dispatch.md');
    for (const field of RETURN_FIELDS) {
      expect(dispatch, `return shape must name \`${field}\``).toContain(`\`${field}\``);
    }
    for (const outcome of OUTCOME_VALUES) {
      expect(dispatch, `outcome enum must include \`${outcome}\``).toContain(`\`${outcome}\``);
    }
  });

  it('a gate is answered then re-dispatched — never continued in the orchestrator thread', () => {
    const dispatch = flat(read('orchestrate/chunk-dispatch.md'));
    expect(dispatch).toMatch(/never resumed in the orchestrator's own\s*thread/i);
    expect(dispatch).toMatch(/The orchestrator never continues a chunk's pipeline steps itself/i);
  });

  it('build-game.md keeps the orchestrator out of slices, docs, code, and CHUNK.md bodies', () => {
    const skill = flat(read('build-game.md'));
    expect(skill).toMatch(/never reads rulebook slices, BoardSmith docs, generated code, or a chunk's\s*`CHUNK\.md` body/i);
  });
});

describe('WF-03 — build-chunk.md honours orchestrated mode', () => {
  it('declares the mode is given in the brief, never inferred', () => {
    const buildChunk = flat(read('build-chunk.md'));
    expect(buildChunk).toMatch(/Orchestrated Mode \(dispatched by `\/bs-build-game`\)/);
    expect(buildChunk).toMatch(/declared\s*in the brief, never inferred/i);
  });

  it('keeps gate-before-write intact: nothing a gate authorizes is written without the answer', () => {
    const buildChunk = flat(read('build-chunk.md'));
    expect(buildChunk).toMatch(/never assume approval/i);
    expect(buildChunk).toMatch(/nothing a gate\s*authorizes is written until a later dispatch/i);
  });

  it('playtest.md forbids a subagent self-confirming a human playtest', () => {
    const playtest = flat(read('build/playtest.md'));
    expect(playtest).toMatch(/In orchestrated mode this gate is returned, not conducted/i);
    expect(playtest).toMatch(/must never fill the `## Verified Checklist`/i);
    expect(playtest).toMatch(/never.*infer a waiver\s*from silence/i);
  });

  it('close.md returns instead of auto-advancing under an orchestrated run', () => {
    const close = flat(read('build/close.md'));
    expect(close).toMatch(/In orchestrated mode, close returns instead of auto-advancing/i);
  });
});

describe('WF-04 — questions are catalogued so they are asked exactly once', () => {
  it('QUESTIONS.template.md carries its parse contract and required fields', () => {
    const template = read('templates/QUESTIONS.template.md');
    expect(template).toMatch(/^# Questions/m);
    expect(template).toContain('## Ledger');
    expect(template).toMatch(/PARSE CONTRACT \(TMPL-02\)/);
    for (const field of [
      'Question:',
      'Asked by:',
      'Scope:',
      'Options:',
      'Answer:',
      'Answered at:',
      'Recorded in:',
    ]) {
      expect(template, `QUESTIONS.template.md must document \`${field}\``).toContain(field);
    }
  });

  it('ask.md reads the cache before asking and writes the question as it is posed', () => {
    const ask = flat(read('build/ask.md'));
    expect(ask).toMatch(/Read the answer cache before asking, and write to it as you ask/i);
    expect(ask).toMatch(/Not after the answer arrives/i);
    expect(ask).toMatch(/QUESTIONS\.md/);
  });

  it('ask.md keeps RULINGS.md as the authority and QUESTIONS.md as the transcript', () => {
    const ask = flat(read('build/ask.md'));
    expect(ask).toMatch(/QUESTIONS\.md` is the transcript;\s*`RULINGS\.md` stays the authority/i);
  });

  it('questions.md forbids re-presenting an answered question for confirmation', () => {
    const questions = flat(read('orchestrate/questions.md'));
    expect(questions).toMatch(/Do not re-present it\s*"for confirmation"/i);
    expect(questions).toMatch(/A question is written the moment it is posed/i);
    expect(questions).toMatch(/An answer is written before the run does anything with it/i);
  });

  it('questions.md does not lower the ask bar — the triple-gate still applies', () => {
    const questions = flat(read('orchestrate/questions.md'));
    expect(questions).toMatch(/triple-gate/i);
    expect(questions).toMatch(/cheaper to remember\*?, never cheaper to do/i);
  });

  it('the pending set is the durable batched-question queue', () => {
    const questions = flat(read('orchestrate/questions.md'));
    expect(questions).toMatch(/batched-question queue/i);
    expect(questions).toMatch(/survives the\s*`\/clear`/i);
  });
});

describe('WF-05 — BoardSmith bugs and gaps are filed and reported upstream', () => {
  it('FILINGS.template.md carries its parse contract and required fields', () => {
    const template = read('templates/FILINGS.template.md');
    expect(template).toMatch(/^# Filings/m);
    expect(template).toContain('## Ledger');
    expect(template).toMatch(/PARSE CONTRACT \(TMPL-02\)/);
    for (const field of [
      'Kind:',
      'Title:',
      'What happened:',
      'Blocked:',
      'Workaround in the game:',
      'BoardSmith version:',
      'Reported:',
      'Issue:',
    ]) {
      expect(template, `FILINGS.template.md must document \`${field}\``).toContain(field);
    }
    // The Reported enum: a filing is either only recorded, posted by us, posted by the designer,
    // or explicitly declined — never silently dropped.
    for (const value of ['recorded', 'posted', 'posted-by-designer', 'declined']) {
      expect(template).toContain(value);
    }
  });

  it('filings.md names the upstream repo for both the gh command and the fallback URL', () => {
    const filings = read('orchestrate/filings.md');
    expect(filings).toContain(`https://github.com/${UPSTREAM_REPO}`);
    expect(filings).toContain(`gh issue create --repo ${UPSTREAM_REPO}`);
    expect(filings).toContain(`gh issue list --repo ${UPSTREAM_REPO}`);
    expect(filings).toContain('gh auth status');
  });

  it('filings.md confirms with the designer before posting and honours a decline', () => {
    const filings = flat(read('orchestrate/filings.md'));
    expect(filings).toMatch(/always confirmed\s*first/i);
    expect(filings).toMatch(/never a standing "post everything from now on" assumption/i);
    expect(filings).toMatch(/Reported: declined/);
  });

  it('filings.md falls back to the designer posting it when gh cannot', () => {
    const filings = flat(read('orchestrate/filings.md'));
    expect(filings).toMatch(/When Posting Is Not Possible/i);
    expect(filings).toMatch(/Show them the complete issue on screen/i);
    expect(filings).toMatch(/posted-by-designer/);
  });

  it('filings.md keeps the feature-request bar high and the bug bar low', () => {
    const filings = flat(read('orchestrate/filings.md'));
    expect(filings).toMatch(/This bar is low on purpose/i);
    expect(filings).toMatch(/This bar is \*\*high\*\*/i);
    expect(filings).toMatch(/is not a feature request/i);
  });

  it('filings.md never patches the library and never suppresses a built-in surface', () => {
    const filings = flat(read('orchestrate/filings.md'));
    expect(filings).toMatch(/FILED, never patched/);
    expect(filings).toMatch(/read-only/i);
    expect(filings).toMatch(/never suppress a built-in surface/i);
  });

  it('build.md points a library gap at FILINGS.md and at the upstream path', () => {
    const build = flat(read('build/build.md'));
    expect(build).toMatch(/Filing means an\s*entry in `FILINGS\.md`/i);
    expect(build).toMatch(/orchestrate\/filings\.md/);
  });

  it('adopts a pre-existing hand-rolled bug ledger once, keeping old citations resolvable', () => {
    // Real projects (chess, lanternfall, doom-machine) already keep design/BOARDSMITH-BUGS.md, and
    // their SKETCH.md/DECISIONS.md/CHUNK.md files cite it BY THAT NAME. A second ledger under a new
    // name would fork the record; deleting the old file would break those citations.
    const filings = flat(read('orchestrate/filings.md'));
    expect(filings).toMatch(/Adopting a Pre-Existing Bug Ledger \(one-time conversion\)/i);
    expect(filings).toContain('BOARDSMITH-BUGS.md');
    expect(filings).toMatch(/Keep its original id inside the `Title:`/i);
    expect(filings).toMatch(/Replace the old file's body with one line pointing at `FILINGS\.md`/i);
    expect(filings).toMatch(/Never run this conversion twice/i);
    // A withdrawn/rejected entry survives the conversion rather than vanishing.
    expect(filings).toMatch(/rejected or withdrawn is transcribed with `Reported: declined`, never dropped/i);

    // The run performs it before the first dispatch, and check-status reads the old name.
    expect(flat(read('build-game.md'))).toMatch(/predates the filings ledger/i);
    expect(read('check-status.md')).toContain('BOARDSMITH-BUGS.md');
  });

  it('the writes-a-filing scratch path is the gitignored scratch dir, never the project root', () => {
    const filings = read('orchestrate/filings.md');
    expect(filings).toContain('.boardsmith/scratch/filing-');
    expect(flat(filings)).toMatch(/never the project root/i);
  });
});

describe('WF-06 — a run resumes cleanly after a /clear or a crash', () => {
  it('RUN.template.md carries its parse contract and run-level lines, and no shared log (#294)', () => {
    const template = read('templates/RUN.template.md');
    expect(template).toMatch(/^# Run/m);
    expect(template).toMatch(/PARSE CONTRACT \(TMPL-02\)/);
    for (const line of ['Run Status:', 'Open Gate:', 'Stop Reason:']) {
      expect(template, `RUN.template.md must carry \`${line}\``).toContain(line);
    }
    for (const value of ['active', 'paused', 'complete']) {
      expect(template).toContain(value);
    }
    expect(template).not.toContain('## Run Log');
    expect(template).toContain('design/run-log/<slug>.md');
  });

  it('RUN-LOG.template.md is one chunk\'s log, with every dispatch field (#294)', () => {
    const template = read('templates/RUN-LOG.template.md');
    expect(template).toMatch(/^# Run Log: /m);
    for (const field of ['Pipeline:', 'Dispatched at:', 'Finished at:', 'Outcome:', 'Detail:']) {
      expect(template, `RUN-LOG.template.md must document \`${field}\``).toContain(field);
    }
  });

  it('RUN.md is a journal, never an authority on chunk status', () => {
    const runState = flat(read('orchestrate/run-state.md'));
    expect(runState).toMatch(/The One Authority Rule/i);
    expect(runState).toMatch(/`CHUNK\.md` wins and `RUN\.md` is repaired to match/i);
    expect(runState).toMatch(/Never repair `CHUNK\.md` to match `RUN\.md`/i);
    expect(flat(read('templates/RUN.template.md'))).toMatch(/IT IS NOT AN AUTHORITY ON CHUNK STATE/);
  });

  it('the resume algorithm reads files, not a conversation, and re-poses the open gate verbatim', () => {
    const runState = flat(read('orchestrate/run-state.md'));
    expect(runState).toMatch(/reconstructs everything it needs from files, never from a conversation/i);
    expect(runState).toMatch(/re-posed \*\*verbatim from the file that owns its text\*\*/i);
    for (const file of ['RUN.md', 'SKETCH.md', 'QUESTIONS.md']) {
      expect(runState).toContain(file);
    }
  });

  it('a dispatch is journalled BEFORE it launches, so a mid-chunk crash is visible', () => {
    const runState = flat(read('orchestrate/run-state.md'));
    expect(runState).toMatch(/\*\*Before\*\* each dispatch: append a `### Dispatch N` entry to that chunk's own `design\/run-log\/<slug>\.md`, with `Outcome: pending`/i);
    expect(runState).toMatch(/a dispatch that never returned/i);
  });

  it('a crashed run leaving Run Status: active is not evidence another run is live', () => {
    const runState = flat(read('orchestrate/run-state.md'));
    expect(runState).toMatch(/`active` is never by itself evidence\s*that another run is live/i);
    expect(runState).toMatch(/the lock's timestamp is/i);
  });

  it('the run stops for exactly the four named reasons, and no vaguer hunch', () => {
    const runState = read('orchestrate/run-state.md');
    for (const reason of ['designer-stopped', 'gate-open', 'stuck', 'context-ceiling']) {
      expect(runState, `stop reasons must include ${reason}`).toContain(reason);
    }
    const skill = flat(read('build-game.md'));
    expect(skill).toMatch(/never for a vaguer "this is getting long\.?"/i);
  });

  it('the context floor/ceiling applies per subagent, so a ceiling return is a re-dispatch', () => {
    const runState = flat(read('orchestrate/run-state.md'));
    expect(runState).toMatch(/fresh context window/i);
    expect(runState).toMatch(/treats as an ordinary re-dispatch, not a stop/i);
    const stateMachine = flat(read('state-machine.md'));
    expect(stateMachine).toMatch(/context floor and ceiling apply per subagent, not per run/i);
  });

  it('build-game.md prints /bs-build-game as the one resume command', () => {
    const skill = read('build-game.md');
    expect(skill).toMatch(/resumes it: `\/bs-build-game`/);
  });
});

describe('WF-07 — the run ends with the bot opponent and final acceptance', () => {
  it('build-game.md dispatches the bot chunk against bs-build-bot', () => {
    const skill = read('build-game.md');
    expect(skill).toContain('bs-build-bot/SKILL.md');
    expect(flat(skill)).toMatch(/after game-end\/scoring is verified/i);
  });

  it('build-game.md offers to insert a bot chunk when the sketch has none', () => {
    const skill = flat(read('build-game.md'));
    expect(skill).toMatch(/If the sketch has \*\*no\*\* bot-opponent chunk/i);
    expect(skill).toMatch(/never edit the ordered chunk list by\s*hand/i);
  });

  it('final acceptance is the run terminus and sets Run Status: complete', () => {
    const skill = flat(read('build-game.md'));
    expect(skill).toMatch(/set `Run Status: complete`/);
    expect(skill).toMatch(/there is no next command to print/i);
  });

  it('build-bot.md is the renamed skill and honours orchestrated mode', () => {
    const buildBot = read('build-bot.md');
    expect(buildBot).toMatch(/^---\nname: bs-build-bot\n/);
    expect(flat(buildBot)).toMatch(/Orchestrated Mode \(dispatched, not typed\)/i);
    expect(flat(buildBot)).toMatch(/never ask a question, never wait for\s*approval/i);
    expect(buildBot).not.toContain('name: bs-generate-bot');
  });
});

describe('WF-08 — check-status reports the two new ledgers, read-only', () => {
  it('reports unanswered questions and filings as items 10 and 11', () => {
    const checkStatus = read('check-status.md');
    expect(checkStatus).toMatch(/\*\*10\. Unanswered questions\.\*\*/);
    expect(checkStatus).toMatch(/\*\*11\. BoardSmith bugs and gaps filed\.\*\*/);
    expect(checkStatus).toMatch(/Present all twelve items together/);
  });

  it('never re-poses an answered question and never reports a declined filing', () => {
    const checkStatus = flat(read('check-status.md'));
    expect(checkStatus).toMatch(/Never re-pose an ANSWERED entry here/i);
    expect(checkStatus).toMatch(/A `declined` filing is not reported here/i);
  });

  it('keeps its no-writes posture over the three new files', () => {
    const checkStatus = flat(read('check-status.md'));
    expect(checkStatus).toMatch(/not to `QUESTIONS\.md`, `FILINGS\.md`, or `RUN\.md`/);
  });

  it('routes the next command to /bs-build-game when a run is active or paused', () => {
    const checkStatus = flat(read('check-status.md'));
    expect(checkStatus).toMatch(/`Run Status:` is `active` or `paused`.*next command\s*is `\/bs-build-game`/i);
  });
});

describe('WF-09 — state-machine.md owns the orchestrated-run rules once', () => {
  it('names the four orchestrated-run rules and the new design artifacts', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toMatch(/## Orchestrated Runs \(`\/bs-build-game`\)/);
    const flatSm = flat(stateMachine);
    expect(flatSm).toMatch(/Orchestrated mode is declared, never inferred/i);
    expect(flatSm).toMatch(/A dispatched subagent has no designer/i);
    expect(flatSm).toMatch(/The run journal is not an authority/i);
    expect(stateMachine).toContain('QUESTIONS.md  FILINGS.md  RUN.md');
  });

  it('lists bs-build-game and bs-build-bot in the skill roster, and no bs-generate-bot anywhere', () => {
    const stateMachine = read('state-machine.md');
    expect(stateMachine).toContain('`bs-build-game`');
    expect(stateMachine).toContain('`bs-build-bot`');
    expect(stateMachine).not.toContain('bs-generate-bot');
  });

  it('keeps the how-never-what boundary: relaying an answer is not deciding it', () => {
    const stateMachine = flat(read('state-machine.md'));
    expect(stateMachine).toMatch(/Only \*who relays\* the answer changes, never \*who decides\* it/i);
  });
});

/**
 * #291: an orchestrated run accepted its own ask gates, extended a one-chunk waiver by
 * "precedent", and marked playtests verified that nobody observed. The three files that govern a
 * gate state ONE policy, word for word, so no file can drift into a looser reading; and the
 * playtest step routes Status through the command that enforces it, never a hand-written line.
 */
const GATE_POLICY =
  'Only the designer answers an ask gate or signs off a playtest. An unattended run parks the ' +
  'chunk at that gate and moves on only to work that does not need the answer.';

describe('#291: one gate policy for orchestrated runs', () => {
  for (const file of ['build-game.md', 'build/ask.md', 'build/playtest.md']) {
    it(`${file} states the gate policy verbatim`, () => {
      expect(flat(read(file))).toContain(GATE_POLICY);
    });

    it(`${file} says a decision about one chunk is never a precedent for another`, () => {
      expect(flat(read(file))).toMatch(/never a precedent/i);
    });
  }

  it('playtest.md derives Status from `boardsmith chunk-signoff`, never by writing the line itself', () => {
    const playtest = flat(read('build/playtest.md'));
    expect(playtest).toContain('boardsmith chunk-signoff');
    expect(playtest).toContain('--observed');
    expect(playtest).toContain('--automated');
    expect(playtest).not.toMatch(/Write `Status: verified`/);
  });

  it('playtest.md routes a skipped playtest through a named, expiring waiver', () => {
    const playtest = flat(read('build/playtest.md'));
    expect(playtest).toContain('boardsmith chunk-waiver');
    expect(playtest).toMatch(/--expires/);
  });

  it('build-game.md re-checks a closed chunk with chunk-check before continuing', () => {
    const buildGame = flat(read('build-game.md'));
    expect(buildGame).toMatch(/`closed`[^]*?boardsmith chunk-check <slug>/);
  });

  it('ask.md does not let an unrecorded precedent stand in for an answer', () => {
    const ask = flat(read('build/ask.md'));
    expect(ask).toMatch(/standing precedent/i);
    expect(ask).toMatch(/reversible/i);
  });
});

/**
 * #294: chunks may be built at the same time, but only where code says it is safe. The prose names
 * the rules and, for every one, the command that enforces it, so a harness that skims the prose
 * still cannot merge an unsafe batch.
 */
describe('#294 — parallel dispatch is allowed only where the checks say so', () => {
  const dispatch = () => flat(read('orchestrate/chunk-dispatch.md'));

  it('replaces the blanket ban with stated rules for when chunks may and may not run together', () => {
    expect(dispatch()).not.toMatch(/Never dispatch two chunks at once/i);
    expect(dispatch()).toMatch(/## Parallel Dispatch/);
    expect(dispatch()).toMatch(/independent in the sketch's dependency graph/i);
    expect(dispatch()).toMatch(/no rulebook citation in common/i);
    expect(dispatch()).toMatch(/`boardsmith parallel-check <slug> <slug>/);
    expect(dispatch()).toMatch(/When Chunks Run One at a Time/);
    for (const alone of ['core-loop', 'final-acceptance', 'bs-insert-chunk']) expect(dispatch()).toContain(alone);
  });

  it('gives each parallel chunk its own worktree and branch, and merges only through chunk-merge, one at a time', () => {
    expect(dispatch()).toContain('.boardsmith/worktrees/<slug>');
    expect(dispatch()).toContain('chunk/<slug>');
    expect(dispatch()).toMatch(/`boardsmith chunk-merge <slug>`/);
    expect(dispatch()).toMatch(/never merge a chunk branch by hand/i);
    expect(dispatch()).toMatch(/one merge at a time/i);
  });

  it('numbers ledger entries provisionally on a parallel branch, allocated at merge', () => {
    expect(dispatch()).toContain('Ruling @<slug>.<n>');
    expect(flat(read('state-machine.md'))).toMatch(/## Ledger Numbers on a Parallel Branch/);
    expect(flat(read('state-machine.md'))).toContain('Ruling @<slug>.<n>');
  });

  it('routes the cross-chunk references a merge records to the audit before the next merge', () => {
    expect(dispatch()).toContain('CROSS-CHUNK.md');
    expect(dispatch()).toMatch(/cross-chunk lens/i);
    const audit = flat(read('build/audit.md'));
    expect(audit).toMatch(/## The Cross-Chunk Lens/);
    expect(audit).toContain('boardsmith chunk-reopen');
    expect(audit).toMatch(/- Verdict: no conflict: /);
  });

  it('build-game.md runs the loop in parallel batches when the check allows, and one at a time otherwise', () => {
    const game = flat(read('build-game.md'));
    expect(game).not.toMatch(/One dispatch at a time, never two/i);
    expect(game).toContain('boardsmith parallel-check');
    expect(game).toContain('boardsmith chunk-merge');
    expect(game).toMatch(/orchestrate\/chunk-dispatch\.md` "Parallel Dispatch"/);
  });

  it('the sketch records each chunk\'s dependencies, which the parallel rule reads', () => {
    expect(read('templates/SKETCH.template.md')).toContain('- Depends on:');
    expect(flat(read('ingest/sketch-derivation.md'))).toMatch(/`- Depends on:`/);
    expect(flat(read('insert-chunk.md'))).toMatch(/`- Depends on:`/);
  });

  it('runs a chunk\'s read-only steps concurrently by default', () => {
    const chunk = flat(read('build-chunk.md'));
    expect(chunk).toMatch(/## Concurrency Within a Chunk/);
    for (const step of ['investigate', 'redteam', 'audit']) expect(chunk).toContain(step);
    expect(flat(read('build/redteam.md'))).toMatch(/in one message, so they run at the same time/i);
    expect(flat(read('build/audit.md'))).toMatch(/in one message, so they run at the same time/i);
  });
});
