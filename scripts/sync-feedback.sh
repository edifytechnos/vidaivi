#!/usr/bin/env bash
# The feedback widget (Report a problem · Suggest an idea · Review · My
# tickets) is one implementation shared by every Seyali app. Its source is
# seyali-org/seyali, platform/web/src/feedback/; src/feedback/ here is a copy.
# Never edit the copy: change it there, then run this with the path to a
# seyali checkout, and commit what it changes.
#
#   scripts/sync-feedback.sh ../seyali
set -euo pipefail
src="${1:?path to a seyali checkout}/platform/web/src/feedback"
here="$(cd "$(dirname "$0")/.." && pwd)/src/feedback"
[ -d "$src" ] || { echo "No $src" >&2; exit 1; }
mkdir -p "$here"
rm -f "$here"/*.ts
cp "$src"/*.ts "$here"/
echo "Copied $(ls "$src"/*.ts | wc -l) files from $src"
