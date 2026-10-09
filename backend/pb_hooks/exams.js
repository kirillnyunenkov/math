/// <reference path="../pb_data/types.d.ts" />
// Assigned mock exams: what a student may see is decided here, by the server
// clock and the phase from lib/exam-core.js. Runs on goja: plain ES6 only.
const Core = require(`${__hooks}/lib/exam-core.js`);
const Ans = require(`${__hooks}/lib/answers-core.js`);
const Hist = require(`${__hooks}/lib/exam-history-core.js`);
const tg = require(`${__hooks}/tg.js`);

// Texts the bot sends. Edit here; no other code depends on the wording.
const TEXT = {
  assigned: (title, at, remind) => "Тебе назначен пробник «" + title + "».\nНачало: " + at + " (по Москве).\n\nВ это время он откроется в тренажёре." + (remind ? " Напомню за час." : ""),
  moved: (title, at) => "Пробник «" + title + "» перенесён.\nНовое начало: " + at + " (по Москве).",
  canceled: (title) => "Пробник «" + title + "» отменён.",
  hour: (title, at) => "Через час пробник «" + title + "»: начало " + at + " (по Москве).\nПриготовь черновики и ручку.",
  open: (title, mins) => "Пробник «" + title + "» открыт. На работу " + mins + " мин, время уже идёт.\n\nРешаем честно и самостоятельно: без калькулятора, подсказок, интернета и тетради с формулами.",
  checked: (title, pts, max, long) => "Пробник «" + title + "» проверен: " + pts + " из " + max + ".\n" + (long ? "Баллы и комментарии по второй части — в тренажёре." : "Результат — в тренажёре."),
  done: (name, title, p1, max1, how) => name + " сдал(а) пробник «" + title + "».\nПервая часть: " + p1 + " из " + max1 + "." + (how ? "\nВторая часть: " + how + "." : ""),
  howPhotos: (k) => "фото — " + k,
  howTg: "решения пришлёт в Telegram",
  howNone: "фото нет",
  btnOpen: "Открыть пробник",
  btnResult: "Посмотреть результат",
  btnCheck: "Проверить",
  botNoExam: "Сейчас нет пробника, к которому можно прикрепить фото.",
  botLate: "Время пробника вышло, фото прикрепить уже нельзя. Если оно нужно, напиши мне: @kirill_math_tutor.",
  botBadFile: "Такой файл я не принимаю. Пришли фото или картинку JPEG, PNG или WebP.",
  botTooMany: "К пробнику уже прикреплено 15 фото — больше нельзя. Лишнее можно удалить на сайте.",
  botFail: "Не получилось забрать фото. Пришли его ещё раз.",
  botNotOpened: "Сначала открой пробник в тренажёре — фото принимаются после этого.",
  botOkAlbum: (title) => "Принял фото к пробнику «" + title + "». Все присланные фото видны в тренажёре.",
  botOk: (title, k) => "Принял фото к пробнику «" + title + "» (всего " + k + ").",
};
const MAX_PHOTOS = 5, MAX_FB_PHOTOS = 5, MAX_BOT_PHOTOS = 15, MAX_LOG = 3000, MIN_DURATION = 60, MAX_DURATION = 21600;
const BOT_PHOTO_AGE = 86400;   // a photo to the bot is taken for an exam that ended at most this long ago
const OPEN_NEWS = 900;   // "открыт" is sent only this long after the start, and only if not opened yet
const DAYS = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const env = (k) => $os.getenv(k);
const site = () => env("SITE_URL") || "https://kirillnyunenkov.github.io/math/";
const nowS = () => Math.floor(Date.now() / 1000);
const START_WAIT = 5;   // seconds: a run this close before a start holds on until the start
const fail = (e, code, msg) => e.json(code, { message: msg });
const inUsers = (e) => e.auth && e.auth.collection().name === "users";
const isTeacher = (e) => inUsers(e) && e.auth.get("role") === "teacher";
const isStudent = (e) => inUsers(e) && e.auth.get("active") === true;

// A json field as a plain value (goja hands it over as raw bytes otherwise).
function J(rec, field, fallback) {
  try { const v = JSON.parse(rec.getString(field)); return v == null ? fallback : v; } catch (_) { return fallback; }
}
// Numbers of the short-answer tasks, as strings: what the autosave route needs to know about an exam.
function shortsOf(tasks) { return tasks.filter((x) => x && x.kind === "short").map((x) => String(x.n)); }
function shape(rec) {
  return { start: rec.getInt("start"), duration: rec.getInt("duration"), opened: rec.getInt("opened"),
    finished: rec.getInt("finished"), photos_done: rec.getInt("photos_done"), checked: rec.getInt("checked") };
}
// "в пятницу, 9 октября, в 18:00" — Moscow time is UTC+3 all year round.
function when(ts) {
  const d = new Date((ts + 10800) * 1000), m = d.getUTCMinutes();
  return DAYS[d.getUTCDay()] + ", " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + ", в " + d.getUTCHours() + ":" + (m < 10 ? "0" : "") + m;
}
// Sends to the student's Telegram. false = Telegram refused it (the caller may try again);
// true = sent, or the account has no Telegram chat, so there is nothing to wait for.
function tell(userId, text, url, label) {
  let chat = "";
  try { chat = $app.findFirstRecordByData("tg_profiles", "user", userId).getString("tg_id"); } catch (_) { return true; }
  return tg.send(chat, text, url, label);
}
const examUrl = (id) => site() + "#/exam/" + id;
function byId(coll, id) { try { return $app.findRecordById(coll, id); } catch (_) { return null; } }
const intOf = (v) => (typeof v === "number" && isFinite(v) && Math.floor(v) === v ? v : null);
// Record lists come from Go as slices; index them instead of relying on Array methods.
function each(rows, fn) { const out = []; for (let i = 0; i < rows.length; i++) out.push(fn(rows[i])); return out; }

// Every write to exam_assignments goes through here: the row is re-read and
// changed under PocketBase's single write connection, so a request never
// writes back an older copy over someone else's change. fn(r, tx) gets the
// fresh row; returning false means "nothing to save". Returns fn's result, or
// null if the row is gone. Inside fn use only `r` and `tx` (an $app.* call
// would wait forever for the connection held here), never call Telegram, and
// never nest mutate().
function mutate(id, fn) {
  let out = null;
  $app.runInTransaction((tx) => {
    let r;
    try { r = tx.findRecordById("exam_assignments", id); } catch (err) {
      if (String(err).indexOf("no rows") >= 0) return;
      throw err;
    }
    out = fn(r, tx);
    if (out !== false) tx.save(r);
  });
  return out;
}

// A bot message guarded by a flag column (unix seconds, 0 = not sent). The
// flag is claimed in a write first, so two runs never send the same message;
// the message goes out after that write; if Telegram did not take it the
// claim is given back and the next tick tries again. plan(r) decides on the
// fresh row: null = not due, true = mark as sent without sending, a function =
// the send itself (returns true on success).
function notify(id, flag, t, plan) {
  let job = null;
  mutate(id, (r) => {
    if (r.getInt(flag)) return false;
    job = plan(r);
    if (job === null) return false;
    r.set(flag, t);
  });
  if (typeof job !== "function") return;
  let ok = false;
  try { ok = job(); } catch (_) { ok = false; }
  if (!ok) mutate(id, (r) => { if (r.getInt(flag) !== t) return false; r.set(flag, 0); });
}

// "сдал" to the teacher; without TEACHER_TG_ID there is nobody to tell.
function doneMsg(id, exam, tasks, t) {
  const chat = env("TEACHER_TG_ID"), max1 = Ans.gradePart1(tasks, {}, {}).max1;
  notify(id, "m_done", t, (r) => {
    if (!r.getInt("settled")) return null;
    if (!chat) return true;
    return () => {
      const k = photosOf(r).length;
      // an exam without part 2 has nothing to say about it
      const how = !hasLongIn(tasks) ? "" : k ? TEXT.howPhotos(k) : r.getBool("via_tg") ? TEXT.howTg : TEXT.howNone;
      const name = $app.findRecordById("users", r.getString("user")).getString("name");
      return tg.send(chat, TEXT.done(name, exam.getString("title"), r.getInt("p1"), max1, how),
        site() + "teacher.html#/check/" + id, TEXT.btnCheck);
    };
  });
}

// "проверен" to the student, with the total as it is when the message goes out.
function checkedMsg(id, exam, tasks, t) {
  notify(id, "m_checked", t, (r) => {
    if (!r.getInt("checked")) return null;
    return () => {
      const sum = Core.total(tasks, r.getInt("p1"), J(r, "part2", {}));
      return tell(r.getString("user"), TEXT.checked(exam.getString("title"), sum.pts, sum.max, hasLongIn(tasks)), examUrl(id), TEXT.btnResult);
    };
  });
}

function assign(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const b = e.requestInfo().body || {}, t = nowS();
  const user = byId("users", String(b.user || "")), exam = byId("exams", String(b.exam || ""));
  const start = intOf(b.start), duration = b.duration == null ? Core.DEFAULT_DURATION : intOf(b.duration);
  if (!user || !exam || start === null || duration === null) return fail(e, 400, "bad input");
  if (duration < MIN_DURATION || duration > MAX_DURATION) return fail(e, 400, "bad duration");
  const rec = new Record($app.findCollectionByNameOrId("exam_assignments"));
  rec.set("user", user.id); rec.set("exam", exam.id); rec.set("start", start); rec.set("duration", duration);
  rec.set("m_hour", start - t < 3600 ? t : 0);   // too close for a "one hour before"
  rec.set("shorts", shortsOf(J(exam, "tasks", [])));
  try { $app.save(rec); } catch (_) { return fail(e, 400, "already assigned"); }   // a new row: nothing to overwrite
  tell(user.id, TEXT.assigned(exam.getString("title"), when(start), start - t >= 3600), examUrl(rec.id), TEXT.btnOpen);
  return e.json(200, { id: rec.id });
}

// Teacher actions are allowed only while nothing was seen.
function untouchedAt(rec, t) {
  const p = Core.phase(shape(rec), t);
  return p === "scheduled" || p === "missed";
}
// The row and its exam, checked once before the write; the write checks again on the fresh row.
function untouched(e) {
  const rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec) return { code: 404 };
  if (!untouchedAt(rec, nowS())) return { code: 409 };
  return { rec: rec, exam: $app.findRecordById("exams", rec.getString("exam")) };
}

function move(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const a = untouched(e);
  if (a.code) return fail(e, a.code, a.code === 404 ? "not found" : "already started");
  const b = e.requestInfo().body || {}, t = nowS();
  const start = intOf(b.start), duration = b.duration == null ? a.rec.getInt("duration") : intOf(b.duration);
  if (start === null || duration === null || duration < MIN_DURATION || duration > MAX_DURATION) return fail(e, 400, "bad input");
  const out = mutate(a.rec.id, (r) => {
    if (!untouchedAt(r, t)) return false;
    r.set("start", start); r.set("duration", duration);
    r.set("m_hour", start - t < 3600 ? t : 0); r.set("m_open", 0);
    return true;
  });
  if (out === null) return fail(e, 404, "not found");
  if (!out) return fail(e, 409, "already started");
  tell(a.rec.getString("user"), TEXT.moved(a.exam.getString("title"), when(start)), examUrl(a.rec.id), TEXT.btnOpen);
  return e.json(200, { ok: true });
}

function cancel(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const a = untouched(e);
  if (a.code) return fail(e, a.code, a.code === 404 ? "not found" : "already started");
  const user = a.rec.getString("user"), t = nowS();
  let gone = false;
  const out = mutate(a.rec.id, (r, tx) => {
    if (untouchedAt(r, t)) { tx.delete(r); gone = true; }
    return false;   // deleted or refused: nothing to save either way
  });
  if (out === null) return fail(e, 404, "not found");
  if (!gone) return fail(e, 409, "already started");
  tell(user, TEXT.canceled(a.exam.getString("title")));
  return e.json(200, { ok: true });
}

// The caller's own assignment with its exam, or null. `light`: the row only, the exam (up to 5 MB) is not loaded.
function own(e, light) {
  const rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec || rec.getString("user") !== e.auth.id) return null;
  return light ? { rec: rec } : { rec: rec, exam: $app.findRecordById("exams", rec.getString("exam")) };
}

// The moment the current phase ends, for the page's countdown: the start while
// scheduled, the end of the window while open, the photo deadline in the photo phase.
function untilOf(a, phase) {
  const t = Core.times(a);
  if (phase === "scheduled") return a.start;
  if (phase === "open") return t.stop;
  if (phase === "photos") return t.photoUntil;
  return 0;
}
function hasLongIn(tasks) { return tasks.some((x) => x.kind === "long"); }
function hasLong(exam) { return hasLongIn(J(exam, "tasks", [])); }

function meta(rec, exam, t) {
  const a = shape(rec), phase = Core.phase(a, t);
  const m = { id: rec.id, title: exam.getString("title"), full: exam.getBool("full"), start: rec.getInt("start"),
    duration: rec.getInt("duration"), phase: phase, via_tg: rec.getBool("via_tg"), until: untilOf(a, phase) };
  // Only the photo phase needs these (the banner and the screen word it differently); the exam is parsed for it alone.
  if (phase === "photos") { m.early = rec.getInt("finished") > 0; m.nolong = !hasLong(exam); }
  return m;
}

// The teacher's photos for the comments (shown to the student once the exam is checked).
function fbOf(rec) {
  return each($app.findRecordsByFilter("exam_feedback_photos", "assignment = {:a}", "created", 200, 0, { a: rec.id }),
    (p) => ({ id: p.id, n: p.getString("n"), file: p.getString("file") }));
}

function photosOf(rec) {
  return each($app.findRecordsByFilter("exam_photos", "assignment = {:a}", "created", 200, 0, { a: rec.id }),
    (p) => ({ id: p.id, n: p.getString("n"), file: p.getString("file") }));
}

// Once the photo phase is over: grade part 1 and tell the teacher. Runs from
// the student's own requests and from the cron tick, whichever comes first;
// the fresh row decides, so only one of them settles and only that one tells
// the teacher. Returns the row as it is now (the caller's copy may be older).
function settle(rec, exam, t) {
  if (rec.getInt("settled") || Core.phase(shape(rec), t) !== "submitted") return rec;
  const tasks = J(exam, "tasks", []), key = J(exam, "key", {});   // parsed before the write, not inside it
  let cur = rec, did = false;
  mutate(rec.id, (r) => {
    cur = r;
    if (r.getInt("settled") || Core.phase(shape(r), t) !== "submitted") return false;
    const g = Ans.gradePart1(tasks, key, J(r, "answers", {}));
    r.set("p1", g.p1); r.set("ok", g.ok); r.set("settled", t);
    did = true;
  });
  if (did) doneMsg(rec.id, exam, tasks, t);
  return cur;
}

// Everything the student may see right now — and nothing more.
function viewOf(rec, exam, t) {
  const v = meta(rec, exam, t), tasks = J(exam, "tasks", []);
  v.now = t;
  if (v.phase === "open") {
    v.tasks = tasks; v.answers = J(rec, "answers", {}); v.photos = photosOf(rec);
  } else if (v.phase === "photos") {
    v.tasks = tasks.filter((x) => x.kind === "long").map((x) => ({ n: x.n, kind: x.kind, max: x.max }));
    v.photos = photosOf(rec);
  } else if (v.phase === "submitted" || v.phase === "checked") {
    const g = Ans.gradePart1(tasks, {}, {});
    v.tasks = tasks; v.answers = J(rec, "answers", {}); v.photos = photosOf(rec);
    v.key = J(exam, "key", {}); v.p1 = rec.getInt("p1"); v.max1 = g.max1; v.ok = J(rec, "ok", {});
    if (v.phase === "checked") { v.part2 = J(rec, "part2", {}); v.total = Core.total(tasks, v.p1, v.part2); v.fb = fbOf(rec); }
  }
  return v;
}

function mine(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const t = nowS();
  const rows = $app.findRecordsByFilter("exam_assignments", "user = {:u}", "-start", 50, 0, { u: e.auth.id });
  const items = each(rows, (rec) => {
    const exam = $app.findRecordById("exams", rec.getString("exam"));
    return meta(settle(rec, exam, t), exam, t);
  });
  return e.json(200, { now: t, items: items });
}

function get(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const a = own(e);
  if (!a) return fail(e, 404, "not found");
  const t = nowS();
  let rec = a.rec, mismatch = false;
  // The first look inside the window marks it opened. `opened` never goes
  // back, so a row that already has it needs no write.
  if (Core.phase(shape(rec), t) === "open" && !rec.getInt("opened")) {
    const out = mutate(rec.id, (r) => {
      rec = r;
      if (r.getString("user") !== e.auth.id) { mismatch = true; return false; }
      if (Core.phase(shape(r), t) !== "open" || r.getInt("opened")) return false;
      r.set("opened", t);
    });
    if (out === null || mismatch) return fail(e, 404, "not found");
  }
  rec = settle(rec, a.exam, t);
  return e.json(200, viewOf(rec, a.exam, t));
}

// The caller's own assignment, re-read in a write and handed there to
// fn(r, a) if its phase on that fresh row is one of `phases` (a.t is the server
// time of this request, taken once). fn returns false when there is nothing
// to save, or [code, message] to refuse; otherwise the row is saved. prep(a),
// if given, runs between the first read and the write: the place for slow
// work such as parsing the exam. Without fn the phase is only checked.
// If refused, the error answer is already written here and `res` is true: the
// handler must then just `return` (e.json gives back nothing under goja, so
// it cannot be passed on). Otherwise a.rec is the row as written.
function during(e, phases, fn, prep, light) {
  if (!isStudent(e)) { fail(e, 403, "forbidden"); return { res: true }; }
  const a = own(e, light);
  if (!a) { fail(e, 404, "not found"); return { res: true }; }
  a.t = nowS();
  const check = (r) => {
    a.rec = r; a.phase = Core.phase(shape(r), a.t);
    if (r.getString("user") !== e.auth.id) return [404, "not found"];
    if (phases.indexOf(a.phase) < 0) return [409, "closed"];
    return null;
  };
  let err = null;
  if (!fn) err = check(a.rec);
  else {
    if (prep) prep(a);
    const out = mutate(a.rec.id, (r) => {
      err = check(r);
      const res = err ? false : fn(r, a);
      if (Array.isArray(res)) { err = res; return false; }
      return res;
    });
    if (out === null) err = [404, "not found"];
  }
  if (err) { fail(e, err[0], err[1]); return { res: true }; }
  return a;
}
function logPush(rec, entries) {
  const log = J(rec, "log", []);
  entries.forEach((x) => { if (log.length < MAX_LOG) log.push(x); });
  rec.set("log", log);
}

function answers(e) {
  const incoming = (e.requestInfo().body || {}).answers || {}, short = {};
  // The body arrives as a Go map, whose key order is random: sort so the journal is stable.
  const pairs = Object.keys(incoming).sort((x, y) => (Number(x) - Number(y)) || (x < y ? -1 : x > y ? 1 : 0))
    .map((n) => [n, String(incoming[n] == null ? "" : incoming[n]).trim().slice(0, 40)]);
  const a = during(e, ["open"], (r, a) => {
    const cur = J(r, "answers", {}), added = [];
    pairs.forEach((p) => {
      const n = p[0], v = p[1];
      if (!short[n] || (cur[n] || "") === v) return;
      cur[n] = v; added.push([a.t, "a", n, v]);
    });
    if (!added.length) return false;
    r.set("answers", cur); logPush(r, added);
  }, (a) => {
    // the row knows its short tasks; a row from before that column falls back to the exam
    const s = J(a.rec, "shorts", []);
    if (s.length) { s.forEach((n) => { short[String(n)] = true; }); return; }
    J($app.findRecordById("exams", a.rec.getString("exam")), "tasks", []).forEach((x) => { if (x && x.kind === "short") short[String(x.n)] = true; });
  }, true);
  if (a.res) return;
  return e.json(200, { ok: true });
}

function away(e) {
  const b = e.requestInfo().body || {}, sec = intOf(b.sec), n = String(b.n == null ? "" : b.n).slice(0, 8);
  const a = during(e, ["open"], (r, a) => {
    if (sec === null || sec < 1 || sec > r.getInt("duration")) return [400, "bad input"];
    logPush(r, [[a.t, "w", n, sec]]);
  }, null, true);
  if (a.res) return;
  return e.json(200, { ok: true });
}

function finish(e) {
  let noPhotos = false;
  const a = during(e, ["open"], (r, a) => {
    if (!r.getInt("opened")) return [409, "closed"];
    r.set("finished", a.t);
    // Without a part 2 there is nothing to attach: no photo phase, the work is handed in at once.
    noPhotos = !hasLong(a.exam);
    if (noPhotos) r.set("photos_done", a.t);
  });
  if (a.res) return;
  if (noPhotos) settle(a.rec, a.exam, a.t);
  return e.json(200, { ok: true });
}

function done(e) {
  const a = during(e, ["photos"], (r, a) => { r.set("photos_done", a.t); });
  if (a.res) return;
  settle(a.rec, a.exam, a.t);
  return e.json(200, { ok: true });
}

function viaTg(e) {
  const on = (e.requestInfo().body || {}).on === true;
  const a = during(e, ["open", "photos"], (r) => { r.set("via_tg", on); });
  if (a.res) return;
  return e.json(200, { ok: true });
}

// The teacher adds a photo to the comment of a long task: only once the work is submitted (the same moment the
// scores can be set), up to MAX_FB_PHOTOS per task. The student sees it after the check.
function addFeedback(e) {
  const rec0 = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec0) return fail(e, 404, "not found");
  const exam = $app.findRecordById("exams", rec0.getString("exam")), rec = settle(rec0, exam, nowS());
  if (!rec.getInt("settled")) return fail(e, 409, "not submitted");
  const n = String(e.request.formValue("n") || "");
  const task = J(exam, "tasks", []).filter((x) => String(x.n) === n && x.kind === "long")[0];
  if (!task) return fail(e, 400, "bad task");
  const files = e.findUploadedFiles("file");
  if (!files || files.length !== 1) return fail(e, 400, "one file expected");
  if ($app.countRecords("exam_feedback_photos", $dbx.hashExp({ assignment: rec.id, n: n })) >= MAX_FB_PHOTOS) return fail(e, 400, "too many");
  const p = new Record($app.findCollectionByNameOrId("exam_feedback_photos"));
  p.set("user", rec.getString("user")); p.set("assignment", rec.id); p.set("n", n); p.set("file", files[0]);
  try { $app.save(p); } catch (_) { return fail(e, 400, "bad file"); }
  return e.json(200, { id: p.id, n: n, file: p.getString("file") });
}

function addPhoto(e) {
  if (isTeacher(e)) return addFeedback(e);
  const a = during(e, ["open", "photos"]);
  if (a.res) return;
  const n = String(e.request.formValue("n") || "");
  const task = J(a.exam, "tasks", []).filter((x) => String(x.n) === n && x.kind === "long")[0];
  if (!task) return fail(e, 400, "bad task");
  const files = e.findUploadedFiles("file");
  if (!files || files.length !== 1) return fail(e, 400, "one file expected");
  if ($app.countRecords("exam_photos", $dbx.hashExp({ assignment: a.rec.id, n: n })) >= MAX_PHOTOS) return fail(e, 400, "too many");
  const p = new Record($app.findCollectionByNameOrId("exam_photos"));
  p.set("user", e.auth.id); p.set("assignment", a.rec.id); p.set("n", n); p.set("file", files[0]);
  try { $app.save(p); } catch (_) { return fail(e, 400, "bad file"); }   // size or type refused by the field
  return e.json(200, { id: p.id, n: n, file: p.getString("file") });
}

function delFeedback(e) {
  const p = byId("exam_feedback_photos", e.request.pathValue("pid"));
  if (!p || p.getString("assignment") !== e.request.pathValue("id")) return fail(e, 404, "not found");
  $app.delete(p);
  return e.json(200, { ok: true });
}

function delPhoto(e) {
  if (isTeacher(e)) return delFeedback(e);
  const a = during(e, ["open", "photos"]);
  if (a.res) return;
  const p = byId("exam_photos", e.request.pathValue("pid"));
  if (!p || p.getString("assignment") !== a.rec.id) return fail(e, 404, "not found");
  $app.delete(p);
  return e.json(200, { ok: true });
}

function check(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  let rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec) return fail(e, 404, "not found");
  const exam = $app.findRecordById("exams", rec.getString("exam")), t = nowS();
  rec = settle(rec, exam, t);
  if (!rec.getInt("settled")) return fail(e, 409, "not submitted");   // `settled` never goes back
  const incoming = (e.requestInfo().body || {}).part2 || {}, tasks = J(exam, "tasks", []), part2 = {};
  for (let i = 0; i < tasks.length; i++) {
    const x = tasks[i];
    if (x.kind !== "long") continue;
    const g = incoming[String(x.n)] || {}, pts = intOf(g.pts);
    if (pts === null || pts < 0 || pts > (x.max || 1)) return fail(e, 400, "bad points for task " + x.n);
    part2[String(x.n)] = { pts: pts, comment: String(g.comment == null ? "" : g.comment).slice(0, 2000) };
  }
  // The teacher's general comment on the whole work lives in part2 under a key no task number can take.
  const general = String((e.requestInfo().body || {}).general == null ? "" : e.requestInfo().body.general).trim().slice(0, 3000);
  if (general) part2._general = general;
  let first = false;
  const out = mutate(rec.id, (r) => {
    first = !r.getInt("checked");
    r.set("part2", part2);
    if (first) r.set("checked", t);
  });
  if (out === null) return fail(e, 404, "not found");
  if (first) checkedMsg(rec.id, exam, tasks, t);
  return e.json(200, { ok: true });
}

// ---- "Мои пробники": the caller's checked exams and the manual ones, per task ----

function summary(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const items = [];
  const rows = $app.findRecordsByFilter("exam_assignments", "user = {:u} && checked > 0", "start", 200, 0, { u: e.auth.id });
  each(rows, (rec) => {
    const exam = $app.findRecordById("exams", rec.getString("exam"));
    const ns = each(photosOf(rec), (p) => p.n).filter((n) => n !== "");
    const ts = Hist.taskScores(J(exam, "tasks", []), J(rec, "answers", {}), J(rec, "ok", {}), J(rec, "part2", {}), ns);
    items.push({ kind: "exam", id: rec.id, title: exam.getString("title"), full: exam.getBool("full"), date: rec.getInt("start"), scores: ts.scores, na: ts.na, maxes: ts.maxes });
  });
  each($app.findRecordsByFilter("exam_history", "user = {:u}", "date", 200, 0, { u: e.auth.id }), (r) => {
    items.push({ kind: "manual", id: r.id, title: r.getString("title"), full: true, date: Hist.dateToTs(r.getString("date")),
      scores: J(r, "scores", {}), na: J(r, "na", []), maxes: Hist.MAXES, test: r.getInt("test") });
  });
  items.sort((a, b) => a.date - b.date);
  return e.json(200, { now: nowS(), items: items });
}

// The teacher enters an old exam. The body is read by key and by index (Go values), then checked as plain JS.
function histAdd(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const b = e.requestInfo().body || {};
  const user = byId("users", String(b.user || ""));
  const date = String(b.date || ""), title = String(b.title || "").trim();
  if (!user || user.get("role") !== "student") return fail(e, 400, "bad user");
  if (!Hist.validDate(date)) return fail(e, 400, "bad date");
  if (title === "" || title.length > 80) return fail(e, 400, "bad title");
  const incoming = b.scores || {}, scores = {}, na = [];
  for (let i = 0; i < Hist.NUMS.length; i++) {
    const n = Hist.NUMS[i], v = incoming[String(n)];
    scores[n] = v == null ? null : (intOf(v) === null ? -1 : v);
  }
  const arr = b.na == null ? [] : b.na;
  if (typeof arr === "string" || typeof arr.length !== "number") return fail(e, 400, "bad na");
  for (let i = 0; i < arr.length; i++) {
    const n = intOf(arr[i]);
    if (n === null || na.indexOf(n) >= 0) return fail(e, 400, "bad na");
    na.push(n);
  }
  const bad = Hist.checkManual(scores, na) || (intOf(b.test) === null ? "Тестовый балл: целое число от 0 до 100." : Hist.checkTest(b.test));
  if (bad) return fail(e, 400, bad);
  const rec = new Record($app.findCollectionByNameOrId("exam_history"));
  rec.set("user", user.id); rec.set("date", date); rec.set("title", title); rec.set("scores", scores); rec.set("na", na); rec.set("test", b.test);
  try { $app.save(rec); } catch (err) {
    // only the unique index (same student, date and title) is the teacher's mistake; anything else is ours
    return /unique/i.test(String(err)) ? fail(e, 400, "already added") : fail(e, 500, "could not save");
  }
  return e.json(200, { id: rec.id });
}

function histList(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const user = String(e.request.url.query().get("user") || "");
  const rows = $app.findRecordsByFilter("exam_history", "user = {:u}", "date", 200, 0, { u: user });
  return e.json(200, { items: each(rows, (r) => ({ id: r.id, date: r.getString("date"), title: r.getString("title"),
    scores: J(r, "scores", {}), na: J(r, "na", []), test: r.getInt("test") })) });
}

function histDel(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const rec = byId("exam_history", e.request.pathValue("id"));
  if (!rec) return fail(e, 404, "not found");
  $app.delete(rec);
  return e.json(200, { ok: true });
}

// Every minute: reminders, the opening message, settling of finished work,
// and another try for any bot message Telegram refused earlier (its flag is
// still 0) while it still makes sense: within a week of the start.
function tick() {
  let t = nowS();
  // The cron may fire a fraction of a second before the minute turns, when the exam
  // is not yet open: waiting here is better than a message a whole minute late.
  const near = $app.findRecordsByFilter("exam_assignments", "start > {:a} && start <= {:b} && settled = 0 && m_open = 0",
    "start", 1, 0, { a: t, b: t + START_WAIT });
  if (near.length) {
    while (Date.now() < near[0].getInt("start") * 1000) { /* goja has no sleep; at most START_WAIT s */ }
    t = nowS();
  }
  const rows = $app.findRecordsByFilter("exam_assignments",
    "start > {:old} && ((checked = 0 && settled = 0 && start < {:soon}) || (settled > 0 && m_done = 0) || (checked > 0 && m_checked = 0))",
    "start", 500, 0, { soon: t + 3600, old: t - 7 * 86400 });
  each(rows, (rec) => {
    try {
      // `rec` was read before any of the sends below and may be old by now:
      // it only picks what to try; every decision is made again on the fresh row.
      const id = rec.id, user = rec.getString("user"), start = rec.getInt("start");
      const exam = $app.findRecordById("exams", rec.getString("exam")), title = exam.getString("title");
      if (!rec.getInt("settled") && !rec.getInt("checked")) {
        if (t < start && !rec.getInt("m_hour")) {
          notify(id, "m_hour", t, (r) => {
            const s = r.getInt("start");
            if (t >= s || s - t >= 3600) return null;
            return () => tell(user, TEXT.hour(title, when(s)));
          });
        } else if (t >= start && t < start + rec.getInt("duration") && !rec.getInt("m_open")) {
          notify(id, "m_open", t, (r) => {
            const s = r.getInt("start"), end = s + r.getInt("duration");
            if (t < s || t >= end) return null;
            if (r.getInt("opened") || t >= s + OPEN_NEWS) return true;   // already seen, or too late to be news
            const mins = Math.floor((end - t) / 60);
            return () => tell(user, TEXT.open(title, mins), examUrl(id), TEXT.btnOpen);
          });
        }
        settle(rec, exam, t);
      }
      if (rec.getInt("settled") && !rec.getInt("m_done")) doneMsg(id, exam, J(exam, "tasks", []), t);
      if (rec.getInt("checked") && !rec.getInt("m_checked")) checkedMsg(id, exam, J(exam, "tasks", []), t);
    } catch (err) { console.log("exams: tick failed for " + rec.id); }
  });
}

// The caller's photos for the page to poll while photos can still arrive from the bot.
function photoList(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const a = own(e);
  if (!a) return fail(e, 404, "not found");
  const p = Core.phase(shape(a.rec), nowS());
  if (p === "scheduled" || p === "missed") return fail(e, 409, "closed");
  return e.json(200, { photos: photosOf(a.rec) });
}

// $dbx.exp takes raw SQL, so AND, not &&. `db` is $app, or tx inside a transaction.
const botCount = (a, db) => (db || $app).countRecords("exam_photos", $dbx.exp("assignment = {:a} AND n = ''", { a: a.id }));
const tgApi = () => env("TG_API") || "https://api.telegram.org";

// A photo, or an image sent as a file, from the student's own Telegram chat goes to the
// exam that started last — no caption, no task. Returns true when handled here, false
// to let the sign-in flow answer. An album is answered once: the first part to reach
// the server marks the album on the row, later parts keep quiet (except a failed download).
function botPhoto(msg) {
  const chat = msg.chat.id, t = nowS();
  let profile;
  try { profile = $app.findFirstRecordByData("tg_profiles", "tg_id", String(msg.from.id)); } catch (_) { return false; }
  const user = byId("users", profile.getString("user"));
  if (!user || !user.getBool("active")) return false;
  const say = (text) => tg.send(chat, text);

  // the exam that started last (never one in the future)
  const rows = $app.findRecordsByFilter("exam_assignments", "user = {:u} && start <= {:t}", "-start", 1, 0, { u: user.id, t: t });
  if (!rows.length) {
    // no assignments at all: this is not an exam student, the sign-in flow answers
    if (!$app.countRecords("exam_assignments", $dbx.hashExp({ user: user.id }))) return false;
    say(TEXT.botNoExam); return true;
  }
  const a = rows[0];
  // An exam that ended long ago is not what this photo is for (homework, a screenshot...): the ordinary bot answer follows.
  if (t > a.getInt("start") + a.getInt("duration") + BOT_PHOTO_AGE) return false;

  // mark the album first, so every refusal below is also said once per album;
  // the phase is read from the fresh row
  const group = String(msg.media_group_id || "").slice(0, 40);   // tg_group holds 40 characters
  const mark = mutate(a.id, (r) => {
    const quiet = group !== "" && group === r.getString("tg_group");
    r.set("tg_group", group);
    return { quiet: quiet, phase: Core.phase(shape(r), t), opened: r.getInt("opened") };
  });
  if (!mark) { say(TEXT.botNoExam); return true; }
  const refuse = (text) => { if (!mark.quiet) say(text); return true; };
  if (mark.phase === "missed" || mark.phase === "scheduled") return refuse(TEXT.botNoExam);
  if (mark.phase !== "open" && mark.phase !== "photos") return refuse(TEXT.botLate);
  if (mark.phase === "open" && !mark.opened) return refuse(TEXT.botNotOpened);   // the statements were never seen

  const doc = msg.document, f = msg.photo ? msg.photo[msg.photo.length - 1] : doc;
  if (!f || (doc && ["image/jpeg", "image/png", "image/webp"].indexOf(doc.mime_type) < 0) || (f.file_size || 0) > 10485760) {
    return refuse(TEXT.botBadFile);
  }
  if (botCount(a) >= MAX_BOT_PHOTOS) return refuse(TEXT.botTooMany);   // fast path; the real check is below

  let stored = false, full = false;
  try {
    const info = $http.send({ url: tgApi() + "/bot" + env("TG_BOT_TOKEN") + "/getFile?file_id=" + encodeURIComponent(f.file_id), method: "GET", timeout: 10 });
    const path = info.json && info.json.result && info.json.result.file_path;
    if (!path) throw new Error("no file path");
    const file = $filesystem.fileFromURL(tgApi() + "/file/bot" + env("TG_BOT_TOKEN") + "/" + path, 30);   // network: outside the transaction
    // count and save in one write transaction, so parallel album parts cannot pass the cap
    $app.runInTransaction((tx) => {
      if (botCount(a, tx) >= MAX_BOT_PHOTOS) { full = true; return; }
      const ph = new Record(tx.findCollectionByNameOrId("exam_photos"));
      ph.set("user", user.id); ph.set("assignment", a.id); ph.set("n", ""); ph.set("file", file);
      tx.save(ph);
      stored = true;
    });
  } catch (err) { console.log("exams: bot photo failed"); }       // never log the URL or the error text: they can hold the token
  if (full) return refuse(TEXT.botTooMany);
  if (!stored) {
    // the next part of this album must not be silent; a DB error here must not fail the webhook
    try { mutate(a.id, (r) => { r.set("tg_group", ""); }); } catch (_) { console.log("exams: album mark not cleared"); }
    say(TEXT.botFail); return true;
  }
  if (!mark.quiet) {
    const exam = $app.findRecordById("exams", a.getString("exam"));
    // an album reply states no number: its parts arrive one by one, a count now would be stale
    say(group !== "" ? TEXT.botOkAlbum(exam.getString("title")) : TEXT.botOk(exam.getString("title"), botCount(a)));
  }
  return true;
}

module.exports = { assign: assign, move: move, cancel: cancel, mine: mine, get: get,
  answers: answers, away: away, finish: finish, done: done, viaTg: viaTg,
  addPhoto: addPhoto, delPhoto: delPhoto, photoList: photoList, botPhoto: botPhoto, check: check, tick: tick,
  summary: summary, histAdd: histAdd, histList: histList, histDel: histDel };
