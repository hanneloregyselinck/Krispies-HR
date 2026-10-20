import { randomUUID } from 'node:crypto';
import { ButtonStyle, EmbedBuilder } from 'discord.js';
import { db, staff, mutate } from './store.js';
import { config } from './config.js';
import { seriesLoaRequests, seriesLoaRequest, reviewSeriesLoa } from './integrations.js';
import { loaKey, reviewIntent, normalizeLoa } from './loa-domain.js';
import { row, button, safe } from './ui.js';

// Dependency injection keeps provider failure and concurrency tests independent of live services.
export function createLoaService({ database, list = seriesLoaRequests, get = seriesLoaRequest,
  review = reviewSeriesLoa, mirror = mirrorLoa, now = () => new Date() }) {
  const requests = () => database().collection('seriesLoa');
  async function save(remote, decision = null, resolving = false) {
    remote = normalizeLoa(remote);
    const key = loaKey(remote.requestId);
    const old = await requests().findOne({ _id: key });
    if (old && old.robloxId !== remote.robloxId) throw new Error('Series LOA identity changed; sync stopped for this request.');
    const ours = decision && remote.status === decision.decision;
    const decisionReason = ours ? decision.reason : remote.decisionReason;
    const reviewedBy = ours ? decision.actorId : remote.reviewedBy;
    const changed = !old || ['version', 'status', 'reason'].some(k => old[k] !== remote[k])
      || +new Date(old.start) !== +remote.start || +new Date(old.end) !== +remote.end
      || old.decisionReason !== decisionReason || old.reviewedBy !== reviewedBy;
    // Preserve local audit metadata when the provider omits Discord reviewer information.
    const preserve = old && old.status === remote.status && old.version === remote.version && !decision;
    const values = { ...remote, decisionReason: preserve ? old.decisionReason : decisionReason,
      reviewedBy: preserve ? old.reviewedBy : reviewedBy, syncedAt: now() };
    if (old && old.status !== 'pending' && remote.status === 'pending') return;
    const result = await requests().updateOne(old ? { _id: key, version: old.version, status: old.status,
      ...(!resolving ? { decision: null } : {}),
    } : { _id: key }, { $set: { ...values,
      ...(changed && !preserve ? { panelPending: true } : {}),
    }, $setOnInsert: { decision: null } }, { upsert: !old });
    if (!result.matchedCount && !result.upsertedCount) return;
    await mirror({ _id: key, ...values });
  }
  async function decide(key, actorId, decision, reason) {
    const intent = { ...reviewIntent(decision, reason), actorId, operationId: randomUUID(), at: now() };
    const result = await requests().updateOne({ _id: key, status: 'pending', decision: null }, {
      $set: { decision: intent },
    });
    if (!result.modifiedCount) throw new Error('This LOA was already reviewed or a decision is already queued.');
    if (await processDecision(key) === false) throw new Error('The request changed in Series. Review its updated panel before deciding again.');
  }
  async function processDecision(key) {
    const leaseId = randomUUID();
    const locked = await requests().findOneAndUpdate({ _id: key, decision: { $ne: null },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lte: now() } }],
    }, { $set: { leaseId, leaseUntil: new Date(+now() + 60000) } }, { returnDocument: 'after' });
    if (!locked) return;
    try {
      const d = locked.decision;
      let remote = await get(locked.requestId);
      if (remote.robloxId !== locked.robloxId) throw new Error('Series LOA identity changed.');
      if (remote.status === 'pending' && remote.version !== locked.version) {
        await save(remote, null, true);
        await requests().updateOne({ _id: key, leaseId }, { $set: { decision: null }, $unset: { leaseUntil: '', leaseId: '', lastError: '' } });
        return false;
      }
      let ours = remote.operationId === d.operationId;
      if (remote.status === 'pending') {
        remote = await review({ requestId: locked.requestId, decision: d.decision, reason: d.reason,
          actorId: d.actorId, operationId: d.operationId, expectedVersion: remote.version });
        ours = true;
      }
      await save(remote, ours ? d : null, true);
      await requests().updateOne({ _id: key, leaseId }, { $set: { decision: null }, $unset: { leaseUntil: '', leaseId: '', lastError: '' } });
    } catch (error) {
      await requests().updateOne({ _id: key, leaseId }, { $set: { lastError: String(error.message).slice(0, 500) }, $unset: { leaseUntil: '', leaseId: '' } });
      throw new Error('Series has not confirmed the LOA decision. It is saved and will be retried automatically.');
    }
  }
  async function sync() {
    let count = 0;
    // Reconcile durable decisions first, including a provider write whose response was lost.
    for await (const record of requests().find({ decision: { $ne: null } })) {
      try { await processDecision(record._id); } catch (error) { console.error(error.message); }
    }
    const snapshot = await list();
    const present = new Set(snapshot.map(r => loaKey(r.requestId)));
    for (const remote of snapshot) {
      const existing = await requests().findOne({ _id: loaKey(remote.requestId) });
      if (existing?.decision) continue;
      await save(remote); count++;
    }
    // A complete, successful snapshot also reconciles deletions; a failed page never reaches here.
    for await (const old of requests().find({ decision: null })) {
      if (!present.has(old._id) && old.status !== 'cancelled') await save({ ...old, requestId: old.requestId,
        status: 'cancelled', version: `missing:${old.version}`, decisionReason: 'Request no longer exists in Series.', reviewedBy: null });
    }
    return count;
  }
  return { sync, decide, processDecision };
}

async function mirrorLoa(request) {
  await staff({ robloxId: request.robloxId, username: request.username });
  const entry = { id: `series:${request._id}`, source: 'series', requestId: request.requestId, type: 'loa',
    at: new Date(), start: request.start, end: request.end, reason: request.reason,
    status: request.status, decisionReason: request.decisionReason, actorId: request.reviewedBy || 'Series',
    logStatus: 'none' };
  await mutate(request.robloxId, s => {
    const old = s.events.find(e => e.id === entry.id);
    const next = { ...entry, at: old?.at || entry.at };
    return old ? { set: { events: s.events.map(e => e.id === entry.id ? next : e) } } : { event: next };
  });
}
export const loaService = createLoaService({ database: () => db });
export function loaReasonModal(key, decision) {
  reviewIntent(decision, 'validation');
  return { custom_id: `seriesloareason:${key}:${decision}`, title: decision === 'approved' ? 'Approve LOA' : 'Deny LOA',
    components: [{ type: 18, label: 'Decision reason', component: { type: 4, custom_id: 'reason', style: 2, required: true, min_length: 1, max_length: 1000 } }] };
}
let running = false;
export async function pollLoas(client, force = false) {
  if (running) return;
  if (!process.env.SERIES_ADAPTER && !process.env.SERIES_API_KEY && !force) return;
  running = true;
  try {
    try { return await loaService.sync(); }
    finally { await deliverLoaPanels(client); }
  } finally { running = false; }
}
export async function deliverLoaPanels(client) {
  const channel = await client.channels.fetch(config.logs.loa);
  if (channel?.guildId !== config.guildId || !channel.send) throw new Error('Invalid LOA log channel.');
  for await (const r of db.collection('seriesLoa').find({ panelPending: true })) {
    const embed = new EmbedBuilder().setTitle(`Series LOA - ${r.status}`).setTimestamp(r.syncedAt).setColor(r.status === 'approved' ? 0x2ecc71 : r.status === 'denied' ? 0xe74c3c : 0xf3b65a)
      .setDescription(`**${safe(r.username)}** | Roblox ID: ${r.robloxId}`)
      .setFooter({ text: `Series request: ${r.requestId}` }).addFields(
        { name: 'Dates', value: `${r.start.toISOString()} to ${r.end.toISOString()}` },
        { name: 'Request reason', value: r.reason },
        ...(r.status !== 'pending' ? [{ name: 'Decision reason', value: r.decisionReason || 'Not supplied by Series' },
          { name: 'Reviewed by', value: r.reviewedBy ? safe(r.reviewedBy) : 'Series' }] : []),
      );
    const payload = { embeds: [embed], allowedMentions: { parse: [] }, components: r.status === 'pending' ? [row(
      button(`seriesloa:${r._id}:approved`, 'Approve', ButtonStyle.Success), button(`seriesloa:${r._id}:denied`, 'Deny', ButtonStyle.Danger),
    )] : [] };
    let message;
    if (r.panelChannelId === channel.id && r.panelMessageId) {
      try { message = await channel.messages.fetch(r.panelMessageId); }
      catch (error) { if (error.code !== 10008) throw error; }
    }
    message = message ? await message.edit(payload) : await channel.send(payload);
    await db.collection('seriesLoa').updateOne({ _id: r._id, version: r.version, status: r.status }, {
      $set: { panelPending: false, panelMessageId: message.id, panelChannelId: channel.id },
    });
  }
}
