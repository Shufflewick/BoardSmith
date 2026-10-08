import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { commandBuildDirPrefix } from './project-paths.js';

/**
 * The build directories of `command` on disk in `projectDir` right now, as absolute paths. A test
 * asserts there is one while a run is going and none once it has ended; each run names its own
 * (`makeCommandBuildDir`), so a test cannot know the name in advance.
 */
export function commandBuildDirs(projectDir: string, command: Parameters<typeof commandBuildDirPrefix>[0]): string[] {
  const parent = join(projectDir, '.boardsmith');
  if (!existsSync(parent)) return [];
  return readdirSync(parent)
    .filter((name) => name.startsWith(commandBuildDirPrefix(command)))
    .map((name) => join(parent, name));
}
