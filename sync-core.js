/* Progress journal merge — pure functions shared by the trainer, the teacher
   panel and the tests (node: require, browser: window.SyncCore).

   The trainer's `state` ({n: {pid: 'g'|'o'|'b'}}) is a fold of an append-only
   event journal. Events come from several devices in any order, so the fold
   is defined by timestamps, not by arrival:
   - a problem shows the status of its newest mark (ties: larger uid wins);
   - the mark is void if a reset covering it (its task, or n=0 = all) is newer.
   `stamps` remembers the newest mark per problem and the newest reset per
   scope, which is what makes late or duplicate events harmless. */
(function (root) {
  'use strict';

  function uid() {
    const a = new Uint8Array(16);
    (root.crypto || require('node:crypto').webcrypto).getRandomValues(a);
    let s = '';
    for (const b of a) s += (b % 36).toString(36);
    return s;
  }

  const newStamps = () => ({ m: {}, r: {} });

  // Journal numbers are stable across bank renumbering. 21 identifies the
  // restored derivative bank; 6 and 13 are retained as hidden historical topics.
  function fromWire(n) {
    n = +n;
    if (n === 0) return 0;
    if (n === 6) return 26;
    if (n === 13) return 33;
    if (n === 21) return 12;
    if (n >= 7 && n <= 20) return n - 1;
    return n;
  }
  function toWire(n) {
    n = +n;
    if (n === 26) return 6;
    if (n === 33) return 13;
    if (n === 12) return 21;
    if ((n >= 6 && n <= 11) || (n >= 13 && n <= 19)) return n + 1;
    return n;
  }
  function stateFromWire(state) {
    const result = {};
    for (const n in state || {}) result[fromWire(n)] = state[n];
    return result;
  }
  function stampsFromWire(stamps) {
    const result = newStamps();
    for (const key in (stamps || {}).m || {}) {
      const [n, pid] = key.split('/');
      result.m[fromWire(n) + '/' + pid] = stamps.m[key];
    }
    for (const n in (stamps || {}).r || {}) result.r[+n === 0 ? 40 : fromWire(n)] = stamps.r[n];
    return result;
  }
  function eventsFromWire(events) {
    return (events || []).map(e => Object.assign({}, e, {
      n: e.kind === 'reset' && +e.n === 0 ? 40 : fromWire(e.n)
    }));
  }
  function eventsToWire(e) {
    if (e.kind === 'reset' && +e.n === 0) {
      // Old clients understand the first reset; the second also resets the
      // restored derivative bank. Distinct uids make both events durable.
      return [Object.assign({}, e), Object.assign({}, e, { uid: uid(), n: 21 })];
    }
    return [Object.assign({}, e, { n: toWire(e.n) })];
  }

  function markEvent(n, pid, status, o) {
    o = o || {};
    return { uid: o.uid || uid(), ts: o.ts || Date.now(), kind: 'mark', n: +n, pid: +pid,
      status: status || '', source: o.source || 'manual', given: o.given || '', device: o.device || '' };
  }

  function resetEvent(n, o) {
    o = o || {};
    return { uid: o.uid || uid(), ts: o.ts || Date.now(), kind: 'reset', n: +n, device: o.device || '' };
  }

  const newer = (a, b) => !b || a.ts > b.ts || (a.ts === b.ts && a.uid > b.uid);

  // Status of one problem from stamps; `legacy` is the current status of a
  // problem that has no mark in the journal (progress made before login).
  function statusOf(stamps, n, pid, legacy) {
    const m = stamps.m[n + '/' + pid];
    const r = Math.max(stamps.r[n] || -Infinity, stamps.r[0] || -Infinity,
      +n === 12 ? -Infinity : (stamps.r[40] || -Infinity));
    if (!m) return r === -Infinity ? legacy : '';
    return m.ts > r ? m.s : '';
  }

  function applyEvents(state, stamps, events) {
    const st = { m: Object.assign({}, stamps.m), r: Object.assign({}, stamps.r) };
    const touched = new Set();   // "n/pid" keys and "n/*" (task) / "*" (all)
    for (const e of events) {
      if (e.kind === 'mark') {
        const k = e.n + '/' + e.pid;
        if (newer(e, st.m[k])) { st.m[k] = { ts: e.ts, uid: e.uid, s: e.status || '' }; touched.add(k); }
      } else if (e.kind === 'reset') {
        if (!(st.r[e.n] >= e.ts)) { st.r[e.n] = e.ts; touched.add(e.n === 0 || e.n === 40 ? '*' : e.n + '/*'); }
      }
    }
    if (!touched.size) return { state, stamps, changed: false };

    // Every problem that could be affected: present in state or in stamps.
    const keys = new Set();
    for (const n in state) for (const pid in state[n]) keys.add(n + '/' + pid);
    for (const k in st.m) keys.add(k);
    const out = {};
    let changed = false;
    for (const k of keys) {
      const [n, pid] = k.split('/');
      const cur = (state[n] || {})[pid] || '';
      const hit = touched.has('*') || touched.has(n + '/*') || touched.has(k);
      const s = hit ? statusOf(st, n, pid, cur) : cur;
      if (s !== cur) changed = true;
      if (s) (out[n] || (out[n] = {}))[pid] = s;
    }
    return { state: out, stamps: st, changed };
  }

  // Deliberate replace (progress loaded from a share link): reset-all just
  // before, then the loaded marks.
  function snapshotEvents(state, o) {
    const ts = o.ts || Date.now(), device = o.device || '';
    const evs = [resetEvent(0, { ts: ts - 1, device })];
    for (const n in state) for (const pid in state[n]) {
      if (state[n][pid]) evs.push(markEvent(n, pid, state[n][pid], { ts, device, source: 'import' }));
    }
    return evs;
  }

  // First login on a device: marks made before login have no history, so
  // they get the oldest possible time — they fill gaps in the journal but
  // never beat a real mark or survive a real reset.
  function importEvents(state, o) {
    const device = (o || {}).device || '', evs = [];
    for (const n in state) for (const pid in state[n]) {
      if (state[n][pid]) evs.push(markEvent(n, pid, state[n][pid], { ts: 1, device, source: 'import' }));
    }
    return evs;
  }

  // Mock-exam history: union by uid (legacy records without uid: by t),
  // minus records older than the newest clear and records the teacher deleted
  // (uids), oldest first, last 50.
  function mergeVariants(local, incoming, clears, deleted) {
    const cut = Math.max(-Infinity, ...(clears || []).map(c => c.ts));
    const gone = new Set(deleted || []);
    const by = new Map();
    for (const v of [...(local || []), ...(incoming || [])]) by.set(v.uid || 't' + v.t, v);
    return [...by.values()].filter(v => v.t >= cut && !gone.has(v.uid)).sort((a, b) => a.t - b.t).slice(-50);
  }

  const api = { uid, newStamps, markEvent, resetEvent, applyEvents, snapshotEvents, importEvents, mergeVariants, statusOf,
    fromWire, toWire, stateFromWire, stampsFromWire, eventsFromWire, eventsToWire };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SyncCore = api;
})(typeof self !== 'undefined' ? self : globalThis);
