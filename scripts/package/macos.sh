#!/bin/bash
# Builds release/PixelOffice-<version>-<arch>.pkg (run on macOS, after `npm run package`).
#   scripts/package/macos.sh <arm64|x64> <version>
set -euo pipefail
ARCH="$1"
VERSION="$2"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
WORK="$REPO/build/mac-$ARCH"
ROOT="$WORK/root"
APP="$ROOT/Applications/Pixel Office.app"
RES="$APP/Contents/Resources"

rm -rf "$WORK"
mkdir -p "$APP/Contents/MacOS" "$RES" "$WORK/scripts" "$REPO/release"

node "$HERE/fetch-node.mjs" "darwin-$ARCH" "$RES"
rsync -a --exclude '*.map' "$REPO/dist/" "$RES/app/"
cp "$HERE/com.pixeloffice.agent.plist" "$RES/"
cp "$REPO/LICENSE" "$RES/LICENSE.txt"
sips -s format icns "$REPO/icon.png" --out "$RES/AppIcon.icns" >/dev/null

cat > "$APP/Contents/MacOS/PixelOffice" <<'SH'
#!/bin/sh
# Opens the office in the browser (starts it first if the login agent is not running).
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
exec "$RES/node" "$RES/app/cli.js" --open
SH
chmod +x "$APP/Contents/MacOS/PixelOffice"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Pixel Office</string>
  <key>CFBundleDisplayName</key><string>Pixel Office</string>
  <key>CFBundleIdentifier</key><string>com.pixeloffice.app</string>
  <key>CFBundleExecutable</key><string>PixelOffice</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <!-- No Dock icon: the launcher only opens the browser or runs the server. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

cat > "$WORK/scripts/postinstall" <<'SH'
#!/bin/sh
# Install the login agent for the console user and (re)start it.
USER_NAME=$(stat -f %Su /dev/console)
if [ -z "$USER_NAME" ] || [ "$USER_NAME" = root ] || [ "$USER_NAME" = _mbsetupuser ]; then
  exit 0
fi
USER_ID=$(id -u "$USER_NAME")
HOME_DIR=$(dscl . -read "/Users/$USER_NAME" NFSHomeDirectory | sed 's/^NFSHomeDirectory: //')
AGENTS="$HOME_DIR/Library/LaunchAgents"
PLIST="$AGENTS/com.pixeloffice.agent.plist"

# Stop an older copy (started by the agent or by the app) before starting the new one.
curl -s -m 3 -X POST http://127.0.0.1:47801/api/quit >/dev/null 2>&1 && sleep 2
launchctl bootout "gui/$USER_ID/com.pixeloffice.agent" 2>/dev/null || true

# Write into the user's tree only AS the user: a root write would follow a planted symlink.
sudo -u "$USER_NAME" mkdir -p "$AGENTS" "$HOME_DIR/Library/Logs"
sudo -u "$USER_NAME" cp "/Applications/Pixel Office.app/Contents/Resources/com.pixeloffice.agent.plist" "$PLIST"
launchctl bootstrap "gui/$USER_ID" "$PLIST"
exit 0
SH
chmod +x "$WORK/scripts/postinstall"

# Keep the app at /Applications (default pkgbuild would follow a moved copy).
pkgbuild --analyze --root "$ROOT" "$WORK/component.plist"
plutil -replace 0.BundleIsRelocatable -bool NO "$WORK/component.plist"

OUT="$REPO/release/PixelOffice-$VERSION-$ARCH.pkg"
pkgbuild --root "$ROOT" --component-plist "$WORK/component.plist" --scripts "$WORK/scripts" \
  --identifier com.pixeloffice.pkg --version "$VERSION" --install-location / "$OUT"
echo "✓ $OUT"
