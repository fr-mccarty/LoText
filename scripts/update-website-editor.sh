#!/bin/bash
#
# Puts the current LoText editor on lolekproductions.org/LoText, whose try-it editors run it.
#
#   1. Builds it for the web (src/web/ → dist-web/).
#   2. Copies it into Peru on the Mac mini (scripts/peru.sh), and commits and pushes it there.
#   3. Rebuilds the public websites from Peru (`pnpm websites:install`) and checks the site
#      serves the new build. Other website commits on Peru's main not yet live go with it, so
#      they are listed first and a yes is asked for (--yes skips the question).
#
# Cloudflare keeps /lotext-playground.js for up to four hours, so some visitors get the old
# editor until it expires or the cache is purged.

set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/peru.sh

SITE=${LOTEXT_SITE_ORIGIN:-"https://lolekproductions.org"}
ASSUME_YES=no
[ "${1:-}" = --yes ] && ASSUME_YES=yes

fail () { printf '\n✗ %s\n\n' "$1" >&2; exit 1; }

echo "▸ Building the web editor"
node build.mjs --web >/dev/null
FILES=(dist-web/lotext-playground.js dist-web/lotext-playground.css)

echo "▸ Copying it into Peru ($PERU_WHERE)"
[ "$(peru 'git branch --show-current')" = main ] || fail "Peru's checkout is not on main."
[ -z "$(peru "git status --porcelain -- $PERU_SITE_FOLDER")" ] ||
  fail "Peru has uncommitted changes in $PERU_SITE_FOLDER. Commit or undo them first."
peru_copy "${FILES[@]}" "$PERU_DIR/$PERU_CODE/$PERU_SITE_FOLDER"

if [ -z "$(peru "git status --porcelain -- $PERU_SITE_FOLDER")" ]; then
  echo "  Peru already has this build"
else
  peru "git add $PERU_SITE_FOLDER/lotext-playground.js $PERU_SITE_FOLDER/lotext-playground.css &&
        git commit -q -m 'The LoText try-it editors run LoText $(git rev-parse --short HEAD)' &&
        git log -1 --format='  committed %h on main'"
  peru 'git push -q origin main' || echo "  (the push failed; push Peru's main by hand)"
fi

waiting=$(peru_unpublished_website_commits | grep -v 'The LoText try-it editors run LoText' || true)
if [ -n "$waiting" ]; then
  echo "▸ These website commits on Peru's main are not live yet, and go live with it:"
  echo "$waiting"
  if [ "$ASSUME_YES" != yes ]; then
    [ -t 0 ] || fail "Not published. Run again in a terminal to answer, or with --yes."
    read -r -p "Publish them too? [y/N] " answer
    case "$answer" in [yY]*) ;; *) fail "Not published. The build is committed in Peru; run this again to publish it." ;; esac
  fi
fi

echo "▸ Rebuilding the public websites (pnpm websites:install)"
peru_publish_websites || exit 1

want=$(shasum < dist-web/lotext-playground.js | cut -c1-40)
got=$(curl -s "$SITE/lotext-playground.js?fresh=$(date +%s)" | shasum | cut -c1-40)
[ "$want" = "$got" ] || fail "$SITE/lotext-playground.js is not the new build, even past the cache."
echo "✓ $SITE/LoText runs this editor (Cloudflare may serve the old one for up to four hours)"
