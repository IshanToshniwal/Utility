const { SlashCommandBuilder } = require('discord.js');
const { COLORS, card, msg } = require('../lib/ui');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('How StaffHub works'),
  async execute(interaction) {
    const c = card({ color: COLORS.blue, title: '🧑‍💼 StaffHub', text: 'Staff applications, verification, roster, promotions, strikes and breaks — synced between your **main server** and **staff server**.', fields: [
        { name: '📝 Joining the team', value: '`/apply` (main server) → I DM you the questions one by one → managers **Accept** (or **Interview** you in a private channel) → DM with the staff-server invite → join → post your **proof** in the proof channel (or `/proof`) → a manager approves it with your position → roles + `Position | Name` nickname in both servers, a guide post with your staff channels.' },
        { name: '🌴 Breaks', value: '`/break duration reason` — request time off (managers approve)\n`/loa give @user duration reason` · `/loa end @user` (managers)\n`/active breaks` — who is away right now' },
        { name: '📋 Roster & records', value: '`/staff roster` · `/staff record [@user]` · `/staff leaderboard [days]`\n`/staff promote|demote @user [to]` · `/staff set @user position`\n`/staff strike @user reason` · `/staff unstrike @user #` · `/staff remove @user`\n`/staff blacklist add|remove|list` · `/staff sync` · `/staffannounce` · `/staff report`' },
        { name: '👋 Leaving', value: '`/bye` — resign: roster updated, roles and nickname removed everywhere' },
        { name: '⚙️ Admins', value: '`/link setup staff_server:<id>` (in the main server) · `/setup …` · **Dashboard** on the bot\'s website (Login with Discord, Administrators only): roster, applications, verification, activity stats, breaks, every channel and message.' },
      ] });
    return interaction.reply(msg(c, { ephemeral: true }));
  },
};
