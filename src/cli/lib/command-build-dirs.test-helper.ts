import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';

import { commandBuildDirPrefix, makeCommandBuildDir } from './command-build-dir.js';
import { scratchDir } from './project-paths.js';

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

const OTHER_RUN = 'another run is still using this\n';

/**
 * Leaves in `projectDir` the files other runs of verify and the test-step check would hold while
 * they are still going: each one's own run directory, and a file in each scratch folder these
 * checks once shared (#544). Call it before the run under test; the function it returns asserts
 * that every one of those files is still there and that the run left no directory of its own behind.
 */
export function plantOtherRuns(projectDir: string): () => void {
  const planted = [
    join(scratchDir(projectDir), 'verify', 'test-report.json'),
    join(scratchDir(projectDir), 'test-step-check', 'mutant.json'),
    join(scratchDir(projectDir), 'verify-mutation', 'mutant.json'),
    join(makeCommandBuildDir(projectDir, 'verify'), 'test-report.json'),
    join(makeCommandBuildDir(projectDir, 'test-step-check'), 'mutant.json'),
    join(makeCommandBuildDir(projectDir, 'verify-mutation'), 'mutant.json'),
  ];
  for (const path of planted) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, OTHER_RUN);
  }
  const left = () => ({
    runDirs: (['verify', 'test-step-check', 'verify-mutation'] as const).flatMap((c) => commandBuildDirs(projectDir, c)).sort(),
    scratch: readdirSync(scratchDir(projectDir)).sort(),
  });
  const before = left();
  return () => {
    for (const path of planted) {
      expect(existsSync(path) && readFileSync(path, 'utf-8'), `the run removed ${path}, which another run made`).toBe(OTHER_RUN);
    }
    expect(left(), 'the run left a directory behind').toEqual(before);
  };
}
