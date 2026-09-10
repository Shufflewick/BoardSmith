import { homedir } from 'node:os';
import { resolve } from 'node:path';

/**
 * The one way a CLI command turns a path a user typed into an absolute one.
 *
 * `join(base, userPath)` is the trap this closes. `join` treats an absolute
 * second argument as just another segment, so `--out-dir /private/tmp/scratch`
 * became `<repo>/private/tmp/scratch` -- the flag looked ignored, but what it
 * actually did was write inside the invocation directory and leave an untracked
 * tree behind (#239). A dirty BoardSmith checkout is exactly what
 * ShufflewickPub's `vendor:boardsmith` refuses to pack from, so the side effect
 * of an ignored flag broke a whole downstream release path.
 *
 * There were two of those, in `pack` and in `build`, and both read as obviously
 * correct. That is why this is a shared function with a gate over the CLI
 * source rather than two corrected call sites: the next command to take a path
 * would have written the same line.
 *
 * `base` is the directory a relative path is relative to -- almost always
 * `process.cwd()`, because that is what a user typing a relative path means.
 */
export function resolveUserPath(base: string, userPath: string): string {
  if (userPath.trim() === '') {
    throw new Error('Path is empty. Pass the directory or file the command should use.');
  }

  // A shell expands `~` before the CLI sees it, but a quoted argument
  // (`--out-dir '~/out'`) and a value read out of a config file both arrive
  // literal. Resolving those against `base` would create a directory whose
  // name is a single tilde. `~cache` is left alone: that is a real name.
  const expanded = userPath === '~' || userPath.startsWith('~/')
    ? homedir() + userPath.slice(1)
    : userPath;

  return resolve(base, expanded);
}
