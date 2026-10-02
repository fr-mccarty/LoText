#!/bin/bash
#
# Where exported disk images are kept: the one place this is written down.
#
#   source scripts/export-folder.sh     sets EXPORTS for a script
#   scripts/export-folder.sh            prints it, for a command typed by hand:
#                                       xcrun stapler validate "$(scripts/export-folder.sh)/LoText-1.0.8.dmg"
#
# The project itself lives outside ~/Documents, because iCloud Drive syncing a working tree
# (node_modules, .git, build output) caused trouble. The images are the opposite case — finished
# files worth having on every Mac — so they are kept in iCloud, in ~/Documents.

EXPORTS="$HOME/Documents/LoText-exports"

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "$EXPORTS"
fi
