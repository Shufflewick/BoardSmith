import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Runs git in `dir` and returns its stdout, for `boardsmith verify` and the modules it reads
 * results and cached mutant outcomes through. Paths come back as written (`core.quotePath=false`),
 * and a whole-project diff or listing fits in the buffer. A non-zero exit rejects.
 */
export async function gitOutput(dir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd: dir,
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}
