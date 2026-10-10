#!/bin/sh
# Pack each skill of the unhrdb plugin as a .zip for claude.ai
# (Customize → Skills → upload). Each archive holds <skill-name>/SKILL.md,
# the layout claude.ai expects. Output: dist/skills/<skill-name>.zip
#
#   ./scripts/package-skills.sh
set -e
cd "$(dirname "$0")/.."
SRC=plugins/unhrdb/skills
OUT=dist/skills
rm -rf "$OUT"
mkdir -p "$OUT"
for dir in "$SRC"/*/; do
  name=$(basename "$dir")
  [ -f "$dir/SKILL.md" ] || continue
  (cd "$SRC" && zip -qr "../../../$OUT/$name.zip" "$name" -x '*.DS_Store')
  echo "$OUT/$name.zip"
done
