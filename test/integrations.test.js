import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roblox, lookupRoblox, seriesProgress, terminateWithBloxrank } from '../src/integrations.js';

test('account lookup resolves IDs, usernames and forced numeric usernames', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ data: [{ id: 123, name: 'Example', displayName: 'Display' }] }) };
  });
  const result = await lookupRoblox(' 123 ');
  assert.equal(result.robloxId, '123'); assert.equal(result.displayName, 'Display');
  assert.equal(result.profileUrl, 'https://www.roblox.com/users/123/profile');
  assert.deepEqual(calls[0].body.userIds, [123]);
  await lookupRoblox('Example'); assert.deepEqual(calls[1].body.usernames, ['Example']);
  await lookupRoblox('@123'); assert.deepEqual(calls[2].body.usernames, ['123']);
});
test('account lookup rejects invalid inputs, missing accounts, and mismatched IDs', async t => {
  for (const input of ['', '0', '-1', '9007199254740992', 'a display name']) await assert.rejects(lookupRoblox(input));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ data: [] }) }));
  await assert.rejects(lookupRoblox('123'), /not found/);
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => ({ data: [{ id: 456, name: 'Other' }] }) }));
  await assert.rejects(lookupRoblox('123'), /invalid account/);
});
test('Roblox username resolution stores an immutable ID and canonical name', async t => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://users.roblox.com/v1/usernames/users');
    assert.deepEqual(JSON.parse(options.body).usernames, ['Example']);
    return { ok: true, json: async () => ({ data: [{ id: 123, name: 'EXAMPLE' }] }) };
  });
  assert.deepEqual(await roblox('Example'), { robloxId: '123', username: 'EXAMPLE' });
});
test('unknown Roblox usernames and unavailable providers fail explicitly', async t => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ data: [] }) }));
  await assert.rejects(roblox('Unknown'), /not found/);
  await assert.rejects(roblox('bad user!'), /valid Roblox username/);
  delete process.env.SERIES_ADAPTER;
  delete process.env.BLOXRANK_ADAPTER;
  await assert.rejects(seriesProgress({}), /not configured/);
  await assert.rejects(terminateWithBloxrank({}), /not configured/);
});
