#!/usr/bin/env bash
# The one way a branch reaches main (#312).
#
#   bash scripts/merge-branch.sh <branch> "<one-line summary (#issue)>"
#
# Run it from the main checkout, on a clean main. It merges <branch> without
# committing, runs `boardsmith test` on the merged tree (which type-checks the
# whole package first), and commits the merge only if that passes. On any
# failure, and on Ctrl-C, it aborts the merge, so main is left exactly as it was.
#
# Merges are serialised (#333). A second run started while one is in flight
# waits for it (up to BOARDSMITH_MERGE_LOCK_WAIT_SECONDS, default 1800, checking
# every BOARDSMITH_MERGE_LOCK_POLL_SECONDS, default 5), then tests its own
# merged result.
#
# Everything lives in functions called by the last line. `git merge` rewrites
# the working tree, this file included when the branch changes it, and bash
# reads a script as it runs it. Defining everything first parses the whole file
# before the first merge.
set -euo pipefail

fail() {
  echo "$1" >&2
  exit 1
}

# --- the merge lock ------------------------------------------------------------
#
# The merge and its test run happen in the shared main checkout, so for the
# length of a test run that checkout belongs to one merge. Before #333 nothing
# said so: a second merge either found main dirty mid-merge, or tested a tree
# that was neither branch's merge result.
#
# The lock is an flock(2) on the open file description behind fd 9, taken
# through perl because macOS has no flock command. `>&=9` opens perl's handle ON
# fd 9 rather than duplicating it, so the lock belongs to this script's
# description and outlives perl. The kernel drops it when the last descriptor
# referring to it closes: on exit, on a failure, on Ctrl-C, on SIGKILL. So a
# killed merge cannot leave a lock behind, and there is no staleness rule to
# guess at. The one way a lock can outlive its merge is a child that inherited
# fd 9 and kept running, which is why the test step runs with fd 9 closed and
# why a holder that has died is reported rather than waited on quietly.
lock_file=""
# The branch this run merges, which is how it names itself as the lock holder.
branch=""
lock_wait="${BOARDSMITH_MERGE_LOCK_WAIT_SECONDS:-1800}"
lock_poll="${BOARDSMITH_MERGE_LOCK_POLL_SECONDS:-5}"

# 0 = taken, 1 = someone else holds it. Anything else ends the run: merging
# unlocked is exactly what this lock exists to prevent.
try_lock() {
  local status=0
  perl -e 'open(my $f, ">&=9") or die "cannot reach the lock descriptor\n"; exit(flock($f, 2 | 4) ? 0 : 1)' ||
    status=$?
  case "$status" in
    0 | 1) return "$status" ;;
    *) fail "Could not take the merge lock (perl exited $status). The merge was not started." ;;
  esac
}

# Who holds the lock, as the holder recorded it. The kernel decides who holds
# the lock; this file only says who to go and ask. It is written after the lock
# is taken, so it can be missing for a moment, and a killed run leaves it
# behind for the next holder to overwrite.
describe_holder() {
  local holder="$lock_file.holder"
  if [ ! -r "$holder" ]; then
    echo "The holder has not recorded itself yet. Check for a running merge-branch.sh."
    return
  fi
  local branch pid since
  branch=$(sed -n 's/^branch: //p' "$holder")
  pid=$(sed -n 's/^pid: //p' "$holder")
  since=$(sed -n 's/^since: //p' "$holder")
  echo "Another merge holds the merge lock: '$branch' (pid $pid), since $since."
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "But pid $pid is no longer running, so the lock is held by a process it left behind."
    echo "Find that process with 'lsof $lock_file', stop it, then run this merge again."
  fi
}

acquire_lock() {
  command -v perl >/dev/null 2>&1 ||
    fail "perl is not on PATH, and it is how this script takes the merge lock. Install perl, then run the merge again."
  [[ "$lock_wait" =~ ^[0-9]+$ && "$lock_poll" =~ ^[1-9][0-9]*$ ]] ||
    fail "BOARDSMITH_MERGE_LOCK_WAIT_SECONDS and BOARDSMITH_MERGE_LOCK_POLL_SECONDS must be whole numbers of seconds (the wait may be 0, the poll may not)."

  # In the common git directory, which every worktree shares and no working
  # tree contains, so the lock can never make main look dirty.
  local git_common
  git_common=$(git rev-parse --git-common-dir)
  [[ "$git_common" == /* ]] || git_common="$PWD/$git_common"
  lock_file="$git_common/merge-branch.lock"
  # Appended, never truncated: the file's content is not the lock.
  exec 9>>"$lock_file"

  local waited=0
  while ! try_lock; do
    if [ "$waited" -ge "$lock_wait" ]; then
      describe_holder >&2
      if [ "$waited" -gt 0 ]; then
        echo "This run waited ${waited}s for it and gave up." >&2
      fi
      fail "Merges run one at a time so each tests its own merged tree. Let that merge finish, then run this merge again."
    fi
    if [ "$waited" -eq 0 ]; then
      echo "Waiting for the merge lock (up to ${lock_wait}s)."
      describe_holder
    elif [ $((waited % 60)) -lt "$lock_poll" ]; then
      echo "Still waiting for the merge lock (${waited}s)."
    fi
    sleep "$lock_poll"
    waited=$((waited + lock_poll))
  done
  printf 'branch: %s\npid: %s\nsince: %s\n' "$branch" "$$" "$(date '+%Y-%m-%d %H:%M:%S %Z')" >"$lock_file.holder"
}

# --- the merge -------------------------------------------------------------------

# Set once `git merge` has started and cleared once the merge is committed, so
# the exit trap aborts exactly the merge this run started and nothing else.
merging=0

# Runs on every exit once the lock is taken: undoes an uncommitted merge, then
# drops the lock. In that order, so the next merge never starts on a tree this
# one is still unwinding.
cleanup() {
  if [ "$merging" -eq 1 ]; then
    git merge --abort || true
  fi
  if [ -n "$lock_file" ]; then
    rm -f "$lock_file.holder"
    exec 9>&-
  fi
}

main() {
  if [ $# -ne 2 ] || [ -z "$1" ] || [ -z "$2" ]; then
    fail 'Usage: bash scripts/merge-branch.sh <branch> "<one-line summary (#issue)>"'
  fi
  branch=$1
  local summary=$2

  cd "$(git rev-parse --show-toplevel)"

  # The lock comes before any question about the checkout: every answer below
  # is only worth having while no other merge can change it. INT and TERM
  # become ordinary exits so the EXIT trap runs.
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  acquire_lock

  [ "$(git rev-parse --abbrev-ref HEAD)" = main ] ||
    fail "Check out main in the main checkout, then run the merge from there. This checkout is on '$(git rev-parse --abbrev-ref HEAD)'."
  # Under the lock no other merge-branch.sh is running, so a merge in progress
  # was left by one that was killed, or by a person.
  [ ! -e "$(git rev-parse --git-path MERGE_HEAD)" ] ||
    fail "main has a merge in progress, most likely left by a merge-branch.sh run that was killed. Run 'git merge --abort' in the main checkout, then run the merge again."
  [ -z "$(git status --porcelain)" ] ||
    fail "main has uncommitted changes. Commit or remove them, then run the merge again."
  git rev-parse --verify --quiet "refs/heads/$branch" >/dev/null ||
    fail "No branch named '$branch'. Run 'git branch' to see the branch names."
  if git merge-base --is-ancestor "$branch" HEAD; then
    fail "'$branch' is already on main. There is nothing to merge."
  fi

  merging=1
  git merge --no-ff --no-commit "$branch" ||
    fail "Refused to merge '$branch': it conflicts with main. Merge main into '$branch', resolve the conflicts there, and run the merge again."

  # fd 9 closed: a process the test run leaves behind must not hold the lock.
  node bin/boardsmith.js test 9>&- ||
    fail "Refused to merge '$branch': boardsmith test failed on the merged tree (it type-checks first). Fix the errors above on '$branch', merge main into it, and run the merge again."

  git commit --quiet -m "Merge branch '$branch': $summary"
  merging=0
  echo "Merged '$branch' into main."
}

main "$@"
