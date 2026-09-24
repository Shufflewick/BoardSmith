#!/usr/bin/env bash
# The one way a branch reaches main (#312).
#
#   npm run merge -- <branch> "<one-line summary (#issue)>"
#
# Run it from the main checkout, on a clean main. It merges <branch> without
# committing, runs `npm test` on the merged tree (whose `pretest` is the
# whole-package `npm run typecheck`), and commits the merge only if that passes.
# On any failure it aborts the merge, so main is left exactly as it was.
set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

if [ $# -ne 2 ] || [ -z "$1" ] || [ -z "$2" ]; then
  fail 'Usage: npm run merge -- <branch> "<one-line summary (#issue)>"'
fi
branch=$1
summary=$2

cd "$(git rev-parse --show-toplevel)"

[ "$(git rev-parse --abbrev-ref HEAD)" = main ] ||
  fail "Check out main in the main checkout, then run the merge from there. This checkout is on '$(git rev-parse --abbrev-ref HEAD)'."
[ -z "$(git status --porcelain)" ] ||
  fail "main has uncommitted changes. Commit or remove them, then run the merge again."
git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null ||
  fail "No branch named '$branch'. Run 'git branch' to see the branch names."
if git merge-base --is-ancestor "$branch" HEAD; then
  fail "'$branch' is already on main. There is nothing to merge."
fi

if ! git merge --no-ff --no-commit "$branch"; then
  git merge --abort
  fail "Refused to merge '$branch': it conflicts with main. Merge main into '$branch', resolve the conflicts there, and run the merge again."
fi

if ! npm test; then
  git merge --abort
  fail "Refused to merge '$branch': npm test failed on the merged tree (it type-checks first). Fix the errors above on '$branch', merge main into it, and run the merge again."
fi

git commit --quiet -m "Merge branch '$branch': $summary"
echo "Merged '$branch' into main."
