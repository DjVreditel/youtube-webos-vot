#!/usr/bin/env bash
set -euo pipefail

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$dir/../../src/vot/minimp3.js"
ref="afb604c06bc8beb145fecd42c0ceb5bda8795144"

curl -sfL -o "$dir/minimp3.h" "https://raw.githubusercontent.com/lieff/minimp3/$ref/minimp3.h"
docker run --rm -v "$dir:/src" -w /src emscripten/emsdk:3.1.74 emcc wrapper.c -O3 \
  -s WASM=0 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createMinimp3 \
  -s ENVIRONMENT=web -s USE_ES6_IMPORT_META=0 -s FILESYSTEM=0 -s INITIAL_MEMORY=16777216 -s ALLOW_MEMORY_GROWTH=0 \
  -s EXPORTED_FUNCTIONS=_mp3_init,_mp3_decode,_mp3_pcm,_mp3_frame,_malloc,_free \
  -s EXPORTED_RUNTIME_METHODS=HEAPU8,HEAP16,HEAP32 \
  -o /src/minimp3.out.js
mv "$dir/minimp3.out.js" "$out"
rm -f "$dir/minimp3.h"
echo "built $out"
