#!/bin/bash
# ClipRename first-launch fixer.
#
# macOS says ClipRename "is damaged" because the app isn't Apple-notarized
# yet — it is NOT damaged. This clears that block.
#
# HOW TO USE:
#   1. Drag ClipRename into the Applications folder first.
#   2. Right-click (or Control-click) this file and choose "Open",
#      then click "Open" again in the warning dialog.

APP="/Applications/ClipRename.app"

# True when no file inside the app carries the quarantine flag anymore.
is_clean() {
  ! xattr -lr "$APP" 2>/dev/null | grep -q com.apple.quarantine
}

echo "Fixing ClipRename's first launch..."

if [ ! -d "$APP" ]; then
  echo ""
  echo "ClipRename isn't in Applications yet."
  echo "Drag ClipRename into the Applications folder, then run this again."
  echo ""
  read -n 1 -s -r -p "Press any key to close this window."
  exit 0
fi

# Pass 1: plain xattr. On macOS 13+ this can fail with "Operation not
# permitted" — Terminal needs the "App Management" permission to modify
# an app bundle that has already been launched once.
xattr -cr "$APP" 2>/dev/null

if ! is_clean; then
  echo ""
  echo "macOS blocked the fix (this is normal on newer macOS)."
  echo "Trying again with administrator rights — enter your Mac password:"
  sudo xattr -cr "$APP"
fi

# Also clear the copy next to this script (still inside the installer).
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -d "$DIR/ClipRename.app" ]; then
  xattr -cr "$DIR/ClipRename.app" 2>/dev/null
fi

if is_clean; then
  echo "Done — opening ClipRename."
  open "$APP"
else
  echo ""
  echo "Still blocked. Two ways to finish:"
  echo ""
  echo "A) System Settings → Privacy & Security → App Management →"
  echo "   turn ON Terminal, then run this file again."
  echo ""
  echo "B) Start clean (no permissions needed):"
  echo "   1. Move ClipRename from Applications to the Trash."
  echo "   2. In Terminal run:"
  echo "        xattr -d com.apple.quarantine ~/Downloads/ClipRename-*.dmg"
  echo "   3. Open the .dmg again and drag ClipRename to Applications."
  echo "      It will now launch with no warning at all."
fi
echo ""
read -n 1 -s -r -p "Press any key to close this window."
