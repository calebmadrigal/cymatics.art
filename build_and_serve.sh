#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
./do_build.sh
python3 -m http.server "${PORT:-8000}" --directory dist
