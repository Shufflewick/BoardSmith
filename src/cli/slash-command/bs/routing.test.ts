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
  ...ENTRY_POINTS.filter((file) => file !== 'verify-game.md'),
  ...readdirSync(BS_DIR + 'build').filter((f) => f.endsWith('.md')).map((f) => `build/${f}`),
  ...readdirSync(BS_DIR + 'orchestrate').filter((f) => f.endsWith('.md')).map((f) => `orchestrate/${f}`),
  'state-machine.md',
  'templates/RUN-LOG.template.md',
];

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
  it('every entry-point skill has a Model Routing section naming the four roles and citing routing.md', () => {
    for (const file of ENTRY_POINTS) {
      const routing = section(read(file), 'Model Routing');
      expect(routing, `${file} must have a "## Model Routing" section`).not.toBe('');
      for (const role of ['mechanical', 'bounded', 'judgement', 'review']) {
        expect(routing, `${file} Model Routing must name the ${role} role`).toContain(`\`${role}\``);
      }
      expect(routing).toContain('bs-shared/routing.md');
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

  it('the repair loop and red team escalation are bounded by the role ladder, not by a round count', () => {
    const machine = flat(section(read('state-machine.md'), 'Repair Loop Bound'));
    expect(machine).toContain('routing.md');
    expect(machine).not.toMatch(/Maximum \*\*3 audit rounds\*\*/);
    const redteam = flat(section(read('state-machine.md'), 'Redteam Escalation'));
    expect(redteam).toMatch(/never sent back for another investigate round/);
  });
});

describe('the run log records role, agent, review rounds and the verify each round started from (#454)', () => {
  it('RUN-LOG.template.md documents every field', () => {
    const template = read('templates/RUN-LOG.template.md');
    for (const field of ['Work:', 'Role:', 'Agent:', 'Escalated from:', '### Review Round N', 'Level:', 'Verify:', 'Agents:']) {
      expect(template, `RUN-LOG.template.md must document \`${field}\``).toContain(field);
    }
    expect(flat(template)).toMatch(/the verify result the round started from/);
  });
});
