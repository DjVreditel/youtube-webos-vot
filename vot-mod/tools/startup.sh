#!/usr/bin/env bash
DIR="$(cd "$(dirname "$0")" && pwd)"
C="$DIR/cdp.cjs"
T="$DIR/tv.cjs"
APP=youtube.leanback.v4
for run in 1 2 3; do
  node "$T" exec "luna-send -n 1 luna://com.webos.applicationManager/closeByAppId '{\"id\":\"$APP\"}'" >/dev/null 2>&1
  sleep 4
  node "$T" exec "sync; echo 3 > /proc/sys/vm/drop_caches; luna-send -n 1 luna://com.webos.applicationManager/launch '{\"id\":\"$APP\"}'" >/dev/null 2>&1
  r=""
  for i in $(seq 1 60); do
    sleep 0.5
    r=$(node "$C" eval '(function(){if(!/youtube\.com\/tv/.test(location.href))return "";var t=document.querySelector("ytlr-tile-renderer");return t?String(Date.now()-performance.timing.navigationStart):"";})()' 2>/dev/null | tr -d '"')
    [ -n "$r" ] && [ "$r" != "null" ] && break
  done
  echo "startup_ms=$r"
done
