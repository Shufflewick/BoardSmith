// Reached by `spawn` from `started-processes.ts`, never by an import.
// fallow-ignore-file unused-file
/**
 * Leads the process group `Started.spawn` gives a child with `ownGroup` (#1648): runs the command in
 * its arguments under this Node, inside its group, and passes its exit on. Its stdin is a pipe from
 * the run, so when the run ends without stopping it, even by SIGKILL, the pipe closes and the whole
 * group is killed, rather than going on with no parent (#1646 review F2).
 *
 * Usage: `node group-leader.mjs <script> [args...]`
 */
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, process.argv.slice(2), { stdio: ['ignore', 'inherit', 'inherit'] });

// A signal to the group reaches the child as well; this leader waits for it to end, to pass that on.
const wait = () => {};
process.on('SIGINT', wait);
process.on('SIGTERM', wait);

process.stdin.on('end', () => process.kill(-process.pid, 'SIGKILL')).resume();

child.on('exit', (code, signal) => {
  if (signal === null) process.exit(code);
  process.off('SIGINT', wait);
  process.off('SIGTERM', wait);
  process.kill(process.pid, signal);
});
