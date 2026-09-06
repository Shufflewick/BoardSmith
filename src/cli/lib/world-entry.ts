/**
 * A WORLD PROJECT ALWAYS HAS A WORLD ENTRY (BoardSmith #170).
 *
 * Before this, `world.html` was a file an author either wrote or did not, and
 * every layer downstream had to branch on the answer: `boardsmith build` emitted
 * the entry only when the file existed, `boardsmith dev` served a fallback
 * document with a debug board in it, and the platform read a `world.ui` flag off
 * the manifest to choose between the bundle's surface and a generic one of its
 * own.
 *
 * That branch is what ShufflewickPub #128 could not survive: a host treating a
 * missing `world.html` as "this game ships no world UI" cannot tell that apart
 * from a UI that failed to deploy, so a broken publish answers with a surface
 * that looks deliberate. Once the entry is ALWAYS emitted, `uiUrl === null`
 * means the publish is broken and nothing else, which is what lets #357 delete
 * the platform's generic `WorldStage`.
 *
 * So a world project that has no entry gets one, written into the project the
 * first time it is built or run. They are then the author's files: ordinary,
 * editable, in source control, and identical to what `boardsmith init --world`
 * scaffolds. Nothing is generated invisibly at build time and nothing has a
 * second code path -- the entry `boardsmith dev` serves is the entry production
 * loads, which is what #167 was for.
 */
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

/** The bundle-root filename a world's surface is served from. */
export const WORLD_ENTRY_HTML = 'world.html';

/** The module `world.html` loads. Relative to the project root. */
export const WORLD_ENTRY_MAIN = join('src', 'world-main.ts');

/** `world.html` -- the document a world's surface is served from. */
function generateWorldHtml(displayName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>${displayName}</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { height: 100%; }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/world-main.ts"></script>
  </body>
</html>
`;
}

/**
 * `src/world-main.ts` -- the mount.
 *
 * It hands `WorldShell` the SAME registry a table's `index.html` hands
 * `GameShell`, which is the whole of what #170 changed here: a world declares
 * its boards in `src/ui/uis.ts` like everything else, so a world with no board
 * of its own gets AutoUI from `devUI(() => import('boardsmith/ui/auto-ui'))`
 * rather than from a fallback document that only existed under `boardsmith dev`.
 */
function generateWorldMainTs(displayName: string): string {
  return `import { createApp, h } from 'vue';
import { WorldShell } from 'boardsmith/ui';
import uis from './ui/uis.js';

createApp({
  render: () => h(WorldShell, { uis, displayName: ${JSON.stringify(displayName)} }),
}).mount('#app');
`;
}

/**
 * Make sure this project has a world entry, writing one if it has none.
 *
 * Returns the paths it created, relative to the project root, so the caller can
 * say so: files appearing in a repository without a word is how a generated
 * thing gets mistaken for a mystery.
 */
export async function ensureWorldEntry(
  cwd: string,
  displayName: string,
): Promise<{ created: string[] }> {
  const created: string[] = [];

  const html = join(cwd, WORLD_ENTRY_HTML);
  if (!existsSync(html)) {
    await writeFile(html, generateWorldHtml(displayName));
    created.push(WORLD_ENTRY_HTML);
  }

  const main = join(cwd, WORLD_ENTRY_MAIN);
  if (!existsSync(main)) {
    await mkdir(dirname(main), { recursive: true });
    await writeFile(main, generateWorldMainTs(displayName));
    created.push(WORLD_ENTRY_MAIN);
  }

  return { created };
}
