import { promises as fs } from 'node:fs';
import { relative } from 'node:path';

/**
 * The one reader of a fenced JSON-lines ledger: a markdown file holding one JSON record per line
 * between a begin and an end HTML-comment marker. The CHECK-04 derive-check, CHECK-01 ruling and
 * CHECK-06 example-replay ledgers all read through it, so a malformed ledger is refused the same
 * way everywhere.
 */
export interface FencedJsonLedgerFile {
  projectDir: string;
  /** Absolute path of the ledger file. */
  path: string;
  begin: string;
  end: string;
  /** What the ledger is called in an error, e.g. "derive-check". */
  name: string;
  /** The sentence every malformed-ledger error ends with, saying what to do. */
  remedy: string;
}

/**
 * Every record in `file`, each built by `read` from its parsed JSON line; none when the file does
 * not exist yet. Throws one message naming the ledger's project-relative path when a fence is
 * missing or the fences are the wrong way round, and one naming the 1-based record and ending
 * with `file.remedy` when a line is not JSON or `read` throws for it.
 */
export async function readFencedJsonLedger<T>(
  file: FencedJsonLedgerFile,
  read: (record: Record<string, unknown>) => T,
): Promise<T[]> {
  let text: string;
  try {
    text = await fs.readFile(file.path, 'utf-8');
  } catch {
    return [];
  }
  const where = `Malformed ${file.name} ledger at ${relative(file.projectDir, file.path)}`;
  const beginIdx = text.indexOf(file.begin);
  const endIdx = text.indexOf(file.end);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(`${where}: missing begin/end fence.`);
  }
  // The markers are located independently, so a hand-edited ledger with the end fence first (or
  // a doubled begin marker) must be refused rather than sliced into a nonsensical body.
  if (beginIdx > endIdx) {
    throw new Error(`${where}: the end fence appears before the begin fence.`);
  }
  return text
    .slice(beginIdx + file.begin.length, endIdx)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line, i) => {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        throw new Error(`${where} (record ${i + 1}): not valid JSON.\n${file.remedy}`);
      }
      try {
        return read(isRecord(raw) ? raw : {});
      } catch (err) {
        throw new Error(`${where} (record ${i + 1}): ${(err as Error).message}\n${file.remedy}`);
      }
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
