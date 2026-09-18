#!/usr/bin/env bash
# Build and test the Notes iOS app on a simulator.
#
# Resolves the simulator to a UDID rather than passing `-destination name:`,
# which goes ambiguous the moment a second simulator is booted and has been
# seen to capture a sibling bag's run.
#
# Pinned to the same -derivedDataPath `barry ios build` uses: with Xcode's
# shared DerivedData, `simctl install` can pick up a stale app from a previous
# build and "verify" a change that was never compiled.
set -euo pipefail

cd "$(dirname "$0")/.."

SIM_NAME="${SIM_NAME:-iPhone 16 Pro}"
DERIVED=".build-barry-ios"
LOG="/tmp/notes-ios-test.log"

# sed, not awk: `match(..., arr)` with a capture array is a GNU extension and
# this is BSD awk. The `(` after the name anchors to the device line so
# "iPhone 16 Pro" cannot match "iPhone 16 Pro Max".
UDID="$(xcrun simctl list devices available \
  | grep -F "$SIM_NAME (" \
  | head -1 \
  | sed -E 's/.*\(([0-9A-Fa-f-]{36})\).*/\1/')"

if [[ -z "${UDID:-}" ]]; then
  echo "No available simulator named '$SIM_NAME'." >&2
  echo "Available:" >&2
  xcrun simctl list devices available | grep iPhone >&2
  exit 1
fi

echo "Simulator: $SIM_NAME ($UDID)"

# Regenerate every time: xcodegen globs the source directories, so a file added
# since the last generate is absent from the project and the build "succeeds"
# without it.
xcodegen generate

echo "Building and testing — full log at $LOG"
set +e
xcodebuild \
  -project Notes.xcodeproj \
  -scheme Notes \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=$UDID" \
  -derivedDataPath "$DERIVED" \
  test >"$LOG" 2>&1
status=$?
set -e

grep -E "error:|Executed .* tests|\*\* TEST" "$LOG" | sort -u || true

if [[ $status -ne 0 ]]; then
  echo "FAILED — see $LOG" >&2
  exit $status
fi

# A zero exit with no bundle is a real failure mode: it would leave a stale app
# installed and a passing report.
APP="$(find "$DERIVED/Build/Products" -maxdepth 2 -name 'Notes.app' -print -quit)"
if [[ -z "$APP" ]]; then
  echo "Build reported success but produced no Notes.app" >&2
  exit 1
fi
echo "OK — $APP"
