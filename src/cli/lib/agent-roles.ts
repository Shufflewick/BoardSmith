import { suggestKey } from './config-schema.js';

/**
 * The roles the bs- skills hand work to, and which Claude Code agent type each one is
 * dispatched as in a project (#454).
 *
 * The skills never name a model. They name a role:
 *
 *   mechanical  bulk edits, searches, summaries: work a machine can check
 *   bounded     implementation where failing tests already say what done is
 *   judgement   spec, investigate, red team, fidelity, anything touching a ruling
 *   review      the review of finished work, once `boardsmith verify` has passed
 *   second-opinion  an independent second reading of work the judgement role also does, such as
 *               `/bs-verify-game`'s second enumerator; it must be a different agent from judgement
 *
 * `boardsmith claude` installs one agent per role (`bs-mechanical`, `bs-bounded`, `bs-judgement`,
 * `bs-review`, `bs-second-opinion`), so a designer with only BoardSmith has a working setup. A project that wants other
 * agents names them in boardsmith.json, role by role:
 *
 *   "agents": { "judgement": "senior", "review": "reviewer" }
 *
 * A role the block leaves out is dispatched as its bs- default. Nothing is detected: the mapping is
 * what the project says, or the default. `boardsmith agent <role>` prints the agent type to dispatch,
 * and `boardsmith validate` refuses a block this module refuses.
 */

export const ROLES = ['mechanical', 'bounded', 'judgement', 'review', 'second-opinion'] as const;

export type Role = (typeof ROLES)[number];

/**
 * The roles a failed step climbs, lowest first. A step that fails (its verify fails,
 * `claim-quote-check` refuses its claims, or its reviewer asks for changes) goes to the next role
 * up, never again to the same one; a step that fails at the top goes to the designer, apart from
 * routing.md's three named exceptions. `review` and `second-opinion` are not on it: when a
 * reviewer asks for changes, the step whose work it reviewed is the one that failed.
 */
export const ESCALATION_LADDER = ['mechanical', 'bounded', 'judgement'] as const;

export type WorkRole = (typeof ESCALATION_LADDER)[number];

const ROLE_LIST = 'The roles are mechanical, bounded, judgement, review and second-opinion.';

const EXAMPLE = '{ "judgement": "senior", "review": "reviewer" }';

/** The agent BoardSmith installs for `role`, dispatched when the project maps it to nothing else. */
export function defaultAgentType(role: Role): string {
  return `bs-${role}`;
}

/** `value` as a role, or an error naming every role and the one it is closest to. */
export function parseRole(value: string): Role {
  if ((ROLES as readonly string[]).includes(value)) return value as Role;
  const near = suggestKey(value, ROLES);
  throw new Error(`Unknown role "${value}"${near ? `; did you mean "${near}"?` : '.'} ${ROLE_LIST}`);
}

/** The role a step that failed at `role` goes to next, or undefined when `role` is the top. */
export function nextRole(role: WorkRole): WorkRole | undefined {
  return ESCALATION_LADDER[ESCALATION_LADDER.indexOf(role) + 1];
}

/** Whether `value` can name a Claude Code agent type: a non-empty word with no spaces. */
function isAgentTypeName(value: unknown): value is string {
  return typeof value === 'string' && /^\S+$/.test(value);
}

/** What is wrong with one `"<key>": <value>` pair of the block, or undefined when it is right. */
function entryProblem(key: string, value: unknown): string | undefined {
  if (!(ROLES as readonly string[]).includes(key)) {
    const near = suggestKey(key, ROLES);
    return `Unknown role "${key}" in "agents"${near ? `; did you mean "${near}"?` : '.'} ${ROLE_LIST}`;
  }
  if (isAgentTypeName(value)) return undefined;
  return (
    `"agents.${key}" must be the name of a Claude Code agent type, with no spaces, e.g. "${key === 'review' ? 'reviewer' : 'senior'}". ` +
    `Got ${JSON.stringify(value)}. Leave the role out to dispatch it as ${defaultAgentType(key as Role)}.`
  );
}

/**
 * What is wrong with a boardsmith.json `agents` block, each problem saying what to write instead.
 * Empty when the block is right, or absent.
 */
export function agentsBlockProblems(block: unknown): string[] {
  if (block === undefined) return [];
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    return [
      `"agents" must be an object mapping a role to the agent type to dispatch for it, e.g. ${EXAMPLE}. ` +
        `Got ${JSON.stringify(block)}.`,
    ];
  }
  const problems = Object.entries(block).flatMap(([key, value]) => entryProblem(key, value) ?? []);
  return problems.length > 0 ? problems : independenceProblems(block as Record<string, string>);
}

/**
 * A second opinion is worth having only when it comes from a different agent than the reading it
 * checks, so the two roles may never resolve to the same agent type.
 */
function independenceProblems(block: Record<string, string>): string[] {
  const judgement = block.judgement ?? defaultAgentType('judgement');
  const second = block['second-opinion'] ?? defaultAgentType('second-opinion');
  if (judgement !== second) return [];
  return [
    `"agents" dispatches second-opinion and judgement as the same agent type, "${judgement}". A second opinion checks ` +
      'the judgement role\'s reading independently, which the same agent cannot do. Map second-opinion to an agent on a ' +
      `different model, or leave it out to use ${defaultAgentType('second-opinion')}.`,
  ];
}

/**
 * The agent type to dispatch `role` as, for a project whose boardsmith.json is `config`: the type
 * its `agents` block maps the role to, else the bs- default. Throws the block's problems, so no
 * work is dispatched on a mapping the project got wrong.
 */
export function agentTypeFor(config: Record<string, unknown>, role: Role): string {
  const problems = agentsBlockProblems(config.agents);
  if (problems.length > 0) {
    throw new Error(`boardsmith.json has a problem in "agents": ${problems.join(' ')}`);
  }
  const mapped = (config.agents as Record<string, string> | undefined)?.[role];
  return mapped ?? defaultAgentType(role);
}
