import { test } from 'node:test';
import assert from 'node:assert/strict';
import Sync from '../sync-core.js';

test('stable journal IDs map each retained topic and preserve removed topics', () => {
  const oldToNew = [0, 1, 2, 3, 4, 5, 26, 6, 7, 8, 9, 10, 11, 33, 13, 14, 15, 16, 17, 18, 19, 12];
  oldToNew.forEach((n, old) => {
    assert.equal(Sync.fromWire(old), n);
    assert.equal(Sync.toWire(n), old);
  });
  assert.deepEqual(Sync.stateFromWire({ 6: { 1: 'g' }, 7: { 2: 'b' }, 13: { 3: 'o' }, 20: { 4: 'g' } }),
    { 26: { 1: 'g' }, 6: { 2: 'b' }, 33: { 3: 'o' }, 19: { 4: 'g' } });
});

test('old offline reset does not reset the restored derivative bank', () => {
  const events = [
    { kind: 'mark', n: 7, pid: 1, status: 'g', ts: 10, uid: 'a' },
    { kind: 'mark', n: 21, pid: 1, status: 'g', ts: 10, uid: 'b' },
    { kind: 'reset', n: 0, ts: 20, uid: 'c' }
  ];
  const result = Sync.applyEvents({}, Sync.newStamps(), Sync.eventsFromWire(events));
  assert.deepEqual(result.state, { 12: { 1: 'g' } });
});

test('new global reset reaches both legacy and derivative topics on all clients', () => {
  const reset = { kind: 'reset', n: 0, ts: 20, uid: 'reset' };
  const sent = Sync.eventsToWire(reset);
  assert.deepEqual(sent.map(e => e.n), [0, 21]);
  assert.notEqual(sent[0].uid, sent[1].uid);
  const marks = [
    { kind: 'mark', n: 7, pid: 1, status: 'g', ts: 10, uid: 'a' },
    { kind: 'mark', n: 21, pid: 1, status: 'g', ts: 10, uid: 'b' }
  ];
  assert.deepEqual(Sync.applyEvents({}, Sync.newStamps(), Sync.eventsFromWire([...marks, ...sent])).state, {});
  assert.deepEqual(Sync.applyEvents({}, Sync.newStamps(), [...marks, ...sent]).state, {});
});

test('migrated stamps and delayed old events keep their original timestamps', () => {
  const migrated = Sync.stampsFromWire({ m: { '7/2': { ts: 20, uid: 'new', s: 'g' } }, r: { 0: 5, 13: 12 } });
  assert.equal(migrated.r[40], 5);
  assert.equal(migrated.r[33], 12);
  const old = Sync.eventsFromWire([{ kind: 'mark', n: 7, pid: 2, status: 'b', ts: 10, uid: 'old' }]);
  const result = Sync.applyEvents({ 6: { 2: 'g' } }, migrated, old);
  assert.deepEqual(result.state, { 6: { 2: 'g' } });
});
