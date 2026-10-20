import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { required } from './config.js';
await new REST({ version: '10' }).setToken(required('DISCORD_TOKEN')).put(
  Routes.applicationGuildCommands(required('DISCORD_CLIENT_ID'), required('DISCORD_GUILD_ID')),
  { body: commands.map(c => c.toJSON()) },
);
console.log('Guild slash commands registered. Set their role visibility in Server Settings > Integrations.');
