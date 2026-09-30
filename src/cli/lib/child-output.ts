import type { ChildProcess } from 'node:child_process';

/**
 * Everything a child process prints, stdout and stderr together, as it arrives: for the commands
 * that start `boardsmith dev` and read what it says (the smoke check, and the tests that spawn it).
 */
export function collectOutput(child: ChildProcess): () => string {
  let output = '';
  child.stdout?.on('data', (chunk) => (output += chunk));
  child.stderr?.on('data', (chunk) => (output += chunk));
  return () => output;
}
