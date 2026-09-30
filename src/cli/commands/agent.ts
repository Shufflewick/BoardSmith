/**
 * `boardsmith agent <role> [--escalate] [--project <dir>]` (#454).
 *
 * The bs- skills name roles, never models (`lib/agent-roles.ts`). Before every dispatch they ask
 * this command which agent type to dispatch the role as, and it prints `<role>: <agent type>`: the
 * type the project's boardsmith.json `agents` block maps the role to, else BoardSmith's own
 * `bs-<role>` agent, which must then be installed (`boardsmith claude`), in the project or in the
 * home directory.
 *
 * With `--escalate` it answers the other question the skills ask, after a step fails at `<role>`
 * (its verify failed, or its reviewer asked for changes): which role takes the step next. That is
 * always the next role up, never the same one. There is nothing above judgement, so there the
 * command refuses and says to ask the designer.
 *
 * Throws, with what to do, on anything it cannot answer; cli.ts prints the message and exits 1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { ESCALATION_LADDER, type Role, type WorkRole, agentTypeFor, defaultAgentType, nextRole, parseRole } from '../lib/agent-roles.js';

function readProjectConfig(projectDir: string): Record<string, unknown> {
  const path = join(projectDir, 'boardsmith.json');
  if (!existsSync(path)) {
    throw new Error(
      `boardsmith agent reads which agent each role is dispatched as from boardsmith.json, and ${projectDir} has no boardsmith.json. ` +
        "Run it in the game's directory, or pass --project <dir>.",
    );
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`boardsmith.json in ${projectDir} is not valid JSON (${(error as Error).message}). Fix it, then run this again.`);
  }
}

/** Where Claude Code finds an agent a project can dispatch: the project's own, then the user's. */
function isInstalled(projectDir: string, agentType: string): boolean {
  return [projectDir, homedir()].some((dir) => existsSync(join(dir, '.claude', 'agents', `${agentType}.md`)));
}

/** The agent type to dispatch `role` as in the project, checked to exist when it is a bs- default. */
function dispatchableAgent(projectDir: string, config: Record<string, unknown>, role: Role): string {
  const agentType = agentTypeFor(config, role);
  if (agentType === defaultAgentType(role) && !isInstalled(projectDir, agentType)) {
    throw new Error(
      `The ${role} role is dispatched as ${agentType}, which is not installed in this project or in your home directory. ` +
        'Run `npx boardsmith claude` to install BoardSmith\'s role agents, or map the role to an agent you have in ' +
        `boardsmith.json, e.g. "agents": { "${role}": "<agent type>" }.`,
    );
  }
  return agentType;
}

/** The role a step that failed at `role` goes to, or an error saying why there is none. */
function escalatedRole(role: Role): Role {
  if (!(ESCALATION_LADDER as readonly string[]).includes(role)) {
    throw new Error(
      `The ${role} role does not climb: it checks another step's work, and when it finds a problem, the step whose work ` +
        "it checked is the one that failed. Run `boardsmith agent <that step's role> --escalate`.",
    );
  }
  const next = nextRole(role as WorkRole);
  if (next === undefined) {
    throw new Error(
      'judgement is the top role, so no role above it takes this step. The one exception (routing.md): a red-team ' +
        're-investigation or a repair that failed at judgement for the first time gets exactly one more judgement round; ' +
        'dispatch `boardsmith agent judgement` for it. Any other step, or one that has already had that round: stop and ask ' +
        'the designer. Tell them, in their terms, what the step was for, what failed, and what each attempt tried, and ' +
        'dispatch nothing more for this step until they answer.',
    );
  }
  return next;
}

export async function agentCommand(roleName: string, options: { project?: string; escalate?: boolean }): Promise<void> {
  const projectDir = resolve(options.project ?? process.cwd());
  const asked = parseRole(roleName);
  const role = options.escalate ? escalatedRole(asked) : asked;
  const config = readProjectConfig(projectDir);
  console.log(`${role}: ${dispatchableAgent(projectDir, config, role)}`);
}
