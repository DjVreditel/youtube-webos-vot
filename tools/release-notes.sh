#!/usr/bin/env bash
# Prints the release notes for one version: .github/release-notes.md with
# @VERSION@ filled in, and that version's CHANGELOG.md section in place of
# @CHANGELOG@. The section's opening paragraph becomes a quote, and every
# heading goes one level down and gets an icon.
#
# Used by the Draft release workflow, and by hand to redo the notes of a
# published release:
#   bash tools/release-notes.sh 0.8.7 > notes.md
#   gh release edit v0.8.7 --notes-file notes.md
#
# Usage: tools/release-notes.sh <version> [commit]
set -euo pipefail

version="${1:?usage: tools/release-notes.sh <version> [commit]}"
commit="${2:-}"
cd "$(dirname "$0")/.."

changes="$(mktemp)"
trap 'rm -f "$changes"' EXIT

tr -d '\r' < CHANGELOG.md | awk -v v="$version" '
  index($0, "## [" v "]") == 1 { on = 1; next }
  on && /^## \[/ { exit }
  !on { next }
  /^#+ / {
    if (!heading && started) print ""
    heading = 1
    $0 = "#" $0
    if ($0 ~ /^### (Added|New Features)$/) sub(/^### /, "### ✨ ")
    else if ($0 ~ /^### Fix/) sub(/^### /, "### 🐛 ")
    else if ($0 ~ /^### Chang/) sub(/^### /, "### 🔧 ")
    else if ($0 ~ /^### Perf/) sub(/^### /, "### ⚡ ")
    else if ($0 ~ /^### Known/) sub(/^### /, "### ⚠️ ")
    else if ($0 ~ /^### Tests/) sub(/^### /, "### 🧪 ")
    else if ($0 ~ /^### /) sub(/^### /, "### 📌 ")
    print; next
  }
  # The summary above the first heading, as a quote.
  !heading {
    if ($0 == "") { if (started) gap = 1; next }
    if (gap) print ">"
    gap = 0; started = 1; print "> " $0; next
  }
  { print }
' > "$changes"

if [ ! -s "$changes" ]; then
  echo "CHANGELOG.md has no section for $version" >&2
  exit 1
fi

# Hidden once published; tells a tester which commit a draft was built from.
[ -n "$commit" ] && echo "<!-- built from $commit -->"

tr -d '\r' < .github/release-notes.md | sed "s/@VERSION@/$version/g" |
  awk -v f="$changes" '$0 == "@CHANGELOG@" { while ((getline l < f) > 0) print l; next } { print }'
