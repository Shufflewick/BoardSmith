import type { ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

/** Everything a child process prints, stdout and stderr together, as it arrives. */
export function collectOutput(child: ChildProcess): () => string {
  let output = '';
  // A stream's own decoder holds a character split across chunks until its last byte arrives.
  child.stdout?.setEncoding('utf-8').on('data', (chunk: string) => (output += chunk));
  child.stderr?.setEncoding('utf-8').on('data', (chunk: string) => (output += chunk));
  return () => output;
}

/** Hands `log` each non-empty line `stream` prints once the line is whole, and the last line when the stream ends. */
export function logLines(stream: Readable, log: (line: string) => void): void {
  createInterface({ input: stream, crlfDelay: Infinity }).on('line', (line) => line && log(line));
}
