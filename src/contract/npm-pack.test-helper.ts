import { spawnSync } from 'node:child_process';

/** Every path `npm pack` would publish from the package at `cwd`, asked of npm itself so `files` and its negations read the way npm reads them. */
export function packedFiles(cwd: string): string[] {
  const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd, encoding: 'utf8' });
  if (pack.status !== 0) throw new Error(`npm pack --dry-run in ${cwd} failed, so the shipped file list is unknown:\n${pack.stderr}`);
  return (JSON.parse(pack.stdout) as { files: { path: string }[] }[])[0].files.map((f) => f.path);
}
