#!/usr/bin/env bash
set -euo pipefail

DEST="${1:-/Users/robgraham/Desktop/APPS/Keytec API Wallet}"
APP_NAME="${APP_NAME:-$(basename "$DEST")}"
BUNDLE_SLUG="$(printf "%s" "$APP_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
APP_PORT="${FAMTEC_SERVER_PORT:-$((48000 + ($(printf "%s" "$BUNDLE_SLUG" | cksum | awk '{print $1}') % 1000)))}"
APP="$DEST/$APP_NAME.app"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js was not found on PATH." >&2
  exit 1
fi

mkdir -p "$DEST"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web"
cp -R "$ROOT/web/." "$APP/Contents/Resources/web/"
printf "%s\n" "$ROOT" > "$APP/Contents/Resources/project-path.txt"

ICONSET="$APP/Contents/Resources/AppIcon.iconset"
python3 "$ROOT/scripts/make_icon.py" "$ICONSET" "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>$APP_NAME</string>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.famtec.$BUNDLE_SLUG.browser</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/$APP_NAME" <<LAUNCHER
#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="\$(cd "\$(dirname "\$0")/.." && pwd)"
RESOURCES="\$APP_ROOT/Resources"
PROJECT_DIR="\$(cat "\$RESOURCES/project-path.txt")"
PORT="$APP_PORT"
NODE_BIN="$NODE_BIN"
LOG_DIR="\$HOME/Library/Logs/$APP_NAME"
CHROME_PROFILE="\$HOME/Library/Application Support/$APP_NAME/ChromeProfile"

mkdir -p "\$LOG_DIR" "\$CHROME_PROFILE"

if ! /usr/bin/curl -fsS "http://127.0.0.1:\$PORT/health" >/dev/null 2>&1; then
  FAMTEC_APP_NAME="$APP_NAME" FAMTEC_PROJECT_DIR="\$PROJECT_DIR" FAMTEC_SERVER_PORT="\$PORT" "\$NODE_BIN" "\$RESOURCES/web/server.js" >> "\$LOG_DIR/dashboard.log" 2>&1 &
fi

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if /usr/bin/curl -fsS "http://127.0.0.1:\$PORT/health" >/dev/null 2>&1; then
    break
  fi
  /bin/sleep 0.2
done

URL="http://127.0.0.1:\$PORT/"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

if [[ -x "\$CHROME" ]]; then
  exec "\$CHROME" --app="\$URL" --user-data-dir="\$CHROME_PROFILE" --no-first-run
fi

exec /usr/bin/open "\$URL"
LAUNCHER

chmod +x "$APP/Contents/MacOS/$APP_NAME"
touch "$APP"

echo "$APP"
