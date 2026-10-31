#!/bin/bash
# Sign and (optionally) publish an RCP Network release.
#   scripts/release.sh             sign every release asset in dist/
#   scripts/release.sh --publish   also tag and upload everything to the GitHub release
# Build the macOS dmgs and zips here (npm run build:mac). The Windows Setup
# exe and the Linux AppImage come from the GitHub workflow's artifacts (or a
# Windows / Linux machine); download them into dist/ first.
# The version comes from package.json.
set -euo pipefail
cd "$(dirname "$0")/.."

PUBLISH=0
[ "${1:-}" = "--publish" ] && PUBLISH=1

REPO="ilham-fauzi/rcp-network"
VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

DMGS=("dist/RCP-Network-$VERSION-x64.dmg" "dist/RCP-Network-$VERSION-arm64.dmg")
SIGNED=(
    "dist/RCP-Network-$VERSION-x64.zip"
    "dist/RCP-Network-$VERSION-arm64.zip"
    "dist/RCP-Network-Setup-$VERSION.exe"
    "dist/RCP-Network-$VERSION.AppImage"
)

echo "===> Releasing RCP Network $VERSION"

# The app only trusts updates signed by the key it was built with.
EMBEDDED=$(grep -o 'PUBLIC_KEY = "[^"]*"' electron/updater/logic.js | cut -d'"' -f2)
case "$EMBEDDED" in
    ""|TODO*)
        echo "Error: electron/updater/logic.js has no public key yet. Run: node scripts/update-key.js public" >&2
        exit 1 ;;
esac
ACTUAL=$(node scripts/update-key.js public)
if [ "$EMBEDDED" != "$ACTUAL" ]; then
    echo "Error: signing key does not match PUBLIC_KEY in electron/updater/logic.js; installed apps would reject this update." >&2
    exit 1
fi

MISSING=0
for f in "${DMGS[@]}" "${SIGNED[@]}"; do
    if [ ! -f "$f" ]; then echo "Error: missing $f" >&2; MISSING=1; fi
done
[ "$MISSING" -eq 0 ] || exit 1

echo "===> Signing..."
for f in "${SIGNED[@]}"; do
    rm -f "$f.sig"
    node scripts/update-key.js sign "$f"
done

if [ "$PUBLISH" -eq 0 ]; then
    echo "Signed ${#SIGNED[@]} assets. Re-run with --publish to release."
    exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Error: commit your changes before publishing (the tag must match what was built)." >&2
    exit 1
fi

FILES=("${DMGS[@]}")
for f in "${SIGNED[@]}"; do FILES+=("$f" "$f.sig"); done

echo "===> Tagging $TAG and creating the GitHub release..."
git tag "$TAG"
git push origin "$TAG"
gh release create "$TAG" "${FILES[@]}" --repo "$REPO" --title "RCP Network $VERSION" --generate-notes
echo "===> Done: https://github.com/$REPO/releases/tag/$TAG"
