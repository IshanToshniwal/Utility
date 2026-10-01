// /staff roster | record | leaderboard | strike | unstrike | promote | demote | set | remove | sync | blacklist | report
const { SlashCommandBuilder } = require('discord.js');
const team = require('../lib/team');
const stats = require('../lib/stats');
const applications = require('../lib/applications');
const { getTeam, requireManager, resolvePosition, autocompletePosition } = require('../lib/ctx');
const { ok, fail, ts } = require('../lib/util');
const ui = require('../lib/ui');
const { COLORS, card, msg } = ui;

function leaderboardCard(t, days) {
  const lb = stats.leaderboard(t, days).filter((x) => x.total > 0).slice(0, 15);
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || `**${i + 1}.**`;
  return card({
    color: COLORS.teal, title: `🏆 Staff activity — last ${days} days`,
    text: lb.length ? lb.map((x, i) => `${medal(i)} <@${x.m.userId}> — **${x.total}** pts · ${x.msgs} msgs · ${x.mod} mod · ${x.interviews} interviews · ${x.apps + x.verifs} reviews`).join('\n') : 'No activity recorded yet. Messages in the staff server, moderation actions in the main server, interviews and application reviews all count.',
    footer: 'Score = messages + 3×mod actions + 5×interviews + 2×application reviews + 3×verifications',
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Staff team management')
    .addSubcommand((s) => s.setName('roster').setDescription('Show the staff roster by department'))
    .addSubcommand((s) => s.setName('record').setDescription("Show a staff member's record (strikes, history, activity)").addUserOption((o) => o.setName('user').setDescription('Staff member (default: you)')))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Most active staff').addIntegerOption((o) => o.setName('days').setDescription('Period in days (default 30)').setMinValue(1).setMaxValue(90)))
    .addSubcommand((s) => s.setName('strike').setDescription('Give a staff member a strike').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(500)))
    .addSubcommand((s) => s.setName('unstrike').setDescription('Remove a strike').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addIntegerOption((o) => o.setName('strike').setDescription('Strike number (#)').setRequired(true)))
    .addSubcommand((s) => s.setName('promote').setDescription('Promote one level up in their department (or to a given position)').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('to').setDescription('Optional: specific position').setAutocomplete(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('demote').setDescription('Demote one level down in their department (or to a given position)').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('to').setDescription('Optional: specific position').setAutocomplete(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('set').setDescription('Move a staff member to any position / department').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('position').setDescription('Department / position').setRequired(true).setAutocomplete(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('remove').setDescription('Remove someone from the staff team').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('sync').setDescription('Re-apply roles and nicknames from the roster (everyone, or one person)').addUserOption((o) => o.setName('user').setDescription('Only this member')))
    .addSubcommand((s) => s.setName('blacklist').setDescription('Blacklist: people who can never apply or be verified').addStringOption((o) => o.setName('action').setDescription('add / remove / list').setRequired(true).addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' })).addUserOption((o) => o.setName('user').setDescription('User')).addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)))
    .addSubcommand((s) => s.setName('report').setDescription('Post the weekly staff report now')),
  autocomplete: autocompletePosition,

  async execute(interaction) {
    const t = await getTeam(interaction);
    if (!t) return;
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');

    if (sub === 'roster') {
      await interaction.deferReply();
      return interaction.editReply(await team.rosterPayload(interaction.client, t));
    }
    if (sub === 'record') {
      const target = user || interaction.user;
      if (target.id !== interaction.user.id && !(await team.isManager(interaction.client, t, interaction.user.id))) return fail(interaction, "You can only view your own record. Managers can view everyone's.");
      return interaction.reply(msg(team.recordCard(t, target.id, target), { ephemeral: target.id === interaction.user.id }));
    }
    if (sub === 'leaderboard') return interaction.reply(msg(leaderboardCard(t, interaction.options.getInteger('days') || 30)));

    if (!(await requireManager(interaction, t))) return;
    const reason = interaction.options.getString('reason');
    if (user?.id === interaction.user.id && ['strike', 'promote', 'demote', 'remove', 'blacklist'].includes(sub)) return fail(interaction, "You can't do that to yourself.");
    if (sub === 'blacklist') {
      const action = interaction.options.getString('action');
      if (action === 'list') {
        const rows = Object.entries(t.blacklist).map(([id, b]) => `• <@${id}> — ${b.reason || 'no reason'} _(${ts(b.at, 'D')})_`);
        return interaction.reply(msg(card({ color: COLORS.red, title: `⛔ Blacklist (${rows.length})`, text: rows.join('\n') || 'Nobody is blacklisted.' }), { ephemeral: true }));
      }
      if (!user) return fail(interaction, 'Pick a user.');
      if (action === 'add') {
        applications.blacklistAdd(t, user.id, interaction.user, reason);
        const m = t.members[user.id];
        let extra = '';
        if (m && m.status !== 'resigned') { await team.resign(interaction.client, t, { userId: user.id, by: interaction.user, reason: `Blacklisted${reason ? `: ${reason}` : ''}`, fired: true }); extra = ' They were also removed from the staff team.'; }
        return ok(interaction, `${user.tag} is now blacklisted${reason ? ` (${reason})` : ''}.${extra}`);
      }
      return applications.blacklistRemove(t, user.id, interaction.user) ? ok(interaction, `${user.tag} removed from the blacklist.`) : fail(interaction, `${user.tag} is not blacklisted.`);
    }
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
      await team.refreshRoster(interaction.client, t);
      res = { ok: true, text: `Synced roles and nicknames for ${n} staff member(s) in both servers.` };
    } else if (sub === 'report') {
      const sent = await team.weeklyReport(interaction.client, t, { force: true });
      res = { ok: sent, text: sent ? 'Weekly report posted.' : 'Could not post — set a reports/announcements/log channel first.' };
    }
    return res.ok ? ok(interaction, res.text) : fail(interaction, res.text);
  },
  leaderboardCard,
};
