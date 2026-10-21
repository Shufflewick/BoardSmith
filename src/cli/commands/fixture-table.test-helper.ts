/**
 * A THROWAWAY TABLE GAME, SERVED BY `boardsmith dev --no-open`, AND GONE
 * AFTERWARDS -- the ordinary-game fixture a browser regression in
 * `scripts/*-browser.mjs` asks for with `table: true` (#703), through
 * `runBrowserRegression` in `scripts/browser-harness.mjs`.
 *
 * The world fixture (`fixture-world.test-helper.ts`) serves a hand-written
 * project in-process. The table road is `boardsmith init`'s own sample run by
 * the real CLI, because the join lobby, Table setup and the GameShell iframe
 * are what an author's project gets, and a hand-written copy would drift.
 *
 * `withFixtureTable` is the only export, for the same reason as the world's
 * (#231): the host must be stopped before its project is removed. The host is
 * started through `Started`, as the smoke check starts it, so a SIGINT or
 * SIGTERM to this process stops it and removes the project too.
 *
 * @module
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { linkGameModules } from '../../testing/installed-modules.test-helper.js';
import { Started, startDev } from '../lib/started-processes.js';
import { REPO_ROOT } from '../spawn-cli.test-helper.js';

/** How long `boardsmith init` gets to scaffold the sample. A hang guard, not a budget. */
const INIT_WITHIN_MS = 120_000;

/** What a fixture's body is handed while its host is serving. */
interface ServedTable {
  /** Where the dev host is served. */
  readonly hostUrl: string;
  /** The project directory. */
  readonly fixture: string;
}

/** Each file a regression puts over the sample, by its path in the project. */
type TableFiles = Readonly<Record<string, string>>;

/** Scaffold `boardsmith init`'s table sample in `parent`, write `files` over it, and install it the way a real game is. */
function writeTableFixture(parent: string, files: TableFiles): string {
  const init = spawnSync(process.execPath, [join(REPO_ROOT, 'bin', 'boardsmith.js'), 'init', 'table-fixture', '--without-rulebook'], {
    cwd: parent,
    encoding: 'utf8',
    timeout: INIT_WITHIN_MS,
  });
  if (init.status !== 0) {
    const why = init.error ? init.error.message : `it exited with code ${init.status}`;
    throw new Error(`boardsmith init could not scaffold the table fixture (${why}):\n${init.stdout}${init.stderr}`);
  }
  const dir = join(parent, 'table-fixture');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  linkGameModules(dir);
  return dir;
}

/**
 * A TABLE GAME, SERVED, AND GONE AFTERWARDS -- IN THAT ORDER (#231).
 *
 * `started.finish` stops the host before it removes the project, whether the
 * body passed, threw, or this process was signalled while it ran.
 *
 * @param body  called with the served fixture; its return value is passed on
 * @param files written over the sample before it is served, such as a regression's own rules and board (#1318)
 */
export async function withFixtureTable<T>(body: (served: ServedTable) => Promise<T>, files: TableFiles = {}): Promise<T> {
  // `realpathSync`: on macOS the temp root is a symlink, and Vite resolves the project by its real path.
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'bs-table-fixture-')));
  const started = new Started();
  try {
    const fixture = writeTableFixture(parent, files);
    const hostUrl = await startDev(started, fixture);
    if (typeof hostUrl !== 'string') throw new Error(`${hostUrl.summary}\n${hostUrl.next}`);
    const interrupted = started.interrupted.then((signal) => {
      throw new Error(`The table fixture was interrupted (${signal}).`);
    });
    // A signal after the body has settled must not crash the cleanup as an unhandled rejection.
    interrupted.catch(() => {});
    return await Promise.race([body({ hostUrl: `${hostUrl}/`, fixture }), interrupted]);
  } finally {
    await started.finish(async () => rmSync(parent, { recursive: true, force: true }));
  }
}
