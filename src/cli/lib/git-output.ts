import { execFile } from 'node:child_process';

/**
 * Runs git in `dir` and returns its stdout. Every CLI command runs git through this (#531), so
 * paths come back as written (`core.quotePath=false`) everywhere, a path with non-ASCII characters
 * read here matches the same path read anywhere else, and a whole-project diff or listing fits in
 * the buffer. A non-zero exit rejects with an error naming the git command and what git said,
 * carrying git's exit status as `code` for a caller that tells one non-zero exit from another, and
 * what git said as `stderr` for a caller that shows it without the command.
 * `options.env` replaces the inherited environment, as `execFile`'s does.
 */
export function gitOutput(dir: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      ['-c', 'core.quotePath=false', ...args],
      { cwd: dir, maxBuffer: 256 * 1024 * 1024, env: options.env },
      (error, stdout, stderr) => {
        if (error) {
          const said = String(stderr).trim();
          const message = `git ${args.join(' ')} failed: ${said || error.message.trim()}`;
          reject(Object.assign(new Error(message), { code: error.code, stderr: said }));
        } else resolvePromise(String(stdout));
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

/**
 * Runs git in the project's own repository at `dir`: without the variables git clears when it enters
 * another one, such as an inherited GIT_DIR or a core.hooksPath passed down in GIT_CONFIG_PARAMETERS
 * (#1301, #1321). For a command run on a game project, which may be started from inside another
 * repository's hook or `git -c` alias.
 */
export async function projectGitOutput(dir: string, args: string[]): Promise<string> {
  const env = { ...process.env };
  for (const name of (await gitOutput(dir, ['rev-parse', '--local-env-vars'])).split('\n')) delete env[name];
  return gitOutput(dir, args, { env });
}

/** `gitSucceeds`, in the project's own repository as `projectGitOutput` runs it. */
export function projectGitSucceeds(dir: string, args: string[]): Promise<boolean> {
  return projectGitOutput(dir, args).then(
    () => true,
    () => false,
  );
}

/**
 * A `git blame --porcelain` (or `--line-porcelain`) header line: the commit and the line's number in
 * the file as it is now; undefined for any other line. A hash is 40 characters in a SHA-1
 * repository and 64 in a SHA-256 one, and a line not committed yet has an all-zero hash.
 */
export function blameHeader(line: string): { commit: string | null; line: number } | undefined {
  const header = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)/.exec(line);
  if (!header) return undefined;
  return { commit: /^0+$/.test(header[1]) ? null : header[1], line: Number(header[2]) };
}
