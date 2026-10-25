#!/usr/bin/env bash
set -euo pipefail

port_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${COBALT_PORT_WORK:-$HOME/cobalt-port-work}"
rf="$work/rf"
runtime="$work/runtime-libs"
build_dir="$rf/workdir/cobalt-source/out/webos-arm-sbversion-13_${COBALT_BUILD_TYPE:-devel}"

mkdir -p "$runtime"
docker run --rm -v ytaf-webos-linux-sdk:/sdk:ro -v "$runtime:/out" ubuntu:24.04 bash -c '
  set -euo pipefail
  sysroot=/sdk/arm-webos-linux-gnueabi_sdk-buildroot/arm-webos-linux-gnueabi/sysroot
  for lib in libstdc++.so.6 libgcc_s.so.1 libatomic.so.1; do
    cp -L "$(find "$sysroot" -name "$lib" -print -quit)" "/out/$lib"
  done
'

cd "$rf"
cp "$port_dir/../assets/icon.png" assets/icon.png
cp "$port_dir/../assets/largeIcon.png" assets/largeIcon.png
git checkout -q -- starterless-cobalt/appinfo.json
jq --arg id "${COBALT_APP_ID:-youtube.leanback.v4}" --arg title "${COBALT_TITLE:-YouTube}" \
  --arg version "${COBALT_VERSION:-}" \
  '.id = $id | .title = $title | .iconColor = "#FFFFFF" | .vendor = "DjVreditel"
   | if $version == "" then . else .version = $version end' \
  starterless-cobalt/appinfo.json > starterless-cobalt/appinfo.json.tmp
mv starterless-cobalt/appinfo.json.tmp starterless-cobalt/appinfo.json
userscript="$port_dir/../dist/webOSUserScripts/userScript.js"
[[ -s "$userscript" ]] || { echo "Build the userscript first (npm run build in the repo root)." >&2; exit 2; }
webapp_out="$work/webapp-out"
rm -rf "$webapp_out"
mkdir -p "$webapp_out"
cat "$port_dir/inject/prefix.js" "$userscript" "$port_dir/inject/suffix.js" > "$webapp_out/adblockPreload.js"
printf 'void 0;\n' > "$webapp_out/adblockMain.js"
printf '\n' > "$webapp_out/adblockMain.css"
sed -i -e "s/grep -Fq '__shorts'/grep -Fq ''/" -e "s/grep -Fq '__ytafPreloadExecuted'/grep -Fq ''/" \
  scripts/package-starterless-cobalt.sh

[[ -x node_modules/.bin/ares-package ]] || npm install --no-audit --no-fund
rm -f output/*.ipk
COBALT_BUILD_DIR="$build_dir" COBALT_RUNTIME_DIR="$runtime" COBALT_PACKAGE_OUTPUT_DIR="$rf/output" \
  WEBAPP_OUTPUT_DIR="$webapp_out" bash scripts/package-starterless-cobalt.sh
mkdir -p "$work/dist"
cp output/*.ipk "$work/dist/"
ls -l "$work/dist"
