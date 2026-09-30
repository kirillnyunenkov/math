# Backend: progress sync and teacher panel — design

Date: 2026-10-01. Status: approved in brainstorming, awaiting spec review.

## Goal

Give the owner (a math tutor, ~30 students) two things the static site
cannot do today:

1. A student's progress follows them between devices (phone, computer).
2. The owner sees every student's results in one place: what they solved,
   where they make mistakes, how active they are, mock-exam scores, and the
   actual wrong answers they typed.

Homework assignment is explicitly out of scope (dropped by the owner).

## Non-goals

- Public sign-up. Only invited students get accounts.
- Changing anything for visitors who never log in: the trainer keeps working
  exactly as today, offline-first, localStorage only.
- Syncing UI conveniences (theme, builder settings, last position `ege_last_v2`).

## Architecture

- **Frontend** stays on GitHub Pages (`index.html`, one file). New:
  a small sync module inside `index.html` and a new page `teacher.html`.
- **Backend**: PocketBase (single binary, SQLite, built-in auth and admin UI)
  at `https://api.kirillnyun.space`, on the owner's existing server next to
  the Avito CRM. Caddy (already serving `crm.kirillnyun.space`) gets one more
  site block proxying to PocketBase on `127.0.0.1`. Wildcard DNS
  `*.kirillnyun.space` already points to the server, no DNS work needed.
  PocketBase runs as its own systemd service under its own user, data in
  `/opt/ege-api/pb_data`. It does not touch the CRM or its PostgreSQL.
- **No student data in the repository.** `teacher.html` is a public but empty
  shell; names and results are fetched only after the teacher logs in.
- Personal data (student names) is stored on a server outside Russia.
  The owner accepted the 152-FZ risk knowingly; not revisited.

## Login by link

- The teacher adds a student in the panel (name only) and gets a link:
  `https://kirillnyunenkov.github.io/math/#/login/<userId>.<secret>`.
  `secret` is 32+ random URL-safe characters.
- Under the hood the link is PocketBase password auth: `users` auth
  collection, identity = `userId`, password = `secret`. Opening the link
  calls `authWithPassword`, stores the auth token and the link itself in
  localStorage (`ege_auth_v1`), removes the secret from the address bar
  (`history.replaceState`), and starts sync.
- Session lasts long: the client refreshes the token on every app start
  (`authRefresh`); PocketBase token duration raised to 90 days.
- **"Link for another device"** button (visible only when logged in) copies
  the same link.
- **New link**: the teacher rotates the secret (sets a new password via the
  auth collection `manageRule`). A password change regenerates the user's
  token key, so every device logged in with the old link is logged out.
  (Verify this PocketBase behavior during implementation; if it does not
  hold, invalidate explicitly by bumping `tokenKey`.)
- The teacher logs in the same way with a link whose user has
  `role = "teacher"`. The first teacher account is created once from the
  PocketBase admin UI / CLI.
- Logout button: forgets the token, keeps local progress.

## Data model (PocketBase collections)

`users` (auth): `name` (text), `role` (`student` | `teacher`),
`active` (bool). `manageRule`: `@request.auth.role = "teacher"`.
Students can view only themselves; the teacher can list/view all.

`links`: `user` (relation), `secret` (text). List/view/create/update:
teacher only. Lets the panel show a student's current link at any time.
The student's own browser keeps its link locally, never reads this collection.

`events` — the attempt journal, one row per student action:

| field | meaning |
|---|---|
| `user` | relation to users |
| `uid` | client-generated unique id (dedup on retry), unique index `(user, uid)` |
| `ts` | client time of the action, ms |
| `kind` | `mark` \| `reset` |
| `n` | task number 1–20; for `reset`: 0 = everything |
| `pid` | problem id within task (for `mark`) |
| `status` | `g` \| `o` \| `b` \| empty (mark cleared) |
| `source` | `check` (typed answer checked) \| `manual` (status buttons) \| `import` |
| `given` | what the student typed (only for `check`) |
| `device` | short random per-browser id |

`variants` — mock-exam history, mirrors today's `ege_variants_v1` records:
`user`, `uid`, `t` (finish time), `p` (primary points), `s` (secondary
score), `ms` (duration), `total` (items), `m` (max points), `q` (JSON:
`[n, pid, points, given]` per item — feeds the wrong-answer feed too). `variant_clears`: `user`, `ts` — "Очистить историю".

Rules: a student can create and list only rows with `user = @request.auth.id`;
no update, no delete (append-only). The teacher can list all, cannot edit.

## Sync

The journal is the source of truth; today's `state` (`ege_hub_v3`) becomes a
cache that equals "the latest action per problem".

- **Hook point.** `recordStatus(n,id,status)` is the single funnel for status
  changes; it also appends a `mark` event to a local outbox. The answer-check
  paths pass `given`/`source=check`. Bulk operations append explicit events:
  reset task → `reset n`; reset all → `reset 0`; loading a shared progress
  link (`?p=`) → `reset 0` followed by `import` marks for the loaded state.
  `pushHistory` / clearing history write `variants` / `variant_clears`.
- **Merge rule (order-independent).** Locally keep per-problem timestamps
  (`ege_stamps_v1`: latest mark ts per `n/pid`, latest reset ts per `n` and
  for "all"). An incoming mark is applied only if it is newer than the local
  mark for that problem; a problem's status is cleared if the newest reset
  covering it is newer than its newest mark. Variants are a union by `uid`,
  minus records older than the newest clear. Applying the same events in any
  order on any device gives the same result.
- **Outbox.** Unsent events live in localStorage (`ege_outbox_v1`) and are
  sent in batches when online and logged in; `uid` makes resending safe.
- **Pull.** On app start, on regaining network/focus, and after sending,
  the client fetches events and variants created after its last server
  cursor (`ege_cursor_v1`, server `created`), merges, re-renders if changed.
- **First login on a device.** Existing local marks (which have no history)
  are uploaded as `import` marks with `ts = 1` (oldest possible), local
  history as `variants`. They fill gaps but never override real journal
  events, so logging in on an old device cannot wipe newer progress.
- **Offline / server down.** Nothing changes for the student; the outbox
  waits. The service worker must not cache API responses (different origin,
  not in the cache list; verify).
- **Not logged in.** No outbox, no network calls, zero behavior change.

## Teacher panel (`teacher.html`)

Same visual language as the trainer (warm = status, blue = interface; see
design-system memory), reuses KaTeX and `img/tN/data.js` to show problems.

- **Students table**: name, last activity, problems solved in last 7 days,
  latest mock score. Sortable by any column; inactive 7+ days highlighted.
- **Student card**:
  - summary by task 1–20: correct / wrong / "повторить" counts;
  - problem prototypes with the most wrong attempts;
  - activity chart by day;
  - mock exams over time with score trend;
  - feed of recent wrong answers (from `check` events and from mock-exam
    items with 0 points): problem, what they typed, the correct answer.
- **Management**: add student, show/copy link, issue new link, deactivate.

All numbers are computed in the browser from `events` / `variants` (30
students × a few thousand rows — trivially small).

## Server operations

- PocketBase binary pinned to a specific release, systemd unit, listens on
  `127.0.0.1` only. Caddy site block `api.kirillnyun.space` →
  reverse_proxy; Caddyfile backed up before the edit, `caddy validate`
  before reload so the CRM site is never broken.
- CORS: allow only `https://kirillnyunenkov.github.io`.
- PocketBase built-in rate limiter on auth endpoints.
- Nightly backup: copy of `pb_data` (PocketBase backup API or sqlite
  `.backup`), keep 14, on the same server.
- Collections and rules defined as PocketBase migrations committed to the
  repo (`backend/pb_migrations/`), so the schema is reproducible.
  No secrets in the repo.

## Testing

- Unit tests (Node, no framework dependency beyond what is needed) for the
  merge logic: two devices interleaved, out-of-order delivery, resets vs
  marks, duplicate events, first-login import, history clear.
- Access rules tested against a local PocketBase: a student cannot read or
  write another student's rows, cannot edit/delete, cannot read `links`.
- End-to-end in the browser: login by link → solve → "second device"
  (fresh profile) with the copied link → same progress → visible in panel;
  rotate link → old device logged out.
- `sw.js` VERSION bumped on each site deploy.

## Rollout

Each step is its own PR (owner authorized self-merge for this session):

1. Server: PocketBase, migrations, Caddy block, backups. Site untouched.
2. Site: login + sync in `index.html`. Logged-out behavior unchanged.
3. Teacher panel.

Before handing links to students the owner creates 1–2 test students and we
verify on them. Sending links to students is done by the owner, never by
the agent.
