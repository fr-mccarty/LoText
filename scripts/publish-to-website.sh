#!/bin/bash
#
# Publish a notarized LoText disk image on lolekproductions.org/LoText, replacing the one there.
# This is docs/publishing-the-mac-download.md as a script.
#
#   scripts/publish-to-website.sh LoText-1.0.3.dmg          one in the export folder (scripts/export-folder.sh)
#   scripts/publish-to-website.sh path/to/LoText-1.0.3.dmg  one anywhere else
#   scripts/publish-to-website.sh LoText-1.0.3.dmg --yes    no questions: for a script
#
# `npm run release` offers to run it once a notarized image is made.
#
# In order, stopping at the first thing that fails:
#
#   1. Checks the image is notarized, that Peru's checkout is on main, and which version the live
#      site offers (the page as last deployed, not as committed).
#   2. Copies the image into Peru's download folder and checks the site serves it.
#   3. Sets the version and today's date in the LoText page, and commits that one file on main.
#   4. Deploys Peru. Anything else on main that is not yet live goes with it, so those commits are
#      listed and a second yes is asked for.
#   5. Once the deploy has succeeded, takes every other LoText image out of the download folder,
#      so the site offers the latest version only. One not already kept in the
#      export folder is moved there.
#
# The site's one-version rule is why the old image stays until step 5: until the deploy, the live
# page still links to it. A run that stopped partway is finished by running it again: a page
# already committed is not committed twice, and once the version is live only step 5 is left.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
source "$ROOT/scripts/export-folder.sh"

PERU=${LOTEXT_PERU_ROOT:-"$HOME/peru"}
SITE=${LOTEXT_SITE_ORIGIN:-"https://lolekproductions.org"}
DOWNLOADS="$PERU/storage/lolekproductions-org-downloads"
PAGE_PATH="frontend/src/pages/websites/lolekproductions/pages/lotext.tsx"
PAGE="$PERU/$PAGE_PATH"
FILE_ROUTE="$SITE/api/public/websites/lolekproductions/published-documents/file?path="

fail () {
  printf '\n✗ %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  printf '\n' >&2
  exit 1
}

ask () {
  local answer
  [ "$ASSUME_YES" = yes ] && return 0
  [ -t 0 ] || return 1
  read -r -p "$1 [y/N] " answer
  case "$answer" in [yY]*) return 0 ;; *) return 1 ;; esac
}

IMAGE=""
ASSUME_YES=no
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=yes ;;
    -*) fail "Unknown option: $arg" ;;
    *) IMAGE=$arg ;;
  esac
done
[ -n "$IMAGE" ] || fail "Which disk image? scripts/publish-to-website.sh LoText-<version>.dmg"
[ -f "$IMAGE" ] || [ ! -f "$EXPORTS/$IMAGE" ] || IMAGE="$EXPORTS/$IMAGE"
[ -f "$IMAGE" ] || fail "No such file: $IMAGE"

NAME=$(basename "$IMAGE")
[[ "$NAME" =~ ^LoText-([0-9]+\.[0-9]+\.[0-9]+)\.dmg$ ]] ||
  fail "$NAME is not named LoText-<version>.dmg, which is the name the page links to."
VERSION=${BASH_REMATCH[1]}
RELEASE_DATE=$(LC_ALL=en_US.UTF-8 date +"%B %-d, %Y")

# ── 1. Checks ────────────────────────────────────────────────────────────────
echo "▸ Checking $NAME"

xcrun stapler validate "$IMAGE" >/dev/null 2>&1 ||
  fail "$NAME has no notarization ticket, so people who download it would be told it cannot be opened." \
       "Only an image from 'npm run release' can be published."
spctl --assess --type open --context context:primary-signature "$IMAGE" 2>/dev/null ||
  fail "Gatekeeper does not accept $NAME." "Only an image from 'npm run release' can be published."

[ -d "$DOWNLOADS" ] || fail "No download folder at $DOWNLOADS."
[ -f "$PAGE" ] || fail "No LoText page at $PAGE."
[ "$(git -C "$PERU" branch --show-current)" = main ] ||
  fail "Peru's checkout ($PERU) is not on main, and a deploy only takes what is on main."
[ -z "$(git -C "$PERU" status --porcelain -- "$PAGE_PATH")" ] ||
  fail "The LoText page has changes nobody has committed:" "$PAGE" \
       "Commit or undo them first, so this commit holds the version change only."

version_in () { sed -nE 's/^ *version: "([^"]*)",$/\1/p'; }
LIVE_VERSION=$(git -C "$PERU" show "refs/deployed/main:$PAGE_PATH" | version_in)
COMMITTED_VERSION=$(version_in < "$PAGE")
[ -n "$LIVE_VERSION" ] && [ -n "$COMMITTED_VERSION" ] ||
  fail "Could not find the version in LOTEXT_PUBLISHED_RELEASE in $PAGE."

# ── 2. The file ──────────────────────────────────────────────────────────────
copy_the_image_to_the_site () {
  echo "▸ Copying $NAME into $DOWNLOADS"
  cp -f "$IMAGE" "$DOWNLOADS/$NAME"
  local status
  status=$(curl -s -r 0-15 -o /dev/null -w "%{http_code}" "$FILE_ROUTE$NAME" || true)
  if [ "$status" != 206 ]; then
    rm -f "$DOWNLOADS/$NAME"
    fail "The site did not serve $NAME (it answered $status), so it has been taken back out." \
         "Nothing else was changed."
  fi
  echo "  the site serves it"
}

# ── 3. The page ──────────────────────────────────────────────────────────────
commit_the_page_version () {
  if [ "$COMMITTED_VERSION" = "$VERSION" ]; then
    COMMIT=$(git -C "$PERU" log -1 --format=%h -- "$PAGE_PATH")
    echo "▸ The LoText page already offers $VERSION on main ($COMMIT)"
    return
  fi
  echo "▸ Setting the LoText page to $VERSION, dated $RELEASE_DATE"
  VERSION="$VERSION" RELEASE_DATE="$RELEASE_DATE" perl -0pi -e '
    s/(LOTEXT_PUBLISHED_RELEASE = \{\s*version: ")[^"]*(",\s*releaseDate: ")[^"]*(")/$1$ENV{VERSION}$2$ENV{RELEASE_DATE}$3/
      or die "LOTEXT_PUBLISHED_RELEASE not found\n";
  ' "$PAGE"
  grep -qF "version: \"$VERSION\"" "$PAGE" && grep -qF "releaseDate: \"$RELEASE_DATE\"" "$PAGE" ||
    fail "The page was not updated as expected: $PAGE"
  git -C "$PERU" commit -q -m "Lolek Productions: the LoText page offers $VERSION" -- "$PAGE_PATH"
  COMMIT=$(git -C "$PERU" rev-parse --short HEAD)
  echo "  committed $COMMIT on main in $PERU"
}

# ── 4. The deploy ────────────────────────────────────────────────────────────
deploy_peru () {
  local waiting
  waiting=$(git -C "$PERU" log --format='  %h %s' "refs/deployed/main..main" | grep -v "^  $COMMIT " || true)
  if [ -n "$waiting" ]; then
    echo "▸ These commits are on main and not yet live. The deploy puts them live too:"
    echo "$waiting"
    ask "Deploy them along with the page?" ||
      fail "Not deployed. $NAME is in the download folder and the page change is committed" \
           "($COMMIT), but the live page still offers $LIVE_VERSION. Deploy Peru when ready — see" \
           "$PERU/skills/manage-peru/references/deploying.md — then run this again to finish."
  fi
  echo "▸ Deploying Peru (this takes several minutes)"
  (cd "$PERU" && scripts/deploy.sh --target main) ||
    fail "The deploy failed. $NAME is in the download folder and the old image has been left in" \
         "place. If the page already changed, the next deploy finishes the job; if not, the site" \
         "still offers $LIVE_VERSION. Run this again once Peru deploys."
  git -C "$PERU" merge-base --is-ancestor "$COMMIT" refs/deployed/main ||
    fail "The deploy reported success but $COMMIT is not live. The old image has been left in place."
}

# ── 5. One version on the site ───────────────────────────────────────────────
take_older_images_off_the_site () {
  echo "▸ Taking older images off the site"
  mkdir -p "$EXPORTS"
  local old kept
  for old in "$DOWNLOADS"/LoText-*.dmg; do
    [ "$(basename "$old")" = "$NAME" ] && continue
    kept="$EXPORTS/$(basename "$old")"
    if [ -f "$kept" ] && cmp -s "$old" "$kept"; then
      rm "$old"
      echo "  removed $(basename "$old") (a copy is in $EXPORTS)"
    elif [ ! -e "$kept" ]; then
      mv "$old" "$kept"
      echo "  moved $(basename "$old") into $EXPORTS"
    else
      fail "$(basename "$old") differs from the copy in $EXPORTS, so it was left on the site." \
           "Decide which to keep, then remove it from $DOWNLOADS."
    fi
  done
}

if [ "$LIVE_VERSION" = "$VERSION" ]; then
  [ -f "$DOWNLOADS/$NAME" ] && cmp -s "$IMAGE" "$DOWNLOADS/$NAME" ||
    fail "The site already offers $VERSION, from a different image than $NAME." \
         "Raise the version in package.json and run 'npm run release' to make a new image."
  echo "  the site already offers $VERSION; only the older images are left to take off"
else
  echo "  the site offers $LIVE_VERSION; this publishes $VERSION"
  copy_the_image_to_the_site
  commit_the_page_version
  deploy_peru
fi
take_older_images_off_the_site

echo "✓ lolekproductions.org/LoText offers $VERSION"
