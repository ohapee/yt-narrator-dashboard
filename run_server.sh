#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
export CI=true
exec ./node_modules/.bin/wrangler dev --ip 0.0.0.0 --port 8787
