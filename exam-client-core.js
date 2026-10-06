/* Assigned mock exams, trainer side — pure helpers shared with the tests
   (node: require, browser: window.ExamClientCore). No DOM here. */
(function (root) {
  'use strict';

  const DAYS = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
  const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

  // "в пятницу, 9 октября, в 18:00" — Moscow time is UTC+3 all year round.
  function whenText(ts) {
    const d = new Date((ts + 10800) * 1000), m = d.getUTCMinutes();
    return DAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ', в ' + d.getUTCHours() + ':' + (m < 10 ? '0' : '') + m;
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

  const api = { whenText: whenText, offsetOf: offsetOf, leftSec: leftSec, fmtLeft: fmtLeft, fitSize: fitSize,
    AwayTracker: AwayTracker, SaveQueue: SaveQueue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ExamClientCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
