// Teacher-panel numbers computed from a student's journal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const S = require('../sync-core.js');
const T = require('../stats-core.js');

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);       // 10 Oct 2026, 15:00 MSK
let k = 0;
const mark = (n, pid, status, ts, extra = {}) =>
  S.markEvent(n, pid, status, { ts, uid: 'e' + (k++), device: 'd', ...extra });
// task 1: prototypes 1 = ids 1-3, 2 = ids 4-6; task 2: no prototypes, 10 problems
const cfg = {
  protoOf: (n, pid) => n === 1 ? (pid <= 3 ? 1 : 2) : null,
  reps: n => n === 1 ? [1, 4] : null,
  count: n => n === 1 ? 6 : n === 2 ? 10 : 0,
};

test('byTask counts statuses, prototype tasks by representative only', () => {
  const evs = [mark(1, 1, 'g', NOW - DAY), mark(1, 2, 'b', NOW - DAY), mark(1, 4, 'b', NOW - DAY),
    mark(2, 3, 'o', NOW - DAY), mark(2, 5, 'g', NOW - DAY)];
  const s = T.studentSummary(evs, [], [], NOW, cfg);
  assert.deepEqual(s.byTask[1], { g: 1, o: 0, b: 1, total: 2 });
  assert.deepEqual(s.byTask[2], { g: 1, o: 1, b: 0, total: 10 });
  assert.equal(s.byTask[3].total, 0);
});

test('lastActive and solved7d ignore imports and old marks', () => {
  const evs = [mark(2, 1, 'g', NOW - 2 * DAY), mark(2, 1, 'g', NOW - DAY), mark(2, 2, 'o', NOW - 3 * DAY),
    mark(2, 3, 'g', NOW - 9 * DAY), mark(2, 4, 'b', NOW - DAY), mark(2, 5, 'g', NOW - 1000, { source: 'import' })];
  const s = T.studentSummary(evs, [], [], NOW, cfg);
  assert.equal(s.solved7d, 2);                       // 2/1 and 2/2; not 2/3 (old), 2/4 (wrong), 2/5 (import)
  assert.equal(s.lastActive, NOW - DAY);
});

test('lastActive counts finished mock exams; null when nothing happened', () => {
  assert.equal(T.studentSummary([], [{ uid: 'v', t: NOW - 5 }], [], NOW, cfg).lastActive, NOW - 5);
  assert.equal(T.studentSummary([mark(2, 1, 'g', 1, { source: 'import' })], [], [], NOW, cfg).lastActive, null);
});

test('activity: 30 Moscow days, oldest first, counts non-import marks', () => {
  const msk21 = Date.UTC(2026, 9, 9, 21, 30);        // 10 Oct 00:30 MSK
  const evs = [mark(2, 1, 'g', msk21), mark(2, 2, 'b', NOW), mark(2, 3, 'g', NOW - DAY),
    mark(2, 4, 'g', NOW, { source: 'import' })];
  const a = T.studentSummary(evs, [], [], NOW, cfg).activity;
  assert.equal(a.length, 30);
  assert.deepEqual(a.at(-1), { day: '2026-10-10', count: 2 });
  assert.deepEqual(a.at(-2), { day: '2026-10-09', count: 1 });
  assert.equal(a[0].day, '2026-09-11');
});

test('wrong feed: checked wrong answers, newest first, capped', () => {
  const evs = [mark(2, 1, 'b', NOW - 3, { source: 'check', given: '5' }),
    mark(2, 2, 'b', NOW - 1, { source: 'check', given: '7' }),
    mark(2, 3, 'b', NOW - 2, { source: 'manual' }),
    mark(2, 4, 'g', NOW, { source: 'check', given: '1' })];
  const w = T.studentSummary(evs, [], [], NOW, cfg).wrong;
  assert.deepEqual(w.map(x => x.given), ['7', '5']);
  assert.deepEqual(Object.keys(w[0]).sort(), ['given', 'n', 'pid', 'ts']);
  const many = Array.from({ length: 80 }, (_, i) => mark(2, i, 'b', i, { source: 'check', given: 'x' }));
  assert.equal(T.studentSummary(many, [], [], NOW, cfg).wrong.length, 50);
});

test('variants: merged, cleared, oldest first', () => {
  const vs = [{ uid: 'a', t: 1, p: 5 }, { uid: 'b', t: 3, p: 9 }, { uid: 'c', t: 2, p: 7 }];
  assert.deepEqual(T.studentSummary([], vs, [], NOW, cfg).variants.map(v => v.p), [5, 7, 9]);
  assert.deepEqual(T.studentSummary([], vs, [{ ts: 2 }], NOW, cfg).variants.map(v => v.p), [7, 9]);
});

test('problem prototypes: wrong attempts grouped, worst first', () => {
  const evs = [mark(1, 1, 'b', 1), mark(1, 2, 'b', 2), mark(1, 3, 'g', 3),
    mark(1, 5, 'b', 4), mark(1, 5, 'g', 5), mark(1, 6, 'g', 6),
    mark(2, 7, 'b', 7), mark(2, 8, 'b', 8, { source: 'import' })];
  assert.deepEqual(T.problemPrototypes(evs, cfg), [
    { n: 1, proto: 1, wrong: 2, attempts: 3 },
    { n: 2, proto: null, pid: 7, wrong: 1, attempts: 1 },   // same wrong count, worse ratio
    { n: 1, proto: 2, wrong: 1, attempts: 3 },
  ]);
});
