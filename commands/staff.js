// /staff strike | unstrike | record | roster | promote | demote | set | remove | sync
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const team = require('../lib/team');
const { getTeam, requireManager, resolvePosition, autocompletePosition } = require('../lib/ctx');
const { ok, fail } = require('../lib/util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Staff team management')
    .addSubcommand((s) => s.setName('roster').setDescription('Show the staff roster by department'))
    .addSubcommand((s) => s.setName('record').setDescription("Show a staff member's record (strikes, history)").addUserOption((o) => o.setName('user').setDescription('Staff member (default: you)')))
    .addSubcommand((s) => s.setName('strike').setDescription('Give a staff member a strike').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500)))
    .addSubcommand((s) => s.setName('unstrike').setDescription('Remove a strike').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addIntegerOption((o) => o.setName('strike').setDescription('Strike number (#)').setRequired(true)))
    .addSubcommand((s) => s.setName('promote').setDescription('Promote one level up in their department (or to a given position)').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('to').setDescription('Optional: specific position').setAutocomplete(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('demote').setDescription('Demote one level down in their department (or to a given position)').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('to').setDescription('Optional: specific position').setAutocomplete(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('set').setDescription('Move a staff member to any position / department').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('position').setDescription('Department / position').setRequired(true).setAutocomplete(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove someone from the staff team').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('sync').setDescription('Re-apply roles and nicknames from the roster (everyone, or one person)').addUserOption((o) => o.setName('user').setDescription('Only this member'))),
  autocomplete: autocompletePosition,

  async execute(interaction) {
    const t = await getTeam(interaction);
    if (!t) return;
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');

    if (sub === 'roster') {
      const { staff } = team.guilds(interaction.client, t);
      return interaction.reply({ embeds: team.rosterEmbeds(t, { staffGuild: staff }) });
    }
    if (sub === 'record') {
      const target = user || interaction.user;
      if (target.id !== interaction.user.id && !(await team.isManager(interaction.client, t, interaction.user.id))) return fail(interaction, "You can only view your own record. Managers can view everyone's.");
      return interaction.reply({ embeds: [team.recordEmbed(t, target.id, target)], flags: target.id === interaction.user.id ? MessageFlags.Ephemeral : undefined });
    }

    if (!(await requireManager(interaction, t))) return;
    const reason = interaction.options.getString('reason');
    if (user?.id === interaction.user.id && ['strike', 'promote', 'demote', 'remove'].includes(sub)) return fail(interaction, "You can't do that to yourself.");
    await interaction.deferReply();
    let res;
    if (sub === 'strike') res = await team.strike(interaction.client, t, { userId: user.id, by: interaction.user, reason });
    else if (sub === 'unstrike') res = team.unstrike(t, user.id, interaction.options.getInteger('strike'), interaction.user, interaction.client);
    else if (sub === 'promote' || sub === 'demote') {
      const to = interaction.options.getString('to');
      const pos = to ? resolvePosition(t, to) : null;
      if (to && !pos) return fail(interaction, 'Unknown position.');
      res = await team.changePosition(interaction.client, t, { userId: user.id, by: interaction.user, direction: sub === 'promote' ? 'up' : 'down', toDeptId: pos?.dept.id, toLevelId: pos?.level.id, reason });
    } else if (sub === 'set') {
      const pos = resolvePosition(t, interaction.options.getString('position'));
      if (!pos) return fail(interaction, 'Unknown position.');
      res = await team.changePosition(interaction.client, t, { userId: user.id, by: interaction.user, toDeptId: pos.dept.id, toLevelId: pos.level.id, reason });
    } else if (sub === 'remove') res = await team.resign(interaction.client, t, { userId: user.id, by: interaction.user, reason, fired: true });
    else if (sub === 'sync') {
      const ids = user ? [user.id] : team.activeStaff(t).map((m) => m.userId);
      let n = 0;
      for (const id of ids) { await team.syncMember(interaction.client, t, id, 'Manual sync'); n++; }
      res = { ok: true, text: `Synced roles and nicknames for ${n} staff member(s) in both servers.` };
    }
    return res.ok ? ok(interaction, res.text) : fail(interaction, res.text);
  },
};
