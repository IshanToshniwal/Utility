require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client, GatewayIntentBits, Partials, Collection, MessageFlags } = require('discord.js');
const store = require('./lib/store');
const team = require('./lib/team');
const components = require('./lib/components');
const dashboard = require('./lib/dashboard');

// Keep the last errors in memory for the /status page.
const recentErrors = [];
const origError = console.error;
console.error = (...args) => {
  recentErrors.unshift({ at: new Date().toISOString(), text: args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 500) });
  if (recentErrors.length > 50) recentErrors.pop();
  origError(...args);
};

// ---------------------------------------------------------------- web (Render keep-alive + dashboard)
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', uptime: process.uptime(), ready: client?.isReady() ?? false, guilds: client?.guilds.cache.size ?? 0 }));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// ---------------------------------------------------------------- client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages], // MessageContent: proof channel + DM applications + activity stats
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message],
});
client.commands = new Collection();
client.recentErrors = recentErrors;
store.attachClient(client);
dashboard.mount(app, client);

function loadDir(dir) {
  const full = path.join(__dirname, dir);
  const out = [];
  for (const file of fs.readdirSync(full).filter((f) => f.endsWith('.js'))) {
    const mod = require(path.join(full, file));
    out.push(...(Array.isArray(mod) ? mod : [mod]));
  }
  return out;
}
for (const cmd of loadDir('commands')) if (cmd?.data && cmd?.execute) client.commands.set(cmd.data.name, cmd);
console.log(`Loaded ${client.commands.size} commands: ${[...client.commands.keys()].join(', ')}`);
for (const ev of loadDir('events')) {
  if (!ev?.name || !ev?.execute) continue;
  client.on(ev.name, (...args) => Promise.resolve(ev.execute(client, ...args)).catch((err) => console.error(`Event ${ev.name} failed:`, err)));
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag} — ${client.guilds.cache.size} server(s)`);
  client.user.setActivity('the staff team 🧑‍💼', { type: 3 });
  await store.restore();
  setInterval(() => team.tick(client).catch((e) => console.error('tick failed:', e)), 60_000);
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isAutocomplete()) {
      const cmd = client.commands.get(interaction.commandName);
      return cmd?.autocomplete ? await cmd.autocomplete(interaction) : interaction.respond([]);
    }
    if (!interaction.inGuild()) {
      if (interaction.isRepliable()) return interaction.reply(require('./lib/ui').fail('Use this in a server.'));
      return;
    }
    if (interaction.isButton()) return await components.handleButton(interaction);
    if (interaction.isModalSubmit()) return await components.handleModal(interaction);
    if (interaction.isStringSelectMenu()) return await components.handleSelect(interaction);
    if (!interaction.isChatInputCommand()) return;
    const cmd = client.commands.get(interaction.commandName);
    if (cmd) await cmd.execute(interaction);
  } catch (err) {
    console.error(`Error in ${interaction.commandName || interaction.customId}:`, err);
    if (!interaction.isRepliable()) return;
    const text = err?.code === 50013 ? 'I am missing permissions. Move my role above the staff roles and give me Manage Roles + Manage Nicknames in both servers.' : `Something went wrong: ${err.message ?? err}`;
    const payload = require('./lib/ui').fail(text);
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('SIGTERM', async () => {
  await store.flush();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
