# Public registration through a Telegram bot — design

Date: 2026-10-02. Builds on `2026-10-01-backend-sync-teacher-panel-design.md`.

## Goal

The trainer becomes a lead magnet for the owner's Telegram channel. Anyone can
register; registration goes through a Telegram bot, so every registered person
is a bot subscriber the owner can later reach. Using the trainer requires
being signed in.

## Decisions made by the owner

- Sign-in for everyone is through the bot. Personal links are no longer handed
  out by the teacher; the "Add student" button leaves the panel.
- The wall is shown immediately (no free tasks), but the threshold is a single
  number in `config.js` so it can be switched to "after N checked answers".
- No channel-subscription check, no owner notifications, no broadcasts (the
  subscriber base accumulates anyway; these can be added later).
- The panel gets a second tab "Из канала". The owner promotes a person to
  "my student" with a button; promoted people appear in the main list.
- Accounts created earlier by personal link keep working unchanged.
- Data kept per person: Telegram id, first name, username. Nothing else.

## User flow

1. Channel post -> button `https://t.me/<bot>?start=channel` -> "Start".
2. The bot replies with a greeting (includes the consent line and a link to
   the privacy page) and an inline button "Открыть тренажёр" whose URL is
   `https://kirillnyunenkov.github.io/math/#/login/<login>.<secret>`.
3. The trainer opens signed in through the existing `loginFromHash` path.
4. Any later message to the bot returns the same link (same account, same
   progress). This is also how a person signs in on another device.

A visitor who opens the site without a session sees the wall instead of the
app: a short pitch, the button "Войти через Telegram" (`t.me/<bot>?start=site`)
and one discreet line for people with an old personal link ("Есть личная
ссылка? Открой её"), so that existing students do not create duplicates.

## Components

### 1. Bot — `backend/pb_hooks/telegram.pb.js`

A PocketBase JS hook; no separate process.

- `POST /api/tg/webhook`. Rejects (403) unless the header
  `X-Telegram-Bot-Api-Secret-Token` equals env `TG_WEBHOOK_SECRET`. Otherwise
  always answers 200 so Telegram does not retry.
- Handles only private-chat messages. For any message:
  - profile with this `tg_id` exists -> refresh `username`/`first_name`,
    reply with the stored link;
  - otherwise, in one transaction: create `users` record (`login` = `tg<id>`,
    `name` = first name cut to 80 chars, `role` = `student`, `active` = true,
    random 32-char password), `links` record with the secret, `tg_profiles`
    record; reply with greeting + link;
  - account has `active = false` -> reply that access is disabled, no link.
- Replies via `$http.send` to `${TG_API}/bot${TG_BOT_TOKEN}/sendMessage`.
  `TG_API` defaults to `https://api.telegram.org`; tests point it at a stub.
- `GET /api/ege/leads` (teacher only): one SQL aggregate over
  `tg_profiles` + `users` + `events`, returning per profile: user id, name,
  username, registration date, `mine`, number of mark events, last activity.

Secrets (`TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`) live in `/etc/ege-api.env`
(root-only, mode 600), loaded by `EnvironmentFile=` in `ege-api.service`.
Never in the repo, never printed.

### 2. Data — migration `1790800004_tg_profiles.js`

New collection `tg_profiles`: `user` (relation, unique, cascade delete),
`tg_id` (text, unique), `username`, `first_name`, `mine` (bool), `created`.
Rules: list/view/update — teacher only; create/delete — nobody (the hook
writes with app privileges).

The `users` collection is **not** touched: saving it invalidates every issued
session (see backend README). "Lead vs student" is therefore expressed by the
profile's `mine` flag, not by a new role:

- student = user with role `student` and (no profile, or profile `mine`);
- lead = user whose profile has `mine = false`.

The same migration sets the trusted proxy header in settings so rate limits
count per visitor rather than for everyone behind Caddy as one address. With
the current shared counter, `*:auth` (10 per minute) would block sign-ins as
soon as a channel post brings more than ten people in a minute. The actual
server setting must be read before deploy (open item from the 2026-10-02
audit).

### 3. Wall — `index.html`, `config.js`

- `config.js`: `TG_BOT` (bot username), `FREE_CHECKS = 0`.
- `gated()` = no session and number of marked tasks in local state
  `>= FREE_CHECKS`. `render()` shows the wall view instead of any route when
  gated. `#/login/...` is processed before the gate. `teacher.html` is not
  gated.
- An expired or disabled session falls back to the wall with the existing
  note. Marks made before sign-in are imported on sign-in (already
  implemented), which is what makes `FREE_CHECKS > 0` work without extra code.
- Account sheet text mentions the bot as the way to sign in elsewhere.
- `sw.js` VERSION bump.

The wall is client-side only: task data are public static files, a technical
person can bypass it. Accepted — it is a lead magnet, not content protection.

### 4. Panel — `teacher.html`

- Two tabs: "Ученики" and "Из канала".
- "Из канала": table from `/api/ege/leads` filtered to `mine = false` — name,
  @username (link to `t.me/<username>` when present), registered, marks, last
  activity, button "В мои ученики" (PATCH `tg_profiles.mine = true`).
- "Ученики": as now, for students as defined above; promoted people show
  their @username and get a "Убрать из учеников" action (sets `mine = false`).
  Events/variants are requested only for these users (filter by user ids in
  chunks) instead of downloading every record, so leads do not slow it down.
- "Add student" and link re-issue for bot accounts are removed; link re-issue
  and enable/disable stay for old link accounts; enable/disable works for all.

### 5. Untrusted input hardening

Until now panel data came from ~30 known students; now from anyone. Audit and
fix every place where user-controlled values reach HTML: `name`, `username`,
`events.given`, `variants.q` in `teacher.html`, and the mock-exam history
rendering in `index.html` (open item from the 2026-10-02 audit). Add a rules
test that a lead cannot read another user's records or any `tg_profiles`.

### 6. Privacy page — `privacy.html`

Short static page: what is stored (Telegram id, name, username, progress),
why, how to ask for deletion. Linked from the bot greeting and the wall. Text
is drafted for the owner's approval; server relocation to Russia is the
owner's separate decision and out of scope.

## Error handling

- Telegram API unreachable when replying: log, answer 200; the person sends
  any message again and gets the link.
- Duplicate concurrent "Start": unique index on `tg_id` makes the second
  transaction fail; the handler then re-reads the profile and replies with the
  existing link.
- Missing env vars: the webhook answers 503 and logs once; the rest of the
  API is unaffected.

## Testing

- `backend/tests/telegram.test.mjs` (throwaway PocketBase with hooks, stub
  Telegram API): first message creates user + link + profile and the reply
  contains a working login link; second message returns the same link and
  creates nothing; wrong/missing secret header -> 403 and nothing created;
  disabled account gets no link; `/api/ege/leads` is teacher-only and counts
  marks correctly; `mine` toggle allowed for teacher only.
- `backend/tests/rules.test.mjs`: lead isolation cases.
- Browser check of the wall and both panel tabs at phone and desktop widths;
  full flow against local PocketBase with the stub.
- Existing suites stay green.

## Deploy (each step needs the owner's go-ahead)

1. Owner creates the bot in BotFather and writes the token to
   `/etc/ege-api.env` himself; webhook secret is generated on the server.
2. Read the live trusted-proxy setting; back up `pb_data`; copy migration and
   hook; update the unit file; restart `ege-api`; register the webhook with
   Telegram (`setWebhook` with `secret_token`).
3. Set `TG_BOT` in `config.js`, merge the PR to `master` (this is the site
   deploy), verify `sw.js` VERSION live, run the real flow once.
4. Owner tells current students who use the trainer without signing in to
   open their link before the wall goes live.

## Out of scope

Broadcasts, channel-subscription check, sign-up notifications, attaching
Telegram to old link accounts, A/B testing of the threshold, analytics of
anonymous visitors.
