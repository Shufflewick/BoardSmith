/**
 * Roles, review after verify, and escalation in the bs- skills (#454).
 *
 * The skills are markdown an agent session follows, so the only way a broken contract fails loudly
 * is here. The mechanical halves live in code and are tested there: the refusal of a review
 * without a passing verify (`commands/review-gate.test.ts`), the agent a role is dispatched as and
 * the escalation ladder (`commands/agent.test.ts`), and the run log's role and review-round
 * records (`lib/run-log-roles.test.ts`). This file pins that the skills call that code, name
 * roles and never models, and give every reviewer the verify result and only judgement checks.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SKILL_NAMES } from '../../commands/install-claude-command.js';

/** The bs/ skill tree this file sits in. */
const BS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** A bs/ file's text; `flat` collapses line wrapping so a phrase matches across a wrapped line. */
const read = (file: string) => readFileSync(BS_DIR + file, 'utf-8');
const flat = (text: string) => text.split(/\s+/).join(' ');

/** The source file of each entry-point skill: `bs-build-chunk` is `build-chunk.md`. */
const ENTRY_POINTS = SKILL_NAMES.map((name) => `${name.replace(/^bs-/, '')}.md`);

/** Every file that dispatches chunk work or routes it: none of them may name a model. */
const ROUTING_FILES = [
  'routing.md',
  ...ENTRY_POINTS,
  ...readdirSync(BS_DIR + 'build').filter((f) => f.endsWith('.md')).map((f) => `build/${f}`),
  ...readdirSync(BS_DIR + 'orchestrate').filter((f) => f.endsWith('.md')).map((f) => `orchestrate/${f}`),
  'state-machine.md',
  'templates/RUN-LOG.template.md',
  ...readdirSync(BS_DIR + 'verify').filter((f) => f.endsWith('.md')).map((f) => `verify/${f}`),
];

/** The one line each entry point's "Model Routing" section gives, instead of a copy of routing.md. */
const POINTER =
  'Which role does each piece of work, when review may start, and what happens when a step fails: ' +
  '`${CLAUDE_SKILL_DIR}/../bs-shared/routing.md`, the one authority.';

/** Asserts routing.md, with line wrapping collapsed, matches every pattern. */
function routingSays(...patterns: RegExp[]): void {
  const routing = flat(read('routing.md'));
  for (const pattern of patterns) expect(routing).toMatch(pattern);
}

/** Every skill markdown file under bs/, relative to it. */
function allSkillFiles(dir = ''): string[] {
  return readdirSync(BS_DIR + dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? allSkillFiles(`${dir}${e.name}/`) : e.name.endsWith('.md') ? [`${dir}${e.name}`] : [],
  );
}

const ROLE_NAMES = '(?:mechanical|bounded|judgement|review|second-opinion)';

/** A paragraph names a role when it says which role's agent to dispatch. */
const NAMES_ROLE = new RegExp(`npx boardsmith agent ${ROLE_NAMES}\\b|\`${ROLE_NAMES}\` role`);

/**
 * Every place in `text` that instructs a dispatch: a dispatch verb with an agent as its object, in
 * prose (fenced blocks and inline code are set aside). A noun ("each dispatch prompt", "Dispatch
 * N") and a negation ("never dispatches", "dispatches no agent") are not dispatch sites.
 */
function dispatchSites(text: string): Array<{ paragraph: string; at: string }> {
  const keep = new RegExp(`^\`(?:npx boardsmith agent )?${ROLE_NAMES}\`$`);
  const prose = text.replace(/^```[\s\S]*?^```$/gm, '').replace(/`[^`\n]*`/g, (code) => (keep.test(code) ? code : '`code`'));
  const verb = /(^|[^\w-])((?:re-)?[Dd]ispatch(?:es)?|(?:is|are) dispatched(?:, in turn,)? to)(?=[\s*])(?!\s+(?:prompts?|templates?|payloads?|handshakes?|briefs?|entry|entries|tokens?)\b)/g;
  const notAVerb = /(?:\b(?:a|an|the|each|every|one|this|that|its|no|per|any|first|second|third|never|not)|`)\s*$/i;
  const object = /^(?![\s*]*(?:no|nothing)\b)(?!\s+[A-Z0-9]\b)[^.;:!?]{0,90}?\b(?:sub-?agents?|agents?|lens(?:es)?|enumerators?|refuters?|reconciler|adversary|reviewers?)\b/;
  const sites: Array<{ paragraph: string; at: string }> = [];
  for (const paragraph of prose.split(/\n\s*\n/).map(flat).filter((p) => !p.startsWith('#'))) {
    for (const m of paragraph.matchAll(verb)) {
      if (notAVerb.test(paragraph.slice(0, m.index + m[1].length))) continue;
      if (!object.test(paragraph.slice(m.index + m[0].length))) continue;
      sites.push({ paragraph, at: paragraph.slice(Math.max(0, m.index - 40), m.index + 100) });
    }
  }
  return sites;
}

/** Every handshake token a subagent contract validates: `contains the exact token \`BS-...\``. */
function handshakeTokens(): string[] {
  const tokens = allSkillFiles().flatMap((file) =>
    [...flat(read(file)).matchAll(/contains the exact token `(BS-[A-Z0-9-]+)`/g)].map((m) => m[1]),
  );
  return [...new Set(tokens)].sort();
}

/** A model family name, bare or inside a model id such as `claude-opus-5`. */
const MODEL_NAME = /\b(haiku|sonnet|opus|fable)\b/i;

/** The body of `## <heading>` up to the next `## ` heading. */
function section(text: string, heading: string): string {
  const start = text.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const next = text.indexOf('\n## ', start + 3);
  return text.slice(start, next < 0 ? undefined : next);
}

/** Every fenced block in `text` whose first line is `Work package: {slug}`. */
function workPackageTemplates(text: string): string[] {
  return [...text.matchAll(/^```\n(Work package: \{slug\}\n[\s\S]*?)^```$/gm)].map((m) => m[1]);
}

describe('roles, never models (#454)', () => {
  it('every entry-point skill has a Model Routing section that points at routing.md in one line, and copies nothing from it', () => {
    for (const file of ENTRY_POINTS) {
      const routing = section(read(file), 'Model Routing');
      expect(routing, `${file} must have a "## Model Routing" section`).not.toBe('');
      expect(flat(routing), `${file} Model Routing must open with the one-line pointer`).toContain(POINTER);
      expect(routing, `${file} must not restate routing.md`).not.toContain('The `bs-` skills name roles, never models.');
      expect(routing).not.toMatch(MODEL_NAME);
    }
  });

  it('no file that dispatches or routes chunk work names a model, or dispatches general-purpose', () => {
    for (const file of ROUTING_FILES) {
      const text = read(file);
      expect(text, `${file} must not name a model`).not.toMatch(MODEL_NAME);
      expect(text, `${file} must dispatch a role's agent, not general-purpose`).not.toContain('general-purpose');
    }
  });

  it('every dispatch site names the role whose agent it dispatches, in the paragraph that dispatches', () => {
    const unnamed = allSkillFiles()
      .filter((file) => file !== 'routing.md')
      .flatMap((file) => dispatchSites(read(file)).filter((site) => !NAMES_ROLE.test(site.paragraph)).map((site) => `${file}: ...${site.at}...`));
    expect(unnamed, 'each of these dispatches names no role: add `npx boardsmith agent <role>` or "the `<role>` role"').toEqual([]);
  });

  it('the dispatch-site check finds an unnamed dispatch, and passes one that names its role', () => {
    const unnamed = dispatchSites('For each pending range, dispatch one subagent. Copy the pointer block.');
    expect(unnamed).toHaveLength(1);
    expect(NAMES_ROLE.test(unnamed[0].paragraph)).toBe(false);
    const named = dispatchSites('Dispatch one subagent per range, as the agent `npx boardsmith agent judgement` names.');
    expect(named).toHaveLength(1);
    expect(NAMES_ROLE.test(named[0].paragraph)).toBe(true);
    expect(dispatchSites('This skill dispatches no agent, and the raw dispatch prompt names the subagent. Dispatch N records it.')).toEqual([]);
    expect(dispatchSites('## Dispatch the lenses\n\nThe `judgement` role reads it.')).toEqual([]);
  });

  it('no skill dispatches a generic Task-tool subagent, which names no role', () => {
    for (const file of allSkillFiles()) {
      expect(flat(read(file)), `${file} must dispatch a role's agent, not a Task-tool subagent`).not.toMatch(/\bTask[- ]tool\b|\bTask subagent\b/);
    }
  });

  it('routing.md\'s step table gives a role to every handshake-token dispatch a subagent contract defines', () => {
    const table = section(read('routing.md'), 'Which Role Each Step Uses');
    const tokens = handshakeTokens();
    expect(tokens).toEqual([
      'BS-CLASSIFY-V1',
      'BS-DISPATCH-V3',
      'BS-ENUMERATE-V1',
      'BS-EXAMPLE-EXTRACT-V1',
      'BS-EXAMPLE-TRANSLATE-V1',
      'BS-RECONCILE-V1',
      'BS-RULING-RECHECK-V1',
    ]);
    for (const token of tokens) {
      const row = table.split('\n').find((line) => line.startsWith('|') && line.includes(token));
      expect(row, `routing.md's step table must have a row for ${token}`).toBeDefined();
      expect(row!, `the ${token} row must name a role`).toMatch(new RegExp(`\\| \`${ROLE_NAMES}\``));
    }
    for (const work of ['`re-investigate`', '`quote-fix`', 'follow-up']) {
      expect(table, `routing.md's step table must have a row for ${work}`).toContain(work);
    }
  });

  it('routing.md says to dispatch the agent `boardsmith agent <role>` prints, mapped in boardsmith.json or the bs- default', () => {
    const routing = flat(read('routing.md'));
    expect(routing).toContain('npx boardsmith agent <role>');
    expect(routing).toContain('"agents": { "judgement": "senior", "review": "reviewer" }');
    expect(routing).toContain('`bs-<role>`');
    expect(routing).toMatch(/Nothing is detected or guessed/);
  });

  it('the chunk dispatch sends a whole chunk to the judgement role\'s agent, and every brief starts with the work package', () => {
    const dispatch = flat(read('orchestrate/chunk-dispatch.md'));
    expect(dispatch).toContain('npx boardsmith agent judgement');
    expect(dispatch).toMatch(/first line of the brief is `Work package: <slug>`/);
    expect(flat(read('routing.md'))).toMatch(/The first line of every dispatch prompt, in every `bs-` skill, is: ``` Work package: <id> ```/);
  });
});

describe('no model review before verify (#454)', () => {
  it('build-chunk and build-game refuse a review step without a passing verify, through review-gate, and say to run boardsmith verify', () => {
    for (const file of ['build-chunk.md', 'build-game.md']) {
      const text = flat(read(file));
      expect(text, file).toContain('npx boardsmith review-gate <slug>');
      expect(text, file).toMatch(/No review step starts until/);
      expect(text, file).toContain('npx boardsmith verify --chunk <slug>');
    }
  });

  it('every review step runs review-gate before it dispatches a reviewer', () => {
    for (const file of ['build/redteam.md', 'build/audit.md', 'build/final-acceptance.md', 'build/design-review.md']) {
      expect(flat(read(file)), file).toContain('npx boardsmith review-gate');
    }
  });

  it('every review prompt starts with the work package, states the mechanical checks are done, carries the verify result, and lists only judgement checks', () => {
    const expected = {
      'build/redteam.md': 2,
      'build/audit.md': 5,
      'build/final-acceptance.md': 1,
      'build/design-review.md': 1,
    };
    for (const [file, count] of Object.entries(expected)) {
      const templates = workPackageTemplates(read(file));
      expect(templates, `${file} must have ${count} review prompt(s) starting "Work package: {slug}"`).toHaveLength(count);
      for (const template of templates) {
        const text = flat(template);
        expect(text, file).toContain('The mechanical checks are done.');
        expect(text, file).toContain('{verifyResult}');
        expect(text, file).toMatch(/Judgement checks \(the only ones you make\):/);
        expect(text, file).not.toMatch(/\b(run|re-run) (the full suite|the suite|typecheck|boardsmith test|boardsmith verify)\b/i);
      }
    }
  });

  it('the size rule and the light review are review-gate\'s, and only a mechanical change may skip review', () => {
    const routing = flat(read('routing.md'));
    expect(routing).toContain('--work-role mechanical --since <the commit before it began>');
    expect(routing).toMatch(/Work by the `bounded` or `judgement` role is always reviewed in full/);
    expect(routing).toMatch(/A \*\*light\*\* review is one agent of the step's review role/);
  });
});

describe('escalation: one role up, never the same role, then the designer (#454)', () => {
  it('routing.md sends a failed step one role up with `boardsmith agent --escalate`, and to the designer after judgement', () => {
    const routing = flat(read('routing.md'));
    expect(routing).toContain('npx boardsmith agent <the role that failed> --escalate');
    expect(routing).toMatch(/`mechanical`, then `bounded`, then `judgement`/);
    expect(routing).toMatch(/\*\*stops and asks the designer\*\*/);
    expect(routing).toMatch(/never again to the same role/);
  });

  it('names one more judgement round for a red-team re-investigation and a repair as the first named exception, with its reason', () => {
    routingSays(
      /\*\*The first named exception: one more `judgement` round for a red-team re-investigation and for a repair\.\*\*/,
      /`judgement`, then one `judgement` re-investigation or repair, then the designer/,
      /the designer's time is the scarcer resource/,
      /No other step gets these rounds, and no step gets a third round/,
      /Audit findings on work already at `judgement`.*count as a failed repair at `judgement`/,
    );
    expect(flat(read('build/redteam.md'))).toMatch(/maximum ONE re-investigate round\. It is dispatched at the `judgement` role again: the first named exception/);
    expect(flat(read('build/repair.md'))).toMatch(/gets exactly one more `judgement` round, the first named exception in `routing\.md`/);
    expect(flat(read('state-machine.md'))).toContain('Maximum **3 audit rounds** per chunk.');
  });

  it('names one narrower quote-fix for a claim-quote-check refusal as the second named exception, with its reason, and counts the refusal as a failure', () => {
    routingSays(
      /A step fails when its verify fails, when `boardsmith claim-quote-check` refuses the claims it wrote \(`investigate` and `re-investigate`\), when `boardsmith verify-run-record` refuses a page range it transcribed, or when its reviewer asks for changes/,
      /\*\*The second named exception: one narrower `quote-fix` for a `claim-quote-check` refusal\.\*\*/,
      /quote fixes are mechanical and cheap, and the designer's time is scarcer/,
    );
    for (const file of ['build/investigate.md', 'build/redteam.md']) {
      expect(flat(read(file)), file).toMatch(/one narrower `quote-fix`.*at the `judgement` role, the second named exception in `routing\.md`.*then the designer/);
    }
  });

  it('names one re-transcription of a page range verify-run-record refused as the third named exception, with its reason, and staging-dispatch follows it', () => {
    routingSays(
      /Apart from the three named exceptions below/,
      /\*\*The third named exception: one re-transcription of a page range `verify-run-record` refused\.\*\*/,
      /transcription slips are usually mechanical/,
      /`transcribe <range>` again after `verify-run-record` refused the range \| `judgement`, the third named exception \(below\)/,
      /a re-transcription the command still refuses/,
    );
    expect(flat(read('verify/staging-dispatch.md'))).toMatch(
      /exactly one re-transcription of that range, dispatched to the `judgement` role again: the third named exception in `routing\.md`.*`Escalated from: Dispatch N`.*stop and ask the designer/,
    );
  });

  it('a build waits for test: its Outcome stays pending until the done gate, then fails naming the check, and the judgement build names it', () => {
    const test = flat(read('build/test.md'));
    expect(test).toMatch(/stays `Outcome: pending` \(with `Finished at: pending`\) until this step's done gate answers/);
    expect(test).toMatch(/`Outcome: failed`, with the check that failed in its Detail/);
    expect(test).toMatch(/`Escalated from: Dispatch N`, naming the failed build/);
    expect(flat(read('templates/RUN-LOG.template.md'))).toMatch(/A `build` dispatch's Outcome and Finished at stay `pending` until `test`'s done gate answers/);
  });

  it('a dispatch that carries on after a gate, a context ceiling or a crash keeps its role and writes Escalated from: none', () => {
    expect(flat(read('templates/RUN-LOG.template.md'))).toMatch(
      /Escalated from: none, also when this dispatch carries on one that stopped at a gate, its context ceiling or a crash/,
    );
    routingSays(/a dispatch that never returned are not failures: the re-dispatch after them keeps its role, writes `Escalated from: none`, and carries on the round it resumes/);
  });
});

describe('the run log records role, agent, review rounds and the verify each round started from (#454)', () => {
  it('RUN-LOG.template.md documents every field', () => {
    const template = read('templates/RUN-LOG.template.md');
    for (const field of ['Work:', 'Role:', 'Agent:', 'Escalated from:', 'Designer answer:', '### Review Round N', 'Reviewed:', 'Level:', 'Verify:', 'Agents:']) {
      expect(template, `RUN-LOG.template.md must document \`${field}\``).toContain(field);
    }
    expect(flat(template)).toMatch(/the verify result the round started from/);
    expect(flat(template)).toMatch(/"Review Round M" for the review round that asked for changes/);
  });

  it('lets a whole chunk fail: `failed` is in the whole-chunk Outcome list, as chunk-dispatch.md and build-game.md use it', () => {
    const outcomes = /- Outcome: ([^;]*) for a whole chunk/.exec(flat(read('templates/RUN-LOG.template.md')))?.[1] ?? '';
    expect(outcomes.split(' | ')).toContain('failed');
  });

  it('ingest-rules and verify-game log their dispatches in a run log of their own, checked like chunk work', () => {
    const routing = flat(read('routing.md'));
    expect(routing).toContain('`design/run-log/ingest-rules.md`');
    expect(routing).toContain('`design/run-log/verify-game.md`');
    expect(routing).toMatch(/`Reviewed: Dispatch N`/);
    expect(routing).toMatch(/`Escalated from: Review Round N`/);
    expect(routing).toMatch(/`Designer answer:`/);
    for (const [file, log] of [['ingest-rules.md', 'ingest-rules'], ['verify-game.md', 'verify-game']]) {
      expect(flat(read(file)), file).toContain(`\`design/run-log/${log}.md\``);
    }
  });
});
