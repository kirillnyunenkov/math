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

  const offsetOf = (serverNowSec, clientNowMs) => serverNowSec * 1000 - clientNowMs;

  function leftSec(untilSec, offsetMs, clientNowMs) {
    return Math.max(0, Math.ceil((untilSec * 1000 - (clientNowMs + offsetMs)) / 1000));
  }

  function fmtLeft(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = (x) => String(x).padStart(2, '0');
    return h ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  }

  function fitSize(w, h, max) {
    const k = Math.min(1, max / Math.max(w, h));
    return { w: Math.round(w * k), h: Math.round(h * k) };
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
     sane size; max a small integer (0 = unknown: the page leaves the label out). Returns fresh plain objects. */
  const MAX_COND = 3000000;
  function wellFormedTasks(list) {
    const out = [], seen = {};
    if (!Array.isArray(list)) return out;
    list.forEach(function (t) {
      if (!t || typeof t !== 'object') return;
      const n = t.n;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 40 || seen[n]) return;
      if (t.kind !== 'short' && t.kind !== 'long') return;
      if (typeof t.cond !== 'string' || t.cond.length > MAX_COND) return;
      const m = typeof t.max === 'number' && Number.isFinite(t.max) && t.max >= 1 ? Math.min(10, Math.round(t.max)) : 0;
      seen[n] = true;
      out.push({ n: n, kind: t.kind, max: m, cond: t.cond });
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

  const api = { wellFormedTasks: wellFormedTasks, answersOf: answersOf, retryDelay: retryDelay, MAX_COND: MAX_COND, clampDelay: clampDelay, refreshDelay: refreshDelay, MAX_DELAY: MAX_DELAY, whenText: whenText, offsetOf: offsetOf, leftSec: leftSec, fmtLeft: fmtLeft, fitSize: fitSize,
    AwayTracker: AwayTracker, SaveQueue: SaveQueue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamClientCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
