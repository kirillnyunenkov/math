/* Teacher-panel numbers — pure functions over one student's journal
   (node: require, browser: window.StatsCore; needs SyncCore).

   cfg describes the task bank so this file stays independent of config.js:
     protoOf(n, pid) -> prototype number, or null for tasks without prototypes
     reps(n)         -> representative ids (one per prototype), or null
     count(n)        -> number of problems in task n
   Imports (progress made before login) have no real time, so they count for
   the current state but not for activity. */
(function (root) {
  'use strict';
  const Sync = root.SyncCore || require('./sync-core.js');
  const DAY = 86400000, MSK = 3 * 3600000;
  const real = e => e.kind === 'mark' && e.source !== 'import';
  const mskDay = ts => new Date(ts + MSK).toISOString().slice(0, 10);

  function studentSummary(events, variants, clears, now, cfg) {
    const state = Sync.applyEvents({}, Sync.newStamps(), events).state;
    const marks = events.filter(real);

    const byTask = {};
    for (let n = 1; n <= 20; n++) {
      const ts = state[n] || {}, reps = cfg.reps(n);
      const vals = reps ? reps.map(id => ts[id]) : Object.values(ts);
      byTask[n] = { g: 0, o: 0, b: 0, total: reps ? reps.length : cfg.count(n) };
      for (const v of vals) if (v) byTask[n][v]++;
    }

    const vs = Sync.mergeVariants([], variants, clears);
    let lastActive = null;
    for (const e of marks) if (lastActive === null || e.ts > lastActive) lastActive = e.ts;
    for (const v of vs) if (lastActive === null || v.t > lastActive) lastActive = v.t;

    const solved = new Set();
    for (const e of marks) {
      if (e.ts >= now - 7 * DAY && (e.status === 'g' || e.status === 'o')) solved.add(e.n + '/' + e.pid);
    }

    const perDay = {};
    for (const e of marks) { const d = mskDay(e.ts); perDay[d] = (perDay[d] || 0) + 1; }
    const activity = [];
    for (let i = 29; i >= 0; i--) { const d = mskDay(now - i * DAY); activity.push({ day: d, count: perDay[d] || 0 }); }

    const wrong = marks.filter(e => e.status === 'b' && e.source === 'check')
      .sort((a, b) => b.ts - a.ts).slice(0, 50)
      .map(e => ({ ts: e.ts, n: e.n, pid: e.pid, given: e.given }));

    return { lastActive, solved7d: solved.size, byTask, activity, variants: vs, wrong };
  }

  // Where the student makes mistakes: wrong marks per prototype (per problem
  // for tasks without prototypes), worst first.
  function problemPrototypes(events, cfg) {
    const by = new Map();
    for (const e of events.filter(real)) {
      const proto = cfg.protoOf(e.n, e.pid);
      const key = e.n + '/' + (proto === null ? 'id' + e.pid : proto);
      let g = by.get(key);
      if (!g) {
        g = proto === null ? { n: e.n, proto: null, pid: e.pid, wrong: 0, attempts: 0 } : { n: e.n, proto, wrong: 0, attempts: 0 };
        by.set(key, g);
      }
      g.attempts++;
      if (e.status === 'b') g.wrong++;
    }
    return [...by.values()].filter(g => g.wrong > 0)
      .sort((a, b) => b.wrong - a.wrong || b.wrong / b.attempts - a.wrong / a.attempts || a.n - b.n);
  }

  const api = { studentSummary, problemPrototypes, mskDay };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StatsCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
