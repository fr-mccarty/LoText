#!/bin/bash
#
# Publish a notarized LoText disk image on lolekproductions.org/LoText, replacing the one there.
#
#   scripts/publish-to-website.sh LoText-1.0.3.dmg          one in the export folder (scripts/export-folder.sh)
#   scripts/publish-to-website.sh path/to/LoText-1.0.3.dmg  one anywhere else
#   scripts/publish-to-website.sh LoText-1.0.3.dmg --yes    no questions: for a script
#
# `npm run release` offers to run it once a notarized image is made. Peru is reached as
# scripts/peru.sh says: in place on the Mac mini, over ssh to it from anywhere else.
#
# In order, stopping at the first thing that fails:
#
#   1. Checks the image is notarized, that Peru's checkout is on main and its LoText page has no
#      uncommitted changes, and which version the live site offers.
#   2. Copies the image into the websites' download folder on the Mac mini.
#   3. Sets the version and today's date in the LoText page, commits that one file on Peru's main
#      and pushes it.
#   4. Takes every other LoText image out of the download folder (into the export folder, if it
#      is not already there), so the site offers the latest version only.
#   5. Rebuilds the public websites (`pnpm websites:install`). Any other website commits on
#      Peru's main not yet live go with it, so those are listed and a yes is asked for. The new
#      build switches in at once, page and image together; until then the live site keeps its
#      own copy of the old page and image, so nothing breaks in between.
#   6. Checks the site serves the new image and the page offers it.
#
# A run that stopped partway is finished by running it again.

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)
source "$ROOT/scripts/export-folder.sh"
source "$ROOT/scripts/peru.sh"

SITE=${LOTEXT_SITE_ORIGIN:-"https://lolekproductions.org"}
PAGE_PATH="frontend/web/src/websites/lolekproductions/lolekproductions-website.tsx"

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

peru true || fail "Cannot reach Peru at $PERU_WHERE."
[ "$(peru 'git branch --show-current')" = main ] ||
  fail "Peru's checkout ($PERU_WHERE) is not on main."
[ -z "$(peru "git status --porcelain -- $PAGE_PATH")" ] ||
  fail "The Lolek Productions page has changes nobody has committed:" "$PERU_WHERE/$PAGE_PATH" \
       "Commit or undo them first, so this commit holds the version change only."

version_in () { sed -nE "s/^const lotextDiskImageFileName = 'LoText-([0-9.]+)\.dmg'$/\1/p"; }
# A live build from before Peru's code moved into behavior/code has the page at the old path.
LIVE_VERSION=$(peru "git show $(peru_live_commit):./$PAGE_PATH 2>/dev/null || git show $(peru_live_commit):$PAGE_PATH" | version_in)
COMMITTED_VERSION=$(peru "cat $PAGE_PATH" | version_in)
[ -n "$LIVE_VERSION" ] && [ -n "$COMMITTED_VERSION" ] ||
  fail "Could not find lotextDiskImageFileName in $PERU_WHERE/$PAGE_PATH."

LOCAL_SUM=$(shasum -a 256 "$IMAGE" | cut -d' ' -f1)
remote_sum () { peru "shasum -a 256 ~/$PERU_DOWNLOADS/$1 2>/dev/null | cut -d' ' -f1"; }

# ── 2. The file ──────────────────────────────────────────────────────────────
copy_the_image () {
  if [ "$(remote_sum "$NAME")" = "$LOCAL_SUM" ]; then
    echo "▸ $NAME is already in the download folder"
    return
  fi
  echo "▸ Copying $NAME into $PERU_DOWNLOADS"
  peru_copy "$IMAGE" "$PERU_DOWNLOADS"
  [ "$(remote_sum "$NAME")" = "$LOCAL_SUM" ] || fail "The copy of $NAME on the Mac mini does not match."
}

# ── 3. The page ──────────────────────────────────────────────────────────────
commit_the_page_version () {
  if [ "$COMMITTED_VERSION" = "$VERSION" ]; then
    echo "▸ The LoText page already offers $VERSION on Peru's main"
    return
  fi
  echo "▸ Setting the LoText page to $VERSION, dated $RELEASE_DATE"
  peru "VERSION='$VERSION' RELEASE_DATE='$RELEASE_DATE' perl -0pi -e '
          s/(lotextDiskImageFileName = \x27LoText-)[0-9.]+(\.dmg\x27)/\$1\$ENV{VERSION}\$2/ or die qq(file name not found\n);
          s/(Version )[0-9.]+( · )[^<]+(<)/\$1\$ENV{VERSION}\$2\$ENV{RELEASE_DATE}\$3/ or die qq(version line not found\n);
        ' $PAGE_PATH" || fail "The page could not be updated: $PERU_WHERE/$PAGE_PATH"
  peru "grep -qF \"LoText-$VERSION.dmg'\" $PAGE_PATH && grep -qF 'Version $VERSION · $RELEASE_DATE<' $PAGE_PATH" ||
    fail "The page was not updated as expected: $PERU_WHERE/$PAGE_PATH"
  peru "git commit -q -m 'Lolek Productions: the LoText page offers $VERSION' -- $PAGE_PATH &&
        git log -1 --format='  committed %h on main'"
  peru 'git push -q origin main' || echo "  (the push failed; push Peru's main by hand)"
}

# ── 4. One version on the site ───────────────────────────────────────────────
take_older_images_out () {
  local old kept
  for old in $(peru "cd ~/$PERU_DOWNLOADS && ls LoText-*.dmg 2>/dev/null" || true); do
    [ "$old" = "$NAME" ] && continue
    kept="$EXPORTS/$old"
    if [ -f "$kept" ] && [ "$(shasum -a 256 "$kept" | cut -d' ' -f1)" = "$(remote_sum "$old")" ]; then
      echo "▸ Taking $old out of the download folder (a copy is in the export folder)"
    elif [ ! -e "$kept" ]; then
      echo "▸ Moving $old into the export folder"
      mkdir -p "$EXPORTS"
      if [ "$PERU_LOCAL" = yes ]; then cp "$HOME/$PERU_DOWNLOADS/$old" "$kept"
      else scp -q -o BatchMode=yes "$PERU_HOST:$PERU_DOWNLOADS/$old" "$kept"; fi
    else
      fail "$old differs from the copy in $EXPORTS, so it was left in the download folder." \
           "Decide which to keep, then remove it from $PERU_HOST:~/$PERU_DOWNLOADS."
    fi
    peru "rm ~/$PERU_DOWNLOADS/$old"
  done
}

# ── 5. The websites ──────────────────────────────────────────────────────────
publish_the_websites () {
  local waiting
  waiting=$(peru_unpublished_website_commits | grep -v "the LoText page offers $VERSION" || true)
  if [ -n "$waiting" ]; then
    echo "▸ These website commits on Peru's main are not live yet, and go live with the page:"
    echo "$waiting"
    ask "Publish them along with the page?" ||
      fail "Not published. $NAME is in the download folder and the page change is committed," \
           "but the live page still offers $LIVE_VERSION. Run this again to finish."
  fi
  echo "▸ Rebuilding the public websites (pnpm websites:install)"
  peru_publish_websites || fail "The site still offers $LIVE_VERSION. Run this again once that is fixed."
}

# ── 6. The check ─────────────────────────────────────────────────────────────
check_the_site () {
  local status
  status=$(curl -s -r 0-15 -o /dev/null -w "%{http_code}" "$SITE/$NAME?fresh=$(date +%s)" || true)
  [ "$status" = 206 ] || fail "$SITE/$NAME answered $status, not 206."
  local tries=0
  until [[ "$(curl -s "$SITE/LoText?fresh=$(date +%s)")" == *"Download $NAME"* ]]; do
    tries=$((tries + 1))
    [ "$tries" -lt 10 ] || fail "$SITE/LoText does not offer $NAME, even past the cache."
    sleep 3
  done
}

if [ "$LIVE_VERSION" = "$VERSION" ] && [ -n "$(remote_sum "$NAME")" ] && [ "$(remote_sum "$NAME")" != "$LOCAL_SUM" ]; then
  fail "The site already offers $VERSION, from a different image than $NAME." \
       "Raise the version in package.json and run 'npm run release' to make a new image."
fi

copy_the_image
if [ "$LIVE_VERSION" != "$VERSION" ] || [ "$COMMITTED_VERSION" != "$VERSION" ]; then
  echo "  the site offers $LIVE_VERSION; this publishes $VERSION"
  commit_the_page_version
fi
take_older_images_out
publish_the_websites
check_the_site

echo "✓ $SITE/LoText offers $VERSION (Cloudflare may show the old page for a few hours)"
