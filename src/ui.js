import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { activeLoa, TERMINATION_WARNING } from './domain.js';
export const button = (id, label, style = ButtonStyle.Primary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
export const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);
export const truncate = (s, n = 1000) => String(s).slice(0, n);
export const safe = s => String(s).replace(/[\\`*_~|>\[\]]/g, '\\$&');
export function textPayload(text) {
  return { content: null, embeds: [new EmbedBuilder().setDescription(text.slice(0, 4000))],
    files: text.length > 4000 ? [new AttachmentBuilder(Buffer.from(text), { name: 'full-report.txt' })] : [] };
}
export function recentConsequences(staff) {
  const recent = staff.events.filter(e => e.type === 'consequence').slice(-3).reverse();
  return '\n**Previous consequences (latest three)**\n' + (recent.length ? recent.map(e =>
    `${new Date(e.at).toISOString().slice(0, 10)} · ${safe(truncate(e.reason, 120))} · ${e.strikes}/5`,
  ).join('\n') : 'None recorded.');
}
export function summary(staff) {
  return `**${safe(staff.username)}** · Roblox ID: ${staff._id}\nStrikes: **${staff.strikes}/5** · Approved LOA now: **${activeLoa(staff) ? 'Yes' : 'No'}**\n`
    + (staff.strikes >= 5 ? `**${TERMINATION_WARNING}**\n` : '')
    + (staff.terminatedAt ? `Termination recorded: ${new Date(staff.terminatedAt).toISOString()}\n` : '');
}
export function verificationModal() {
  return {
    custom_id: 'verification:submit', title: 'Krispies Staff Verification',
    components: [
      ...[['username', 'Username', 20], ['rank', 'Rank', 100], ['timezone', 'Timezone', 100], ['invited', 'Invited by', 100]].map(([id, label, max]) => ({
        type: 18, label, component: { type: 4, custom_id: id, style: 1, required: true, max_length: max },
      })),
      { type: 18, label: 'Screenshot (optional)', component: { type: 19, custom_id: 'screenshot', min_values: 0, max_values: 1, required: false } },
    ],
  };
}
export function verificationPanel() {
  return {
    content: null,
    attachments: [],
    files: [],
    embeds: [
      new EmbedBuilder().setColor(0x292d30).setTitle('Staff verification')
        .setDescription('Welcome to Krispies HR! Press **Verify** below to complete your staff verification.\n\n'
          + 'Please provide your **Roblox username**, **rank**, **timezone**, and **who invited you**. You can also attach an optional screenshot.\n\n'
          + 'Our Leadership team will review your submission.'),
    ],
    components: [row(button('verification:open', 'Verify'))],
    allowedMentions: { parse: [] },
  };
}
export function verificationImage(position) {
  if (!['header', 'footer'].includes(position)) throw new Error('Invalid verification image position.');
  const name = `verification-${position}.png`;
  return { content: null, embeds: [], components: [], attachments: [],
    files: [new AttachmentBuilder(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)), { name })],
    allowedMentions: { parse: [] } };
}
export function history(staff, page = 0) {
  const events = [...staff.events].reverse(), pages = Math.max(1, Math.ceil(events.length / 5));
  page = Math.max(0, Math.min(page, pages - 1));
  const embed = new EmbedBuilder().setTitle('Staff history').setDescription(summary(staff)).setColor(0xf3b65a)
    .setFooter({ text: `Page ${page + 1}/${pages}` });
  for (const e of events.slice(page * 5, page * 5 + 5)) embed.addFields({
    name: `${e.type} · ${new Date(e.at).toISOString().slice(0, 10)}`,
    value: truncate(`${safe(e.reason || e.status || '')}\nHR: ${/^\d+$/.test(e.actorId) ? `<@${e.actorId}>` : safe(e.actorId || 'Series')}${e.strikes !== undefined ? ` · Strikes: ${e.strikes}` : ''}${e.start ? `\n${new Date(e.start).toISOString()} → ${new Date(e.end).toISOString()}` : ''}${e.type === 'loa' ? `\nStatus: ${e.status}\nDecision reason: ${safe(e.decisionReason || 'Not provided')}` : ''}${e.evidence ? `\nEvidence: ${e.evidence}` : ''}\nRecord: ${e.id}`),
  });
  return { embeds: [embed], components: pages > 1 ? [row(
    button(`history:${staff._id}:${page - 1}`, 'Previous').setDisabled(page === 0),
    button(`history:${staff._id}:${page + 1}`, 'Next').setDisabled(page === pages - 1),
  )] : [] };
}
