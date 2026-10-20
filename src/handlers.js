import { ButtonStyle, MessageFlags } from 'discord.js';
import { config } from './config.js';
import { db, staff, mutate, event, pending, consume } from './store.js';
import { roblox, lookupRoblox, groupRank, seriesProgress, terminateWithBloxrank } from './integrations.js';
import { activeLoa, consequenceAllowed, validatePeriod, evaluate } from './domain.js';
import { button, row, summary, history, verificationModal, safe, textPayload, recentConsequences } from './ui.js';
import { loaReasonModal, loaService, pollLoas, deliverLoaPanels } from './loa.js';

export async function authorize(i, cohead = false) {
  if (i.guildId !== config.guildId) throw new Error('This bot is restricted to its configured server.');
  const member = await i.guild.members.fetch({ user: i.user.id, force: true });
  const roles = cohead ? config.coheadRoles : [...config.hrRoles, ...config.coheadRoles];
  if (!roles.some(id => member.roles.cache.has(id))) throw new Error(cohead ? 'Co-Head+ role required.' : 'Authorized HR role required.');
}
async function confirm(i, action, data, text) {
  const id = await pending(i.user.id, action, data);
  await i.editReply({ ...textPayload(text), components: [row(
    button(`confirm:${id}`, 'Yes', ButtonStyle.Danger), button(`cancel:${id}`, 'No', ButtonStyle.Secondary),
  )] });
}
async function channel(client, id) {
  if (!id) throw new Error('The channel for this action is not configured.');
  const c = await client.channels.fetch(id);
  if (!c?.isTextBased() || c.guildId !== config.guildId || !c.send) throw new Error('Configured channel must be a sendable channel in this server.');
  return c;
}
export async function handle(i) {
  if (i.guildId !== config.guildId) return;
  if (i.isButton() && i.customId.startsWith('seriesloa:')) {
    const [, key, decision] = i.customId.split(':');
    if (i.channelId !== config.logs.loa || !/^[a-f0-9]{32}$/.test(key)) throw new Error('Use the LOA review channel.');
    // Only opening the reason form uses the cached role list to meet Discord's modal deadline.
    // Submitting the decision always fetches fresh authorization before writing to Series.
    const roles = i.member?.roles;
    if (!config.coheadRoles.some(id => Array.isArray(roles) ? roles.includes(id) : roles?.cache?.has(id))) throw new Error('Co-Head+ role required.');
    return i.showModal(loaReasonModal(key, decision));
  }
  if (i.isModalSubmit() && i.customId.startsWith('seriesloareason:')) {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    await authorize(i, true);
    const [, key, decision] = i.customId.split(':');
    if (i.channelId !== config.logs.loa || !/^[a-f0-9]{32}$/.test(key)) throw new Error('Use the LOA review channel.');
    await loaService.decide(key, i.user.id, decision, i.fields.getTextInputValue('reason'));
    await deliverLoaPanels(i.client);
    return i.editReply('Series status reconciled and the Discord LOA log updated.');
  }
  if (i.isButton() && i.customId === 'verification:open') {
    if (i.channelId !== config.verification) throw new Error('Use the button in the configured verification channel.');
    return i.showModal(verificationModal());
  }
  if (i.isModalSubmit() && i.customId === 'verification:submit') {
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    if (i.channelId !== config.verification) throw new Error('Use the configured verification channel.');
    const user = await roblox(i.fields.getTextInputValue('username').trim());
    const files = i.fields.getUploadedFiles('screenshot', false);
    const attachment = files?.first();
    if (attachment && (!attachment.contentType?.startsWith('image/') || attachment.size > 10 * 1024 * 1024)) throw new Error('Please submit an image under 10 MB.');
    await channel(i.client, config.review);
    // Discord's signed attachment URL may expire; log delivery reuploads the image.
    const data = { robloxId: user.robloxId, username: user.username,
      claimedRank: i.fields.getTextInputValue('rank'), timezone: i.fields.getTextInputValue('timezone'),
      invitedBy: i.fields.getTextInputValue('invited'), discordId: i.user.id,
      screenshot: attachment ? { url: attachment.url, name: attachment.name, size: attachment.size } : null };
    if (![data.claimedRank, data.timezone, data.invitedBy].every(x => x.trim())) throw new Error('Please fill in every text field.');
    const existing = await db.collection('verification').findOne({ _id: i.user.id, status: 'pending' });
    if (existing) throw new Error('You already have a verification submission awaiting review.');
    await db.collection('verification').updateOne({ _id: i.user.id, status: { $ne: 'pending' } }, { $set: {
      ...data, status: 'pending', submittedAt: new Date(), logStatus: 'pending',
    } }, { upsert: true });
    return i.editReply('Your form was saved for HR review. Claimed details have not granted any roles.');
  }
  if (!i.isButton() && !i.isChatInputCommand()) return;
  // Acknowledge before fetching roles, so a slow Discord response cannot expire the interaction.
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  await authorize(i, i.isChatInputCommand() && ['adjustreqs', 'staffprofile', 'terminate', 'verificationpanel', 'syncloas'].includes(i.commandName));
  if (i.isButton()) return handleButton(i);
  if (!i.isChatInputCommand()) return;
  const get = name => i.options.getString(name);
  const name = i.commandName;
  if (name === 'robloxlookup') {
    const account = await lookupRoblox(get('account'));
    return i.editReply(textPayload(`**Roblox account**\nUsername: **${safe(account.username)}**\nDisplay name: ${safe(account.displayName)}\nRoblox ID: **${account.robloxId}**\n[Open profile](${account.profileUrl})`));
  }
  if (name === 'syncloas') {
    const count = await pollLoas(i.client, true);
    return i.editReply(count === undefined ? 'LOA sync is already running. Try again shortly.' : `Synced ${count} Series LOA requests.`);
  }
  if (name === 'verificationpanel') {
    const c = await channel(i.client, config.verification);
    const panels = db.collection('settings');
    const prior = await panels.findOne({ _id: 'verificationPanel' });
    const payload = { content: '**Staff verification**\nPress Verify to submit your username, rank, timezone, inviter, and optional screenshot. HR will review your submission.', components: [row(button('verification:open', 'Verify'))], allowedMentions: { parse: [] } };
    let message;
    if (prior?.channelId === c.id) message = await c.messages.fetch(prior.messageId).catch(() => null);
    message = message ? await message.edit(payload) : await c.send(payload);
    await panels.updateOne({ _id: 'verificationPanel' }, { $set: { channelId: c.id, messageId: message.id } }, { upsert: true });
    return i.editReply('Verification panel posted.');
  }
  if (name === 'adjustreqs') {
    const key = { rank: get('rank').trim(), department: get('department').trim(), metric: get('metric').trim() };
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key.metric)) throw new Error('Use a plain Series metric key (letters, numbers, underscores or hyphens).');
    await db.collection('requirements').updateOne({ _id: JSON.stringify(key) }, { $set: { ...key, target: i.options.getInteger('target'), updatedBy: i.user.id, updatedAt: new Date() } }, { upsert: true });
    return i.editReply('Requirement saved. A zero target disables that metric.');
  }
  const user = await roblox(get('username').trim());
  let s = await staff(user);
  if (name === 'staffhistory') return i.editReply(history(s));
  if (name === 'staffprofile') {
    await mutate(s._id, () => ({ set: { department: get('department').trim() }, event: event('profile', i.user.id, { reason: `Department changed to ${get('department').trim()}`, logStatus: 'none' }) }));
    return i.editReply('Staff department updated.');
  }
  if (name === 'issuecon') {
    consequenceAllowed(s, false);
    const attachment = i.options.getAttachment('evidence');
    if (attachment?.size > 10 * 1024 * 1024) throw new Error('Evidence must be no larger than 10 MB.');
    await channel(i.client, config.logs.consequence);
    return confirm(i, 'consequence', { robloxId: s._id, reason: get('reason'), evidence: attachment?.url,
      evidenceFile: attachment ? { url: attachment.url, name: attachment.name, size: attachment.size } : null },
      `${summary(s)}${recentConsequences(s)}\n\nIssue one strike for **${safe(get('reason'))}**?\nEvidence: ${attachment?.url || 'None'}`);
  }
  if (name === 'reslog') {
    const rank = await groupRank(s._id);
    const mrRanks = (process.env.MR_RANK_NAMES || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!mrRanks.includes(rank)) throw new Error('This rank is not configured as an MR rank. Set MR_RANK_NAMES to the exact eligible Roblox group rank names.');
    await channel(i.client, config.logs.resignation);
    return confirm(i, 'resignation', { robloxId: s._id, rank, reason: get('reason') }, `${summary(s)}\nLog resignation from **${safe(rank)}**?\nReason: ${safe(get('reason'))}`);
  }
  if (name === 'terminate') {
    if (s.strikes < 5 || s.terminatedAt) throw new Error('Termination requires five strikes and an active staff record.');
    if (!process.env.BLOXRANK_ADAPTER) throw new Error('Configure BLOXRANK_ADAPTER before processing termination.');
    return confirm(i, 'termination', { robloxId: s._id }, `${summary(s)}\nConfirm termination through Bloxrank? This changes their Roblox group rank.`);
  }
  if (name === 'checkreqs') {
    await refreshLoas(i.client);
    s = await db.collection('staff').findOne({ _id: s._id });
    const period = validatePeriod(get('start'), get('end'));
    const rank = await groupRank(s._id);
    const reqs = await db.collection('requirements').find({ rank, department: s.department, target: { $gt: 0 } }).toArray();
    if (!reqs.length) throw new Error('No requirements configured for this rank and department. Use /adjustreqs.');
    const data = { robloxId: s._id, start: period.start.toISOString(), end: period.end.toISOString() };
    const results = evaluate(reqs, await seriesProgress(data));
    const text = `${summary(s)}\nRank: ${safe(rank)} · Department: ${safe(s.department)}\n${data.start} → ${data.end}\n` + results.map(r => `${r.complete ? '✅' : '❌'} ${safe(r.metric)}: ${r.actual}/${r.target}`).join('\n');
    if (activeLoa(s, period.start, period.end)) return i.editReply(textPayload(`${text}\n**Approved LOA overlaps this period: exempt from quota consequences.**`));
    if (results.every(r => r.complete) || s.strikes >= 5 || s.terminatedAt) return i.editReply(textPayload(text));
    if (period.end > new Date()) return i.editReply(textPayload(`${text}\nThis period has not ended. Consequences are unavailable.`));
    await channel(i.client, config.logs.consequence);
    return confirm(i, 'consequence', { ...data, quota: true, rank, department: s.department, reason: 'Failure to meet quota' }, `${text}${recentConsequences(s)}\n\nIssue consequence for failure to meet quota?`);
  }
}

async function refreshLoas(client) {
  const count = await pollLoas(client, true);
  if (count === undefined) throw new Error('LOA sync is already running. Retry once it finishes so exemptions can be checked safely.');
}

async function handleButton(i) {
  const [action, id, extra] = i.customId.split(':');
  if (action === 'verificationreview') {
    if (!['accepted', 'denied'].includes(extra)) throw new Error('Unknown review action.');
    const result = await db.collection('verification').updateOne({ _id: id, status: 'pending', logMessageId: i.message.id }, {
      $set: { status: extra, reviewedBy: i.user.id, reviewedAt: new Date() },
    });
    if (!result.modifiedCount) throw new Error('This submission was already reviewed or this panel is outdated.');
    await i.message.edit({ content: `Review: ${extra} by <@${i.user.id}>`, components: [], allowedMentions: { parse: [] } });
    return i.editReply(extra === 'accepted' ? 'Marked reviewed. No Discord roles were assigned.' : 'Resubmission enabled. Ask the member to use the Verify button again.');
  }
  if (action === 'history') {
    const s = await db.collection('staff').findOne({ _id: id });
    if (!s) throw new Error('Staff record not found.');
    return i.editReply(history(s, Number(extra)));
  }
  if (action === 'loa') {
    throw new Error('This local LOA panel is retired. Use /syncloas and review the Series request instead.');
  }
  if (!['confirm', 'cancel'].includes(action)) throw new Error('Unknown button.');
  const p = await consume(id, i.user.id);
  if (action === 'cancel') {
    await i.message.edit({ components: [] }).catch(() => {});
    return i.editReply('Cancelled.');
  }
  const d = p.data;
  if (p.action === 'termination') {
    await authorize(i, true);
    // A durable operation key lets the adapter safely retry after a process crash.
    const operationId = `termination:${d.robloxId}`;
    await mutate(d.robloxId, s => {
      if (s.strikes < 5 || s.terminatedAt) throw new Error('Staff member is no longer eligible for termination.');
      if (s.terminationLease && new Date(s.terminationLease) > new Date()) throw new Error('Termination is already being processed.');
      return { set: { terminationLease: new Date(Date.now() + 120000) } };
    });
    try {
      const reference = await terminateWithBloxrank({ robloxId: d.robloxId, actorId: i.user.id, operationId });
      await mutate(d.robloxId, () => ({ set: { terminatedAt: new Date(), terminationLease: null }, event: event('termination', i.user.id, { reference, reason: 'Five-strike termination' }) }));
    } catch (error) {
      await mutate(d.robloxId, () => ({ set: { terminationLease: null } }));
      throw error;
    }
  } else if (p.action === 'consequence') {
    if (d.quota) {
      await refreshLoas(i.client);
      const s = await db.collection('staff').findOne({ _id: d.robloxId });
      const rank = await groupRank(d.robloxId);
      if (rank !== d.rank || s.department !== d.department) throw new Error('Rank or department changed. Run /checkreqs again.');
      const reqs = await db.collection('requirements').find({ rank, department: s.department, target: { $gt: 0 } }).toArray();
      if (!reqs.length || evaluate(reqs, await seriesProgress(d)).every(r => r.complete)) throw new Error('No unmet requirements remain. No consequence issued.');
    }
    const quotaKey = d.quota ? `${d.start}:${d.end}` : null;
    const updated = await mutate(d.robloxId, s => {
      consequenceAllowed(s, d.quota, new Date(d.start), new Date(d.end));
      if (d.quota && s.department !== d.department) throw new Error('Department changed. Run /checkreqs again.');
      if (quotaKey && s.events.some(e => e.quotaKey === quotaKey)) throw new Error('A consequence was already issued for this quota period.');
      const strikes = s.strikes + 1;
      return { set: { strikes }, event: event('consequence', i.user.id, { reason: d.reason, evidence: d.evidence, evidenceFile: d.evidenceFile || null, strikes, quotaKey }) };
    });
    await i.message.edit({ components: [] }).catch(() => {});
    return i.editReply(`Consequence saved; log queued.\n${summary(updated)}`);
  } else if (p.action === 'resignation') {
    await mutate(d.robloxId, () => ({ event: event('resignation', i.user.id, { reason: d.reason, rank: d.rank }) }));
  } else throw new Error('Unknown confirmation action.');
  await i.message.edit({ components: [] }).catch(() => {});
  return i.editReply('Action saved; log queued.');
}
