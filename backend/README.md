# Backend (PocketBase)

Progress sync and the teacher panel talk to a PocketBase instance at
`https://api.kirillnyun.space`. Design: `docs/superpowers/specs/2026-10-01-backend-sync-teacher-panel-design.md`.

## Layout on the server

| Path | What |
|---|---|
| `/opt/ege-api/pocketbase` | binary, v0.40.4 |
| `/opt/ege-api/pb_migrations/` | copy of `backend/pb_migrations/` |
| `/opt/ege-api/pb_hooks/` | copy of `backend/pb_hooks/` (Telegram bot, assigned exams) |
| `/opt/ege-api/pb_data/` | database (SQLite) |
| `/opt/ege-api/backups/` | nightly `.tgz`, newest 14 kept (`ege-api-backup.timer`) |
| `/etc/systemd/system/ege-api.service` | listens on `127.0.0.1:8091` |
| `/etc/caddy/Caddyfile` | block from `deploy/Caddyfile.snippet` |
| `/root/ege-api-superuser.txt` | admin UI login (`https://api.kirillnyun.space/_/`) |
| `/root/ege-api-teacher-link.txt` | the teacher's login link |
| `/etc/ege-api.env` | `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `TEACHER_TG_ID` (root-only, mode 600) |

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

## Assigned mock exams

Design: `docs/superpowers/specs/2026-10-05-assigned-exams-design.md`.

The teacher's own exams live in `exams` (statements in `tasks`, answers and
part 1 solutions in `key`) and are never part of the public site. An exam is
opened to one student by a row in `exam_assignments`; photos of part 2 go to
`exam_photos` (protected files). Students reach all of it only through the
routes in `pb_hooks/exams.js`, which decide by the server clock what may be
shown (phases: `exam-core.js`). Bot texts are at the top of `exams.js`.

`pb_hooks/lib/` holds copies of `exam-core.js` and `answers-core.js` from the
repository root. After editing either file:

    cp answers-core.js exam-core.js backend/pb_hooks/lib/

(`tests/cores-in-sync.test.mjs` fails if you forget.)

A cron job inside PocketBase (`exams-tick`, every minute) sends the "one hour
before" and "exam is open" messages and settles finished work. Messages to the
teacher go to the chat in `TEACHER_TG_ID`. A message Telegram refused (the
person blocked the bot, Telegram was down) is tried again every minute while
it still makes sense; each one is delivered at most once.

### Photos through the bot

A student can send photos of part 2 to the bot instead of attaching them on the site — no
caption, no task number. The bot attaches them to the exam that started last, if it is still
open or within the 10 minutes after it; otherwise it says the time is over. Bot photos have an
empty task (`exam_photos.n = ''`), at most 15 per exam. Handled in `botPhoto()`
(`pb_hooks/exams.js`); the webhook (`tg.js`) hands photo messages there. No change to the
Telegram webhook registration is needed (`message` updates already include photos).

Rollout of this part, on top of the earlier exams rollout. Take a backup first (it copies the data
and the stored files, so a rollback loses nothing):

    ssh root@185.249.154.78 'systemctl start ege-api-backup.service'

Nightly backups (the newest 14 are kept) now also hold the bot photos: up to 15 x 10 MB per exam.

Then the files:

    scp backend/pb_migrations/1790800008_exam_tg_photos.js root@185.249.154.78:/opt/ege-api/pb_migrations/
    scp backend/pb_hooks/exams.pb.js backend/pb_hooks/exams.js backend/pb_hooks/tg.js root@185.249.154.78:/opt/ege-api/pb_hooks/
    ssh root@185.249.154.78 'chown egeapi: /opt/ege-api/pb_migrations/1790800008_exam_tg_photos.js /opt/ege-api/pb_hooks/exams.pb.js /opt/ege-api/pb_hooks/exams.js /opt/ege-api/pb_hooks/tg.js && systemctl restart ege-api && sleep 2 && systemctl is-active ege-api'

Verify: `curl -s -o /dev/null -w '%{http_code}\n' https://api.kirillnyun.space/api/ege/exams/x/photos` prints `403`.

### Teacher photos in the comment of a task

While checking, the teacher can attach up to 5 photos to the comment of each long task (panel, check page: the
button, a screenshot pasted into the comment field, or a dropped file). They live in their own collection
`exam_feedback_photos` (migration `1790800009_exam_feedback_photos.js`); the student reads them only once the exam is
checked (`assignment.checked > 0`), and sees them under "Мой комментарий". Upload and delete reuse the existing
`POST/DELETE /api/ege/exams/{id}/photos` routes (a teacher token takes the feedback branch), so the Caddy 12 MB rule
and `exams.pb.js` need no change. Rollout: backup, then the migration and `exams.js`, then the site:

    ssh root@185.249.154.78 'systemctl start ege-api-backup.service'
    scp backend/pb_migrations/1790800009_exam_feedback_photos.js root@185.249.154.78:/opt/ege-api/pb_migrations/
    scp backend/pb_hooks/exams.js root@185.249.154.78:/opt/ege-api/pb_hooks/
    ssh root@185.249.154.78 'chown egeapi: /opt/ege-api/pb_migrations/1790800009_exam_feedback_photos.js /opt/ege-api/pb_hooks/exams.js && systemctl restart ege-api && sleep 2 && systemctl is-active ege-api'

A migration runs on restart. Before it, the panel's request for the new collection fails softly (no photos, the check page still works).

### Rollout of the trainer screens

Precondition: the "Photos through the bot" rollout (migration `1790800008_exam_tg_photos.js`, `exams.pb.js`,
`exams.js`, `tg.js`) is already on the server. It is: the check below prints `403` on production (`404` means
the photo routes are not deployed, stop and roll that part out first). Keep running it before every release:

    curl -s -o /dev/null -w '%{http_code}\n' https://api.kirillnyun.space/api/ege/exams/x/photos

Then the hooks go **before** the site. `exams.js` now returns `until` (the end of the current phase) in the exam
meta. A new site against old hooks has no `until`: the running exam shows no countdown and does not move to
the photo phase at the end of the window until a save is refused with 409, and the "scheduled" screen does not
open at the start but only polls every 30-60 s. Only `exams.js` changed; take the backup and copy the hook the
same way as in "Photos through the bot":

    ssh root@185.249.154.78 'systemctl start ege-api-backup.service'
    scp backend/pb_hooks/exams.js root@185.249.154.78:/opt/ege-api/pb_hooks/
    ssh root@185.249.154.78 'chown egeapi: /opt/ege-api/pb_hooks/exams.js && systemctl restart ege-api && sleep 2 && systemctl is-active ege-api'

Then deploy the site (the new files `exam.js`, `exam-client-core.js`, `exam-validate.js` are in the service
worker's list and `sw.js` has a new version). Photos from the site need the Caddy 12 MB rule for
`/api/ege/exams/<id>/photos`: it is step 6 of the exams "Rollout" (`deploy/Caddyfile.snippet`) and is already in
place on the server, so there is nothing to do here.

### Preparing and assigning exams (Claude Code)

Exams are not uploaded through the panel. Work happens in a Claude Code chat with the project
skill. Its source is `tools/assigned-exam-skill/SKILL.md` (`.claude/` is git-ignored); install it once:

    mkdir -p .claude/skills/assigned-exam && cp tools/assigned-exam-skill/SKILL.md .claude/skills/assigned-exam/

Flow: source files in `~/math-source/exams/<slug>/` (outside the repository), a typeset `exam.json`,
answers verified by computation, `node tools/exam_check.mjs` (validation, the HTML allowlist gate,
every formula rendered with the repo's KaTeX), a local `node tools/exam_preview.mjs` for review,
`node tools/exam_api.mjs upload`, and, only with an explicit yes because the student gets a Telegram
message, `node tools/exam_api.mjs assign ... --yes`. `exams`, `students`, `status` and `delete` are
there too. The tool logs in with `~/ege-teacher-link.txt` and prints no secrets.

- Assign an exam only after the trainer screens release has been deployed together with the updated server hooks ("Rollout of the trainer screens", including its precondition: the photo routes answer `403`); until then the student cannot open the exam.
- The catalog is numbered: `exams` prints "No. N · title", and `--exam` takes that number (or a title).
- Statements and solutions are HTML checked against an allowlist (`exam-validate.js`, run by
  `exam_check.mjs` and again before `upload`). Short answers are plain text as a student types them;
  write `\lt` instead of `<` inside formulas.
- Production writes (`upload`, `assign`, `delete`) are run by the owner. To try the tools without
  touching production, start `node tools/exam-dev-stack.mjs` and pass
  `--api http://127.0.0.1:8090/api --link-file <throwaway file>` (the stack prints the link).
- Exam content and previews stay out of the repository (it is public).
  `tests/fixtures/exam-sample.json` is a made-up example of the file format.

### Rollout

1. The teacher presses "Старт" in the bot once, from the account that should
   receive "student has submitted" messages.
2. On the server, find that chat id (prints only the id). Give the Telegram
   username without "@"; an empty result means no match: the account has no
   username or has not pressed "Старт" yet.

       sqlite3 /opt/ege-api/pb_data/data.db "SELECT tg_id FROM tg_profiles WHERE username = '<telegram username>'"

   Then back up the env file and add the id on a line of its own (the leading
   newline keeps it off the last line if the file does not end with one):

       cp /etc/ege-api.env /etc/ege-api.env.bak-$(date +%Y%m%d-%H%M%S) && printf '\nTEACHER_TG_ID=%s\n' '<id>' >> /etc/ege-api.env

3. Check free disk space (photos): `df -h /opt/ege-api`.
4. Copy the migration and the hooks, restart:

       scp backend/pb_migrations/1790800007_exams.js root@185.249.154.78:/opt/ege-api/pb_migrations/
       scp -r backend/pb_hooks/exams.pb.js backend/pb_hooks/exams.js backend/pb_hooks/tg.js backend/pb_hooks/lib root@185.249.154.78:/opt/ege-api/pb_hooks/
       ssh root@185.249.154.78 'chown -R egeapi: /opt/ege-api/pb_migrations /opt/ege-api/pb_hooks && systemctl restart ege-api && sleep 2 && systemctl is-active ege-api'

5. Verify from anywhere: `curl -s -o /dev/null -w '%{http_code}\n' https://api.kirillnyun.space/api/ege/exams/mine`
   must print `403` (the route exists and refuses a signed-out caller).
6. Before the site or the panel starts using exam photos or exam upload, raise
   Caddy's 1 MB body limit for those two paths (steps 1-5 do not depend on
   this). Replace the `api.kirillnyun.space { ... }` block in
   `/etc/caddy/Caddyfile` with the one from `deploy/Caddyfile.snippet`; back up
   first and validate before reload (see "Caddy" above):

       cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%Y%m%d-%H%M%S)
       nano /etc/caddy/Caddyfile        # paste the block from deploy/Caddyfile.snippet
       set -a; . /etc/avito-crm-caddy.env; set +a
       caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && systemctl reload caddy

The nightly backup archives `pb_data`, which now includes the photos in
`pb_data/storage/`; watch the size of `/opt/ege-api/backups/`.

## Exam history (Мои пробники)

The collection `exam_history` holds exams a student wrote before the trainer existed. One row = one exam:
per-task points (`scores`, null = not solved), the task numbers that were not in the variant (`na`) and the
fixed test score (`test`, 0..100) entered by the teacher; no scale converts these. The student may read own
rows, nobody writes through the collection API: every write goes through the teacher routes of `exams.js`.

Routes:

- `GET /api/ege/exams/summary` (student): checked trainer exams with per-task points, plus own manual rows, by date. The teacher adds `?user=<id>` to read one student's (the student card in the panel).
- `POST /api/ege/exams/history` (teacher): `{user, date: "YYYY-MM-DD", title, scores, na, test}` -> `{id}`.
- `GET /api/ege/exams/history?user=<id>` (teacher): the manual rows of one student.
- `DELETE /api/ege/exams/history/{id}` (teacher): `{ok: true}`.

`lib/exam-history-core.js` is a copy of the shared `exam-history-core.js` at the repository root (the site and
the tools use the root one). After editing the shared core, refresh the copy:

    cp exam-history-core.js backend/pb_hooks/lib/

Rollout (hooks and the migration; take the backup first):

    ssh root@185.249.154.78 'systemctl start ege-api-backup.service'
    scp backend/pb_migrations/1790800010_exam_history.js root@185.249.154.78:/opt/ege-api/pb_migrations/
    scp backend/pb_hooks/exams.js backend/pb_hooks/exams.pb.js root@185.249.154.78:/opt/ege-api/pb_hooks/
    scp -r backend/pb_hooks/lib root@185.249.154.78:/opt/ege-api/pb_hooks/
    ssh root@185.249.154.78 'chown -R egeapi: /opt/ege-api/pb_hooks /opt/ege-api/pb_migrations && systemctl restart ege-api && sleep 2 && systemctl is-active ege-api'

Verify: `curl -s -o /dev/null -w '%{http_code}\n' https://api.kirillnyun.space/api/ege/exams/summary` must print `403`.
