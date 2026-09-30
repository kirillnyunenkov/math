#!/bin/sh
# Create a user with a login link (server-side helper; the panel does the same).
# Usage: add-user.sh <login> <role> <name>   -> prints the login link
set -eu
LOGIN=$1 ROLE=$2 NAME=$3
B=http://127.0.0.1:8091/api
SUP=$(sed -n 's/^password: //p' /root/ege-api-superuser.txt)
SEC=$(openssl rand -base64 64 | tr -dc A-Za-z0-9 | head -c 32)
ST=$(curl -s -X POST $B/collections/_superusers/auth-with-password -H "content-type: application/json" \
  -d "{\"identity\":\"admin@kirillnyun.space\",\"password\":\"$SUP\"}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
ID=$(python3 -c 'import json,sys;print(json.dumps({"login":sys.argv[1],"role":sys.argv[2],"name":sys.argv[3],"active":True,"password":sys.argv[4],"passwordConfirm":sys.argv[4]}))' "$LOGIN" "$ROLE" "$NAME" "$SEC" \
  | curl -s -X POST $B/collections/users/records -H "Authorization: $ST" -H "content-type: application/json" -d @- \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
curl -s -o /dev/null -X POST $B/collections/links/records -H "Authorization: $ST" -H "content-type: application/json" -d "{\"user\":\"$ID\",\"secret\":\"$SEC\"}"
PAGE=; [ "$ROLE" = teacher ] && PAGE=teacher.html
echo "https://kirillnyunenkov.github.io/math/$PAGE#/login/$LOGIN.$SEC"
