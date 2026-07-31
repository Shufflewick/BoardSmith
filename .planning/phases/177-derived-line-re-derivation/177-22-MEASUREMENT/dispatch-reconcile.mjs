// Dispatches ONE real `claude -p` reconciler call under the real, unmodified
// reconcile-facts.md contract, given both enumerators' completed facts lists and the slice's
// Derived-line list. Prints raw JSON result to stdout.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [, , factsAJson, factsBJson, derivedLinesJson, model] = process.argv;
const contract = readFileSync('/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/verify/reconcile-facts.md', 'utf8');
const factsA = readFileSync(factsAJson, 'utf8');
const factsB = readFileSync(factsBJson, 'utf8');
const derivedLines = JSON.parse(readFileSync(derivedLinesJson, 'utf8'));

const derivedLinesText = derivedLines
  .map((d) => `Line ${d.lineNumber}: ${d.text}`)
  .join('\n');

const prompt = [
  'You are being dispatched as a subagent under the following contract. Read it in full, then',
  'follow it exactly. After the contract, the dispatch payload (pointer block) follows, including',
  'the required token.',
  '',
  '=== CONTRACT (verify/reconcile-facts.md) ===',
  contract,
  '=== END CONTRACT ===',
  '',
  '=== DISPATCH PAYLOAD ===',
  'BS-RECONCILE-V1',
  '',
  '--- Enumerator A facts list ---',
  factsA,
  '',
  '--- Enumerator B facts list ---',
  factsB,
  '',
  "--- This slice's Derived (p.N): lines, verbatim, one per line ---",
  derivedLinesText,
  '=== END DISPATCH PAYLOAD ===',
  '',
  'Return ONLY the structured object the contract specifies (the `{ both, aOnly, bOnly,',
  'derivedLineProposals }` shape), as raw JSON, no prose before or after, no markdown code fence.',
].join('\n');

const args = ['-p', prompt, '--model', model, '--output-format', 'json'];
const out = execFileSync('claude', args, { maxBuffer: 1024 * 1024 * 64, timeout: 400000, encoding: 'utf8' });
process.stdout.write(out);
