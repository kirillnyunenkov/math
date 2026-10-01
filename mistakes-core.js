/* «Работа над ошибками» — pure functions over the trainer's `state`
   ({n: {pid: 'g'|'o'|'b'}}) (node: require, browser: window.MistakesCore).

   A mistake is a prototype with at least one red ('b') problem. The student
   practises another problem of the same prototype; once that one is solved,
   the red ones turn yellow and the prototype leaves the list.

   cfg keeps this file independent of config.js:
     groupOf(n, pid) -> ids of the prototype containing pid, or null for
                        tasks without prototypes (the problem is its own group) */
(function (root) {
  'use strict';

  function groups(state, cfg) {
    const by = new Map();
    for (const n of Object.keys(state).map(Number).sort((a, b) => a - b)) {
      const ts = state[n] || {};
      for (const pid of Object.keys(ts).map(Number).sort((a, b) => a - b)) {
        if (ts[pid] !== 'b') continue;
        const ids = cfg.groupOf(n, pid) || [pid], key = n + '/' + ids[0];
        if (!by.has(key)) by.set(key, { n, ids, red: [] });
        by.get(key).red.push(pid);
      }
    }
    return [...by.values()].sort((a, b) => a.n - b.n || a.ids[0] - b.ids[0]);
  }

  // Up to `limit` problems to practise, one per group. Prefers a problem the
  // student has not touched, then any non-red one, then a red one.
  function pick(groups, state, limit, rnd) {
    rnd = rnd || Math.random;
    const any = a => a[Math.floor(rnd() * a.length)];
    const pool = groups.slice();
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, limit).map(g => {
      const ts = state[g.n] || {}, other = g.ids.filter(id => ts[id] !== 'b');
      const fresh = other.filter(id => !ts[id]);
      return { n: g.n, id: any(fresh.length ? fresh : other.length ? other : g.red), fix: g.red };
    }).sort((a, b) => a.n - b.n || a.id - b.id);
  }

  // Originals to turn yellow: the practised problem is solved ('g' or 'o')
  // and they are still red.
  function closed(state, item) {
    const ts = state[item.n] || {}, s = ts[item.id];
    if (s !== 'g' && s !== 'o') return [];
    return item.fix.filter(id => ts[id] === 'b');
  }

  const api = { groups, pick, closed };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MistakesCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
