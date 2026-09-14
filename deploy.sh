#!/bin/sh
# Stamp the build version into index.html (cache-busts style.css/app.js and shows
# the version in the footer), then deploy to Netlify production.
set -e
cd "$(dirname "$0")"
V=$(date -u +%Y%m%d-%H%M)
sed -i '' -E "s#/style\.css(\?v=[^\"]*)?#/style.css?v=$V#; s#/app\.js(\?v=[^\"]*)?#/app.js?v=$V#; s#(<span id=\"build\">)[^<]*#\1$V#" public/index.html
npx netlify deploy --prod --dir public "$@"
