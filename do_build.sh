#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
# Parcel inlines the module and styles into a self-contained HTML app.
npm ci
npm test
npm run build
cp -R images dist/
cp images/favicon.ico dist/favicon.ico
cp dist/index.html dist/Cymatics.art.html
node scripts/check-build.cjs
