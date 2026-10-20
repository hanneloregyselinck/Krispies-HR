import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
const command = (name, description, publicAccess = false) => {
  const c = new SlashCommandBuilder().setName(name).setDescription(description).setDMPermission(false);
  if (!publicAccess) c.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  return c;
};
const string = (c, name, description, required = true) => c.addStringOption(o => o.setName(name).setDescription(description).setRequired(required).setMaxLength(name === 'reason' ? 1000 : 100));
const user = c => string(c, 'username', 'Roblox username');
const reason = c => string(c, 'reason', 'Reason for this action');
const dates = c => string(string(c, 'start', 'Period start: ISO date, for example 2026-10-19T00:00:00Z'), 'end', 'Period end: ISO date (exclusive for quota periods)');
export const commands = [
  string(command('robloxlookup', 'Find a Roblox account by ID or exact username'), 'account', 'Roblox ID or username (prefix @ to force a username lookup)'),
  command('verificationpanel', 'Post the verification button in the configured channel'),
  reason(user(command('issuecon', 'Confirm and issue one strike with an audit log')))
    .addAttachmentOption(o => o.setName('evidence').setDescription('Optional supporting evidence')),
  reason(user(command('reslog', 'Log an MR resignation using their current Roblox group rank'))),
  user(command('staffhistory', 'View a staff record, with paginated history')),
  dates(user(command('checkreqs', 'Check Series requirements for a specific period'))),
  string(string(string(command('adjustreqs', 'Co-Head+: set a requirement target'), 'rank', 'Exact Roblox rank name'), 'department', 'Exact department name'), 'metric', 'Series metric key')
    .addIntegerOption(o => o.setName('target').setDescription('Required count; zero disables this metric').setMinValue(0).setRequired(true)),
  string(user(command('staffprofile', 'Co-Head+: assign a staff department')), 'department', 'Department name'),
  command('syncloas', 'Co-Head+: fetch Series LOA requests and refresh Discord panels'),
  user(command('terminate', 'Co-Head+: confirm termination through Bloxrank')),
];
