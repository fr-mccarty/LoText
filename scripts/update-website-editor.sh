#!/bin/bash
#
# Builds the LoText editor for the web (src/web/) and copies it into Peru, where
# lolekproductions.org/LoText loads it for its try-it editors. Commit and deploy Peru afterwards
# (docs/publishing-the-mac-download.md points at how).

set -euo pipefail
cd "$(dirname "$0")/.."

PERU=${LOTEXT_PERU_ROOT:-"$HOME/peru"}
TARGET="$PERU/frontend/public/websites/lolekproductions"
[ -d "$TARGET" ] || { echo "No folder at $TARGET." >&2; exit 1; }

node build.mjs --web
cp dist-web/lotext-playground.js dist-web/lotext-playground.css "$TARGET/"
echo "✓ Copied into $TARGET — commit it in $PERU and deploy."
