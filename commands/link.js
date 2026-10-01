// /link setup | view | unlink  — connect a main server with its staff server.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const store = require('../lib/store');
const team = require('../lib/team');
const { ok, fail } = require('../lib/util');
const { COLORS, card, msg } = require('../lib/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Connect this main server with a staff server')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('setup').setDescription('Run in the MAIN server: link it to your staff server').addStringOption((o) => o.setName('staff_server').setDescription('Server ID of the staff server (bot must already be in it)').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription('Show the current link'))
    .addSubcommand((s) => s.setName('unlink').setDescription('Remove the link (roster data is deleted!)').addBooleanOption((o) => o.setName('confirm').setDescription('Type True to confirm').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const existing = store.teamFor(interaction.guildId);

    if (sub === 'view') {
      if (!existing) return fail(interaction, 'This server is not linked. Run `/link setup` in the main server.');
      const { main, staff } = team.guilds(interaction.client, existing);
      return interaction.reply(msg(card({ color: COLORS.blue, title: '🔗 Server link', fields: [
        { name: 'Main server', value: `${main?.name || 'unknown'} (\`${existing.mainGuildId}\`)`, inline: true },
        { name: 'Staff server', value: `${staff?.name || 'unknown'} (\`${existing.staffGuildId}\`)`, inline: true },
        { name: 'Staff on roster', value: String(team.activeStaff(existing).length), inline: true },
        { name: 'Dashboard', value: process.env.BASE_URL ? `${process.env.BASE_URL}/dashboard/${existing.id}` : 'Open the bot\'s website and log in with Discord' },
      ] }), { ephemeral: true }));
    }

    if (sub === 'unlink') {
      if (!existing) return fail(interaction, 'This server is not linked.');
      if (!interaction.options.getBoolean('confirm')) return fail(interaction, 'Set `confirm` to True to unlink. This deletes departments, roster, applications and strikes for this pair.');
      store.deleteTeam(existing.id);
      return ok(interaction, 'Unlinked. All StaffHub data for this pair was deleted (roles in Discord were left untouched).');
    }

    // setup
    if (existing) return fail(interaction, `This server is already linked (${existing.mainGuildId === interaction.guildId ? 'as the main server' : 'as the staff server'}). Use \`/link unlink\` first.`);
    const staffId = interaction.options.getString('staff_server').trim();
    if (!/^\d{15,22}$/.test(staffId)) return fail(interaction, 'That is not a server ID. Right-click the staff server → **Copy Server ID** (enable Developer Mode in Discord settings → Advanced).');
    if (staffId === interaction.guildId) return fail(interaction, 'The staff server must be a different server from the main one.');
    const staffGuild = interaction.client.guilds.cache.get(staffId);
    if (!staffGuild) return fail(interaction, 'I am not in that server. Invite me to the staff server first (same invite link), then run this again.');
    if (store.teamFor(staffId)) return fail(interaction, 'That staff server is already linked to another main server.');
    const sm = await team.fetchMember(staffGuild, interaction.user.id);
    if (!sm?.permissions.has(PermissionFlagsBits.Administrator)) return fail(interaction, `You must be an **Administrator** in **${staffGuild.name}** too.`);

    const t = store.createTeam(interaction.guildId, staffId);
    store.activity(t, `🔗 Linked ${interaction.guild.name} ↔ ${staffGuild.name} by ${interaction.user.tag}`);
    store.save();
    return interaction.reply(msg(card({ color: COLORS.green, title: '🔗 Linked!', text: `**Main:** ${interaction.guild.name}\n**Staff:** ${staffGuild.name}\n\n**Next steps** (dashboard is easiest — log in on the bot's website):\n1. **Roster** → create departments and positions, pick a role for each in both servers\n2. **Settings** → channels (applications, proof, verification, announcements, guide, roster…), manager roles, LOA roles\n3. Members use \`/apply\` in the main server; managers **Accept** → applicant joins the staff server → posts proof → manager approves with a position\n\nOr use \`/setup\` commands for the basics.` })));
  },
};
