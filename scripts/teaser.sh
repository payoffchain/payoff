#!/usr/bin/env bash
# Render the pre-launch tweet image with the site's real web fonts (headless Chrome).
#   scripts/teaser.sh out.png ["headline <span>ice part</span>"] ["lede line"] ["STAMP"]
OUT="${1:-teaser.png}"
Q="h1=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "${2:-a loan strangers <span>pay for.</span>}")"
[ -n "$3" ] && Q="$Q&lede=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$3")"
[ -n "$4" ] && Q="$Q&stamp=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$4")"
HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,675 --virtual-time-budget=8000 --screenshot="$OUT" "file:///$HERE/teaser.html?$Q"
