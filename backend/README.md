# Backend (PocketBase)

Progress sync and the teacher panel talk to a PocketBase instance at
`https://api.kirillnyun.space`. Design: `docs/superpowers/specs/2026-10-01-backend-sync-teacher-panel-design.md`.

## Layout on the server

| Path | What |
|---|---|
| `/opt/ege-api/pocketbase` | binary, v0.40.4 |
| `/opt/ege-api/pb_migrations/` | copy of `backend/pb_migrations/` |
| `/opt/ege-api/pb_hooks/` | copy of `backend/pb_hooks/` (Telegram bot) |
| `/opt/ege-api/pb_data/` | database (SQLite) |
| `/opt/ege-api/backups/` | nightly `.tgz`, newest 14 kept (`ege-api-backup.timer`) |
| `/etc/systemd/system/ege-api.service` | listens on `127.0.0.1:8091` |
| `/etc/caddy/Caddyfile` | block from `deploy/Caddyfile.snippet` |
| `/root/ege-api-superuser.txt` | admin UI login (`https://api.kirillnyun.space/_/`) |
| `/root/ege-api-teacher-link.txt` | the teacher's login link |
| `/etc/ege-api.env` | `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET` (root-only, mode 600) |

Secrets live only in those three root-only files; never commit them.

## Tests

```bash
PB_BIN=~/.local/pocketbase/pocketbase node --test 'backend/tests/*.test.mjs'
```

Spins up a throwaway PocketBase with the migrations and hooks (plus a stub
Telegram API) and checks access rules and the bot.

## Telegram bot

Registration and sign-in go through a bot implemented in `pb_hooks/tg.js`
(texts are at the top of that file). Telegram calls
`POST /api/tg/webhook`; the call is accepted only with the header
`X-Telegram-Bot-Api-Secret-Token` equal to `TG_WEBHOOK_SECRET`.

Register the webhook once (run on the server; prints only Telegram's answer):

    set -a; . /etc/ege-api.env; set +a
    curl -s "https://api.telegram.org/bot$TG_BOT_TOKEN/setWebhook" \
      -d url=https://api.kirillnyun.space/api/tg/webhook \
      -d secret_token="$TG_WEBHOOK_SECRET" -d 'allowed_updates=["message"]'

Every bot reply also carries a one-time 6-digit code (10 minutes) for signing
in on a device without Telegram: the page sends it to `POST /api/tg/code` and
gets the same login pair the personal link holds. Codes live in `login_codes`
(closed to the API); guessing is capped at 5 requests a minute per address.

A hook change needs the files copied to `/opt/ege-api/pb_hooks/` and
`systemctl restart ege-api`.

## Schema change

1. Add a new file to `backend/pb_migrations/` (never edit applied ones), run the tests.
2. Copy it to `/opt/ege-api/pb_migrations/`, then
   `systemctl restart ege-api` (migrations auto-apply on start).
   A settings change made by a migration needs that restart too.
3. **Warning:** saving the `users` collection (rules, auth options) makes
   PocketBase invalidate every issued session — all students get
   "Нужно войти заново" and must reopen their link (the link itself still
   works). Verified on 2026-10-01 with `authRule`. Avoid touching `users`
   in migrations; if unavoidable, do it when students can be told.

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
