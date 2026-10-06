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

  const api = { clampDelay: clampDelay, refreshDelay: refreshDelay, MAX_DELAY: MAX_DELAY, whenText: whenText, offsetOf: offsetOf, leftSec: leftSec, fmtLeft: fmtLeft, fitSize: fitSize,
    AwayTracker: AwayTracker, SaveQueue: SaveQueue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamClientCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
