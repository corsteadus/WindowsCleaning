#!/bin/bash
# Increments APP_VERSION in artifacts/crm/src/version.ts
# and updates the Rev label in the build summary HTML.

VERSION_FILE="artifacts/crm/src/version.ts"
SUMMARY_FILE="clearview-crm-build-summary.html"
SUMMARY_PUBLIC="artifacts/crm/public/clearview-crm-build-summary.html"

# Read current version
CURRENT=$(grep -oP '(?<=APP_VERSION = )\d+' "$VERSION_FILE")
NEXT=$((CURRENT + 1))

# Bump version.ts
sed -i "s/APP_VERSION = $CURRENT/APP_VERSION = $NEXT/" "$VERSION_FILE"

# Bump Rev in the build summary HTML (covers "Rev N" anywhere in the file)
sed -i "s/Rev $CURRENT/Rev $NEXT/g" "$SUMMARY_FILE"
cp "$SUMMARY_FILE" "$SUMMARY_PUBLIC"

echo "✓ Version bumped: Rev $CURRENT → Rev $NEXT"
