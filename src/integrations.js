import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeLoa } from './loa-domain.js';
async function json(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Roblox lookup failed (${response.status}). Please retry later.`);
  return response.json();
}
export async function roblox(username) {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('Enter a valid Roblox username, not a display name.');
  const result = await json('https://users.roblox.com/v1/usernames/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
  });
  const user = result.data?.[0];
  if (!user) throw new Error('Roblox username not found.');
  return { robloxId: String(user.id), username: user.name };
}
export async function lookupRoblox(account) {
  const input = account.trim();
  const byId = /^\d+$/.test(input);
  const username = input.replace(/^@/, '');
  if (byId && (!Number.isSafeInteger(Number(input)) || Number(input) <= 0)) throw new Error('Enter a valid positive Roblox ID.');
  if (!byId && !/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error('Enter a Roblox ID or exact username, not a display name.');
  const result = await json(`https://users.roblox.com/v1/${byId ? 'users' : 'usernames/users'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(byId ? { userIds: [Number(input)] } : { usernames: [username] }), excludeBannedUsers: false }),
  });
  const user = result.data?.[0];
  if (!user) throw new Error('Roblox account not found.');
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.name !== 'string'
    || (byId && user.id !== Number(input))) throw new Error('Roblox returned an invalid account. Please retry.');
  return { robloxId: String(user.id), username: user.name, displayName: user.displayName || user.name,
    profileUrl: `https://www.roblox.com/users/${user.id}/profile` };
}
export async function groupRank(robloxId) {
  const group = process.env.ROBLOX_GROUP_ID;
  if (!group) throw new Error('ROBLOX_GROUP_ID must be configured to retrieve an authoritative rank.');
  const result = await json(`https://groups.roblox.com/v2/users/${robloxId}/groups/roles`);
  const member = result.data?.find(x => String(x.group.id) === group);
  if (!member) throw new Error('This user is not a member of the configured Roblox group.');
  return member.role.name;
}
async function adapter(key) {
  const path = process.env[key];
  if (!path) throw new Error(`${key} is not configured. See README; this integration needs your provider API details.`);
  return import(pathToFileURL(resolve(path)).href);
}
export async function seriesProgress(input) {
  const module = await adapter('SERIES_ADAPTER');
  const result = await module.getProgress(input);
  if (String(result.robloxId) !== input.robloxId || result.start !== input.start || result.end !== input.end
    || !result.metrics || typeof result.metrics !== 'object') throw new Error('Series returned mismatched identity or dates. Check aborted.');
  return result.metrics;
}
export async function terminateWithBloxrank(input) {
  const module = await adapter('BLOXRANK_ADAPTER');
  const result = await module.terminate(input);
  if (result?.success !== true || !result.reference) throw new Error('Bloxrank did not confirm termination. The staff record remains blocked.');
  return String(result.reference);
}
export async function seriesLoaRequests() {
  const module = process.env.SERIES_ADAPTER ? await adapter('SERIES_ADAPTER') : await import('./series-api.js');
  if (typeof module.listLoaRequests !== 'function') throw new Error('Series adapter must implement listLoaRequests. See README.');
  const rows = await module.listLoaRequests();
  if (!Array.isArray(rows)) throw new Error('Series LOA list must be a complete array of requests.');
  return rows.map(normalizeLoa);
}
export async function seriesLoaRequest(requestId) {
  const module = process.env.SERIES_ADAPTER ? await adapter('SERIES_ADAPTER') : await import('./series-api.js');
  const request = normalizeLoa(await module.getLoaRequest({ requestId }));
  if (request.requestId !== requestId) throw new Error('Series returned a different LOA request.');
  return request;
}
export async function reviewSeriesLoa(input) {
  const module = process.env.SERIES_ADAPTER ? await adapter('SERIES_ADAPTER') : await import('./series-api.js');
  const request = normalizeLoa(await module.reviewLoaRequest(input));
  if (request.requestId !== input.requestId || request.status !== input.decision || request.operationId !== input.operationId) throw new Error('Series did not confirm this LOA decision. It will be reconciled on retry.');
  return request;
}
