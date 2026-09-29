#!/bin/bash
#
# Build a signed, notarized LoText disk image — the one to hand to other people.
#
#   npm run release                      → exports/LoText-<version>.dmg, then asks about the Desktop
#                                          and about publishing it on lolekproductions.org
#   npm run release -- /path/out.dmg     → there instead
#   npm run release -- --desktop         … and a copy on the Desktop, without asking
#   npm run release -- --no-desktop      … and no copy, without asking
#   npm run release -- --publish         … and publish it on lolekproductions.org, without asking
#   npm run release -- --no-publish      … and do not, without asking
#
# This is scripts/make-dmg.sh with the signing identity and notary profile filled in, and with
# every precondition checked *first*, in plain words. Each check below is here because its
# failure once cost real time: the raw tools report them as `errSecInternalComponent`, a 401, or
# nothing at all. The one-time setup they check for is in discoveries/packaging-a-dmg.md.
#
# Run it in Terminal on the Mac itself, not over SSH.

set -euo pipefail

cd "$(dirname "$0")/.."

IDENTITY=${LOTEXT_SIGN_IDENTITY:-"Developer ID Application: Lolek Productions, INC. (N6Z9A72885)"}
PROFILE=${LOTEXT_NOTARY_PROFILE:-lotext-notary}
SETUP="See \"First-time setup\" in discoveries/packaging-a-dmg.md."

fail () {
  printf '\n✗ %s\n' "$1" >&2
  shift
  for line in "$@"; do printf '  %s\n' "$line" >&2; done
  printf '\n' >&2
  exit 1
}

echo "▸ Checking the release setup"

# Over SSH the login keychain is locked for the session and nothing can ask for the password,
# so signing dies halfway with errSecInternalComponent. Refuse up front instead.
if [ -n "${SSH_CONNECTION:-}${SSH_TTY:-}" ]; then
  fail "This is an SSH session, where the keychain is locked and cannot be unlocked." \
       "Run 'npm run release' in Terminal on the Mac itself."
fi

# The certificate, with its private key. A *Managed* Developer ID certificate never appears here
# — its key lives on Apple's servers — which is the usual reason this fails.
if ! security find-identity -v -p codesigning | grep -qF "\"$IDENTITY\""; then
  fail "No signing certificate called: $IDENTITY" \
       "Create one in Xcode → Settings → Accounts → Manage Certificates → + → Developer ID Application." \
       "A 'Managed' Developer ID certificate on developer.apple.com will not work for this." \
       "$SETUP"
fi

# The saved notary login. `history` is the cheapest call that proves the profile exists and that
# Apple accepts it.
if ! NOTARY=$(xcrun notarytool history --keychain-profile "$PROFILE" 2>&1); then
  case "$NOTARY" in
    *401*|*"Invalid credentials"*)
      fail "Apple rejected the saved notarization login ('$PROFILE')." \
           "Make a new app-specific password at account.apple.com → Sign-In and Security →" \
           "App-Specific Passwords, then run:" \
           "  xcrun notarytool store-credentials $PROFILE --apple-id <your Apple ID> --team-id N6Z9A72885" ;;
    *keychainLocked*)
      fail "The login keychain is locked, so the saved notarization login cannot be read." \
           "Run this in Terminal on the Mac, where the keychain is unlocked when you log in." ;;
    *"No Keychain password item found"*|*"profile"*)
      fail "No saved notarization login called '$PROFILE'. Run:" \
           "  xcrun notarytool store-credentials $PROFILE --apple-id <your Apple ID> --team-id N6Z9A72885" \
           "$SETUP" ;;
    *)
      fail "Could not reach Apple's notary service:" "$NOTARY" ;;
  esac
fi

echo "  certificate  $IDENTITY"
echo "  notary       $PROFILE"
echo "  If macOS asks whether codesign may use the key: enter your login password, Always Allow."

LOTEXT_SIGN_IDENTITY="$IDENTITY" LOTEXT_NOTARY_PROFILE="$PROFILE" bash scripts/make-dmg.sh "$@"
