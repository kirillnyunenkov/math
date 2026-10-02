// Merge rules of the progress journal: the result must not depend on the
// order in which events from different devices arrive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../sync-core.js');

const mark = (n, pid, status, ts, uid = `m${n}-${pid}-${ts}`) => S.markEvent(n, pid, status, { ts, uid, device: 'd' });
const reset = (n, ts, uid = `r${n}-${ts}`) => S.resetEvent(n, { ts, uid, device: 'd' });
const run = evs => S.applyEvents({}, S.newStamps(), evs);

test('empty tasks are dropped from the state', () => {
  assert.deepEqual(S.applyEvents({ 3: {} }, S.newStamps(), [reset(0, 5)]).state, {});
});

test('single mark sets status', () => {
  const r = run([mark(3, 5, 'g', 10)]);
  assert.deepEqual(r.state, { 3: { 5: 'g' } });
  assert.equal(r.changed, true);
});

test('newest mark wins in any arrival order', () => {
  const a = mark(3, 5, 'b', 10), b = mark(3, 5, 'g', 20);
  assert.deepEqual(run([a, b]).state, { 3: { 5: 'g' } });
  assert.deepEqual(run([b, a]).state, { 3: { 5: 'g' } });
});

test('empty status clears a problem', () => {
  assert.deepEqual(run([mark(3, 5, 'g', 10), mark(3, 5, '', 20)]).state, {});
});

test('task reset clears older marks of that task only', () => {
  const evs = [mark(3, 5, 'g', 10), mark(4, 1, 'b', 10), reset(3, 15), mark(3, 6, 'o', 20)];
  const want = { 3: { 6: 'o' }, 4: { 1: 'b' } };
  assert.deepEqual(run(evs).state, want);
  assert.deepEqual(run(evs.slice().reverse()).state, want);
});

test('reset-all clears everything older, keeps newer', () => {
  const evs = [mark(3, 5, 'g', 10), mark(7, 2, 'b', 30), reset(0, 20)];
  assert.deepEqual(run(evs).state, { 7: { 2: 'b' } });
  assert.deepEqual(run([evs[2], evs[1], evs[0]]).state, { 7: { 2: 'b' } });
});

test('late older reset does not resurrect or clear newer marks', () => {
  const first = run([mark(3, 5, 'g', 30)]);
  const r = S.applyEvents(first.state, first.stamps, [reset(3, 20)]);
  assert.deepEqual(r.state, { 3: { 5: 'g' } });
  assert.equal(r.changed, false);
});

test('late older mark after a reset stays cleared', () => {
  const first = run([reset(3, 20)]);
  const r = S.applyEvents(first.state, first.stamps, [mark(3, 5, 'g', 10)]);
  assert.deepEqual(r.state[3] || {}, {});
});

test('duplicates are idempotent and report no change', () => {
  const e = mark(3, 5, 'g', 10);
  const first = run([e]);
  const again = S.applyEvents(first.state, first.stamps, [e]);
  assert.equal(again.changed, false);
  assert.deepEqual(again.state, first.state);
});

test('equal timestamps break ties by uid deterministically', () => {
  const a = mark(3, 5, 'b', 10, 'aaa'), b = mark(3, 5, 'g', 10, 'bbb');
  assert.deepEqual(run([a, b]).state, run([b, a]).state);
  assert.equal(run([a, b]).state[3][5], 'g');
});

test('applyEvents does not mutate its inputs', () => {
  const state = { 3: { 5: 'g' } }, stamps = S.newStamps();
  S.applyEvents(state, stamps, [reset(0, 99)]);
  assert.deepEqual(state, { 3: { 5: 'g' } });
  assert.deepEqual(stamps, S.newStamps());
});

test('snapshot reproduces the state on an empty device', () => {
  const state = { 1: { 2: 'g', 3: 'b' }, 14: { 7: 'o' }, 5: {} };
  const evs = S.snapshotEvents(state, { ts: 50, device: 'd' });
  assert.equal(evs[0].kind, 'reset');
  assert.ok(evs.slice(1).every(e => e.source === 'import' && e.ts === 50));
  assert.deepEqual(run(evs).state, { 1: { 2: 'g', 3: 'b' }, 14: { 7: 'o' } });
});

test('snapshot overrides older marks but not newer ones', () => {
  const snap = S.snapshotEvents({ 1: { 2: 'g' } }, { ts: 50, device: 'd' });
  const r = run([mark(1, 9, 'b', 40), mark(1, 3, 'o', 60), ...snap]);
  assert.deepEqual(r.state, { 1: { 2: 'g', 3: 'o' } });
});

test('mergeVariants: union by uid, sorted, clears, cap 50', () => {
  const v = (uid, t) => ({ uid, t, p: 1 });
  const m = S.mergeVariants([v('a', 1), v('b', 3)], [v('b', 3), v('c', 2)], []);
  assert.deepEqual(m.map(x => x.uid), ['a', 'c', 'b']);
  assert.deepEqual(S.mergeVariants(m, [], [{ ts: 2 }]).map(x => x.uid), ['c', 'b']);
  const many = Array.from({ length: 60 }, (_, i) => v('u' + i, i));
  const capped = S.mergeVariants(many, [], []);
  assert.equal(capped.length, 50);
  assert.equal(capped[0].uid, 'u10');
});

test('mergeVariants keeps legacy records without uid, keyed by t', () => {
  const m = S.mergeVariants([{ t: 5, p: 1 }], [{ t: 5, p: 1 }], []);
  assert.equal(m.length, 1);
});

test('mergeVariants drops records the teacher deleted', () => {
  const v = (uid, t) => ({ uid, t, p: 1 });
  const m = S.mergeVariants([v('a', 1), v('b', 2)], [v('c', 3)], [], ['b', 'zz']);
  assert.deepEqual(m.map(x => x.uid), ['a', 'c']);
  assert.equal(S.mergeVariants([{ t: 5, p: 1 }], [], [], ['a']).length, 1);
});

test('uid is 16 base36 chars and unique', () => {
  const a = S.uid(), b = S.uid();
  assert.match(a, /^[0-9a-z]{16}$/);
  assert.notEqual(a, b);
});

test('first-login import fills gaps but never overrides the journal', () => {
  const server = [mark(1, 2, 'g', 100), reset(4, 100)];
  const imp = S.importEvents({ 1: { 2: 'b', 3: 'o' }, 4: { 1: 'g' }, 9: { 9: 'g' } }, { device: 'd' });
  assert.ok(imp.every(e => e.kind === 'mark' && e.source === 'import'));
  const want = { 1: { 2: 'g', 3: 'o' }, 9: { 9: 'g' } };
  assert.deepEqual(run([...server, ...imp]).state, want);
  assert.deepEqual(run([...imp, ...server]).state, want);
});
