// Texts the bot sends. Edit here; no other code depends on the wording.
const TEXT = {
  hello: "Привет! Это тренажёр ЕГЭ по математике.\n\nЖми кнопку — откроется тренажёр, прогресс сохранится на всех твоих устройствах. Ссылка личная, никому её не пересылай.",
  again: "Вот твоя ссылка для входа. Прогресс сохранён.",
  off: "Доступ к тренажёру отключён.",
  button: "Открыть тренажёр",
  linked: "Готово, Telegram привязан к твоему аккаунту. Прогресс на месте.\n\nВот твоя ссылка для входа.",
  linkBad: "Код не подходит или устарел. Открой тренажёр, нажми «Привязать Telegram» и получи новый.",
  linkTaken: "Этот Telegram уже используется в другом аккаунте. Напиши Кириллу.",
  linkOther: "К этому аккаунту уже привязан другой Telegram. Напиши Кириллу.",
  code: (c) => "\n\nНужен вход на компьютере, где нет Telegram? Открой там тренажёр и введи код: " + c + "\nКод действует 10 минут и срабатывает один раз.",
};
const CODE_TTL = 600;   // seconds
const BOT_NAME = "kirill_repet_bot";
// An invited account has no Telegram yet: its profile carries a made-up id that
// starts with "0" (real ids never do) until the person binds a real one.
const isPlaceholder = (tgId) => String(tgId).charAt(0) === "0";
const placeholderId = () => "0" + $security.randomStringWithAlphabet(15, "0123456789");
const env = (k) => $os.getenv(k);
const site = () => env("SITE_URL") || "https://kirillnyunenkov.github.io/math/";

// Returns true when Telegram accepted the message (a person who blocked the
// bot gives 403 — callers that retry need to know).
function send(chatId, text, url, label) {
  const body = { chat_id: chatId, text: text, disable_web_page_preview: true };
  if (url) body.reply_markup = { inline_keyboard: [[{ text: label || TEXT.button, url: url }]] };
  let status = 0;
  try {
    const res = $http.send({
      url: (env("TG_API") || "https://api.telegram.org") + "/bot" + env("TG_BOT_TOKEN") + "/sendMessage",
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, timeout: 10,
    });
    status = res.statusCode;
    if (status !== 200) console.log("tg: sendMessage answered " + status);
  } catch (err) { console.log("tg: sendMessage failed"); }   // never log the URL: it holds the token
  journal(chatId, text, url ? label || TEXT.button : "", status);
  return status === 200;
}

// One row in bot_messages per attempt. The sign-in code is masked and the
// button's link is not kept at all (it holds the personal secret). A failure
// here must never stop the message itself.
function journal(chatId, text, label, status) {
  try {
    const rec = new Record($app.findCollectionByNameOrId("bot_messages"));
    rec.set("chat", String(chatId));
    const prof = findProfile(String(chatId));
    if (prof) rec.set("user", prof.get("user"));
    rec.set("text", String(text).replace(/(введи код: )\d{6}/, "$1••••••").slice(0, 4096));
    rec.set("label", String(label).slice(0, 64));
    rec.set("ok", status === 200);
    rec.set("status", status);
    $app.save(rec);
  } catch (err) { console.log("tg: journal failed"); }
}

function findProfile(tgId) {
  try { return $app.findFirstRecordByData("tg_profiles", "tg_id", tgId); } catch (_) { return null; }
}

// Returns {profile, created}. One Telegram account = one trainer account.
function ensure(from) {
  const tgId = String(from.id);
  const name = String(from.first_name || "Ученик").slice(0, 80);
  const username = String(from.username || "").slice(0, 64);
  let profile = findProfile(tgId);
  if (profile) {
    if (profile.get("username") !== username || profile.get("first_name") !== name) {
      profile.set("username", username); profile.set("first_name", name); $app.save(profile);
    }
    return { profile: profile, created: false };
  }
  const secret = $security.randomString(32);
  try {
    $app.runInTransaction((tx) => {
      const user = new Record(tx.findCollectionByNameOrId("users"));
      user.set("login", "tg" + tgId); user.set("name", name); user.set("role", "student"); user.set("active", true);
      user.setPassword(secret);
      tx.save(user);
      const link = new Record(tx.findCollectionByNameOrId("links"));
      link.set("user", user.id); link.set("secret", secret);
      tx.save(link);
      const p = new Record(tx.findCollectionByNameOrId("tg_profiles"));
      p.set("user", user.id); p.set("tg_id", tgId); p.set("username", username); p.set("first_name", name); p.set("mine", false);
      tx.save(p);
    });
  } catch (err) {
    // two "Start" taps at once: the unique index rejected the second one
    profile = findProfile(tgId);
    if (!profile) throw err;
    return { profile: profile, created: false };
  }
  return { profile: findProfile(tgId), created: true };
}

// A fresh one-time code for the user; the previous one stops working.
// Returns "" if no free code was found (the link still works on its own).
function newCode(userId, purpose) {
  purpose = purpose || "";
  const now = Math.floor(Date.now() / 1000);
  $app.db().newQuery("DELETE FROM login_codes WHERE (user = {:u} AND COALESCE(purpose, '') = {:p}) OR expires < {:now}")
    .bind({ u: userId, p: purpose, now: now }).execute();
  const coll = $app.findCollectionByNameOrId("login_codes");
  for (let i = 0; i < 5; i++) {
    const code = $security.randomStringWithAlphabet(6, "0123456789");
    try {
      const rec = new Record(coll);
      rec.set("user", userId); rec.set("code", code); rec.set("purpose", purpose); rec.set("expires", now + CODE_TTL);
      $app.save(rec);
      return code;
    } catch (_) { /* the code is taken by someone else: try another */ }
  }
  return "";
}

// Exchanges a code for the sign-in pair of the personal link. The code dies
// on the first hit, valid or expired. Public, rate limited per address.
function claim(e) {
  const bad = () => e.json(400, { message: "bad code" });
  const code = String((e.requestInfo().body || {}).code || "").replace(/\D/g, "");
  if (code.length !== 6) return bad();
  let rec;
  try { rec = $app.findFirstRecordByData("login_codes", "code", code); } catch (_) { return bad(); }
  if (rec.get("purpose")) return bad();   // a link code is not a sign-in code and must survive this guess
  $app.delete(rec);
  if (rec.get("expires") < Math.floor(Date.now() / 1000)) return bad();
  const user = $app.findRecordById("users", rec.get("user"));
  if (!user.get("active")) return e.json(403, { message: "disabled" });
  const link = $app.findFirstRecordByData("links", "user", user.id);
  return e.json(200, { login: user.get("login"), secret: link.get("secret") });
}

function webhook(e) {
  const secret = env("TG_WEBHOOK_SECRET");
  if (!secret || !env("TG_BOT_TOKEN")) return e.json(503, { message: "bot is not configured" });
  if (!$security.equal(e.request.header.get("X-Telegram-Bot-Api-Secret-Token"), secret)) return e.json(403, { message: "forbidden" });
  const msg = (e.requestInfo().body || {}).message;
  if (!msg || !msg.from || msg.from.is_bot || !msg.chat || msg.chat.type !== "private") return e.json(200, { ok: true });
  // photos and images sent as files belong to a running exam, not to the sign-in flow
  if (msg.photo || (msg.document && /^image\//.test(msg.document.mime_type || ""))) {
    if (require(`${__hooks}/exams.js`).botPhoto(msg)) return e.json(200, { ok: true });
  }
  const linkCmd = String(msg.text || "").match(/^\/(?:start\s+link_|link\s+)([\d\s]*)$/);
  if (linkCmd) { bind(msg, linkCmd[1].replace(/\s/g, "")); return e.json(200, { ok: true }); }
  if (/^\/link\b/.test(String(msg.text || ""))) { send(msg.chat.id, TEXT.linkBad); return e.json(200, { ok: true }); }
  const r = ensure(msg.from);
  const user = $app.findRecordById("users", r.profile.get("user"));
  if (!user.get("active")) { send(msg.chat.id, TEXT.off); return e.json(200, { ok: true }); }
  const link = $app.findFirstRecordByData("links", "user", user.id);
  const url = site() + "#/login/" + user.get("login") + "." + link.get("secret");
  const code = newCode(user.id);
  send(msg.chat.id, (r.created ? TEXT.hello : TEXT.again) + (code ? TEXT.code(code) : ""), url);
  return e.json(200, { ok: true });
}

// Everyone registered through the bot, with a cheap activity summary, so the
// panel does not have to download every lead's journal.
function leads(e) {
  if (!e.auth || e.auth.collection().name !== "users" || e.auth.get("role") !== "teacher") return e.json(403, { message: "forbidden" });
  const rows = arrayOf(new DynamicModel({ id: "", user: "", username: "", mine: false, created: "", name: "", active: false, marks: 0, last: "", placeholder: false }));
  $app.db().newQuery(
    "SELECT p.id, p.user, p.username, p.mine, p.created, u.name, u.active, (substr(p.tg_id, 1, 1) = '0') AS placeholder, " +
    "(SELECT COUNT(*) FROM events e WHERE e.user = p.user AND e.kind = 'mark' AND e.source != 'import') AS marks, " +
    "COALESCE((SELECT MAX(e.created) FROM events e WHERE e.user = p.user), '') AS last " +
    "FROM tg_profiles p JOIN users u ON u.id = p.user ORDER BY p.created DESC"
  ).all(rows);
  return e.json(200, { items: rows });
}

const isTeacher = (e) => e.auth && e.auth.collection().name === "users" && e.auth.get("role") === "teacher";
const isStudent = (e) => e.auth && e.auth.collection().name === "users" && e.auth.get("role") === "student";
function profileOf(userId) {
  try { return $app.findFirstRecordByData("tg_profiles", "user", userId); } catch (_) { return null; }
}

// Teacher only. Without `user`: a new account with a personal link and a placeholder
// Telegram profile, so the person shows up under "Из канала" like everyone else.
// With `user`: puts a placeholder profile on an old link account that has none.
function invite(e) {
  if (!isTeacher(e)) return e.json(403, { message: "forbidden" });
  const body = e.requestInfo().body || {};
  if (body.user) {
    let user;
    try { user = $app.findRecordById("users", String(body.user)); } catch (_) { return e.json(404, { message: "no such user" }); }
    if (user.get("role") !== "student") return e.json(400, { message: "not a student" });
    if (profileOf(user.id)) return e.json(409, { message: "already has a profile" });
    const p = new Record($app.findCollectionByNameOrId("tg_profiles"));
    p.set("user", user.id); p.set("tg_id", placeholderId()); p.set("mine", false);
    $app.save(p);
    return e.json(200, { id: user.id });
  }
  const secret = $security.randomString(32);
  const login = "s" + $security.randomStringWithAlphabet(8, "abcdefghijklmnopqrstuvwxyz0123456789");
  let id = "";
  $app.runInTransaction((tx) => {
    const user = new Record(tx.findCollectionByNameOrId("users"));
    user.set("login", login); user.set("name", ""); user.set("role", "student"); user.set("active", true);
    user.setPassword(secret);
    tx.save(user);
    const link = new Record(tx.findCollectionByNameOrId("links"));
    link.set("user", user.id); link.set("secret", secret);
    tx.save(link);
    const p = new Record(tx.findCollectionByNameOrId("tg_profiles"));
    p.set("user", user.id); p.set("tg_id", placeholderId()); p.set("mine", false);
    tx.save(p);
    id = user.id;
  });
  return e.json(200, { id: id, login: login, secret: secret });
}

// A student names themselves once; after that only the teacher can rename.
function setName(e) {
  if (!isStudent(e)) return e.json(403, { message: "forbidden" });
  const name = String((e.requestInfo().body || {}).name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!name) return e.json(400, { message: "empty name" });
  const user = $app.findRecordById("users", e.auth.id);
  if (user.getString("name")) return e.json(403, { message: "name is already set" });
  user.set("name", name);
  $app.save(user);
  return e.json(200, { name: name });
}

const linked = (userId) => { const p = profileOf(userId); return !!p && !isPlaceholder(p.getString("tg_id")); };

// GET: is a real Telegram bound? POST: a fresh code for binding one.
function tgLinkStatus(e) {
  if (!isStudent(e)) return e.json(403, { message: "forbidden" });
  return e.json(200, { linked: linked(e.auth.id) });
}
function tgLinkCode(e) {
  if (!isStudent(e)) return e.json(403, { message: "forbidden" });
  if (linked(e.auth.id)) return e.json(200, { linked: true });
  const code = newCode(e.auth.id, "link");
  if (!code) return e.json(503, { message: "no free code" });
  return e.json(200, { code: code, bot: BOT_NAME });
}

// The bot got "/start link_<code>" or "/link <code>": swap the account's placeholder
// (or missing) profile for this Telegram.
function bind(msg, code) {
  const chat = msg.chat.id;
  let rec = null;
  if (/^\d{6}$/.test(code)) {
    try { rec = $app.findFirstRecordByData("login_codes", "code", code); } catch (_) { rec = null; }
  }
  if (!rec || rec.get("purpose") !== "link" || rec.get("expires") < Math.floor(Date.now() / 1000)) {
    if (rec && rec.get("purpose") === "link") $app.delete(rec);
    send(chat, TEXT.linkBad);
    return;
  }
  const user = $app.findRecordById("users", rec.get("user"));
  if (!user.get("active")) { send(chat, TEXT.off); return; }
  const tgId = String(msg.from.id);
  const taken = findProfile(tgId), own = profileOf(user.id);
  const same = taken && own && taken.id === own.id;
  if (taken && !same) { $app.delete(rec); send(chat, TEXT.linkTaken); return; }
  if (own && !same && !isPlaceholder(own.getString("tg_id"))) { $app.delete(rec); send(chat, TEXT.linkOther); return; }
  const username = String(msg.from.username || "").slice(0, 64), name = String(msg.from.first_name || "").slice(0, 80);
  const p = own || new Record($app.findCollectionByNameOrId("tg_profiles"));
  if (!own) { p.set("user", user.id); p.set("mine", false); }
  p.set("tg_id", tgId); p.set("username", username); p.set("first_name", name);
  $app.save(p);
  $app.delete(rec);
  let url = "";
  try { url = site() + "#/login/" + user.get("login") + "." + $app.findFirstRecordByData("links", "user", user.id).get("secret"); } catch (_) { /* no link: the binding still stands */ }
  send(chat, TEXT.linked, url);
}

module.exports = { invite: invite, setName: setName, tgLinkStatus: tgLinkStatus, tgLinkCode: tgLinkCode, webhook: webhook, leads: leads, claim: claim, send: send };
