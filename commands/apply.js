// /apply — main server only. Starts the application in the user's DMs.
const { SlashCommandBuilder } = require('discord.js');
const store = require('../lib/store');
const applications = require('../lib/applications');
const ui = require('../lib/ui');

module.exports = {
  data: new SlashCommandBuilder().setName('apply').setDescription('Apply to join the staff team (the questions are asked in your DMs)'),
  async execute(interaction) {
    const t = store.teamFor(interaction.guildId);
    if (!t) return interaction.reply(ui.fail('Staff applications are not set up in this server.'));
    if (interaction.guildId !== t.mainGuildId) return interaction.reply(ui.fail('Applications are submitted in the **main** server, not here.'));
    return applications.start(interaction, t);
  },
};
