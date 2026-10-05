/// <reference path="../pb_data/types.d.ts" />
// Assigned mock exams: what a student may see is decided here, by the server
// clock and the phase from lib/exam-core.js. Runs on goja: plain ES6 only.
const Core = require(`${__hooks}/lib/exam-core.js`);
const Ans = require(`${__hooks}/lib/answers-core.js`);
const tg = require(`${__hooks}/tg.js`);

// Texts the bot sends. Edit here; no other code depends on the wording.
const TEXT = {
  assigned: (title, at) => "Тебе назначен пробник «" + title + "».\nНачало: " + at + " (по Москве).\n\nВ это время он откроется в тренажёре. Напомню за час.",
  moved: (title, at) => "Пробник «" + title + "» перенесён.\nНовое начало: " + at + " (по Москве).",
  canceled: (title) => "Пробник «" + title + "» отменён.",
  hour: (title, at) => "Через час пробник «" + title + "»: начало " + at + " (по Москве).\nПриготовь черновики и ручку.",
  open: (title, mins) => "Пробник «" + title + "» открыт. На работу " + mins + " мин, время уже идёт.",
  checked: (title, pts, max) => "Пробник «" + title + "» проверен: " + pts + " из " + max + ".\nБаллы и комментарии по второй части — в тренажёре.",
  done: (name, title, p1, max1, how) => name + " сдал(а) пробник «" + title + "».\nПервая часть: " + p1 + " из " + max1 + ".\nВторая часть: " + how + ".",
  howPhotos: (k) => "фото на сайте — " + k,
  howTg: "решения пришлёт в Telegram",
  howNone: "фото нет",
  btnOpen: "Открыть пробник",
  btnResult: "Посмотреть результат",
  btnCheck: "Проверить",
};
const MAX_PHOTOS = 5, MAX_LOG = 3000, MIN_DURATION = 60, MAX_DURATION = 21600;
const DAYS = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

const env = (k) => $os.getenv(k);
const site = () => env("SITE_URL") || "https://kirillnyunenkov.github.io/math/";
const nowS = () => Math.floor(Date.now() / 1000);
const fail = (e, code, msg) => e.json(code, { message: msg });
const inUsers = (e) => e.auth && e.auth.collection().name === "users";
const isTeacher = (e) => inUsers(e) && e.auth.get("role") === "teacher";
const isStudent = (e) => inUsers(e) && e.auth.get("active") === true;

// A json field as a plain value (goja hands it over as raw bytes otherwise).
function J(rec, field, fallback) {
  try { const v = JSON.parse(rec.getString(field)); return v == null ? fallback : v; } catch (_) { return fallback; }
}
function shape(rec) {
  return { start: rec.getInt("start"), duration: rec.getInt("duration"), opened: rec.getInt("opened"),
    finished: rec.getInt("finished"), photos_done: rec.getInt("photos_done"), checked: rec.getInt("checked") };
}
// "в пятницу, 9 октября, в 18:00" — Moscow time is UTC+3 all year round.
function when(ts) {
  const d = new Date((ts + 10800) * 1000), m = d.getUTCMinutes();
  return DAYS[d.getUTCDay()] + ", " + d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + ", в " + d.getUTCHours() + ":" + (m < 10 ? "0" : "") + m;
}
// Sends to the student's Telegram; false if the account has none or it failed.
function tell(userId, text, url, label) {
  let chat = "";
  try { chat = $app.findFirstRecordByData("tg_profiles", "user", userId).getString("tg_id"); } catch (_) { return false; }
  return tg.send(chat, text, url, label);
}
const examUrl = (id) => site() + "#/exam/" + id;
function byId(coll, id) { try { return $app.findRecordById(coll, id); } catch (_) { return null; } }
const intOf = (v) => (typeof v === "number" && isFinite(v) && Math.floor(v) === v ? v : null);
// Record lists come from Go as slices; index them instead of relying on Array methods.
function each(rows, fn) { const out = []; for (let i = 0; i < rows.length; i++) out.push(fn(rows[i])); return out; }

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
  try { $app.save(rec); } catch (_) { return fail(e, 400, "already assigned"); }
  tell(user.id, TEXT.assigned(exam.getString("title"), when(start)), examUrl(rec.id), TEXT.btnOpen);
  return e.json(200, { id: rec.id });
}

// The row and its exam, for teacher actions allowed only while nothing was seen.
function untouched(e) {
  const rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec) return { code: 404 };
  const p = Core.phase(shape(rec), nowS());
  if (p !== "scheduled" && p !== "missed") return { code: 409 };
  return { rec: rec, exam: $app.findRecordById("exams", rec.getString("exam")) };
}

function move(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const a = untouched(e);
  if (a.code) return fail(e, a.code, a.code === 404 ? "not found" : "already started");
  const b = e.requestInfo().body || {}, t = nowS();
  const start = intOf(b.start), duration = b.duration == null ? a.rec.getInt("duration") : intOf(b.duration);
  if (start === null || duration === null || duration < MIN_DURATION || duration > MAX_DURATION) return fail(e, 400, "bad input");
  a.rec.set("start", start); a.rec.set("duration", duration);
  a.rec.set("m_hour", start - t < 3600 ? t : 0); a.rec.set("m_open", 0);
  $app.save(a.rec);
  tell(a.rec.getString("user"), TEXT.moved(a.exam.getString("title"), when(start)), examUrl(a.rec.id), TEXT.btnOpen);
  return e.json(200, { ok: true });
}

function cancel(e) {
  if (!isTeacher(e)) return fail(e, 403, "forbidden");
  const a = untouched(e);
  if (a.code) return fail(e, a.code, a.code === 404 ? "not found" : "already started");
  const user = a.rec.getString("user");
  $app.delete(a.rec);
  tell(user, TEXT.canceled(a.exam.getString("title")));
  return e.json(200, { ok: true });
}

// The caller's own assignment with its exam, or null.
function own(e) {
  const rec = byId("exam_assignments", e.request.pathValue("id"));
  if (!rec || rec.getString("user") !== e.auth.id) return null;
  return { rec: rec, exam: $app.findRecordById("exams", rec.getString("exam")) };
}

function meta(rec, exam, t) {
  return { id: rec.id, title: exam.getString("title"), full: exam.getBool("full"), start: rec.getInt("start"),
    duration: rec.getInt("duration"), phase: Core.phase(shape(rec), t), via_tg: rec.getBool("via_tg") };
}

function photosOf(rec) {
  return each($app.findRecordsByFilter("exam_photos", "assignment = {:a}", "created", 200, 0, { a: rec.id }),
    (p) => ({ id: p.id, n: p.getString("n"), file: p.getString("file") }));
}

// Grades part 1 once the photo phase is over. Filled in by a later task.
function settle(rec, exam, t) {}

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
    if (v.phase === "checked") { v.part2 = J(rec, "part2", {}); v.total = Core.total(tasks, v.p1, v.part2); }
  }
  return v;
}

function mine(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const t = nowS();
  const rows = $app.findRecordsByFilter("exam_assignments", "user = {:u}", "-start", 50, 0, { u: e.auth.id });
  const items = each(rows, (rec) => {
    const exam = $app.findRecordById("exams", rec.getString("exam"));
    settle(rec, exam, t);
    return meta(rec, exam, t);
  });
  return e.json(200, { now: t, items: items });
}

function get(e) {
  if (!isStudent(e)) return fail(e, 403, "forbidden");
  const a = own(e);
  if (!a) return fail(e, 404, "not found");
  const t = nowS();
  if (Core.phase(shape(a.rec), t) === "open" && !a.rec.getInt("opened")) { a.rec.set("opened", t); $app.save(a.rec); }
  settle(a.rec, a.exam, t);
  return e.json(200, viewOf(a.rec, a.exam, t));
}

module.exports = { assign: assign, move: move, cancel: cancel, mine: mine, get: get };
