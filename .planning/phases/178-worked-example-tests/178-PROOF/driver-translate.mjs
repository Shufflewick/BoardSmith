import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const BASE = '/private/tmp/claude-501/-Users-jtsmith-BoardSmith/ec67162e-8441-486e-81a5-9664c77fbf70/scratchpad/178-11';
const CONTRACT = '/Users/jtsmith/BoardSmith/src/cli/slash-command/bs/verify/translate-example.md';
const MODEL = 'claude-sonnet-5';
const CONCURRENCY = 5;

const payloadsDir = join(BASE, 'translate-payload-files');
const outDir = join(BASE, 'translate-raw');
mkdirSync(outDir, { recursive: true });

const files = readdirSync(payloadsDir).filter((f) => f.endsWith('.payload.txt'));

function run(args) {
  return new Promise((resolve, reject) => {
    execFile('node', args, { cwd: BASE, maxBuffer: 1024 * 1024 * 64, timeout: 400000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`dispatch failed: ${err.message}\nstderr: ${stderr.slice(0, 4000)}`));
      else resolve(stdout);
    });
  });
}

function extractJson(rawClaudeOutput) {
  const parsed = JSON.parse(rawClaudeOutput);
  let result = parsed.result ?? '';
  const fenceMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) result = fenceMatch[1];
  return { raw: parsed, resultText: result.trim() };
}

async function processFile(fname) {
  const slug = basename(fname, '.payload.txt');
  const outFile = join(outDir, `${slug}.raw.json`);
  const log = (msg) => console.log(`[translate] [${slug}] ${msg}`);
  if (existsSync(outFile)) {
    log('already done, skipping');
    return { slug, status: 'skipped' };
  }
  try {
    log('dispatching...');
    const raw = await run(['dispatch-example.mjs', CONTRACT, join(payloadsDir, fname), MODEL]);
    const { raw: rawParsed, resultText } = extractJson(raw);
    writeFileSync(outFile, JSON.stringify({ raw: rawParsed, result: resultText }, null, 2));
    log('done');
    return { slug, status: 'ok' };
  } catch (e) {
    log(`ERROR: ${e.message}`);
    writeFileSync(join(outDir, `${slug}.ERROR.txt`), e.message);
    return { slug, status: 'error', error: e.message };
  }
}

async function main() {
  console.log(`${files.length} translation dispatches, concurrency ${CONCURRENCY}`);
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < files.length) {
      const f = files[idx++];
      results.push(await processFile(f));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  writeFileSync(join(outDir, 'run-summary.json'), JSON.stringify(results, null, 2));
  console.log(`COMPLETE. ${results.filter((r) => r.status === 'ok').length}/${results.length} ok, ${results.filter((r) => r.status === 'error').length} errors`);
}

main();
