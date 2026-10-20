import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { config, required } from './config.js';
import { connect, mongo } from './store.js';
import { handle } from './handlers.js';
import { flushLogs } from './logs.js';
import { pollLoas } from './loa.js';
for (const key of ['DISCORD_TOKEN', 'DISCORD_GUILD_ID', 'HR_ROLE_IDS', 'COHEAD_ROLE_IDS', 'VERIFICATION_CHANNEL_ID', 'VERIFICATION_REVIEW_CHANNEL_ID', 'CONSEQUENCE_LOG_CHANNEL_ID', 'RESIGNATION_LOG_CHANNEL_ID', 'LOA_LOG_CHANNEL_ID']) required(key);
await connect();
const client = new Client({ intents: [GatewayIntentBits.Guilds], allowedMentions: { parse: [] } });
let timer, loaTimer;
client.once(Events.ClientReady, ready => {
  console.log(`Logged in as ${ready.user.tag}; server ${config.guildId}`);
  void flushLogs(client).catch(error => console.error('Log worker failed:', error.message));
  timer = setInterval(() => void flushLogs(client).catch(error => console.error('Log worker failed:', error.message)), 15000);
  const poll = () => void pollLoas(client).catch(error => console.error('Series LOA sync failed:', error.message));
  poll();
  const seconds = Number(process.env.SERIES_LOA_POLL_SECONDS || 60);
  loaTimer = setInterval(poll, (Number.isFinite(seconds) ? Math.max(30, seconds) : 60) * 1000);
});
client.on(Events.InteractionCreate, async i => {
  try { await handle(i); }
  catch (error) {
    console.error('Interaction failed:', error.message);
    const message = { content: String(error.message).slice(0, 1900), components: [], embeds: [], allowedMentions: { parse: [] } };
    try {
      if (i.deferred || i.replied) await i.editReply(message);
      else await i.reply({ ...message, flags: MessageFlags.Ephemeral });
    } catch (replyError) { console.error('Unable to send error response:', replyError.message); }
  }
});
client.on(Events.Error, error => console.error('Discord client error:', error.message));
async function shutdown() { clearInterval(timer); clearInterval(loaTimer); client.destroy(); await mongo.close(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
await client.login(required('DISCORD_TOKEN'));
