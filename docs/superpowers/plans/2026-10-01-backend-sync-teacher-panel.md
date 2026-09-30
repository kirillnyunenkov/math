# Backend sync + teacher panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Invited students log in by link, their progress syncs across devices through a PocketBase backend, and the teacher sees all students' results in `teacher.html`.

**Architecture:** PocketBase 0.40.4 on the owner's server behind the existing Caddy at `api.kirillnyun.space`. The trainer keeps localStorage as its working copy and adds an append-only event journal (outbox → server, server → merge). Pure logic (merge, stats) lives in small JS files testable with `node --test`; DOM/network glue lives in `index.html` / `teacher.html`.

**Tech Stack:** PocketBase 0.40.4 (JS migrations), plain `fetch` (no SDK), vanilla JS, `node --test` (Node 24), Caddy, systemd.

**Spec:** `docs/superpowers/specs/2026-10-01-backend-sync-teacher-panel-design.md`

## Global Constraints

- Logged-out behaviour of the trainer must not change: no network calls, no new UI. Login happens only via link.
- No student personal data and no secrets in the repo (the repo is public via GitHub Pages).
- API origin: `https://api.kirillnyun.space`; CORS allowed origin: `https://kirillnyunenkov.github.io`.
- Bump `VERSION` in `sw.js` on every site deploy.
- The CRM on the same server (`crm.kirillnyun.space`, Caddy, PostgreSQL, gunicorn :8010) must never go down: back up the Caddyfile, `caddy validate` before `reload`.
- Code comments/docs in English; UI text in Russian; commits in English with the Co-Authored-By trailer.
- Owner authorized push / PR / merge to master for this session.

## Facts verified in a spike (PocketBase 0.40.4)

- Default `users` auth collection requires `email`; set `fields.getByName("email").required = false`.
- `passwordAuth.identityFields = ["login"]` with a unique index on `login` works for `auth-with-password`.
- `manageRule = '@request.auth.role = "teacher"'` lets the teacher PATCH another user's password; that invalidates the old token (`auth-refresh` → 401).
- A student PATCHing own `role` → 404 (updateRule teacher-only).
- Batch API needs `settings.batch.enabled = true` and a server restart after changing settings via migration; a batch containing a duplicate `(user, uid)` fails as a whole (400 `validation_not_unique`) → client must retry item-by-item and treat `validation_not_unique` as already-sent.
- Forged `user` in create body → 400 by createRule; other students' rows are invisible.
- `autodate` field `created` has ms precision (`2026-09-30 23:28:50.589Z`).

## File Structure

| File | Responsibility |
|---|---|
| `backend/pb_migrations/1790800000_init.js` | users collection: login/role/active, identity, rules |
| `backend/pb_migrations/1790800001_events.js` | events collection, batch settings |
| `backend/pb_migrations/1790800002_rest.js` | variants, variant_clears, links collections; token duration; rate limits |
| `backend/tests/rules.test.mjs` | access-rule tests against a throwaway local PocketBase |
| `backend/deploy/ege-api.service` | systemd unit |
| `backend/deploy/backup.sh` + `ege-api-backup.timer/.service` | nightly backup, keep 14 |
| `backend/deploy/Caddyfile.snippet` | site block for api.kirillnyun.space |
| `backend/README.md` | how to install/upgrade/restore, how to create the teacher |
| `sync-core.js` | pure: event constructors, stamps, merge, fold of variants (browser global `SyncCore` + CommonJS export) |
| `tests/sync-core.test.mjs` | unit tests for merge logic |
| `stats-core.js` | pure: per-student stats for the panel (global `StatsCore` + CommonJS) |
| `tests/stats-core.test.mjs` | unit tests for stats |
| `index.html` | hooks at status/history change points; network sync; account UI |
| `teacher.html` | teacher panel (single file, like index.html) |
| `sw.js` | cache new JS files; navigation caching per page; VERSION bump |

---

### Task 1: Backend schema + access-rule tests

**Files:** Create the three migrations, `backend/tests/rules.test.mjs`, `backend/.gitignore` (`pb_data/`).

**Produces (schema used by every later task):**
- `users`: `login` (text `^[a-z0-9_-]+$`, 3–40, unique), `role` (`student`|`teacher`), `name` (text ≤ 80), `active` (bool). list/view: self or teacher; create/update/manage: teacher; delete: none.
- `links`: `user` (relation, unique), `secret` (text). all rules teacher-only.
- `events`: `user, uid, ts, kind(mark|reset), n(0–20), pid, status(^[gob]?$), source(check|manual|import), given(≤200), device(≤20), created(autodate)`; unique `(user, uid)`; index `(user, created)`. list/view: own or teacher; create: `@request.auth.id != "" && @request.auth.active = true && @request.body.user = @request.auth.id`; no update/delete.
- `variants`: `user, uid, t, p, s, ms, total, m, q(json), created`; same rules; unique `(user, uid)`.
- `variant_clears`: `user, uid, ts, created`; same rules; unique `(user, uid)`.
- Settings: batch enabled (maxRequests 200); users `authToken.duration = 7776000` (90 days); rate limits enabled with `*:auth` 10 req / 60 s per IP and default `/api/` 300 / 10 s.

- [ ] Step 1: Write `rules.test.mjs` (node:test). `before`: spawn `~/.local/pocketbase/pocketbase` (path from `PB_BIN` env) with a temp `--dir`, `migrate up`, `superuser upsert`, `serve --http 127.0.0.1:8097`; create teacher + two students via superuser. Tests:
  - student lists users → sees only self; teacher → sees 3
  - student cannot PATCH own role (404/403)
  - student creates own event → 200; with other `user` → 400
  - student lists events → only own; teacher → all
  - student cannot PATCH/DELETE own event (404/403)
  - student cannot list `links` (200 with 0 items or 403) and cannot view a link by id
  - duplicate `(user, uid)` → 400 `validation_not_unique`
  - batch of 2 events → 200
  - deactivated student (`active=false`) cannot create events
  - teacher rotates student password → old token `auth-refresh` 401
- [ ] Step 2: Run `node --test backend/tests/` → fails (migrations incomplete).
- [ ] Step 3: Finish migrations (users `name`, links, variants, variant_clears, settings).
- [ ] Step 4: Run tests → all pass.
- [ ] Step 5: Commit `Add PocketBase schema and access-rule tests`.

### Task 2: Server deployment

**Files:** `backend/deploy/*`, `backend/README.md`.

- [ ] Step 1: Write systemd unit: user `egeapi`, `WorkingDirectory=/opt/ege-api`, `ExecStart=/opt/ege-api/pocketbase serve --http 127.0.0.1:8091 --dir /opt/ege-api/pb_data --migrationsDir /opt/ege-api/pb_migrations --origins https://kirillnyunenkov.github.io`, `Restart=always`, hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `ReadWritePaths=/opt/ege-api/pb_data /opt/ege-api/backups`).
- [ ] Step 2: Caddy snippet: `api.kirillnyun.space { reverse_proxy 127.0.0.1:8091 }` (+ `request_body max_size 1MB`).
- [ ] Step 3: `backup.sh`: consistent online copy with `sqlite3 pb_data/data.db ".backup <tmp>/data.db"` (apt package `sqlite3`), plus `pb_data/storage` if present; tar.gz into `/opt/ege-api/backups/YYYY-MM-DD.tgz`; keep newest 14. Timer: daily 03:30 MSK.
- [ ] Step 4: On server (verify port 8091 free first): create user, dirs, download pocketbase 0.40.4 linux_amd64 + verify sha256 from checksums.txt, copy migrations, `migrate up`, install unit, enable+start; `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-<ts>`, append snippet, `caddy validate --config /etc/caddy/Caddyfile`, `systemctl reload caddy`.
- [ ] Step 5: Create superuser (random password stored only in `/root/ege-api-superuser.txt`, mode 600) and teacher user with random 32-char secret + `links` row; teacher link stored in `/root/ege-api-teacher-link.txt` (600). Never printed into chat/logs.
- [ ] Step 6: Smoke: `curl https://api.kirillnyun.space/api/health` → 200; CORS preflight from the Pages origin returns `Access-Control-Allow-Origin`; `curl https://crm.kirillnyun.space` still 200/302 as before.
- [ ] Step 7: Commit, PR, merge `Deploy PocketBase backend`.

### Task 3: `sync-core.js` merge logic (TDD)

**Produces:**
```js
SyncCore.newStamps() -> {m:{}, r:{}}          // m["n/pid"]=ts of newest mark; r[n]=ts of newest reset (n=0 => all)
SyncCore.markEvent(n,pid,status,{source,given,device,ts,uid}) -> event
SyncCore.resetEvent(n,{device,ts,uid}) -> event
SyncCore.applyEvents(state, stamps, events) -> {state, stamps, changed:boolean}   // pure, returns new objects
SyncCore.snapshotEvents(state,{device,ts}) -> events   // reset 0 + import marks for every non-empty status
SyncCore.mergeVariants(local, incoming, clears) -> array   // union by uid (t for legacy), drop t < newest clear ts, sort by t, keep last 50
SyncCore.uid() -> string   // 16 random base36 chars via crypto.getRandomValues
```
Merge rule: for problem `n/pid`, let `M` = newest mark (by `ts`, tie → larger `uid`), `R` = max(r[n], r[0]). Status = `M.status` if `M.ts > R`, else cleared. Order of application must not matter.

- [ ] Step 1: Tests: single mark; newer mark wins regardless of arrival order (both orders); older mark after newer ignored; reset task clears older marks only in that task; reset-all clears everything older; mark newer than reset survives; duplicates idempotent; tie-break deterministic; `changed` false on no-op; snapshot round-trip reproduces state; mergeVariants union/dedupe/clear/cap 50.
- [ ] Step 2: Run `node --test tests/` → FAIL.
- [ ] Step 3: Implement (applying a reset must recompute: clear every `n/pid` in scope whose mark ts < reset ts; stamps keep marks even when cleared so a later-arriving older reset can't resurrect).
- [ ] Step 4: Run → PASS. Commit `Add sync merge core with tests`.

### Task 4: Trainer — journal hooks (still offline-only)

**Files:** `index.html` (recordStatus 2368, answer checks ~3505–3519 and the task page check handler, reset task 3670, reset all 3674, shared link apply 3689, pushHistory 2605, clear history 3562), load `sync-core.js`.

**Produces:** `journal(ev)` — no-op unless logged in; appends to `ege_outbox_v1`, updates `ege_stamps_v1`. `recordStatus(n,id,status,meta)` gains optional `meta={source,given}` (default `manual`).

- [ ] Step 1: Load `<script src="sync-core.js">` before the main script.
- [ ] Step 2: `recordStatus` → after updating state, `journal(SyncCore.markEvent(...))`. Checked answers pass `{source:'check', given: raw}`.
- [ ] Step 3: Resets → `journal(resetEvent(n))` / `resetEvent(0)`; shared link apply → `snapshotEvents`.
- [ ] Step 4: `pushHistory` gives each record a `uid`; clear history journals a clear record.
- [ ] Step 5: Manual check in the browser preview (logged out): no localStorage keys other than existing ones appear, no network requests to the API. Commit.

### Task 5: Trainer — login, push/pull, account UI

**Produces (in index.html):** `Sync.login(link)`, `Sync.logout()`, `Sync.push()`, `Sync.pull()`, `Sync.link()`; storage `ege_auth_v1 = {token, userId, name, link, device}`, `ege_cursor_v1`.

- [ ] Step 1: On DOMContentLoaded, before routing: if `location.hash` matches `#/login/<login>.<secret>` → `history.replaceState` to strip it, `auth-with-password`, store auth, then first-login import: `snapshotEvents(state)` with `source:'import'` and all local history → outbox; show a toast «Вход выполнен: <name>».
- [ ] Step 2: On start (logged in): `auth-refresh` (401 → logged out with a note «Ссылка для входа больше не действует — попроси у преподавателя новую»; local progress stays).
- [ ] Step 3: `push()`: take up to 200 outbox items → `/api/batch`; on 400 retry one by one, dropping items that succeed or fail with `validation_not_unique`; keep others. Offline/5xx → keep, retry on `online`/`visibilitychange`/every 60 s while visible.
- [ ] Step 4: `pull()`: page through `events`, `variants`, `variant_clears` with `filter=created >= "<cursor>"`, `sort=created`, `perPage=500`; merge via `applyEvents` / `mergeVariants`; save; re-render current view if `changed`; advance cursor to max `created` seen.
- [ ] Step 5: Account UI on the hub (only when logged in): name, «Ссылка для другого устройства» (copies `auth.link`, toast «Ссылка скопирована»), «Выйти». Follow design-system tokens.
- [ ] Step 6: Test with the local spike server + two browser tabs with separate storage (preview + fresh profile): solve on A → appears on B after reload; reset on B → cleared on A; offline edit then online → delivered. Commit.

### Task 6: Service worker + site deploy

- [ ] Step 1: `sw.js`: add `./sync-core.js`, `./stats-core.js`, `./teacher.html` to SHELL; navigation cache: store response under the request's own path (`index.html` for `/`), fall back to `./index.html` only for the trainer. Bump VERSION.
- [ ] Step 2: Verify in preview: open teacher.html then go offline → index.html still the trainer.
- [ ] Step 3: PR + merge; after deploy `curl .../sw.js` shows new VERSION; login with a test student link against production API works.

### Task 7: `stats-core.js` (TDD)

**Produces:**
```js
StatsCore.studentSummary(events, variants, now) -> {
  lastActive, solved7d,               // solved7d: distinct n/pid with a g/o mark in last 7 days
  byTask: {n: {g,o,b}},               // from folded state
  activity: [{day:'YYYY-MM-DD', count}] // last 30 days, marks per day (MSK days)
  variants: [{t,p,s,m,total,ms}],
  wrong: [{ts,n,pid,given,source}]    // newest first, check-marks with status b + variant items with 0 pts
}
StatsCore.problemPrototypes(events, protoOf) -> [{n, proto, wrong, attempts}] sorted by wrong desc
```
- [ ] Tests → FAIL → implement → PASS → commit.

### Task 8: Teacher panel `teacher.html`

- [ ] Step 1: Login: same `#/login/...` flow (shared code copied into the page), requires `role=teacher`, otherwise message «Эта страница только для преподавателя».
- [ ] Step 2: Students table (name, last activity, solved 7d, last mock score), sortable, inactive ≥7 d highlighted.
- [ ] Step 3: Student card: summary by task 1–20, problem prototypes, 30-day activity bars, mock history, wrong-answer feed (loads `img/tN/data.js` lazily for problem text/answers, KaTeX render).
- [ ] Step 4: Management: add student (name → login `s` + 6 random base36, secret 32 chars, create user + link row), copy link, new link (rotate password + update link row), deactivate/activate.
- [ ] Step 5: Browser check against local server with seeded data; screenshot. Commit, PR, merge.

### Task 9: End-to-end on production + handoff

- [ ] Create 1 test student in the panel, run: link on "device A" → solve 3 problems, one wrong → link copied from account UI into "device B" → same progress → panel shows activity, wrong answer, summary → rotate link → device A logged out.
- [ ] Delete nothing; deactivate the test student.
- [ ] Update memory (project overview: backend, how to deploy, where secrets are) and `backend/README.md`.
- [ ] Copy the teacher link into `~/ege-teacher-link.txt` on the owner's Mac (mode 600, outside the repo) and tell the owner the path — never paste secrets into chat.
