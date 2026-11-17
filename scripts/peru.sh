# Sourced, not run: how the scripts that publish to lolekproductions.org reach Peru.
#
# Peru is the Peru-2 checkout on the Mac mini (~/peru-2). The public websites, lolekproductions.org
# among them, are served from that Mac through a Cloudflare tunnel, out of
# ~/peru-2-agent/websites/current, which `pnpm websites:install` rebuilds from Peru's checkout and
# switches in one step. `pnpm deploy` is the droplet, and does not touch the public websites.
#
# Run on the Mac mini, everything happens in place; anywhere else, over ssh to it.
#
#   LOTEXT_PERU_HOST   ssh login for the Mac mini (default jmccarty@mac-mini, its Tailscale address)
#   LOTEXT_PERU_DIR    the checkout, relative to that home (default peru-2)

PERU_HOST=${LOTEXT_PERU_HOST:-"jmccarty@mac-mini"}
PERU_DIR=${LOTEXT_PERU_DIR:-"peru-2"}
PERU_SITE_FOLDER="frontend/web/public/websites/lolekproductions"
PERU_DOWNLOADS="peru-2-agent/websites/downloads/lolekproductions"
PERU_LIVE_LINK="peru-2-agent/websites/current"

if [ -d "$HOME/$PERU_DIR/.git" ]; then PERU_LOCAL=yes; else PERU_LOCAL=no; fi
PERU_WHERE=$([ "$PERU_LOCAL" = yes ] && echo "~/$PERU_DIR" || echo "$PERU_HOST:~/$PERU_DIR")

# peru 'commands' — runs them in a login zsh (so pnpm is on the PATH) in Peru's checkout.
peru () {
  if [ "$PERU_LOCAL" = yes ]; then
    printf '%s\n' "$1" | (cd "$HOME/$PERU_DIR" && zsh -l -s)
  else
    printf '%s\n' "$1" | ssh -o BatchMode=yes -o ConnectTimeout=15 "$PERU_HOST" "cd ~/$PERU_DIR && zsh -l -s"
  fi
}

# peru_copy FILE... DEST — copies local files into DEST, a folder relative to the Mac mini's home.
peru_copy () {
  local dest=${*: -1}
  local files=("${@:1:$#-1}")
  if [ "$PERU_LOCAL" = yes ]; then
    cp -f "${files[@]}" "$HOME/$dest/"
  else
    scp -q -o BatchMode=yes "${files[@]}" "$PERU_HOST:$dest/"
  fi
}

# The commit the public websites were last built from, from the name of the live release.
peru_live_commit () {
  peru "basename \"\$(readlink ~/$PERU_LIVE_LINK)\" | cut -d- -f1"
}

# peru_publish_websites — rebuilds the public websites from Peru's checkout and switches them in.
# Refuses a checkout with uncommitted changes, which the build would otherwise put live.
peru_publish_websites () {
  local dirty
  dirty=$(peru 'git status --porcelain')
  if [ -n "$dirty" ]; then
    printf '\n✗ Peru (%s) has uncommitted changes, which the websites build would put live:\n%s\n\n' \
      "$PERU_WHERE" "$dirty" >&2
    return 1
  fi
  local output
  output=$(peru 'pnpm websites:install' 2>&1) || true
  if [ "$(peru_live_commit)" != "$(peru 'git rev-parse HEAD' | cut -c1-12)" ]; then
    printf '\n✗ pnpm websites:install did not switch the sites to Peru'"'"'s HEAD. Its last lines:\n' >&2
    printf '%s\n' "$output" | tail -20 >&2
    return 1
  fi
  printf '%s\n' "$output" | grep '^\[websites\]' || true
}

# The website commits on Peru's main that the live sites do not have yet, one per line.
peru_unpublished_website_commits () {
  local live
  live=$(peru_live_commit)
  peru "git log --format='  %h %s' $live..HEAD -- frontend/web/src/websites frontend/web/public/websites"
}
