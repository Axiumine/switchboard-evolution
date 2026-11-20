#!/usr/bin/env bash
# Merge new commits of upstream Switchboard (doctly/switchboard) into apps/desktop.
#
# The monorepo records upstream `main` as merged into apps/desktop (a `-s ours`
# merge of the commit the desktop app was last in step with), so git knows the
# merge base and a subtree merge brings in only the upstream commits made since.
# Run it on master. The local `main` branch, an exact copy of upstream main, is
# moved forward to the fetched commit as well (fast-forward only).
#
#   scripts/upstream-sync.sh                 merge upstream main into the current branch
#   scripts/upstream-sync.sh --ref <ref>     another upstream branch, tag or commit
#   scripts/upstream-sync.sh --url <url>     another upstream repository (for tests)
#
# Exit status: 0 when up to date or merged, 2 when the merge has conflicts (the
# merge is left in progress: fix, `git add`, `git commit`, or `git merge --abort`),
# 1 on any other error. With GITHUB_OUTPUT set (GitHub Actions), it also writes
# status, upstream_sha, upstream_short and conflicts there.
set -euo pipefail

url="https://github.com/doctly/switchboard.git"
ref="main"
prefix="apps/desktop"

while [ $# -gt 0 ]; do
  case "$1" in
    --ref) ref="$2"; shift 2 ;;
    --url) url="$2"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"

output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    if [ "$#" -eq 2 ]; then
      printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
    else
      { printf '%s<<SYNC_EOF\n' "$1"; cat; printf 'SYNC_EOF\n'; } >> "$GITHUB_OUTPUT"
    fi
  fi
}

if [ "$(git branch --show-current)" = main ]; then
  echo "main is a copy of upstream and is not merged into: switch to master and run this again." >&2
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "The working tree has uncommitted changes; commit or stash them first." >&2
  exit 1
fi

git fetch --quiet --no-tags "$url" "$ref"
sha="$(git rev-parse FETCH_HEAD)"
short="$(git rev-parse --short FETCH_HEAD)"
output upstream_sha "$sha"
output upstream_short "$short"

if [ "$ref" = main ] && git show-ref --verify --quiet refs/heads/main; then
  if git merge-base --is-ancestor refs/heads/main "$sha"; then
    git update-ref refs/heads/main "$sha"
    echo "main is at upstream $short."
  else
    echo "main has commits that upstream main does not have: left as it is." >&2
  fi
fi

if git merge-base --is-ancestor "$sha" HEAD; then
  echo "Already up to date with upstream $ref ($short)."
  output status up-to-date
  exit 0
fi

if ! git merge-base HEAD "$sha" >/dev/null; then
  echo "No merge base with upstream: record upstream as merged first (see README, Upstream)." >&2
  exit 1
fi

echo "Upstream commits to merge:"
git log --no-merges --format='  %h %s (%an)' "HEAD..$sha"

if git merge --no-ff -X subtree="$prefix" -m "Merge upstream Switchboard $short into $prefix" "$sha"; then
  echo "Merged upstream $ref ($short) into $prefix."
  output status merged
  exit 0
fi

conflicts="$(git diff --name-only --diff-filter=U)"
if [ -z "$conflicts" ]; then
  echo "The merge failed without conflicted files; see the messages above." >&2
  git merge --abort 2>/dev/null || true
  exit 1
fi
echo "Conflicts in:"
printf '  %s\n' $conflicts
output status conflict
printf '%s\n' "$conflicts" | output conflicts
exit 2
