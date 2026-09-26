import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_DIR } from '../lib/project-paths.js';
import { SIGNOFF_HEADING } from './chunk-signoff.js';

/**
 * A game project on disk with the chunks a sign-off test needs: each chunk's CHUNK.md made from
 * the real template, its SKETCH.md entry, the files its Build Manifest names, and the project's
 * CONSTRAINTS.md. Used by the `chunk-signoff` and `chunk-gate-transition` tests.
 */
export interface ChunkSpec {
  slug: string;
  status?: string;
  ui?: 'none' | 'touches' | 'major';
  milestone?: 'none' | 'core-loop' | 'scoring' | 'final-acceptance';
  checklist?: string[];
  /** Build Manifest rows: project-relative path to file contents, written to disk too. */
  manifest?: Record<string, string>;
  /** Replaces the template's placeholder claim in `## Interpretation`. */
  interpretation?: string;
  /** A CHUNK.md made before #291: it has no `## Sign-off` section at all. */
  preGate?: boolean;
}

function chunkText(template: string, c: ChunkSpec): string {
  let text = template.replace(/^Status: proposed$/m, `Status: ${c.status ?? 'built'}`);
  text = text.replace(/(## ui:\n<!--[\s\S]*?-->\n)none\n/, `$1${c.ui ?? 'touches'}\n`);
  text = text.replace(
    '- [ ] <!-- item 1 -->\n- [ ] <!-- item 2 -->',
    (c.checklist ?? ['Draw a card', 'Pass the turn']).map((item) => `- [ ] ${item}`).join('\n'),
  );
  text = text.replace(
    '<!-- | src/... | written / pending | -->',
    Object.keys(c.manifest ?? {}).map((path) => `| ${path} | written |`).join('\n'),
  );
  if (c.interpretation !== undefined) {
    text = text.replace(/^1\. \*\*<!-- claim text -->\*\*\n.*\n.*\n/m, `${c.interpretation}\n`);
  }
  if (c.preGate) {
    text = text.replace(new RegExp(`^${SIGNOFF_HEADING}\\n[\\s\\S]*?(?=^## )`, 'm'), '');
  }
  return text;
}

function sketchEntry(c: ChunkSpec): string {
  const status = c.status ?? 'built';
  return [
    `### ${c.slug}`,
    `- What it builds: ${c.slug}`,
    `- Citations: none`,
    `- ui: ${c.ui ?? 'touches'}`,
    `- Milestone: ${c.milestone ?? 'core-loop'}`,
    `- Status (derived from chunks/${c.slug}/CHUNK.md): ${status}`,
    `- Rules Staleness (derived from chunks/${c.slug}/CHUNK.md): clear`,
    `- Test script (outcome-based): play it`,
    '',
  ].join('\n');
}

export async function makeChunkProject(root: string, chunks: ChunkSpec[]): Promise<string> {
  const project = join(root, 'game');
  const design = join(project, DESIGN_DIR);
  await fs.mkdir(design, { recursive: true });
  const template = await fs.readFile(
    new URL('../slash-command/bs/templates/CHUNK.template.md', import.meta.url),
    'utf-8',
  );

  for (const c of chunks) {
    for (const [path, content] of Object.entries(c.manifest ?? {})) {
      const onDisk = path.endsWith('DECISIONS.md') ? join(design, path) : join(project, path);
      await fs.mkdir(join(onDisk, '..'), { recursive: true });
      await fs.writeFile(onDisk, content);
    }
    const chunkDir = join(design, 'chunks', c.slug);
    await fs.mkdir(chunkDir, { recursive: true });
    await fs.writeFile(join(chunkDir, 'CHUNK.md'), chunkText(template, c));
  }
  await fs.copyFile(
    new URL('../slash-command/bs/templates/CONSTRAINTS.template.md', import.meta.url),
    join(design, 'CONSTRAINTS.md'),
  );
  await fs.writeFile(
    join(design, 'SKETCH.md'),
    `# Sketch\n\n## Ordered Chunk List\n\n${chunks.map(sketchEntry).join('\n')}\n### later-tail\n- What it builds: later\n- ui: none\n- Milestone: none\n- Status: proposed (sketch-level — no CHUNK.md yet)\n`,
  );
  return project;
}

export async function readChunk(project: string, slug: string): Promise<string> {
  return fs.readFile(join(project, DESIGN_DIR, 'chunks', slug, 'CHUNK.md'), 'utf-8');
}

export async function readSketch(project: string): Promise<string> {
  return fs.readFile(join(project, DESIGN_DIR, 'SKETCH.md'), 'utf-8');
}

export async function setStatusByHand(project: string, slug: string, status: string): Promise<void> {
  const path = join(project, DESIGN_DIR, 'chunks', slug, 'CHUNK.md');
  const text = await fs.readFile(path, 'utf-8');
  await fs.writeFile(path, text.replace(/^Status:.*$/m, `Status: ${status}`));
}
