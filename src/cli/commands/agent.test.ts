import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { tempTree } from '../../testing/temp-tree.test-helper.js';
import { agentCommand } from './agent.js';

/**
 * `boardsmith agent <role>` (#454): the agent type the bs- skills dispatch a role as, and the role a
 * failed step climbs to. HOME is a temp tree, so the check for an installed bs- agent never reads
 * the real ~/.claude.
 */

let project: string;
let home: string;
let realHome: string | undefined;
let printed: string[];

beforeEach(async () => {
  const tree = tempTree('bs-agent-command-');
  project = join(tree, 'game');
  home = join(tree, 'home');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  realHome = process.env.HOME;
  process.env.HOME = home;
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => {
    printed.push(line);
  });
});

afterEach(() => {
  process.env.HOME = realHome;
  vi.restoreAllMocks();
});

async function config(extra: Record<string, unknown> = {}): Promise<void> {
  await fs.writeFile(join(project, 'boardsmith.json'), JSON.stringify({ name: 'game', ...extra }));
}

async function installAgent(dir: string, name: string): Promise<void> {
  await fs.mkdir(join(dir, '.claude', 'agents'), { recursive: true });
  await fs.writeFile(join(dir, '.claude', 'agents', `${name}.md`), `---\nname: ${name}\n---\n`);
}

describe('boardsmith agent <role>', () => {
  it('prints the bs- default when the project maps the role to nothing, once it is installed', async () => {
    await config();
    await installAgent(home, 'bs-judgement');
    await agentCommand('judgement', { project });
    expect(printed).toEqual(['judgement: bs-judgement']);
  });

  it('finds a bs- agent installed in the project as well as in the home directory', async () => {
    await config();
    await installAgent(project, 'bs-bounded');
    await agentCommand('bounded', { project });
    expect(printed).toEqual(['bounded: bs-bounded']);
  });

  it('prints the agent type boardsmith.json maps the role to, installed or not', async () => {
    await config({ agents: { judgement: 'senior', review: 'reviewer' } });
    await agentCommand('review', { project });
    expect(printed).toEqual(['review: reviewer']);
  });

  it('refuses a bs- default that is not installed, and says how to install it', async () => {
    await config();
    await expect(agentCommand('review', { project })).rejects.toThrow(
      /dispatched as bs-review, which is not installed.*Run `npx boardsmith claude`/s,
    );
  });

  it('refuses an unknown role and a bad mapping, each in words that say what to write', async () => {
    await config({ agents: { judgment: 'senior' } });
    await expect(agentCommand('senior', { project })).rejects.toThrow(/Unknown role "senior"\. The roles are/);
    await expect(agentCommand('judgement', { project })).rejects.toThrow(/did you mean "judgement"\?/);
  });

  it('refuses a directory with no boardsmith.json', async () => {
    await expect(agentCommand('judgement', { project })).rejects.toThrow(/has no boardsmith\.json.*--project <dir>/s);
  });
});

describe('boardsmith agent <role> --escalate', () => {
  it('names the next role up and its agent type', async () => {
    await config({ agents: { judgement: 'senior' } });
    await installAgent(home, 'bs-bounded');
    await agentCommand('mechanical', { project, escalate: true });
    await agentCommand('bounded', { project, escalate: true });
    expect(printed).toEqual(['bounded: bs-bounded', 'judgement: senior']);
  });

  it('stops at judgement and says to ask the designer, naming the two exceptions that get one more judgement round', async () => {
    await config();
    const refusal = agentCommand('judgement', { project, escalate: true });
    await expect(refusal).rejects.toThrow(/judgement is the top role.*ask the designer/s);
    await expect(refusal).rejects.toThrow(/red-team re-investigation or a repair.*one more judgement round/s);
    await expect(refusal).rejects.toThrow(/claim-quote-check refusal.*one narrower quote-fix/s);
  });

  it('refuses to climb from review: the step it reviewed is the one that failed', async () => {
    await config();
    await expect(agentCommand('review', { project, escalate: true })).rejects.toThrow(
      /review role does not climb.*boardsmith agent <that step's role> --escalate/s,
    );
  });
});
