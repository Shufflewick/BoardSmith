// Extracts, for each real reference-game slice, the buildEnumeratorPayload output (or the throw
// it produces) plus the mechanical list of "Derived" annotation lines (both the (p.N)-citation
// form and the bare-"Derived:" form), for reconciler input. Real, unmodified verify-enumerate.ts
// function — no reimplementation. Adapted from 177-21-MEASUREMENT/extract-corpus.mjs (path/output
// changes only).
import { buildEnumeratorPayload } from '/Users/jtsmith/BoardSmith/src/cli/commands/verify-enumerate.ts';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const GAMES = {
  seven: '/Users/jtsmith/BoardSmithGames/seven/rulebook',
  'one-two-punch': '/Users/jtsmith/BoardSmithGames/one-two-punch/rulebook',
  'doom-machine': '/Users/jtsmith/BoardSmithGames/doom-machine/rulebook',
};

const EXCLUDE = new Set(['INDEX.md', 'OPEN-QUESTIONS.md']);

const DERIVED_LINE_START_RE = /^[\s>\-*(]*Derived\s*(\(p\.[^)]*\))?\s*:/i;
// Requires an actual digit after "p." — CARDS.md-family legends explaining the annotation
// convention using the literal placeholder text "Derived (p.N):" must not be mistaken for a real
// citation. Fix carried forward from 177-21's disclosed harness bug.
const DERIVED_ANYWHERE_RE = /Derived\s*\(p\.\d/i;

const OUT_DIR = '/private/tmp/claude-501/-Users-jtsmith-BoardSmith/39655717-66f7-4931-ad0d-d86278ea06be/scratchpad/177-22/payloads';
mkdirSync(OUT_DIR, { recursive: true });

const manifest = { slices: [] };

for (const [game, rulebookDir] of Object.entries(GAMES)) {
  const files = readdirSync(rulebookDir).filter(
    (f) => f.endsWith('.md') && !EXCLUDE.has(f) && f !== '00-visual-survey.md',
  );
  for (const file of files.sort()) {
    const fullPath = join(rulebookDir, file);
    const text = readFileSync(fullPath, 'utf8');
    const rawLines = text.split('\n');

    const derivedLines = [];
    rawLines.forEach((raw, idx) => {
      const trimmed = raw.trim();
      const isStart = DERIVED_LINE_START_RE.test(trimmed);
      const isMidline = !isStart && DERIVED_ANYWHERE_RE.test(raw);
      if (isStart || isMidline) {
        derivedLines.push({ lineNumber: idx + 1, text: trimmed, form: isStart ? 'line-start' : 'mid-line-residual' });
      }
    });

    if (derivedLines.length === 0) continue; // no Derived lines in this slice; skip entirely

    let payloadResult;
    try {
      const payload = buildEnumeratorPayload({ path: `rulebook/${file}`, text });
      payloadResult = { ok: true, payload };
    } catch (e) {
      payloadResult = { ok: false, error: e.message };
    }

    const slug = `${game}__${file.replace(/\.md$/, '')}`;
    const record = {
      game,
      slicePath: `rulebook/${file}`,
      fullPath,
      derivedLines,
      payloadOk: payloadResult.ok,
      payloadLength: payloadResult.ok ? payloadResult.payload.length : null,
      throwMessage: payloadResult.ok ? null : payloadResult.error,
    };
    manifest.slices.push(record);

    writeFileSync(join(OUT_DIR, `${slug}.derived-lines.json`), JSON.stringify(derivedLines, null, 2));
    if (payloadResult.ok) {
      writeFileSync(join(OUT_DIR, `${slug}.payload.txt`), payloadResult.payload);
    } else {
      writeFileSync(join(OUT_DIR, `${slug}.throw.txt`), payloadResult.error);
    }
  }
}

writeFileSync(
  '/private/tmp/claude-501/-Users-jtsmith-BoardSmith/39655717-66f7-4931-ad0d-d86278ea06be/scratchpad/177-22/manifest.json',
  JSON.stringify(manifest, null, 2),
);

let totalLines = 0;
let dispatchable = 0;
let blocked = 0;
for (const s of manifest.slices) {
  totalLines += s.derivedLines.length;
  if (s.payloadOk) dispatchable += s.derivedLines.length;
  else blocked += s.derivedLines.length;
}
console.log(`Slices with Derived lines: ${manifest.slices.length}`);
console.log(`Total Derived lines: ${totalLines}`);
console.log(`Dispatchable (payload built OK): ${dispatchable}`);
console.log(`Blocked (construction-site throw): ${blocked}`);
for (const s of manifest.slices) {
  console.log(`  ${s.game}/${s.slicePath}: ${s.derivedLines.length} lines, payloadOk=${s.payloadOk}`);
}
