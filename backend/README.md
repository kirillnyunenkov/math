# Backend (PocketBase)

Progress sync and the teacher panel talk to a PocketBase instance at
`https://api.kirillnyun.space`. Design: `docs/superpowers/specs/2026-10-01-backend-sync-teacher-panel-design.md`.

## Layout on the server

| Path | What |
|---|---|
| `/opt/ege-api/pocketbase` | binary, v0.40.4 |
| `/opt/ege-api/pb_migrations/` | copy of `backend/pb_migrations/` |
| `/opt/ege-api/pb_data/` | database (SQLite) |
| `/opt/ege-api/backups/` | nightly `.tgz`, newest 14 kept (`ege-api-backup.timer`) |
| `/etc/systemd/system/ege-api.service` | listens on `127.0.0.1:8091` |
| `/etc/caddy/Caddyfile` | block from `deploy/Caddyfile.snippet` |
| `/root/ege-api-superuser.txt` | admin UI login (`https://api.kirillnyun.space/_/`) |
| `/root/ege-api-teacher-link.txt` | the teacher's login link |

Secrets live only in those two root-only files; never commit them.

## Tests

```bash
PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'
```

Spins up a throwaway PocketBase with the migrations and checks access rules.

## Schema change

1. Add a new file to `backend/pb_migrations/` (never edit applied ones), run the tests.
2. Copy it to `/opt/ege-api/pb_migrations/`, then
   `systemctl restart ege-api` (migrations auto-apply on start).
   A settings change made by a migration needs that restart too.

## Restore from backup

```bash
systemctl stop ege-api
cd /opt/ege-api && mv pb_data pb_data.broken && mkdir pb_data
tar -xzf backups/<file>.tgz -C pb_data && chown -R egeapi:egeapi pb_data
systemctl start ege-api
```

## Caddy

Always back up and validate before reload — the same Caddy serves the CRM:

```bash
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
set -a; . /etc/avito-crm-caddy.env; set +a
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy
```
