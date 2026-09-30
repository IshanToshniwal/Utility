// /apply — main server only. Opens the application form.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const store = require('../lib/store');
const applications = require('../lib/applications');

module.exports = {
  data: new SlashCommandBuilder().setName('apply').setDescription('Apply to join the staff team'),
  async execute(interaction) {
    const t = store.teamFor(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ Staff applications are not set up in this server.', flags: MessageFlags.Ephemeral });
    if (interaction.guildId !== t.mainGuildId) return interaction.reply({ content: '❌ Applications are submitted in the **main** server, not here.', flags: MessageFlags.Ephemeral });
    return applications.open(interaction, t);
  },
};
