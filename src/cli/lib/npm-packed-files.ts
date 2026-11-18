import { execFileSync } from 'node:child_process';

/**
 * Every path `npm pack` would put in the tarball of the package at `dir`, by npm's own
 * `--dry-run` listing, so the `files` globs in `package.json` are applied by the program that applies them for real.
 */
export function npmPackedFiles(dir: string): string[] {
  const [report] = JSON.parse(
    execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
  ) as [{ files: { path: string }[] }];
  return report.files.map((file) => file.path);
}
