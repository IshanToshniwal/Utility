// /bye — a staff member resigns. Asks for confirmation with a button.
const { SlashCommandBuilder, ButtonStyle, ComponentType } = require('discord.js');
const ui = require('../lib/ui');
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
    const row = ui.row(ui.button('bye:yes', 'Yes, I resign', ButtonStyle.Danger), ui.button('bye:no', 'Cancel', ButtonStyle.Secondary));
    const reply = await interaction.reply({ ...ui.msg(ui.card({ color: ui.COLORS.yellow, title: '⚠️ Resign from the staff team?', text: `You are about to resign as **${team.positionFull(t, m)}**. Your staff roles and nickname will be removed in both servers and the roster updated.`, rows: [row] }), { ephemeral: true }), withResponse: true });
    const msg = reply?.resource?.message || (await interaction.fetchReply());
    try {
      const click = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 60_000, filter: (i) => i.user.id === interaction.user.id });
      if (click.customId === 'bye:no') return click.update(ui.msg(ui.card({ color: ui.COLORS.blue, text: 'Cancelled — you are still on the team. 💙' })));
      await click.update(ui.msg(ui.card({ color: ui.COLORS.grey, text: '⏳ Processing…' })));
      const res = await team.resign(interaction.client, t, { userId: interaction.user.id, by: interaction.user, reason: interaction.options.getString('message') });
      return interaction.editReply(ui.msg(ui.card({ color: res.ok ? ui.COLORS.green : ui.COLORS.red, text: res.ok ? '👋 You have resigned. Thank you for your time on the team!' : `❌ ${res.text}` })));
    } catch {
      return interaction.editReply(ui.msg(ui.card({ color: ui.COLORS.grey, text: 'Timed out — nothing changed.' }))).catch(() => null);
    }
  },
};
