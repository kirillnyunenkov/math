import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../exam-core.js');

const base = { start: 1000, duration: 100, opened: 0, finished: 0, photos_done: 0, checked: 0 };
const a = (o) => Object.assign({}, base, o);

test('before the start it is scheduled, whatever else is set', () => {
  assert.equal(C.phase(a({}), 999), 'scheduled');
});

test('never opened: open during the window, missed after it', () => {
  assert.equal(C.phase(a({}), 1000), 'open');
  assert.equal(C.phase(a({}), 1099), 'open');
  assert.equal(C.phase(a({}), 1100), 'missed');
  assert.equal(C.phase(a({}), 99999), 'missed');
});

test('opened and not finished: open until end, then 600 s of photos, then submitted', () => {
  const x = a({ opened: 1005 });
  assert.equal(C.phase(x, 1099), 'open');
  assert.equal(C.phase(x, 1100), 'photos');
  assert.equal(C.phase(x, 1699), 'photos');
  assert.equal(C.phase(x, 1700), 'submitted');
});

test('early finish starts the photo phase from the finish time', () => {
  const x = a({ opened: 1005, finished: 1040 });
  assert.equal(C.phase(x, 1040), 'photos');
  assert.equal(C.phase(x, 1639), 'photos');
  assert.equal(C.phase(x, 1640), 'submitted');
  assert.deepEqual(C.times(x), { end: 1100, stop: 1040, photoUntil: 1640 });
});

test('"done" ends the photo phase at once', () => {
  assert.equal(C.phase(a({ opened: 1005, finished: 1040, photos_done: 1050 }), 1051), 'submitted');
  assert.equal(C.phase(a({ opened: 1005, photos_done: 1110 }), 1111), 'submitted');
});

test('checked wins over everything after the start', () => {
  assert.equal(C.phase(a({ opened: 1005, checked: 5000 }), 5001), 'checked');
});

test('total adds part 1 and the teacher points, capped by each task max', () => {
  const tasks = [{ n: 1, kind: 'short', max: 1 }, { n: 2, kind: 'short', max: 1 },
    { n: 13, kind: 'long', max: 2 }, { n: 14, kind: 'long', max: 3 }];
  assert.deepEqual(C.total(tasks, 1, { 13: { pts: 2 }, 14: { pts: 9 } }), { pts: 6, max: 7 });
  assert.deepEqual(C.total(tasks, 2, null), { pts: 2, max: 7 });
});
