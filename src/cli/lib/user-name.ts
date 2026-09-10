/**
 * The one place that decides whether a name a user typed is a NAME (#240).
 *
 * `resolveUserPath` (#239) is this module's opposite number, and the pair only
 * makes sense read together. A CLI argument a user types is one of two things:
 *
 *   - a LOCATION, which the user is entitled to put anywhere. `--out-dir`,
 *     `--project`, `--rulebook`. `resolveUserPath` owns those.
 *   - an IDENTITY, which the command turns into a location itself. `init`'s
 *     `<name>` is the project's directory, the `name` in its package.json, the
 *     `name` in its boardsmith.json, the display name, and the prefix of every
 *     generated TypeScript class. `chunk-check`'s `<slug>` addresses
 *     `design/chunks/<slug>/CHUNK.md`.
 *
 * #240 was `init` treating one argument as both at once: `join(process.cwd(),
 * name)` made `<name>` a location, and `scaffold.config(name)` made the same
 * string a package name. So `boardsmith init /private/tmp/scratch/mygame`
 * appended an absolute path to the invocation directory, and had that parent
 * existed it would have written `"name": "/private/tmp/scratch/mygame"` into a
 * package.json npm will not read.
 *
 * Applying `resolveUserPath` there would have been the wrong fix: it would have
 * made `init` succeed at an arbitrary location under a package named after a
 * path. An identity is not resolved, it is REFUSED when it is not one.
 */

/**
 * A game name is kebab-case: lowercase ASCII letters, digits, single interior
 * hyphens, first character a letter.
 *
 * The rule is the intersection of the four things `<name>` simultaneously is,
 * not a house style:
 *
 *   - `boardsmith.json`'s own schema documents `name` as a "machine-readable
 *     game identifier (kebab-case)", and it is the game's slug on the platform.
 *   - npm package names are lowercase, have no spaces, and may not start with
 *     `.` or `_`; kebab-case is a strict subset of what npm accepts.
 *   - it is a directory name on every filesystem the CLI runs on.
 *   - `toPascalCase` splits it on `-`/`_` and concatenates to build class names
 *     (`GoFishGame`), so a leading digit, a space or a dot would emit
 *     TypeScript that does not parse. This is the constraint that makes the
 *     rule tighter than npm's: npm would accept `7-wonders` and `my.game`, and
 *     both scaffold a project whose sources cannot compile.
 *
 * Every one of the 15 games in the catalogue already satisfies it.
 */
const GAME_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** npm's hard limit on a package name, and `<name>` becomes one. */
const MAX_GAME_NAME_LENGTH = 214;

/** Both separators, because a Windows-shaped path is a path here too. */
const PATH_SEPARATOR = /[/\\]/;

/**
 * The kebab-case form of what the user typed, or `undefined` when nothing
 * usable is left.
 *
 * Advice only. It is printed in a refusal for the user to copy, and is never
 * substituted for what they typed: silently renaming somebody's game is the
 * kind of fallback that hides the mistake instead of reporting it.
 */
function suggestGameName(name: string): string | undefined {
  // A name that does not start with a letter has no honest suggestion: turning
  // `7-wonders` into `wonders` proposes a different game's name, which is worse
  // advice than none.
  if (!/^[A-Za-z]/.test(name)) return undefined;

  const kebab = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+$/, '');
  return GAME_NAME.test(kebab) ? kebab : undefined;
}

/**
 * Refuse an identity that is shaped like a location, before the command turns
 * it into one.
 *
 * `label` names the argument as the user typed it (`'<name>'`, `'<slug>'`) so
 * the message points at their command line rather than at a variable, and
 * `remedy` is the sentence only the calling command can write: where the thing
 * it wanted actually goes.
 */
export function assertBareName(label: string, value: string, remedy: string): void {
  if (value.trim() === '') {
    throw new Error(`${label} is empty.\n${remedy}`);
  }
  const isPath =
    PATH_SEPARATOR.test(value) ||
    value === '.' ||
    value === '..' ||
    value.startsWith('~');
  if (isPath) {
    throw new Error(`${label} "${value}" is a path, not a name.\n${remedy}`);
  }
}

/**
 * Refuse a `<name>` that cannot be all four of the things `init` makes it.
 *
 * Called before `init` creates anything, so a refused name leaves the disk
 * exactly as it was.
 */
export function assertGameName(name: string): void {
  // Checked before the path refusal below, which a scope's own "/" would
  // otherwise answer with a message about path separators.
  if (name.startsWith('@')) {
    const bare = suggestGameName(name.split('/').pop() ?? '');
    throw new Error(
      `"${name}" is not a valid game name: a game name is not npm-scoped.\n` +
        `The name is the game's identifier on the platform and the name of the ` +
        `directory init creates, and neither carries a scope.\n` +
        `Pass the bare name instead, and add a scope to package.json yourself if you ` +
        `ever publish this project to npm.` +
        (bare === undefined ? '' : `\nTry: boardsmith init ${bare}`),
    );
  }

  assertBareName(
    '<name>',
    name,
    'init always creates the project as a new directory in the directory you run it from, ' +
      'and <name> is that directory AND the package name, so it cannot be a path.\n' +
      'Change to the directory the project should live in, then pass a bare name:\n' +
      '  cd <the-parent-directory>\n' +
      '  boardsmith init my-game --without-rulebook',
  );

  if (name.length > MAX_GAME_NAME_LENGTH) {
    throw new Error(
      `That game name is ${name.length} characters long, and a name becomes an npm ` +
        `package name, which may be at most ${MAX_GAME_NAME_LENGTH}.\n` +
        `Pass a shorter name.`,
    );
  }

  if (!GAME_NAME.test(name)) {
    const suggestion = suggestGameName(name);
    throw new Error(
      `"${name}" is not a valid game name.\n` +
        `A game name is kebab-case: lowercase letters, digits and single hyphens, ` +
        `starting with a letter (go-fish, hex, doom-machine).\n` +
        `It becomes the project directory, the package name in package.json, the game's ` +
        `identifier in boardsmith.json and the prefix of the generated TypeScript ` +
        `classes, so every character has to be legal in all four.` +
        (suggestion === undefined ? '' : `\nTry: boardsmith init ${suggestion}`),
    );
  }
}
