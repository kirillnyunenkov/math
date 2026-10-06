/* Assigned mock exams, trainer side — pure helpers shared with the tests
   (node: require, browser: window.ExamClientCore). No DOM here. */
(function (root) {
  'use strict';

  const DAYS = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // "в пятницу, 9 октября, в 18:00" — Moscow time is UTC+3 all year round.
  // Twin of when() in backend/pb_hooks/exams.js (the Telegram messages): change both together.
  function whenText(ts) {
    const d = new Date((ts + 10800) * 1000), m = d.getUTCMinutes();
    return DAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', в ' + d.getUTCHours() + ':' + (m < 10 ? '0' : '') + m;
  }

  // setTimeout stores its delay in a signed 32-bit int: anything above ~24.8 days fires at once, and a
  // NaN delay too. Every timer of the exam pages goes through this clamp (NaN and Infinity wait the maximum).
  const MAX_DELAY = 2147483000;
  function clampDelay(ms) {
    if (typeof ms !== 'number' || ms !== ms) return MAX_DELAY;
    return Math.min(MAX_DELAY, Math.max(0, Math.round(ms)));
  }

  /* When to ask the server again about a "scheduled" exam. A start still ahead: just after it passes
     (slackMs later). An `until` that is already past (the server still says "scheduled", a request
     failed, or the value is missing): never reuse it, back off 30 s, then 60 s; `misses` is the number
     of such refreshes in a row including the current one. */
  function refreshDelay(untilSec, nowMs, misses, slackMs) {
    const left = typeof untilSec === 'number' ? untilSec * 1000 - nowMs : NaN;
    if (Number.isFinite(left) && left > 0) return clampDelay(left + (slackMs == null ? 1200 : slackMs));
    return misses > 1 ? 60000 : 30000;
  }

  /* The soonest moment (server seconds) at which the hub banners can change by themselves: the start of a scheduled
     exam, the end of a running window, the end of the photo time. Items without a finite `until` are ignored. */
  function nextChangeAt(items) {
    let best;
    (Array.isArray(items) ? items : []).forEach(function (it) {
      if (!it || (it.phase !== 'scheduled' && it.phase !== 'open' && it.phase !== 'photos')) return;
      if (typeof it.until !== 'number' || !Number.isFinite(it.until)) return;
      if (best === undefined || it.until < best) best = it.until;
    });
    return best;
  }

  const offsetOf = (serverNowSec, clientNowMs) => serverNowSec * 1000 - clientNowMs;

  function leftSec(untilSec, offsetMs, clientNowMs) {
    return Math.max(0, Math.ceil((untilSec * 1000 - (clientNowMs + offsetMs)) / 1000));
  }

  function fmtLeft(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (x) => String(x).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  }

  // The size an image is drawn at so that its long side is at most `max` (never enlarged, never below 1 px);
  // 0 x 0 for a size that is not a positive finite number.
  function fitSize(w, h, max) {
    if (![w, h, max].every(function (x) { return typeof x === 'number' && Number.isFinite(x) && x > 0; })) return { w: 0, h: 0 };
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  /* Tracks when the exam page was hidden or lost focus and for how long.
     Intervals shorter than minSec are ignored (a keyboard or a notification). */
  function AwayTracker(minSec) {
    let since = 0, task = '';
    this.hide = function (nowMs, n) { if (since) return; since = nowMs; task = n == null ? '' : n; };
    this.show = function (nowMs) {
      if (!since) return null;
      const sec = Math.round((nowMs - since) / 1000), n = task;
      since = 0; task = '';
      return sec >= minSec ? { n: n, sec: Math.min(sec, 21600) } : null;
    };
  }

  // Typed answers waiting to be sent; a value typed again during a request stays queued.
  function SaveQueue() {
    const dirty = {};
    this.set = function (n, v) { dirty[n] = v; };
    this.has = function () { return Object.keys(dirty).length > 0; };
    this.snapshot = function () { return Object.assign({}, dirty); };
    this.ack = function (snap) {
      Object.keys(snap).forEach(function (k) { if (dirty[k] === snap[k]) delete dirty[k]; });
    };
  }

  /* The task list of an open exam comes from the server and is not trusted: a bad item is dropped, never thrown on.
     Kept: n an integer 1..40 (a number, not "__proto__" or "3"), unique; kind 'short' | 'long'; cond a string of
     sane size; max a small integer (0 = unknown: the page leaves the label out). Returns fresh plain objects.
     The photo phase sends no statements: with opts.noCond a missing cond is allowed and kept as ''. */
  const MAX_COND = 3000000;
  function wellFormedTasks(list, opts) {
    const noCond = !!(opts && opts.noCond);
    const out = [], seen = {};
    if (!Array.isArray(list)) return out;
    list.forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      const n = t.n;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 40 || seen[n]) return;
      if (t.kind !== 'short' && t.kind !== 'long') return;
      const cond = noCond && t.cond == null ? '' : t.cond;
      if (typeof cond !== 'string' || cond.length > MAX_COND) return;
      const m = typeof t.max === 'number' && Number.isFinite(t.max) && t.max >= 1 ? Math.min(10, Math.round(t.max)) : 0;
      seen[n] = true;
      out.push({ n: n, kind: t.kind, max: m, cond: cond });
    });
    return out;
  }

  /* The saved answers of the listed short tasks as { n: text }: only own string values, cut to the
     40 characters the server keeps (it trims the same way). */
  function answersOf(raw, tasks) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    tasks.forEach(function (t) {
      if (t.kind !== 'short' || !Object.prototype.hasOwnProperty.call(raw, String(t.n))) return;
      const v = raw[String(t.n)];
      if (typeof v === 'string') out[t.n] = v.slice(0, 40);
    });
    return out;
  }

  // Wait before the next autosave attempt after `fails` failures in a row: 5 s, 15 s, then 30 s.
  function retryDelay(fails) { return fails >= 3 ? 30000 : fails === 2 ? 15000 : 5000; }

  /* What a server answer to a save means: 'ok'; 'closed' (409, the window is over: re-read the phase); 'auth' (401/403:
     stop, sign in again); 'gone' (404); 'client' (other 4xx: the server refuses this request, retrying is slow but
     allowed); 'retry' (no answer, a timeout, 408, 429, 5xx, anything unexpected: all of these pass by themselves). */
  function classifyStatus(status) {
    if (status === 200) return 'ok';
    if (status === 409) return 'closed';
    if (status === 401 || status === 403) return 'auth';
    if (status === 404) return 'gone';
    if (status === 408 || status === 429) return 'retry';
    if (typeof status === 'number' && status >= 400 && status < 500) return 'client';
    return 'retry';
  }

  // A page that was left with unsent answers retries in the background: after the nth failure wait 5 s, 15 s, 30 s; then give up (null).
  function detachedDelay(failures) {
    if (typeof failures !== 'number' || failures !== failures) return null;
    return failures <= 1 ? 5000 : failures === 2 ? 15000 : failures === 3 ? 30000 : null;
  }

  // The entries of `snap` that the request already on its way (`inflight`) does not carry with the same value.
  function unsentOf(snap, inflight) {
    const out = {};
    Object.keys(snap).forEach(function (k) {
      if (!inflight || !Object.prototype.hasOwnProperty.call(inflight, k) || inflight[k] !== snap[k]) out[k] = snap[k];
    });
    return out;
  }

  // The token a request goes with: the one given explicitly (kept by an exam screen, it survives a sign-out), else the signed-in one.
  function pickToken(own, authObj) {
    if (typeof own === 'string' && own) return own;
    return authObj && typeof authObj.token === 'string' ? authObj.token : '';
  }

  // Answers typed but never sent (kept from a screen that was left) shown over the older server text; short tasks of this exam only.
  function mergePending(typed, pending, tasks) {
    const out = Object.assign({}, typed);
    if (!pending || typeof pending !== 'object') return out;
    tasks.forEach(function (t) {
      if (t.kind === 'short' && Object.prototype.hasOwnProperty.call(pending, String(t.n)) && typeof pending[String(t.n)] === 'string') out[t.n] = pending[String(t.n)];
    });
    return out;
  }

  /* ---- photos of part 2 ---- */
  // Limits of the server (backend/pb_hooks/exams.js, migration exam_photos); the page keeps to them before sending.
  const PHOTO = { PER_TASK: 5, BOT_MAX: 15, SIDE: 2000, SERVER_MAX: 10485760, SRC_MAX: 83886080, PIXELS_MAX: 150000000, LIST_MAX: 200, MANUAL_MAX: 3, PICKER_MS: 90000 };

  // A decoded size the canvas can take: positive integers and not an absurd pixel count (a decompression bomb).
  function dimsOk(w, h) {
    return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w * h <= PHOTO.PIXELS_MAX;
  }

  /* The photo list of the server is not trusted: an item is kept only when id and file are plain strings of a sane
     shape, and n is '' (sent to the bot) or the number of a task the page shows (`known`: numbers or digit strings).
     Duplicated ids and everything past LIST_MAX are dropped. Fresh objects; never throws, `__proto__` is just a string. */
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  function okFile(f) {
    return typeof f === 'string' && f.length > 0 && f.length <= 255 && f !== '.' && f !== '..' && !/[\/\\?#%\u0000-\u001f\u007f]/.test(f);
  }
  function wellFormedPhotos(list, known) {
    const out = [], seen = new Set(), ok = new Set();
    (Array.isArray(known) ? known : []).forEach(function (k) { if (typeof k === 'number' || typeof k === 'string') ok.add(String(k)); });
    if (!Array.isArray(list)) return out;
    for (let i = 0; i < list.length && out.length < PHOTO.LIST_MAX; i++) {
      const p = list[i];
      if (!p || typeof p !== 'object') continue;
      const id = p.id, n = p.n, file = p.file;
      if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id) || !okFile(file)) continue;
      if (typeof n !== 'string' || (n !== '' && !ok.has(n))) continue;
      seen.add(id);
      out.push({ id: id, n: n, file: file });
    }
    return out;
  }
  // Two photo lists look the same to the screen: same items in the same order.
  function photoSig(list) { return list.map(function (p) { return p.n + ':' + p.id + ':' + p.file; }).join('|'); }

  // Places left for a task: the photos the server holds plus the ones on their way, against the limit of five.
  function photoRoom(held, coming) { return Math.max(0, PHOTO.PER_TASK - (held | 0) - (coming | 0)); }

  // Wait before asking the server for its photo list again: 15 s, and after failures in a row 30, 60, then 120 s.
  function pollDelay(fails) {
    return typeof fails !== 'number' || !(fails > 0) ? 15000 : fails === 1 ? 30000 : fails === 2 ? 60000 : 120000;
  }

  // After the nth failed upload of one photo: 3 s, 10 s, 30 s, then it stays failed until the student presses "again".
  function uploadRetryDelay(failures) {
    return typeof failures !== 'number' || failures !== failures ? null : failures <= 1 ? 3000 : failures === 2 ? 10000 : failures === 3 ? 30000 : null;
  }

  /* What a server answer to an upload means: 'ok'; 'closed' (409: photos are not taken any more); 'auth' (401/403);
     'gone' (404); 'tooMany' (400 "too many": five on the task already); 'badTask'; 'badFile' (400 / 413 / 415: the
     server will not take this file, trying it again will not help); 'retry' (no answer, a timeout, 408, 429, 5xx). */
  function uploadVerdict(status, message) {
    const k = classifyStatus(status);
    if (k === 'ok' || k === 'closed' || k === 'auth' || k === 'gone' || k === 'retry') return k;
    const m = typeof message === 'string' ? message : '';
    if (status === 400 && m === 'too many') return 'tooMany';
    if (status === 400 && m === 'bad task') return 'badTask';
    return 'badFile';
  }

  // A photo the server refused (400) may be tried again by hand this many times, then it stays as it is.
  function canRetry(manual) { return typeof manual === 'number' && manual === manual && manual < PHOTO.MANUAL_MAX; }

  // What the server's own words about a refused file are about: 'typeSize' only when they clearly name the type or the size.
  function fileRefusal(message) {
    return typeof message === 'string' && /\b(size|large|big|type|mime|format)\b/i.test(message) ? 'typeSize' : 'other';
  }

  /* The mark "the file dialog is open" (set when the student presses "attach", a timestamp): it keeps the dialog's blur
     from being written to the away journal, but only for 90 s, so that a real absence cannot go unrecorded. */
  function pickerActive(setAt, nowMs) {
    return typeof setAt === 'number' && setAt > 0 && nowMs >= setAt && nowMs - setAt < PHOTO.PICKER_MS;
  }

  /* The server list of the photo phase merged into a carried list: what the server says now is the truth, except a photo
     that was uploaded from this very page (`localIds`: a Set, a Map or an array of ids with a local preview) and is not in that answer yet, because the
     answer was read just before the upload was committed. Fresh objects, bad items dropped, never more than LIST_MAX. */
  function mergePhotoLists(raw, held, localIds, known) {
    const out = wellFormedPhotos(raw, known), have = new Set(out.map(function (p) { return p.id; }));
    const mine = localIds instanceof Set ? localIds : localIds instanceof Map ? new Set(localIds.keys()) : new Set(Array.isArray(localIds) ? localIds : []);
    wellFormedPhotos(held, known).forEach(function (p) {
      if (mine.has(p.id) && !have.has(p.id) && out.length < PHOTO.LIST_MAX) { have.add(p.id); out.push(p); }
    });
    return out;
  }

  /* ---- the result screen (phases "submitted" and "checked") ---- */
  // Nothing from the server is trusted to have the promised shape: only own properties of plain objects are read.
  const isPlain = function (x) { return !!x && typeof x === 'object' && !Array.isArray(x); };
  function ownGet(obj, key) {
    const k = String(key);
    return isPlain(obj) && Object.prototype.hasOwnProperty.call(obj, k) ? obj[k] : undefined;
  }
  // A finite number clamped to lo..hi (rounded to a whole point); `fb` for anything else.
  function pointsOf(x, lo, hi, fb) {
    if (typeof x !== 'number' || !Number.isFinite(x)) return fb;
    return Math.max(lo, Math.min(hi, Math.round(x)));
  }
  const text = function (x, cut) { return typeof x === 'string' ? x.trim().slice(0, cut) : ''; };

  /* The test score ("Тестовый балл") of a full exam: only for a full exam, only for whole primary points in the range of
     the table the generator uses (0..33, the profile exam), and only when the answer is a number from 0 to 100.
     `fn` is the page's secondaryScore; null means "show no tile". */
  const SEC_MAX_PRIMARY = 33;
  function secondaryOf(full, pts, fn) {
    if (full !== true || typeof fn !== 'function' || !Number.isInteger(pts) || pts < 0 || pts > SEC_MAX_PRIMARY) return null;
    let r;
    try { r = fn(pts); } catch (e) { return null; }
    return typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 100 ? r : null;
  }

  /* Everything the result page shows, as plain data (the page escapes it): the tiles and one entry per task.
     `tasks` is wellFormedTasks(v.tasks).
     The tiles are the SERVER's numbers, the same as in the Telegram message and the teacher panel: p1/max1 and total
     {pts, max} are taken when they are whole numbers with 0 <= p1 <= max1 and 0 <= pts <= max (and the total covers part 1);
     part 2 is then total - part 1. Only when they are missing or invalid are the numbers summed locally the way
     ExamCore.total does it (a task without a known maximum counts for 1).
     The per-task label "N из M" is local: it is shown only when the local sums agree with the tiles (the page may have
     dropped tasks the server counts, or capped a maximum); otherwise the task says just "проверено", never a contradiction.
     Until the exam is checked part 2 has no points: state 'wait'. A short answer counts as right only when ok[n] is exactly
     true. state: 'ok' | 'part' | 'no' | 'wait'. Text fields are plain strings: the key's `a` of a short task is plain text,
     `answer` is teacher HTML of a long task and `sol` of a short one, both for the page's HTML gate; a long task never
     has a solution (part 1 only). */
  const whole = function (x) { return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1000; };
  function resultOf(v, tasks, opts) {
    v = isPlain(v) ? v : {};
    const checked = v.phase === 'checked', mxOf = function (t) { return t.max || 1; };
    const typed = answersOf(v.answers, tasks);
    let max1 = 0, max2 = 0, sum1 = 0, sum2 = 0, hasLong = false;
    const items = tasks.map(function (t) {
      const mx = mxOf(t), k = ownGet(v.key, t.n), key = isPlain(k) ? k : {};
      const a = typeof key.a === 'string' ? key.a : typeof key.a === 'number' && Number.isFinite(key.a) ? String(key.a) : '';
      if (t.kind === 'short') {
        const ok = ownGet(v.ok, t.n) === true;
        max1 += mx; if (ok) sum1 += mx;
        return { n: t.n, kind: 'short', max: mx, ok: ok, state: ok ? 'ok' : 'no', label: ok ? 'верно' : 'неверно',
          given: typeof typed[t.n] === 'string' ? typed[t.n].trim() : '', correct: a.trim().slice(0, 200), sol: text(key.sol, MAX_COND) };
      }
      hasLong = true; max2 += mx;
      const g = ownGet(v.part2, t.n), gg = isPlain(g) ? g : {};
      const pts = checked ? pointsOf(gg.pts, 0, mx, 0) : 0;
      sum2 += pts;
      return { n: t.n, kind: 'long', max: mx, pts: pts, state: !checked ? 'wait' : pts >= mx ? 'ok' : pts > 0 ? 'part' : 'no',
        label: checked ? pts + ' из ' + mx : 'на проверке', answer: a.trim() ? a : '', sol: '', comment: checked ? text(gg.comment, 5000) : '' };
    });
    // part 1: the server's pair when valid, else counted here
    const srvP1 = whole(v.p1) && whole(v.max1) && v.p1 <= v.max1;
    const p1 = srvP1 ? v.p1 : pointsOf(v.p1, 0, max1, Math.min(sum1, max1));
    if (srvP1) max1 = v.max1;
    let total = null, part2 = null;
    if (checked) {
      const t = ownGet(v, 'total'), srvT = isPlain(t) && whole(t.pts) && whole(t.max) && t.pts <= t.max && t.pts >= p1 && t.max - max1 >= t.pts - p1;
      if (srvT) { total = { pts: t.pts, max: t.max }; part2 = t.pts - p1; max2 = t.max - max1; }
      else { total = { pts: p1 + sum2, max: max1 + max2 }; part2 = sum2; }
      // the per-task numbers may not contradict the tiles
      if (srvT && (sum2 !== part2 || tasks.filter(function (x) { return x.kind === 'long'; }).reduce(function (m, x) { return m + mxOf(x); }, 0) !== max2)) {
        items.forEach(function (i) { if (i.kind === 'long') { i.label = 'проверено'; i.state = 'wait'; } });
      }
    }
    return { checked: checked, items: items, hasLong: hasLong, p1: p1, max1: max1, max2: max2, part2: part2, total: total,
      second: total ? secondaryOf(v.full, total.pts, opts && opts.secondary) : null };
  }

  const api = { mergePhotoLists: mergePhotoLists, ownGet: ownGet, pointsOf: pointsOf, secondaryOf: secondaryOf, resultOf: resultOf, canRetry: canRetry, fileRefusal: fileRefusal, pickerActive: pickerActive, dimsOk: dimsOk, wellFormedPhotos: wellFormedPhotos, photoSig: photoSig, photoRoom: photoRoom, pollDelay: pollDelay, uploadRetryDelay: uploadRetryDelay, uploadVerdict: uploadVerdict, PHOTO: PHOTO,
    classifyStatus: classifyStatus, detachedDelay: detachedDelay, unsentOf: unsentOf, pickToken: pickToken, mergePending: mergePending, wellFormedTasks: wellFormedTasks, answersOf: answersOf, retryDelay: retryDelay, MAX_COND: MAX_COND, clampDelay: clampDelay, refreshDelay: refreshDelay, nextChangeAt: nextChangeAt, MAX_DELAY: MAX_DELAY, whenText: whenText, offsetOf: offsetOf, leftSec: leftSec, fmtLeft: fmtLeft, fitSize: fitSize,
    AwayTracker: AwayTracker, SaveQueue: SaveQueue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamClientCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
