import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listLoaRequests, getLoaRequest, reviewLoaRequest } from '../src/series-api.js';
const raw = (status = 'pending', note = '') => ({ RequestId: 'req-1', RequesterId: '987654', Start: '2026-10-20', End: '2026-10-25',
  Reason: 'Trip', Status: status, ManagerNote: note, UpdatedAt: '2026-10-19T12:00:00Z' });
const response = data => ({ ok: true, json: async () => ({ success: true, data }) });
test('Series pagination and accepted/ongoing/completed status mapping use documented API', async t => {
  process.env.SERIES_API_KEY = 'test-only'; let pages = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith('https://users.roblox.com')) return { ok: true, json: async () => ({ id: 987654, name: 'Example' }) };
    assert.equal(options.headers.apikey, 'test-only'); pages++;
    assert.match(url, new RegExp(`page=${pages}&limit=50$`));
    const r = raw(pages === 1 ? 'ongoing' : 'completed'); r.RequestId = `req-${pages}`;
    return response({ Requests: [r], Pagination: { CurrentPage: pages, HasNextPage: pages === 1 } });
  });
  const result = await listLoaRequests();
  assert.equal(pages, 2); assert.ok(result.every(r => r.status === 'approved'));
});
test('Series review PATCH sends status and reason, then verifies stored reference', async t => {
  process.env.SERIES_API_KEY = 'test-only'; let state = raw(), patched = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.startsWith('https://users.roblox.com')) return { ok: true, json: async () => ({ id: 987654, name: 'Example' }) };
    if (options.method === 'PATCH') {
      assert.equal(url, 'https://api.series.hr/time-off/update/req-1');
      const body = JSON.parse(options.body); assert.equal(body.Status, 'denied'); assert.match(body.ManagerNote, /^Dates conflict/);
      state = raw(body.Status, body.ManagerNote); patched = true;
      return response({ RequestId: 'req-1', Status: 'denied' });
    }
    return response(state);
  });
  const operationId = '12345678-1234-1234-1234-123456789abc';
  const result = await reviewLoaRequest({ requestId: 'req-1', decision: 'denied', reason: 'Dates conflict', actorId: '123', operationId, expectedVersion: state.UpdatedAt });
  assert.ok(patched); assert.equal(result.operationId, operationId); assert.equal(result.decisionReason, 'Dates conflict');
});
test('provider failures do not produce a successful list or decision', async t => {
  process.env.SERIES_API_KEY = 'test-only';
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
  await assert.rejects(listLoaRequests(), /403/);
  await assert.rejects(getLoaRequest({ requestId: 'req-1' }), /403/);
});
