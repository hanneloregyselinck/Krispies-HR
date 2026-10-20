import { AttachmentBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { db } from './store.js';
import { config } from './config.js';
import { row, button, truncate, safe } from './ui.js';
async function destination(client, id) {
  if (!id) throw new Error('Missing log channel configuration.');
  const c = await client.channels.fetch(id);
  if (c?.guildId !== config.guildId || !c.send) throw new Error('Invalid log channel.');
  return c;
}
async function screenshot(file) {
  const url = new URL(file.url);
  if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname)) throw new Error('Invalid attachment host.');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error('Screenshot download failed. Submission retained for retry.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error('Screenshot exceeds 10 MB.');
    chunks.push(chunk);
  }
  return new AttachmentBuilder(Buffer.concat(chunks), { name: file.name.replace(/[^A-Za-z0-9_.-]/g, '_') });
}
let running = false;
export async function flushLogs(client) {
  if (running) return;
  running = true;
  try {
    for await (const s of db.collection('staff').find({ 'events.logStatus': 'pending' })) {
      for (const e of s.events.filter(x => x.logStatus === 'pending')) {
        try {
          const c = await destination(client, config.logs[e.type]);
          const embed = new EmbedBuilder().setTitle(`Staff ${e.type}`).setTimestamp(new Date(e.at))
            .setDescription(`**${safe(s.username)}** · Roblox ID: ${s._id}`)
            .setFooter({ text: `Record ${e.id}` }).addFields(
              { name: 'HR member', value: `<@${e.actorId}>` },
              { name: 'Reason', value: truncate(e.reason || 'Not specified') },
            );
          if (e.strikes !== undefined) embed.addFields({ name: 'Updated strikes', value: `${e.strikes}/5${e.strikes >= 5 ? '\n**TERMINATION REQUIRED: Staff member has reached 5 strikes.**' : ''}` });
          if (e.rank) embed.addFields({ name: 'Previous rank', value: truncate(e.rank) });
          if (e.evidence) embed.addFields({ name: 'Evidence', value: truncate(e.evidence) });
          if (e.reference) embed.addFields({ name: 'Bloxrank reference', value: truncate(e.reference) });
          if (e.type === 'loa') embed.addFields({ name: 'Status', value: e.status }, { name: 'Dates', value: `${new Date(e.start).toISOString()} → ${new Date(e.end).toISOString()}` }, ...(e.reviewedBy ? [{ name: 'Reviewed by', value: `<@${e.reviewedBy}>` }] : []));
          const files = e.evidenceFile ? [await screenshot(e.evidenceFile)] : [];
          const message = await c.send({ embeds: [embed], files, allowedMentions: { parse: [] }, components: [] });
          await db.collection('staff').updateOne({ _id: s._id }, { $set: { 'events.$[e].logStatus': 'sent', 'events.$[e].logMessageId': message.id,
            ...(message.attachments.first() ? { 'events.$[e].evidence': message.attachments.first().url } : {}),
          } }, {
            arrayFilters: [{ 'e.id': e.id, ...(e.status ? { 'e.status': e.status } : {}) }],
          });
        } catch (error) { console.error(`Log delivery failed for ${e.id}: ${error.message}`); }
      }
    }
    for await (const v of db.collection('verification').find({ logStatus: 'pending' })) {
      try {
        const c = await destination(client, config.review);
        const embed = new EmbedBuilder().setTitle('Verification submission').setTimestamp(v.submittedAt)
          .setFooter({ text: `Submission ${v._id} · ${v.submittedAt.toISOString()}` })
          .setDescription('Details are self-reported. This form does not prove Roblox account ownership or assign roles.')
          .addFields(
            { name: 'Discord member', value: `<@${v.discordId}>` },
            { name: 'Roblox username / ID', value: `${v.username} / ${v.robloxId}` },
            { name: 'Claimed rank', value: v.claimedRank }, { name: 'Timezone', value: v.timezone }, { name: 'Invited by', value: v.invitedBy },
          );
        const files = v.screenshot ? [await screenshot(v.screenshot)] : [];
        const message = await c.send({ embeds: [embed], files, allowedMentions: { parse: [] }, components: [row(
          button(`verificationreview:${v._id}:accepted`, 'Mark reviewed', ButtonStyle.Success),
          button(`verificationreview:${v._id}:denied`, 'Request resubmission', ButtonStyle.Secondary),
        )] });
        await db.collection('verification').updateOne({ _id: v._id, submittedAt: v.submittedAt }, { $set: { logStatus: 'sent', logMessageId: message.id,
          ...(message.attachments.first() ? { storedScreenshot: message.attachments.first().url } : {}),
        } });
      } catch (error) { console.error(`Verification log delivery failed for ${v._id}: ${error.message}`); }
    }
  } finally { running = false; }
}
