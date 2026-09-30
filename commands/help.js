const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { COLORS, embed } = require('../lib/util');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('How StaffHub works'),
  async execute(interaction) {
    const e = embed(COLORS.blue, '🧑‍💼 StaffHub', 'Staff applications, verification, roster, promotions, strikes and breaks — synced between your **main server** and **staff server**.')
      .addFields(
        { name: '📝 Joining the team', value: '`/apply` (main server) → managers **Accept** → DM with the staff-server invite → join → post your **proof** in the proof channel (or `/proof`) → a manager approves it with your position → roles + `[Position | Name]` nickname in both servers, a guide post with your staff channels.' },
        { name: '🌴 Breaks', value: '`/break duration reason` — request time off (managers approve)\n`/loa give @user duration reason` · `/loa end @user` (managers)\n`/active breaks` — who is away right now' },
        { name: '📋 Roster & records', value: '`/staff roster` · `/staff record [@user]`\n`/staff promote|demote @user [to]` · `/staff set @user position`\n`/staff strike @user reason` · `/staff unstrike @user #` · `/staff remove @user`\n`/staff sync` — re-apply roles/nicknames from the roster' },
        { name: '👋 Leaving', value: '`/bye` — resign: roster updated, roles and nickname removed everywhere' },
        { name: '⚙️ Admins', value: '`/link setup staff_server:<id>` (in the main server) · `/setup …` · **Dashboard** on the bot\'s website (Login with Discord, Administrators only): departments & positions with roles for both servers, application questions, review applications, staff records, breaks, all settings.' },
      );
    return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
  },
};
