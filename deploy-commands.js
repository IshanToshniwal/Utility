// Registers slash commands. Runs automatically in the Render build.
// GUILD_IDS (comma-separated) -> instant guild commands in those servers; empty -> global.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');

const commands = [];
const dir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
  const mod = require(path.join(dir, file));
  for (const cmd of Array.isArray(mod) ? mod : [mod]) if (cmd?.data) commands.push(cmd.data.toJSON());
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
(async () => {
  try {
    const ids = (process.env.GUILD_IDS || process.env.GUILD_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length) {
      for (const id of ids) {
        await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, id), { body: commands });
        console.log(`Registered ${commands.length} guild commands in ${id}`);
      }
    } else {
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
      console.log(`Registered ${commands.length} global commands`);
    }
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
