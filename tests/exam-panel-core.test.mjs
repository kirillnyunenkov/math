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
