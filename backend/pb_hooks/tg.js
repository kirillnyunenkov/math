// Texts the bot sends. Edit here; no other code depends on the wording.
const TEXT = {
  hello: "Привет! Это тренажёр ЕГЭ по математике.\n\nЖми кнопку — откроется тренажёр, прогресс сохранится на всех твоих устройствах. Ссылка личная, никому её не пересылай.",
  again: "Вот твоя ссылка для входа. Прогресс сохранён.",
  off: "Доступ к тренажёру отключён.",
  button: "Открыть тренажёр",
  code: (c) => "\n\nНужен вход на компьютере, где нет Telegram? Открой там тренажёр и введи код: " + c + "\nКод действует 10 минут и срабатывает один раз.",
};
const CODE_TTL = 600;   // seconds
const env = (k) => $os.getenv(k);
const site = () => env("SITE_URL") || "https://kirillnyunenkov.github.io/math/";

// Returns true when Telegram accepted the message (a person who blocked the
// bot gives 403 — callers that retry need to know).
function send(chatId, text, url, label) {
  const body = { chat_id: chatId, text: text, disable_web_page_preview: true };
  if (url) body.reply_markup = { inline_keyboard: [[{ text: label || TEXT.button, url: url }]] };
  try {
    const res = $http.send({
      url: (env("TG_API") || "https://api.telegram.org") + "/bot" + env("TG_BOT_TOKEN") + "/sendMessage",
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" }, timeout: 10,
    });
    return res.statusCode === 200;
  } catch (err) { console.log("tg: sendMessage failed"); return false; }   // never log the URL: it holds the token
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
function newCode(userId) {
  const now = Math.floor(Date.now() / 1000);
  $app.db().newQuery("DELETE FROM login_codes WHERE user = {:u} OR expires < {:now}").bind({ u: userId, now: now }).execute();
  const coll = $app.findCollectionByNameOrId("login_codes");
  for (let i = 0; i < 5; i++) {
    const code = $security.randomStringWithAlphabet(6, "0123456789");
    try {
      const rec = new Record(coll);
      rec.set("user", userId); rec.set("code", code); rec.set("expires", now + CODE_TTL);
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
  const rows = arrayOf(new DynamicModel({ id: "", user: "", username: "", mine: false, created: "", name: "", active: false, marks: 0, last: "" }));
  $app.db().newQuery(
    "SELECT p.id, p.user, p.username, p.mine, p.created, u.name, u.active, " +
    "(SELECT COUNT(*) FROM events e WHERE e.user = p.user AND e.kind = 'mark' AND e.source != 'import') AS marks, " +
    "COALESCE((SELECT MAX(e.created) FROM events e WHERE e.user = p.user), '') AS last " +
    "FROM tg_profiles p JOIN users u ON u.id = p.user ORDER BY p.created DESC"
  ).all(rows);
  return e.json(200, { items: rows });
}

module.exports = { webhook: webhook, leads: leads, claim: claim, send: send };
