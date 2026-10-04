#!/usr/bin/env bash
# Carry the previous builds' hashed chunks into this build, so a tab that was
# open across the deploy keeps working untouched.
#
# A deploy replaces the whole site, and the previous build's files under
# /assets/ go with it. A tab loaded before the deploy still runs that build,
# and the next lazy part it asks for — KaTeX, Browse, the PDF reader — is a
# 404. src/staleload.ts turns that into one reload; this script removes even
# the reload: the last few builds' assets are uploaded as workflow artifacts,
# and each deploy copies them in beside its own. Hashed names never collide
# and are cached immutable, so the copies cost a few megabytes and nothing
# else.
#
#   scripts/carry-assets.sh <artifact-name> <assets-dir> [branch] [keep]
#
# Reads the last `keep` (default 3) successful runs of this workflow — on
# `branch` when given — and downloads each one's <artifact-name>. A run with
# no such artifact (older than this script, or expired) is skipped. Nothing
# here may fail the deploy: a listing or download that fails is reported and
# the build ships as it is, which is exactly what it did before.
#
# Needs `gh` with GH_TOKEN (actions: read). CARRY_WORKFLOW names the workflow
# file; it defaults to the one this repo deploys with.

set -uo pipefail

name="${1:?artifact name}"
dest="${2:?assets dir}"
branch="${3:-}"
keep="${4:-3}"
workflow="${CARRY_WORKFLOW:-azure-static-web-apps.yml}"

mkdir -p "$dest"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

args=(run list --workflow "$workflow" --status success --limit 20 --json databaseId --jq '.[].databaseId')
if [ -n "$branch" ]; then args+=(--branch "$branch"); fi

if ! runs="$(gh "${args[@]}" 2>/dev/null)"; then
  echo "note: could not list previous runs; nothing carried forward"
  exit 0
fi

carried=0
builds=0
lines=""
for id in $runs; do
  if [ "$builds" -ge "$keep" ]; then break; fi
  # No artifact on that run — older than this script, or expired. Skip it.
  if ! gh run download "$id" -n "$name" -D "$tmp/$id" >/dev/null 2>&1; then continue; fi
  # Never overwrite — this build's own file always wins, and a file with the
  # same hash is the same file anyway. File by file rather than `cp -n`,
  # which newer coreutils flag as non-portable.
  n=0
  while IFS= read -r -d '' f; do
    rel="${f#"$tmp/$id/"}"
    if [ ! -e "$dest/$rel" ]; then
      mkdir -p "$(dirname "$dest/$rel")"
      cp "$f" "$dest/$rel"
      n=$((n + 1))
    fi
  done < <(find "$tmp/$id" -type f -print0)
  carried=$((carried + n))
  builds=$((builds + 1))
  lines="$lines- run $id: $n file(s) carried"$'\n'
done

echo "carried $carried file(s) from $builds previous build(s)"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Carried forward from previous builds"
    if [ "$builds" -eq 0 ]; then
      echo "Nothing yet — the next deploy will carry this one."
    else
      printf '%s' "$lines"
    fi
  } >> "$GITHUB_STEP_SUMMARY"
fi
exit 0
