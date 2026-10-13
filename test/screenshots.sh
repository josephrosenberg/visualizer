#!/bin/sh
# Headless screenshots of every look (or the ones named as arguments) via
# Chrome + SwiftShader, plus the page console log, so shader compile errors
# and JS exceptions show up without a hand on the browser.
# Usage: [BUDGET=ms] sh test/screenshots.sh [Look ...]  ->  test/.generated/shots/<look>.png and console.log
set -e
cd "$(dirname "$0")/.."
OUT=test/.generated/shots; mkdir -p "$OUT"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="$(command -v chromium || command -v google-chrome || true)"
[ -x "$CHROME" ] || { echo "no Chrome found"; exit 1; }
PORT=8093
python3 -m http.server $PORT >/dev/null 2>&1 & SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
LOOKS="$*"
[ -n "$LOOKS" ] || LOOKS="Classic Wireframe Rays+Only Points Long+Trails Wire+Rays Ghost Dense Comets"
: > "$OUT/console.log"
for look in $LOOKS; do
  name=$(echo "$look" | tr '+' '_')
  "$CHROME" --headless=new --no-sandbox --disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader \
    --user-data-dir="$OUT/.profile" --enable-logging=stderr --v=0 --virtual-time-budget="${BUDGET:-9000}" \
    --window-size=1280,800 --screenshot="$OUT/$name.png" \
    "http://localhost:$PORT/?demo&look=$look&planets=3" 2>&1 \
    | grep -E 'CONSOLE' | grep -viE 'GL Driver Message|chrome-extension' | sed "s/^/[$name] /" >> "$OUT/console.log" || true
  echo "$name -> $OUT/$name.png"
done
echo "--- console (errors and warnings from the page):"
grep -iE 'error|warn|THREE' "$OUT/console.log" || echo "none"
