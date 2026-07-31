// Drives one full run (all dispatchable slices: 2 enumerators + 1 reconciler each) with
// bounded concurrency. Real `claude -p` dispatches only — no simulation. Uses two explicit,
// different-family model ids (not CLI aliases) per this run's brief.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const RUN = process.argv[2]; // 'run1' or 'run2'
if (!RUN) throw new Error('usage: driver.mjs run1|run2');

const BASE = '/private/tmp/claude-501/-Users-jtsmith-BoardSmith/39655717-66f7-4931-ad0d-d86278ea06be/scratchpad/177-22';
const manifest = JSON.parse(readFileSync(join(BASE, 'manifest.json'), 'utf8'));
const OUT = join(BASE, RUN);
mkdirSync(join(OUT, 'enum'), { recursive: true });
mkdirSync(join(OUT, 'reconcile'), { recursive: true });

const ENUM_A_MODEL = 'claude-opus-5';
const ENUM_B_MODEL = 'claude-haiku-4-5-20251001';
const RECONCILE_MODEL = 'claude-sonnet-5';

const CONCURRENCY = 5;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile('npx', ['tsx', ...args], { cwd: BASE, maxBuffer: 1024 * 1024 * 64, timeout: 400000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${err.message}\nstderr: ${stderr.slice(0, 2000)}`));
      } else {
        resolve(stdout);
      }
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

async function processSlice(slice) {
  const slug = `${slice.game}__${basename(slice.slicePath, '.md')}`;
  const payloadFile = join(BASE, 'payloads', `${slug}.payload.txt`);
  const derivedLinesFile = join(BASE, 'payloads', `${slug}.derived-lines.json`);

  const enumAOut = join(OUT, 'enum', `${slug}.A.json`);
  const enumBOut = join(OUT, 'enum', `${slug}.B.json`);
  const reconcileOut = join(OUT, 'reconcile', `${slug}.json`);

  const log = (msg) => console.log(`[${RUN}] [${slug}] ${msg}`);

  if (existsSync(reconcileOut)) {
    log('already done, skipping');
    return { slug, status: 'skipped' };
  }

  try {
    log('dispatching enumerator A (claude-opus-5)...');
    const rawA = await run('dispatch-enum', ['dispatch-enum.mjs', payloadFile, ENUM_A_MODEL]);
    const { raw: rawAParsed, resultText: factsAText } = extractJson(rawA);
    writeFileSync(enumAOut, JSON.stringify({ raw: rawAParsed, facts: factsAText }, null, 2));

    log('dispatching enumerator B (claude-haiku-4-5-20251001)...');
    const rawB = await run('dispatch-enum', ['dispatch-enum.mjs', payloadFile, ENUM_B_MODEL]);
    const { raw: rawBParsed, resultText: factsBText } = extractJson(rawB);
    writeFileSync(enumBOut, JSON.stringify({ raw: rawBParsed, facts: factsBText }, null, 2));

    const factsAFile = join(OUT, 'enum', `${slug}.A.facts.txt`);
    const factsBFile = join(OUT, 'enum', `${slug}.B.facts.txt`);
    writeFileSync(factsAFile, factsAText);
    writeFileSync(factsBFile, factsBText);

    log('dispatching reconciler (claude-sonnet-5)...');
    const rawR = await run('dispatch-reconcile', [
      'dispatch-reconcile.mjs',
      factsAFile,
      factsBFile,
      derivedLinesFile,
      RECONCILE_MODEL,
    ]);
    const { raw: rawRParsed, resultText: reconcileText } = extractJson(rawR);
    writeFileSync(reconcileOut, JSON.stringify({ raw: rawRParsed, reconcile: reconcileText }, null, 2));

    log('done');
    return { slug, status: 'ok' };
  } catch (e) {
    log(`ERROR: ${e.message}`);
    writeFileSync(join(OUT, 'reconcile', `${slug}.ERROR.txt`), e.message);
    return { slug, status: 'error', error: e.message };
  }
}

async function main() {
  const dispatchable = manifest.slices.filter((s) => s.payloadOk);
  console.log(`[${RUN}] ${dispatchable.length} dispatchable slices, concurrency ${CONCURRENCY}`);

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < dispatchable.length) {
      const slice = dispatchable[idx++];
      const r = await processSlice(slice);
      results.push(r);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  writeFileSync(join(OUT, 'run-summary.json'), JSON.stringify(results, null, 2));
  console.log(`[${RUN}] COMPLETE. ${results.filter((r) => r.status === 'ok').length}/${results.length} ok, ${results.filter((r) => r.status === 'error').length} errors`);
}

main();
