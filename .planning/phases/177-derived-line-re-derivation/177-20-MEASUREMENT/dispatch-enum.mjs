// Dispatches ONE real `claude -p` enumerator call for one slice's payload, under the real,
// unmodified enumerate-facts.md contract. Prints the raw JSON result object to stdout (from
// --output-format json); caller extracts .result and parses the facts object.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [, , payloadFile, model] = process.argv;
const contract = readFileSync('/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/verify/enumerate-facts.md', 'utf8');
const payload = readFileSync(payloadFile, 'utf8');

const prompt = [
  'You are being dispatched as a subagent under the following contract. Read it in full, then',
  'follow it exactly. After the contract, the dispatch payload (pointer block) follows, including',
  'the required token.',
  '',
  '=== CONTRACT (verify/enumerate-facts.md) ===',
  contract,
  '=== END CONTRACT ===',
  '',
  '=== DISPATCH PAYLOAD ===',
  payload,
  '=== END DISPATCH PAYLOAD ===',
  '',
  'Return ONLY the structured object the contract specifies (the `{ facts: [...] }` shape), as',
  'raw JSON, no prose before or after, no markdown code fence.',
].join('\n');

const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
const out = execFileSync('claude', args, { maxBuffer: 1024 * 1024 * 64, timeout: 300000, encoding: 'utf8' });
process.stdout.write(out);
