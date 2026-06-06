#!/usr/bin/env bash
set -u
BASE="https://www.geospatial.jp/ckan/dataset/9db8f0a7-5f94-424b-a978-740cfd58a5fa/resource"
OUT="data/raw"
while read -r rid fname; do
  [ -z "$rid" ] && continue
  dest="$OUT/$fname"
  if [ -s "$dest" ] && [ "$(stat -c%s "$dest")" -gt 100000 ]; then
    echo "SKIP $fname ($(stat -c%s "$dest") bytes)"; continue
  fi
  ok=0
  for attempt in 1 2 3 4 5; do
    code=$(curl -sL --max-time 180 -o "$dest" -w "%{http_code}" \
      "$BASE/$rid/download/$fname")
    sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
    if [ "$code" = "200" ] && [ "$sz" -gt 100000 ]; then
      echo "OK   $fname  $sz bytes"; ok=1; break
    fi
    echo "RETRY $fname attempt=$attempt code=$code size=$sz"
    sleep $((attempt*3))
  done
  [ "$ok" = "0" ] && echo "FAIL $fname"
done < scripts/files.txt
echo "DOWNLOAD COMPLETE"
