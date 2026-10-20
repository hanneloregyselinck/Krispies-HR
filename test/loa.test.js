import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModalBuilder } from 'discord.js';
import { normalizeLoa, loaKey, reviewIntent } from '../src/loa-domain.js';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017';
const { createLoaService, loaReasonModal } = await import('../src/loa.js');
const request = (extra = {}) => normalizeLoa({ requestId: 'req-123', robloxId: '123', username: 'Example',
  start: '2026-10-20T00:00:00Z', end: '2026-10-25T00:00:00Z', reason: 'Vacation', status: 'pending', version: 'v1', ...extra });
// Small repository double exercises durable decisions, retries and duplicate reviews.
function repository() {
  const rows = new Map();
  const match = (row, query) => Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => match(row, q));
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$ne' in value) return row[key] != null && row[key] !== value.$ne;
      if ('$exists' in value) return (key in row) === value.$exists;
      if ('$lte' in value) return row[key] <= value.$lte;
    }
    return value === null ? row[key] == null : row[key] === value;
  });
  const update = (row, change, insert) => {
    if (insert) Object.assign(row, structuredClone(change.$setOnInsert || {}));
    Object.assign(row, structuredClone(change.$set || {}));
    for (const key of Object.keys(change.$unset || {})) delete row[key];
  };
  const collection = {
    async findOne(q) { const r = [...rows.values()].find(r => match(r, q)); return r ? structuredClone(r) : null; },
    async updateOne(q, change, options = {}) {
      let r = [...rows.values()].find(r => match(r, q)); const inserted = !r && options.upsert;
      if (!r && !inserted) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      if (inserted) { r = { _id: q._id }; rows.set(r._id, r); }
      update(r, change, inserted);
      return { matchedCount: inserted ? 0 : 1, modifiedCount: 1, upsertedCount: inserted ? 1 : 0 };
    },
    async findOneAndUpdate(q, change) {
      const r = [...rows.values()].find(r => match(r, q)); if (!r) return null;
      update(r, change, false); return structuredClone(r);
    },
    async *find(q) { for (const r of [...rows.values()]) if (match(r, q)) yield structuredClone(r); },
  };
  return { collection: () => collection, rows };
}
test('LOA status and reason inputs are validated and modal requires a reason', () => {
  assert.throws(() => request({ status: 'unknown' }));
  assert.throws(() => request({ end: 'bad' }));
  assert.throws(() => reviewIntent('denied', '   '));
  assert.throws(() => reviewIntent('approved', 'x'.repeat(1001)));
  const json = new ModalBuilder(loaReasonModal(loaKey('req-123'), 'denied')).toJSON();
  assert.equal(json.components[0].component.required, true);
});
test('repeated sync deduplicates requests and reflects external cancellations', async () => {
  const repo = repository(), mirrored = []; let remote = request();
  const service = createLoaService({ database: () => repo, list: async () => [remote], mirror: async r => mirrored.push(r) });
  await service.sync(); await service.sync();
  assert.equal(repo.rows.size, 1);
  remote = request({ status: 'cancelled', version: 'v2' }); await service.sync();
  assert.equal(mirrored.at(-1).status, 'cancelled');
});
test('decision saves reason, writes to Series once and blocks duplicate review', async () => {
  const repo = repository(); let remote = request(), writes = 0;
  const service = createLoaService({ database: () => repo, list: async () => [remote], get: async () => remote,
    mirror: async () => {}, review: async input => {
      writes++; assert.equal(input.reason, 'Enjoy your trip'); assert.equal(input.expectedVersion, 'v1');
      remote = request({ status: input.decision, version: 'v2', operationId: input.operationId }); return remote;
    } });
  await service.sync(); const key = loaKey(remote.requestId);
  await service.decide(key, '456', 'approved', 'Enjoy your trip');
  assert.equal(writes, 1); assert.equal(repo.rows.get(key).decision, null);
  assert.equal(repo.rows.get(key).decisionReason, 'Enjoy your trip');
  await assert.rejects(service.decide(key, '789', 'denied', 'Other'), /already/);
});
test('lost provider response is reconciled without a second write after restart', async () => {
  const repo = repository(); let remote = request(), writes = 0;
  const dependencies = { database: () => repo, list: async () => [remote], get: async () => remote, mirror: async () => {},
    review: async input => { writes++; remote = request({ status: input.decision, version: 'v2', operationId: input.operationId }); throw new Error('timeout'); } };
  const service = createLoaService(dependencies); await service.sync();
  const key = loaKey(remote.requestId);
  await assert.rejects(service.decide(key, '456', 'denied', 'Overlapping dates'), /retried/);
  assert.ok(repo.rows.get(key).decision);
  await createLoaService(dependencies).sync();
  assert.equal(writes, 1); assert.equal(repo.rows.get(key).status, 'denied');
  assert.equal(repo.rows.get(key).decisionReason, 'Overlapping dates');
});
test('an external decision wins without being overwritten or attributed to Discord', async () => {
  const repo = repository(); let remote = request();
  const service = createLoaService({ database: () => repo, list: async () => [remote], get: async () => remote, mirror: async () => {},
    review: async () => assert.fail('must not write') });
  await service.sync(); remote = request({ status: 'denied', version: 'v2', decisionReason: 'Series decision', reviewedBy: 'Roblox 999' });
  await service.decide(loaKey(remote.requestId), '456', 'approved', 'Discord reason');
  const result = repo.rows.get(loaKey(remote.requestId));
  assert.equal(result.status, 'denied'); assert.equal(result.reviewedBy, 'Roblox 999');
  assert.equal(result.decisionReason, 'Series decision');
});
test('deleted requests lose their approved exemption after a complete snapshot', async () => {
  const repo = repository(); let snapshot = [request({ status: 'approved' })]; const mirrored = [];
  const service = createLoaService({ database: () => repo, list: async () => snapshot, mirror: async r => mirrored.push(r) });
  await service.sync(); snapshot = []; await service.sync();
  assert.equal(mirrored.at(-1).status, 'cancelled');
});
test('requests edited after the panel was displayed must be reviewed again', async () => {
  const repo = repository(); let remote = request();
  const service = createLoaService({ database: () => repo, list: async () => [remote], get: async () => remote, mirror: async () => {},
    review: async () => assert.fail('must not approve changed dates') });
  await service.sync(); remote = request({ version: 'v2', end: '2026-10-30' });
  await assert.rejects(service.decide(loaKey(remote.requestId), '456', 'approved', 'Fine'), /changed/);
  assert.equal(repo.rows.get(loaKey(remote.requestId)).decision, null);
  assert.equal(repo.rows.get(loaKey(remote.requestId)).version, 'v2');
});
