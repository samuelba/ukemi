#!/bin/sh
# Usage: scripts/preview/screenshot.sh <jj-repo> <output-dir>
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$1
out=$2
mkdir -p "$out"
npx esbuild "$here/state.ts" --bundle --platform=node --format=cjs --log-level=warning --outfile="$out/state.js"
node "$out/state.js" "$repo" "$here/state.generated.js"
shot() {
  google-chrome --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --virtual-time-budget=2000 --force-device-scale-factor=2 --window-size="$2" \
    --screenshot="$out/$1.png" "file://$here/harness.html?$3" >/dev/null 2>&1
  echo "$out/$1.png"
}
shot graph-dark 400,300 "theme=dark"
shot graph-light 400,300 "theme=light"
shot split-dark 700,520 "view=split&theme=dark"
shot evolution-dark 400,420 "theme=dark&evolution"
shot evolution-light 400,420 "theme=light&evolution"
