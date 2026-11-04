#!/usr/bin/env bash
# Automate redeeming a Swiggy Money gift voucher on the Android emulator.
#
# Flow: launch Swiggy -> hamburger (Menu) -> Swiggy Money -> Redeem Now
#       -> fill "Enter 16 digit Code" + "Enter PIN" -> Add Gift Voucher.
#
# Elements are resolved by their on-screen text/content-desc at runtime (the UI
# is dumped and parsed each step), so the script survives minor layout shifts
# instead of relying on fixed pixel coordinates.
#
# Usage: ./swiggy-redeem.sh <16-digit-code> <6-digit-pin>
#   e.g. ./swiggy-redeem.sh 1234567890123456 654321

set -euo pipefail

ADB="${ADB:-/opt/homebrew/bin/adb}"
PKG="in.swiggy.android"
DUMP_REMOTE="/sdcard/zpay-ui.xml"
DUMP_LOCAL="/tmp/zpay-swiggy-ui.xml"

CODE="${1:-}"
PIN="${2:-}"

if [[ -z "$CODE" || -z "$PIN" ]]; then
  echo "Usage: $0 <16-digit-code> <6-digit-pin>" >&2
  exit 1
fi
if [[ ! "$CODE" =~ ^[0-9A-Za-z]{16}$ ]]; then
  echo "Error: code must be exactly 16 alphanumeric characters. Got: '$CODE'" >&2
  exit 1
fi
if [[ ! "$PIN" =~ ^[0-9]{6}$ ]]; then
  echo "Error: pin must be exactly 6 digits. Got: '$PIN'" >&2
  exit 1
fi

log() { printf '• %s\n' "$*"; }

# Always close the Swiggy app when we're done — success or failure — so it
# doesn't linger in the foreground after the flow completes.
cleanup() { "$ADB" shell am force-stop "$PKG" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# Dump the current UI hierarchy to $DUMP_LOCAL. Retries once; the first dump
# after a screen transition occasionally races the render.
dump_ui() {
  local tries=0
  while (( tries < 3 )); do
    if "$ADB" shell uiautomator dump "$DUMP_REMOTE" >/dev/null 2>&1 \
       && "$ADB" pull "$DUMP_REMOTE" "$DUMP_LOCAL" >/dev/null 2>&1 \
       && [[ -s "$DUMP_LOCAL" ]]; then
      return 0
    fi
    sleep 1
    (( tries++ ))
  done
  echo "Error: could not dump UI after 3 tries." >&2
  return 1
}

# center_of <attr> <value> : print "X Y" of the first node whose <attr> equals
# <value> (attr = text | content-desc). Empty if not found.
center_of() {
  local attr="$1" val="$2"
  python3 - "$attr" "$val" "$DUMP_LOCAL" <<'PY'
import sys, re
attr, val, path = sys.argv[1], sys.argv[2], sys.argv[3]
xml = open(path, encoding="utf-8").read()
for node in re.findall(r"<node\b[^>]*/?>", xml):
    m = re.search(rf'{re.escape(attr)}="([^"]*)"', node)
    if not m or m.group(1) != val:
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
    if not b:
        continue
    x1, y1, x2, y2 = map(int, b.groups())
    print((x1 + x2) // 2, (y1 + y2) // 2)
    break
PY
}

# Wait until an element with <attr>=<value> appears (timeout seconds), dumping
# each iteration. Prints its center on success.
wait_for() {
  local attr="$1" val="$2" timeout="${3:-15}" waited=0 pt
  while (( waited < timeout )); do
    dump_ui
    pt="$(center_of "$attr" "$val")"
    if [[ -n "$pt" ]]; then
      echo "$pt"
      return 0
    fi
    sleep 1
    (( waited++ ))
  done
  echo "Error: timed out waiting for $attr=\"$val\"" >&2
  return 1
}

tap() { "$ADB" shell input tap "$1" "$2"; }

# Tap the EditText whose resource-id OR hint equals <label>, then type <text>.
fill_field() {
  local label="$1" text="$2" pt
  pt="$(python3 - "$label" "$DUMP_LOCAL" <<'PY'
import sys, re
label, path = sys.argv[1], sys.argv[2]
xml = open(path, encoding="utf-8").read()
for node in re.findall(r"<node\b[^>]*/?>", xml):
    if 'class="android.widget.EditText"' not in node:
        continue
    rid  = (re.search(r'resource-id="([^"]*)"', node) or [None, ""])[1]
    hint = (re.search(r'hint="([^"]*)"', node) or [None, ""])[1]
    if label not in (rid, hint):
        continue
    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', node)
    if b:
        x1, y1, x2, y2 = map(int, b.groups())
        print((x1 + x2) // 2, (y1 + y2) // 2)
    break
PY
)"
  if [[ -z "$pt" ]]; then
    echo "Error: field '$label' not found on screen." >&2
    return 1
  fi
  tap $pt
  sleep 1
  "$ADB" shell input text "$text"
  "$ADB" shell input keyevent 66 >/dev/null 2>&1 || true  # dismiss IME/next
  sleep 1
}

echo "Redeeming Swiggy Money voucher (code ****${CODE: -4}, pin ${#PIN} digits)…"

# 1. Launch Swiggy and wait for it to actually reach the foreground. A fixed
# sleep races the cold-start render (splash/login), which left the next step
# unable to find the Menu button and stalled the whole redeem after payment.
# Poll the focused window until Swiggy owns it (or time out).
log "Launching Swiggy…"
"$ADB" shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

wait_app_foreground() {
  local timeout="${1:-30}" waited=0
  while (( waited < timeout )); do
    if "$ADB" shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus=.*$PKG"; then
      return 0
    fi
    sleep 1
    (( waited++ ))
  done
  echo "Error: Swiggy did not reach the foreground within ${timeout}s." >&2
  return 1
}
wait_app_foreground 30
sleep 2  # small settle for the home screen to finish painting after focus

# 2. Open the hamburger menu (top-right, content-desc="Menu").
log "Opening menu…"
read -r mx my < <(wait_for content-desc "Menu" 20)
tap "$mx" "$my"
sleep 2

# 3. Open Swiggy Money (accessibility label includes "Double tap to open").
log "Opening Swiggy Money…"
read -r sx sy < <(wait_for content-desc "Swiggy Money. Double tap to open." 15)
tap "$sx" "$sy"
sleep 3

# 4. Tap "Redeem Now".
log "Tapping Redeem Now…"
read -r rx ry < <(wait_for text "Redeem Now" 15)
tap "$rx" "$ry"
sleep 3

# 5. Fill both fields (dump once so fill_field sees the form).
log "Filling voucher code and PIN…"
dump_ui
fill_field "Enter 16 digit Code" "$CODE"
dump_ui
fill_field "Enter PIN" "$PIN"

# 6. Tap "Add Gift Voucher" (enabled once both fields are valid).
log "Submitting…"
"$ADB" shell input keyevent 4 >/dev/null 2>&1 || true   # hide keyboard if open
sleep 1
read -r ax ay < <(wait_for text "Add Gift Voucher" 10)
tap "$ax" "$ay"
sleep 3

# 7. Report result.
"$ADB" shell screencap -p /sdcard/zpay-redeem-result.png >/dev/null 2>&1 || true
"$ADB" pull /sdcard/zpay-redeem-result.png /tmp/zpay-redeem-result.png >/dev/null 2>&1 || true
log "Submitted. Screenshot: /tmp/zpay-redeem-result.png"
log "Verify the result on the emulator — a success toast / updated balance confirms redemption."
