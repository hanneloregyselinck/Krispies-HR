const list = key => (process.env[key] || '').split(',').map(x => x.trim()).filter(Boolean);
export function required(key) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Missing ${key}. Copy .env.example to .env and configure it.`);
  return value;
}
export const config = {
  guildId: process.env.DISCORD_GUILD_ID,
  hrRoles: list('HR_ROLE_IDS'), coheadRoles: list('COHEAD_ROLE_IDS'),
  verification: process.env.VERIFICATION_CHANNEL_ID,
  review: process.env.VERIFICATION_REVIEW_CHANNEL_ID,
  logs: { consequence: process.env.CONSEQUENCE_LOG_CHANNEL_ID,
    resignation: process.env.RESIGNATION_LOG_CHANNEL_ID,
    termination: process.env.CONSEQUENCE_LOG_CHANNEL_ID,
    loa: process.env.LOA_LOG_CHANNEL_ID, verification: process.env.VERIFICATION_REVIEW_CHANNEL_ID },
};
