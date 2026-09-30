// /bye — a staff member resigns. Asks for confirmation with a button.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ComponentType } = require('discord.js');
const team = require('../lib/team');
const { getTeam } = require('../lib/ctx');
const { fail } = require('../lib/util');

module.exports = {
  data: new SlashCommandBuilder().setName('bye').setDescription('Resign from the staff team (removes your roles and updates the roster)').addStringOption((o) => o.setName('message').setDescription('Optional farewell message / reason').setMaxLength(300)),
  async execute(interaction) {
    const t = await getTeam(interaction);
    if (!t) return;
    const m = t.members[interaction.user.id];
    if (!m || m.status === 'resigned') return fail(interaction, 'You are not on the staff roster.');
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bye:yes').setLabel('Yes, I resign').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('bye:no').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
    );
    const reply = await interaction.reply({ content: `⚠️ You are about to resign as **${team.positionFull(t, m)}**. Your staff roles and nickname will be removed in both servers and the roster updated. Are you sure?`, components: [row], flags: MessageFlags.Ephemeral, withResponse: true });
    const msg = reply?.resource?.message || (await interaction.fetchReply());
    try {
      const click = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 60_000, filter: (i) => i.user.id === interaction.user.id });
      if (click.customId === 'bye:no') return click.update({ content: 'Cancelled — you are still on the team. 💙', components: [] });
      await click.update({ content: '⏳ Processing…', components: [] });
      const res = await team.resign(interaction.client, t, { userId: interaction.user.id, by: interaction.user, reason: interaction.options.getString('message') });
      return interaction.editReply({ content: `${res.ok ? '👋' : '❌'} ${res.ok ? 'You have resigned. Thank you for your time on the team!' : res.text}` });
    } catch {
      return interaction.editReply({ content: 'Timed out — nothing changed.', components: [] }).catch(() => null);
    }
  },
};
