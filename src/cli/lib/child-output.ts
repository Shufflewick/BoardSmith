import type { ChildProcess } from 'node:child_process';

/**
 * Everything a child process prints, stdout and stderr together, as it arrives: for the commands
 * that start `boardsmith dev` and read what it says (the smoke check, and the tests that spawn it).
 */
export function collectOutput(child: ChildProcess): () => string {
  let output = '';
  // A stream's own decoder holds a character split across chunks until its last byte arrives.
  child.stdout?.setEncoding('utf-8').on('data', (chunk: string) => (output += chunk));
  child.stderr?.setEncoding('utf-8').on('data', (chunk: string) => (output += chunk));
  return () => output;
}
