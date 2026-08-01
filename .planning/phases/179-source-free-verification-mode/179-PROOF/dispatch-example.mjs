// Dispatches ONE real `claude -p` call under a named worked-example contract (extraction or
// translation). Adapted from 177-22-MEASUREMENT/dispatch-enum.mjs — same execFileSync shape,
// same "contract verbatim + payload" prompt construction, generalized to take the contract path
// as an argument instead of hardcoding enumerate-facts.md.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [, , contractPath, payloadFile, model] = process.argv;
if (!contractPath || !payloadFile || !model) {
  console.error('usage: dispatch-example.mjs <contractPath> <payloadFile> <model>');
  process.exit(1);
}
const contract = readFileSync(contractPath, 'utf8');
const payload = readFileSync(payloadFile, 'utf8');

const prompt = [
  'You are being dispatched as a subagent under the following contract. Read it in full, then',
  'follow it exactly. After the contract, the dispatch payload (pointer block) follows, including',
  'the required token.',
  '',
  `=== CONTRACT (${contractPath}) ===`,
  contract,
  '=== END CONTRACT ===',
  '',
  '=== DISPATCH PAYLOAD ===',
  payload,
  '=== END DISPATCH PAYLOAD ===',
  '',
  'Return ONLY the structured object the contract specifies, as raw JSON, no prose before or',
  'after, no markdown code fence.',
].join('\n');

const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
const out = execFileSync('claude', args, { maxBuffer: 1024 * 1024 * 64, timeout: 300000, encoding: 'utf8' });
process.stdout.write(out);
