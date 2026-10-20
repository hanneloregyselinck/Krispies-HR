import { normalizeLoa } from './loa-domain.js';
const origin = 'https://api.series.hr';
async function api(path, options = {}) {
  const key = process.env.SERIES_API_KEY?.trim();
  if (!key) throw new Error('Set SERIES_API_KEY in .env to enable Series LOA requests.');
  const response = await fetch(`${origin}${path}`, { ...options, headers: { apikey: key, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error(`Series time-off API failed (${response.status}).`);
  const body = await response.json();
  if (body.success !== true || !body.data) throw new Error('Series did not confirm the time-off API request.');
  return body.data;
}
const names = new Map();
async function username(id) {
  if (names.get(id)?.expires > Date.now()) return names.get(id).name;
  const response = await fetch(`https://users.roblox.com/v1/users/${id}`, { signal: AbortSignal.timeout(10000), redirect: 'error' });
  if (!response.ok) throw new Error(`Roblox LOA username lookup failed (${response.status}).`);
  const user = await response.json();
  if (typeof user.name !== 'string' || String(user.id) !== id) throw new Error('Roblox returned an invalid LOA requester.');
  names.set(id, { name: user.name, expires: Date.now() + 300000 });
  return user.name;
}
const auditPattern = /\n\nDiscord reviewer: (\d+)\nReference: ([a-f0-9-]{36})$/;
async function convert(r) {
  if (!r || !/^\d+$/.test(String(r.RequesterId))) throw new Error('Series returned an invalid requester ID.');
  const statuses = { pending: 'pending', accepted: 'approved', ongoing: 'approved', completed: 'approved', denied: 'denied', cancelled: 'cancelled' };
  const note = String(r.ManagerNote || '');
  const audit = note.match(auditPattern);
  return normalizeLoa({ requestId: r.RequestId, robloxId: String(r.RequesterId), username: await username(String(r.RequesterId)),
    start: r.Start, end: r.End, reason: r.Reason, status: statuses[r.Status], version: r.UpdatedAt,
    decisionReason: audit ? note.slice(0, audit.index) : note,
    reviewedBy: audit ? `Discord ${audit[1]}` : r.HandledBy ? `Roblox ${r.HandledBy}` : null,
    operationId: audit?.[2] || null });
}
export async function listLoaRequests() {
  const result = [], seen = new Set();
  for (let page = 1; page <= 10000; page++) {
    const data = await api(`/time-off/list?page=${page}&limit=50`);
    if (!Array.isArray(data.Requests) || typeof data.Pagination?.HasNextPage !== 'boolean'
      || data.Pagination.CurrentPage !== page) throw new Error('Series returned invalid LOA pagination. Sync aborted.');
    for (const request of data.Requests) {
      if (seen.has(request.RequestId)) throw new Error('Series returned duplicate LOA requests; retry sync.');
      seen.add(request.RequestId);
      result.push(await convert(request));
    }
    if (!data.Pagination.HasNextPage) return result;
  }
  throw new Error('Series LOA pagination exceeded its safety limit.');
}
export async function getLoaRequest({ requestId }) {
  const result = await convert(await api(`/time-off/get/${encodeURIComponent(requestId)}`));
  if (result.requestId !== requestId) throw new Error('Series returned a mismatched LOA request.');
  return result;
}
export async function reviewLoaRequest({ requestId, decision, reason, actorId, operationId, expectedVersion }) {
  // Series documents no conditional update or idempotency headers. Re-read before PATCH,
  // and retain a reference in ManagerNote to reconcile a lost response without another write.
  const current = await getLoaRequest({ requestId });
  if (current.status !== 'pending') return current;
  if (current.version !== expectedVersion) throw new Error('The Series LOA changed during review. Retrying with fresh details.');
  const data = await api(`/time-off/update/${encodeURIComponent(requestId)}`, { method: 'PATCH', body: JSON.stringify({
    Status: decision === 'approved' ? 'accepted' : 'denied',
    ManagerNote: `${reason}\n\nDiscord reviewer: ${actorId}\nReference: ${operationId}`,
  }) });
  if (data.RequestId !== requestId || data.Status !== (decision === 'approved' ? 'accepted' : 'denied')) throw new Error('Series did not acknowledge the expected LOA update.');
  const confirmed = await getLoaRequest({ requestId });
  if (confirmed.operationId !== operationId || confirmed.status !== decision) throw new Error('Series LOA update could not yet be verified.');
  return confirmed;
}
