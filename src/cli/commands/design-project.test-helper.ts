/**
 * The design-project fixtures `verify-derive-check` and `verify-example-replay`
 * both build (#238).
 *
 * Between them these two suites hand-copied `makeProject` four times,
 * `writeJson` four times, and the archived-source rulebook setup four more --
 * verbatim, comments included. They are testing different commands over the
 * same project shape, which is a missing helper rather than a coincidence, and
 * copies of a fixture drift: the day the design layout changes, four of the
 * eight copies get updated and the other four keep passing against a shape the
 * CLI no longer reads.
 *
 * `makeProject` and `writeJson` are handed back bound to the suite's temp tree
 * rather than taking it per call, because the tree is assigned in a
 * `beforeEach` and the call sites read better without it. The tree itself
 * belongs to `tempTree` (#236); nothing here creates or removes one.
 */
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { DESIGN_DIR, resolveDesignRelative } from '../lib/project-paths.js';
import { renderIndex } from './ingest-archive.js';

/** The fixture writers a suite gets for its own temp tree. */
interface DesignProjectFixtures {
  /**
   * A design project at `<tree>/project` holding `files`.
   *
   * Keys are written the way a design doc writes them -- `rulebook/02-x.md`,
   * not `design/rulebook/02-x.md` -- so the fixture exercises the same
   * resolution the CLI does.
   */
  makeProject(files: Record<string, string>): Promise<string>;
  /** A JSON file directly in the tree, at the path the command is handed. */
  writeJson(name: string, value: unknown): Promise<string>;
}

/**
 * `tree` is read on each call rather than captured, because a suite assigns its
 * temp tree in a `beforeEach` that runs after this is called.
 */
export function designProjectFixtures(tree: () => string): DesignProjectFixtures {
  return {
    async makeProject(files) {
      const project = join(tree(), 'project');
      for (const [relPath, text] of Object.entries(files)) {
        const full = resolveDesignRelative(project, relPath);
        await fs.mkdir(dirname(full), { recursive: true });
        await fs.writeFile(full, text);
      }
      return project;
    },
    async writeJson(name, value) {
      const filePath = join(tree(), name);
      await fs.writeFile(filePath, JSON.stringify(value, null, 2));
      return filePath;
    },
  };
}

/** What a project's archived rulebook source is, once it has one. */
interface ArchivedSource {
  /** The bytes on disk, so a caller can archive them somewhere else too. */
  bytes: Buffer;
  /** Their SHA-256, as recorded in the INDEX.md this wrote. */
  hash: string;
  /** Where INDEX.md says the archive is, relative to the design dir. */
  archivedPath: string;
}

/**
 * Give `project` an archived rulebook source and an INDEX.md that records its
 * hash -- the state `QuoteVerifiedProvenance` reads as "this slice is covered".
 *
 * Callers add whatever their case is about on top: an unarchived second PDF, a
 * slice file, a loose copy at the project root.
 */
export async function archiveRulebookSource(project: string): Promise<ArchivedSource> {
  const rulebookDir = join(project, DESIGN_DIR, 'rulebook');
  await fs.mkdir(rulebookDir, { recursive: true });
  const bytes = Buffer.from('%PDF-1.4 fake rulebook bytes\n');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const archivedPath = 'rulebook/source/rules.pdf';
  await fs.writeFile(
    join(rulebookDir, 'INDEX.md'),
    renderIndex({
      gameName: 'game',
      edition: 'First Printing 2020',
      archivedPath,
      sourceHash: hash,
      transcribed: '2026-07-28',
    }),
  );
  await fs.mkdir(dirname(join(project, DESIGN_DIR, archivedPath)), { recursive: true });
  await fs.writeFile(join(project, DESIGN_DIR, archivedPath), bytes);
  return { bytes, hash, archivedPath };
}
