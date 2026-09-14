#!/bin/bash
# SessionStart hook.
#
# Two jobs, in this order:
#   1. Report what changed in the repository since the last session, so a fresh
#      session opens already knowing what a co-worker pushed.
#   2. Make sure the test suite can actually run (remote sessions only).
#
# Everything here is best-effort. A failure must never block a session, so the
# script guards each step and always exits 0.

set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Commits authored by Claude carry this address; anything else is a person.
CLAUDE_EMAIL="noreply@anthropic.com"

echo "=== Repository state ==========================================="

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
echo "branch    $branch"
echo "head      $(git log -1 --format='%h %s  (%an, %ar)' 2>/dev/null)"

dirty=$(git status --porcelain 2>/dev/null | head -5)
if [ -n "$dirty" ]; then
  echo "uncommitted changes:"
  echo "$dirty" | sed 's/^/          /'
fi

# Fetch quietly. No network (or a proxy denial) is not an error here — it just
# means the report below describes the last known state.
if ! git fetch --quiet --prune origin 2>/dev/null; then
  echo "note      could not reach origin; the report below may be stale"
fi

# Work out the default branch without assuming it is called main.
default=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
if [ -z "$default" ]; then
  for candidate in origin/main origin/master; do
    if git rev-parse --verify --quiet "$candidate" >/dev/null 2>&1; then
      default="$candidate"
      break
    fi
  done
fi

if [ -n "$default" ] && [ "$(git rev-parse HEAD)" != "$(git rev-parse "$default" 2>/dev/null)" ]; then
  behind=$(git log --oneline "HEAD..$default" 2>/dev/null | wc -l | tr -d ' ')
  ahead=$(git log --oneline "$default..HEAD" 2>/dev/null | wc -l | tr -d ' ')
  echo "vs $default: $behind to pull, $ahead not yet merged"
  if [ "$behind" != "0" ]; then
    echo "NOT IN THIS BRANCH YET — merge $default before building on it:"
    git log --format='          %h %s  (%an, %ar)' "HEAD..$default" 2>/dev/null | head -15
  fi
fi

# Who has been committing. A human author means someone else has been working
# here and their reasoning lives in the commit messages and pull requests.
others=$(git log -25 --format='%h %s  (%an, %ar)' --perl-regexp \
         --author="^(?!.*$CLAUDE_EMAIL).*$" 2>/dev/null | head -10)
if [ -n "$others" ]; then
  echo "Recent commits by someone other than Claude:"
  echo "$others" | sed 's/^/          /'
  echo "          -> read these (and their PRs) before changing the same code."
else
  echo "recent    no commits by anyone other than Claude"
fi

echo "Read CLAUDE.md before changing anything; run python3 tests/run.py --quick before committing."
echo "================================================================"

# --- dependencies, remote sessions only ---------------------------------
# A local clone manages its own environment; only the ephemeral cloud container
# needs this, and its state is cached after the hook completes.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

if ! python3 -c "import pandas, requests" >/dev/null 2>&1; then
  echo "installing tools/requirements.txt ..."
  python3 -m pip install --quiet --disable-pip-version-check -r tools/requirements.txt \
    || echo "warning: pip install failed; the pandas-dependent tests will skip"
fi

if ! python3 -c "import playwright" >/dev/null 2>&1; then
  echo "installing playwright ..."
  python3 -m pip install --quiet --disable-pip-version-check playwright \
    || echo "warning: playwright install failed; the browser tests will skip"
fi

exit 0
