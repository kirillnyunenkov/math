#!/bin/sh
# Nightly consistent backup of the PocketBase data; keeps the newest 14.
set -eu
umask 077
SRC=/opt/ege-api/pb_data
DST=/opt/ege-api/backups
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sqlite3 "$SRC/data.db" ".backup '$TMP/data.db'"
sqlite3 "$SRC/auxiliary.db" ".backup '$TMP/auxiliary.db'" 2>/dev/null || true
[ -d "$SRC/storage" ] && cp -a "$SRC/storage" "$TMP/storage"
mkdir -p "$DST"
tar -czf "$DST/$(date +%Y-%m-%d_%H%M).tgz" -C "$TMP" .
ls -1t "$DST"/*.tgz | tail -n +15 | xargs -r rm --
