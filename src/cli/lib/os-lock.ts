/**
 * A lock the kernel releases when its holder exits, however it exits (#441), for `chunk-merge`.
 *
 * `chunk-merge` used to lock with `mkdir` and remove the directory in a `finally`, so a run that was
 * killed (a timeout, a stopped background task) left the lock behind for good, and the refusal
 * could not say who held it. This takes the same kind of lock the repo's merge gate takes (#333): an
 * exclusive `flock` on a file, which the kernel drops when the process holding it exits. Node has
 * no `flock`, so a small `perl` helper holds it on this process's behalf and reads its stdin until
 * end-of-file. That pipe closes when this process exits by any means, a SIGKILL included, so the
 * helper exits and the lock goes with it. Nothing has to judge whether a lock is stale.
 *
 * Beside the lock, `<file>.holder` records who holds it: what it is doing, its pid and since when.
 * The kernel decides who holds the lock; the note only says whom to ask. A killed holder leaves its
 * note behind for the next holder to overwrite.
 *
 * Use: `const lock = await takeOsLock(file, 'chunk-merge of trading (branch chunk/trading)')`. A
 * string is the refusal, ready to show; otherwise do the work and `await lock.release()`.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { once } from 'node:events';

export interface OsLock {
  /** Drops the lock and its holder note. */
  release(): Promise<void>;
}

// Prints `locked` or `held`, then, holding the lock, waits for end-of-file on stdin.
const HELPER =
  '$| = 1; open(my $f, ">>", $ARGV[0]) or die "cannot open $ARGV[0]: $!\\n"; ' +
  'if (!flock($f, 2 | 4)) { print "held\\n"; exit 0; } print "locked\\n"; 1 while <STDIN>;';

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Who holds the lock at `file`, as its holder recorded itself, and how to check on it. */
async function describeHolder(file: string): Promise<string> {
  const wait = 'Merges run one at a time. Wait for it to finish, then run chunk-merge again.';
  const note = await fs.readFile(`${file}.holder`, 'utf-8').catch(() => undefined);
  const field = (name: string) => (note === undefined ? undefined : new RegExp(`^${name}: (.*)$`, 'm').exec(note)?.[1]);
  const pid = Number(field('pid'));
  if (note === undefined || !Number.isInteger(pid) || pid <= 0) {
    return `Another chunk-merge holds the merge lock and has not recorded itself yet. ${wait} Find it with \`lsof ${file}\`.`;
  }
  const holder = `Another chunk-merge holds the merge lock: ${field('holder')}, pid ${pid}, since ${field('since')}.`;
  if (isRunning(pid)) return `${holder} It is still running; check it with \`ps -p ${pid}\`. ${wait}`;
  return (
    `${holder} But pid ${pid} is no longer running, so the lock is held by a process it left behind. ` +
    `Find that process with \`lsof ${file}\`, stop it, then run chunk-merge again.`
  );
}

/** Takes the lock at `file` for `holder`, or returns why not: who holds it and what to do. */
export async function takeOsLock(file: string, holder: string): Promise<OsLock | string> {
  const helper = spawn('perl', ['-e', HELPER, file], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  helper.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
  const answer = await new Promise<string>((done) => {
    let out = '';
    helper.stdout.on('data', (d: Buffer) => {
      out += d.toString();
      if (out.includes('\n')) done(out.trim());
    });
    helper.once('error', (error: NodeJS.ErrnoException) => done(error.code === 'ENOENT' ? 'no perl' : error.message));
    helper.once('close', () => done(out.trim()));
  });
  if (answer === 'no perl') {
    return 'perl is not on PATH, and it is how chunk-merge takes its merge lock. Install perl, then run chunk-merge again.';
  }
  if (answer === 'held') return describeHolder(file);
  if (answer !== 'locked') {
    helper.kill();
    return `Could not take the merge lock at ${file}: ${stderr.trim() || answer || 'the lock helper exited'}. The merge was not started.`;
  }
  const note = `${file}.holder`;
  await fs.writeFile(note, `holder: ${holder}\npid: ${process.pid}\nsince: ${new Date().toISOString()}\n`);
  return {
    async release() {
      await fs.rm(note, { force: true });
      const exited = helper.exitCode === null ? once(helper, 'close') : Promise.resolve();
      helper.stdin.end();
      await exited;
    },
  };
}
