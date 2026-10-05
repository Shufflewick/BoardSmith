import { execFile } from 'node:child_process';

/**
 * Runs git in `dir` and returns its stdout. Every CLI command runs git through this (#531), so
 * paths come back as written (`core.quotePath=false`) everywhere, a path with non-ASCII characters
 * read here matches the same path read anywhere else, and a whole-project diff or listing fits in
 * the buffer. A non-zero exit rejects with an error naming the git command and what git said.
 */
export function gitOutput(dir: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd: dir, maxBuffer: 256 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(new Error(`git ${args.join(' ')} failed: ${(String(stderr) || error.message).trim()}`));
        else resolvePromise(String(stdout));
      },
    );
  });
}

/**
 * Whether git exits zero, for a yes/no question (`merge-base --is-ancestor`, `check-ignore -q`,
 * `rev-parse --verify`) where a non-zero exit is the answer "no", not a failure.
 */
export function gitSucceeds(dir: string, args: string[]): Promise<boolean> {
  return gitOutput(dir, args).then(
    () => true,
    () => false,
  );
}
