import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const P = createRequire(import.meta.url)('../exam-panel-core.js');

test('a datetime-local value is read as Moscow time, whatever the machine zone is', () => {
  assert.equal(P.moscowInputToTs('2026-10-09T18:00'), 1791558000);          // 15:00 UTC
  assert.equal(P.moscowInputToTs('2026-10-10T00:05'), 1791579900);
  assert.equal(P.moscowInputToTs('garbage'), null);
  assert.equal(P.moscowInputToTs(''), null);
});

test('tsToMoscowInput is the inverse', () => {
  assert.equal(P.tsToMoscowInput(1791558000), '2026-10-09T18:00');
  assert.equal(P.tsToMoscowInput(1791579900), '2026-10-10T00:05');
  assert.equal(P.moscowInputToTs(P.tsToMoscowInput(1798750800)), 1798750800);
});

test('activitySummary counts away intervals and answer changes relative to the start', () => {
  const start = 1000;
  const log = [[1060, 'a', '1', '5'], [1100, 'w', '1', 30], [1500, 'a', '2', '0,6'], [1520, 'a', '2', '0,5'],
    [2000, 'w', '3', 200], [2100, 'a', '1', '6']];
  const s = P.activitySummary(log, start);
  assert.deepEqual(s.away, { count: 2, totalSec: 230, longest: { sec: 200, n: '3' } });
  assert.deepEqual(s.tasks['1'], { changes: 2, firstSec: 60, lastSec: 1100 });
  assert.deepEqual(s.tasks['2'], { changes: 2, firstSec: 500, lastSec: 520 });
});

test('activitySummary copes with an empty or missing log', () => {
  assert.deepEqual(P.activitySummary(null, 0), { away: { count: 0, totalSec: 0, longest: null }, tasks: {} });
  assert.deepEqual(P.activitySummary([], 0).tasks, {});
});

test('fmtSec', () => {
  assert.equal(P.fmtSec(65), '1:05');
  assert.equal(P.fmtSec(3725), '1:02:05');
  assert.equal(P.fmtSec(0), '0:00');
});

test('every phase the server can return has a label', () => {
  for (const p of ['scheduled', 'open', 'photos', 'submitted', 'checked', 'missed']) assert.ok(P.PHASE_TEXT[p], p);
});

test('activitySummary tolerates malformed entries and non-array logs', () => {
  const log = [null, 5, 'x', [1,'w','2',30], [2,'a','1','5'], [3,'a',null,'x'], [4,'w','1','30'], [5,'w','1',null], [6,'zzz','1',1]];
  const s = P.activitySummary(log, 0);
  assert.deepEqual(s.away, { count: 1, totalSec: 30, longest: { sec: 30, n: '2' } });
  assert.deepEqual(s.tasks['1'], { changes: 1, firstSec: 2, lastSec: 2 });
  assert.equal(Object.keys(s.tasks).length, 1);
});

test('activitySummary returns empty summary for non-array logs', () => {
  const empty = { away: { count: 0, totalSec: 0, longest: null }, tasks: {} };
  assert.deepEqual(P.activitySummary({}, 0), empty);
  assert.deepEqual(P.activitySummary('abc', 0), empty);
  assert.deepEqual(P.activitySummary(42, 0), empty);
});

test('fmtSec coerces and sanitizes input', () => {
  assert.equal(P.fmtSec(NaN), '0:00');
  assert.equal(P.fmtSec(-5), '0:00');
  assert.equal(P.fmtSec(undefined), '0:00');
  assert.equal(P.fmtSec(65.9), '1:05');
});

test('activitySummary does not touch Object.prototype for a hostile task key', () => {
  const s = P.activitySummary([[5, 'a', '__proto__', 'x'], [6, 'a', '__proto__', 'y'], [7, 'a', 'constructor', 'z']], 0);
  try {
    assert.equal(({}).changes, undefined);
    assert.equal(({}).firstSec, undefined);
    assert.equal(s.tasks.constructor.changes, 1);
  } finally { delete Object.prototype.changes; delete Object.prototype.firstSec; delete Object.prototype.lastSec; }
});

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };

test('draft: written, read back, removed', () => {
  const s = mem(), k = P.draftKey('abc');
  assert.equal(k, 'ck-draft:abc');
  P.writeDraft(s, k, { pts: { 13: 2 }, note: { 13: 'Не хватает обоснования' } });
  assert.deepEqual(P.readDraft(s, k), { pts: { 13: 2 }, note: { 13: 'Не хватает обоснования' } });
  P.writeDraft(s, k, null);
  assert.equal(P.readDraft(s, k), null);
});

test('draft: garbage in storage is dropped, never thrown on', () => {
  const s = mem(), k = P.draftKey('x');
  s.setItem(k, '{"pts":{"13":"2","__proto__":5,"99999":1,"14":-1,"15":101,"16":1.5},"note":{"13":7,"14":"ok"}}');
  assert.deepEqual(P.readDraft(s, k), { pts: {}, note: { 14: 'ok' } });
  s.setItem(k, 'not json');
  assert.equal(P.readDraft(s, k), null);
  assert.equal(P.readDraft({ getItem() { throw new Error('blocked'); } }, k), null);
  assert.doesNotThrow(() => P.writeDraft({ setItem() { throw new Error('full'); }, removeItem() {} }, k, { pts: { 1: 1 }, note: {} }));
});

test('draft: the general comment alone is a draft, and differs from the server only when changed', () => {
  const s = mem(), k = P.draftKey('g');
  P.writeDraft(s, k, { pts: {}, note: {}, general: 'Молодец' });
  assert.deepEqual(P.readDraft(s, k), { pts: {}, note: {}, general: 'Молодец' });
  assert.equal(P.draftDiffers(P.readDraft(s, k), { _general: 'Молодец' }), false);
  assert.equal(P.draftDiffers(P.readDraft(s, k), {}), true);
  P.writeDraft(s, k, { pts: {}, note: {}, general: '' });
  assert.equal(P.readDraft(s, k), null);
});

test('draftDiffers: equal to the server is not a draft', () => {
  const server = { 13: { pts: 2, comment: 'a' } };
  assert.equal(P.draftDiffers({ pts: { 13: 2 }, note: { 13: 'a' } }, server), false);
  assert.equal(P.draftDiffers({ pts: { 13: 3 }, note: { 13: 'a' } }, server), true);
  assert.equal(P.draftDiffers({ pts: {}, note: { 13: 'b' } }, server), true);
  assert.equal(P.draftDiffers({ pts: { 14: 0 }, note: {} }, {}), false);   // nothing saved yet: 0 points and empty text is the blank form
  assert.equal(P.draftDiffers(null, server), false);
});

const D = (s) => P.moscowInputToTs(s + 'T12:00');   // noon Moscow, seconds

test('mockReminders: one month after the last assigned mock, reminded a week ahead', () => {
  const stu = [{ id: 'a', since: D('2026-01-01') }];
  const asg = [{ user: 'a', start: D('2026-09-10') }, { user: 'a', start: D('2026-08-10') }];
  // due 2026-10-10; the reminder opens on 2026-10-03
  assert.deepEqual(P.mockReminders(stu, asg, D('2026-10-02')), []);
  const r = P.mockReminders(stu, asg, D('2026-10-03'));
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { id: 'a', last: D('2026-09-10'), due: D('2026-10-10'), days: 7 });
  assert.equal(P.mockReminders(stu, asg, D('2026-10-14'))[0].days, -4);   // overdue by 4 days
});

test('mockReminders: a mock assigned ahead of time (future start) counts and silences the reminder', () => {
  const stu = [{ id: 'a', since: D('2026-01-01') }];
  assert.deepEqual(P.mockReminders(stu, [{ user: 'a', start: D('2026-10-20') }], D('2026-10-10')), []);
});

test('mockReminders: a student with no mock yet is listed at once, before everyone else', () => {
  const stu = [{ id: 'a' }, { id: 'new' }];
  const r = P.mockReminders(stu, [{ user: 'a', start: D('2026-09-10') }, { user: 'a', start: D('2026-09-01') }], D('2026-10-05'));
  assert.deepEqual(r.map((x) => x.id), ['new', 'a']);
  assert.deepEqual(r[0], { id: 'new', last: null, due: null, days: null });
});

test('mockReminders: month arithmetic clamps to the end of a short month', () => {
  const stu = [{ id: 'a', since: 0 }];
  const r = P.mockReminders(stu, [{ user: 'a', start: D('2026-01-31') }], D('2026-02-21'));
  assert.equal(r[0].due, D('2026-02-28'));
});
