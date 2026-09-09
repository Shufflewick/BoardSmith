/**
 * `boardsmith contract` — inspect or record the engine contract.
 *
 * See `docs/engine-contract.md` for why the contract exists. In short: a
 * published game runs on the engine the PLATFORM vendored, not the one it was
 * built against, so a BoardSmith change is invisible to production until
 * someone re-vendors. This command is how a change gets recorded so the
 * platform can find out.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import chalk from 'chalk';

import { buildFormatFixture, computeFingerprints } from '../../contract/fingerprint.js';
import type { EngineContract } from '../../contract/index.js';

export interface ContractOptions {
  update?: boolean;
  summary?: string;
  breaking?: boolean;
  adopt?: boolean;
  regenerateFormat?: boolean;
}

// This file lives at src/cli/commands/contract.ts — repo root is three levels up.
const CONTRACT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../contract/engine-contract.json',
);

/** The committed corpus of world partition bytes `formatHash` round-trips. */
const FORMAT_FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../contract/format-fixture.json',
);

function readContract(): EngineContract | null {
  // In an INSTALLED copy the CLI runs from the bundled `dist/cli.js`, so this
  // path resolves outside the package and the read fails with a raw ENOENT
  // naming an internal path. The contract is a repo-development concern, so
  // say that instead of leaking a resolution detail.
  if (!existsSync(CONTRACT_PATH)) return null;
  return JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as EngineContract;
}

/**
 * Compare the committed contract against what the engine actually looks like
 * now. Returns which dimensions moved — the caller decides what to do about it.
 */
export function diffContract(
  contract: EngineContract,
  computed: { surfaceHash: string; payloadHash: string; formatHash: string },
): {
  surfaceChanged: boolean;
  payloadChanged: boolean;
  formatChanged: boolean;
  drifted: boolean;
} {
  const surfaceChanged = computed.surfaceHash !== contract.surfaceHash;
  const payloadChanged = computed.payloadHash !== contract.payloadHash;
  // A committed contract with NO `formatHash` is drift, not a pass. Declaring
  // no format is a real state -- every revision before r61 is in it -- but a
  // contract this repo is recording now has one, and treating absence as
  // "unchanged" is how it would go on being absent.
  const formatChanged = computed.formatHash !== contract.formatHash;
  return {
    surfaceChanged,
    payloadChanged,
    formatChanged,
    drifted: surfaceChanged || payloadChanged || formatChanged,
  };
}

/**
 * Whether this run may record a revision, and why.
 *
 * A revision that means nothing trains the platform team to stop reading them,
 * so a bump with nothing behind it is refused. `--adopt` is the one case where
 * nothing IS behind it and the revision is still owed, and it exists because of
 * how the platform stores an engine rather than how BoardSmith describes one:
 * ShufflewickPub archives each engine BUILD under its revision number and
 * refuses to overwrite one, on the rule that a revision identifies exactly one
 * engine. A change no fingerprint can see -- a performance fix alters no
 * surface, no payload and no stored byte -- therefore has no way to reach a
 * live world at all unless it is given a number of its own.
 *
 * It is refused when the contract DID move, so "the platform must adopt this"
 * cannot become the sentence every revision carries.
 */
export function recordable(
  diff: { drifted: boolean },
  options: { breaking: boolean; adopt: boolean },
): { record: boolean; reason: "drift" | "breaking" | "adopt" | "nothing" | "adopt-not-needed" } {
  if (diff.drifted) {
    return options.adopt
      ? { record: false, reason: "adopt-not-needed" }
      : { record: true, reason: "drift" };
  }
  if (options.adopt) return { record: true, reason: "adopt" };
  if (options.breaking) return { record: true, reason: "breaking" };
  return { record: false, reason: "nothing" };
}

/**
 * Build the next contract. Pure, so the bump arithmetic and the history
 * append are testable without touching the filesystem.
 */
export function nextContract(
  current: EngineContract,
  computed: { surfaceHash: string; payloadHash: string; formatHash: string },
  options: { summary: string; breaking: boolean; date: string },
): EngineContract {
  const revision = current.revision + 1;
  const bundleProtocol = options.breaking ? current.bundleProtocol + 1 : current.bundleProtocol;

  return {
    revision,
    bundleProtocol,
    surfaceHash: computed.surfaceHash,
    payloadHash: computed.payloadHash,
    formatHash: computed.formatHash,
    history: [
      ...current.history,
      {
        revision,
        date: options.date,
        bundleProtocol,
        surfaceHash: computed.surfaceHash,
        payloadHash: computed.payloadHash,
        formatHash: computed.formatHash,
        summary: options.summary,
      },
    ],
  };
}

function reportCheck(contract: EngineContract, diff: ReturnType<typeof diffContract>): void {
  console.log(chalk.cyan('\nEngine contract\n'));
  console.log(`  revision        ${contract.revision}`);
  console.log(`  bundleProtocol  ${contract.bundleProtocol}`);
  console.log(`  surfaceHash     ${contract.surfaceHash}`);
  console.log(`  payloadHash     ${contract.payloadHash}`);
  console.log(`  formatHash      ${contract.formatHash ?? chalk.red('none declared')}`);

  const head = contract.history[contract.history.length - 1];
  if (head) console.log(chalk.dim(`\n  r${head.revision} (${head.date}) — ${head.summary}`));

  if (!diff.drifted) {
    console.log(chalk.green('\n✓ The engine matches its committed contract.\n'));
    return;
  }

  const moved = [
    diff.surfaceChanged && 'exported API surface',
    diff.payloadChanged && 'player-view payload',
    diff.formatChanged && 'world serialization format',
  ].filter(Boolean).join(' and ');

  console.error(chalk.red(`\n✗ Contract drift: the ${moved} changed.\n`));
  console.error('Record it so ShufflewickPub learns about it:');
  console.error(chalk.bold('  boardsmith contract --update --summary "<one sentence for the platform team>"'));
  console.error(chalk.dim('\nSee docs/engine-contract.md.\n'));
}

export async function contractCommand(options: ContractOptions): Promise<void> {
  const contract = readContract();
  if (contract === null) {
    console.error(chalk.red('\n`boardsmith contract` only works inside the BoardSmith repository.\n'));
    console.error('It reads and writes src/contract/engine-contract.json, which is a');
    console.error('development-time file — an installed copy of BoardSmith has nothing to record.');
    console.error(chalk.dim('\nTo see which engine a project is running, check its own vendored copy:'));
    console.error(chalk.dim('  node_modules/boardsmith/src/contract/engine-contract.json\n'));
    process.exitCode = 1;
    return;
  }
  // REGENERATING THE CORPUS IS A DELIBERATE FORMAT BREAK, and it happens
  // before the fingerprints are computed because computing them is what refuses
  // while the old corpus is unreadable. Every world holding the old bytes is
  // ended by this, so it is its own flag and never a side effect of `--update`.
  if (options.regenerateFormat === true) {
    const fixture = await buildFormatFixture();
    writeFileSync(FORMAT_FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`);
    console.log(chalk.yellow('\n! Regenerated src/contract/format-fixture.json.\n'));
    console.log('Every world whose partitions were written under the OLD corpus can no longer');
    console.log('be read by this engine. On ShufflewickPub those worlds end: there is no');
    console.log('migration, because nothing can read them.');
    console.log(chalk.dim('\nRecord the new format:'));
    console.log(chalk.dim('  boardsmith contract --update --summary "<what stored bytes now look like>"\n'));
  }

  const computed = await computeFingerprints();
  const diff = diffContract(contract, computed);

  if (!options.update) {
    reportCheck(contract, diff);
    if (diff.drifted) process.exitCode = 1;
    return;
  }

  const summary = (options.summary ?? '').trim();
  if (!summary) {
    console.error(chalk.red('\n--summary is required when recording a contract revision.\n'));
    console.error('It is the text ShufflewickPub\'s `npm run vendor:check` shows the person');
    console.error('deciding whether to re-vendor, so write it for them:');
    console.error(chalk.bold('  boardsmith contract --update --summary "Deck defaults to count-only; draw piles report size again"'));
    console.error('');
    process.exitCode = 1;
    return;
  }

  const verdict = recordable(diff, {
    breaking: options.breaking === true,
    adopt: options.adopt === true,
  });
  if (verdict.reason === 'nothing') {
    console.error(chalk.yellow('\nNothing to record — the API surface, the player-view payload and the world serialization format are all unchanged.\n'));
    console.error('If your change affects the platform in a way neither fingerprint can see');
    console.error('(an exported TYPE, say — see the KNOWN LIMIT in src/contract/fingerprint.ts),');
    console.error('extend the fixture in fingerprint.ts so it does, then re-run this.\n');
    console.error('If nothing a fingerprint COULD see changed and the platform still has to run');
    console.error('this build — a performance fix, which alters no surface, no payload and no');
    console.error('stored byte — it needs a number of its own, because the platform archives an');
    console.error('engine build under its revision and will not overwrite one:');
    console.error(chalk.bold('  boardsmith contract --update --adopt --summary "<why the platform must run this build>"'));
    console.error('');
    process.exitCode = 1;
    return;
  }
  if (verdict.reason === 'adopt-not-needed') {
    console.error(chalk.yellow('\n--adopt is for a change no fingerprint can see, and this one moved the contract.\n'));
    console.error('Record it as the ordinary revision it is, without the flag:');
    console.error(chalk.bold('  boardsmith contract --update --summary "<one sentence for the platform team>"'));
    console.error('');
    process.exitCode = 1;
    return;
  }

  const updated = nextContract(contract, computed, {
    summary,
    breaking: options.breaking === true,
    date: new Date().toISOString().slice(0, 10),
  });

  writeFileSync(CONTRACT_PATH, `${JSON.stringify(updated, null, 2)}\n`);

  const changed = [
    diff.surfaceChanged && 'exported API surface',
    diff.payloadChanged && 'player-view payload',
    diff.formatChanged && chalk.yellow(
      'world serialization format (a live world may not cross this)',
    ),
    verdict.reason === 'adopt' && 'nothing a fingerprint can see — recorded so the platform can archive and run this build',
    options.breaking && chalk.red('bundle protocol (BREAKING — every published game must be rebuilt)'),
  ].filter(Boolean);

  console.log(chalk.green(`\n✓ Engine contract revision ${contract.revision} → ${updated.revision}`));
  console.log(`  Changed: ${changed.join(', ')}`);
  console.log(`  Summary: ${summary}`);
  console.log(chalk.dim('\nCommit src/contract/engine-contract.json, then re-vendor on the platform:'));
  console.log(chalk.dim('  cd ~/ShufflewickPub && npm run vendor:boardsmith\n'));
}
