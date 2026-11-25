#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
# Parcel inlines the module and styles into a self-contained HTML app.
npm ci
npm test
npm run build
