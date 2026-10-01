// /setup — quick configuration from Discord. The dashboard can do all of this and more.
// Roles are per-server: run the command in the server whose role you are picking.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../lib/store');
const team = require('../lib/team');
const { getTeam, autocompletePosition, resolvePosition } = require('../lib/ctx');
const { ok, fail } = require('../lib/util');
const { COLORS, card, msg } = require('../lib/ui');

const CHANNEL_TYPES = [
  ['applications', 'Applications (staff server)'], ['proof', 'Proof — applicants post proof here (staff server)'], ['verification', 'Verification requests for managers (staff server)'], ['announcements', 'Staff announcements (staff server)'], ['guide', 'New-staff guide / welcome (staff server)'], ['roster', 'Live roster message (staff server)'], ['strikes', 'Strike log (staff server)'], ['breaks', 'Breaks / LOA (staff server)'], ['log', 'General staff log (staff server)'], ['reports', 'Weekly report (staff server)'], ['mainAnnouncements', 'Public new-staff post (main server)'],
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure StaffHub (admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('channel').setDescription('Set a channel').addStringOption((o) => o.setName('type').setDescription('Which channel').setRequired(true).addChoices(...CHANNEL_TYPES.map(([v, n]) => ({ name: n, value: v })))).addChannelOption((o) => o.setName('channel').setDescription('Channel (leave empty to clear)')))
    .addSubcommand((s) => s.setName('manager').setDescription('Toggle a manager role (staff server) — managers can verify/promote/strike/LOA').addRoleOption((o) => o.setName('role').setDescription('Role in the staff server').setRequired(true)))
    .addSubcommand((s) => s.setName('role').setDescription('Set the Staff / LOA / Pending / interview-manager role for THIS server').addStringOption((o) => o.setName('type').setDescription('Which role').setRequired(true).addChoices({ name: 'Staff (given to every verified member)', value: 'staff' }, { name: 'LOA (given during breaks)', value: 'loa' }, { name: 'Pending (staff server: accepted, not yet verified)', value: 'pending' }, { name: 'Interview managers (main server: can see interview channels)', value: 'managermain' })).addRoleOption((o) => o.setName('role').setDescription('Role (leave empty to clear)')))
    .addSubcommand((s) => s.setName('interviews').setDescription('Category in the MAIN server where interview channels are created').addChannelOption((o) => o.setName('category').setDescription('Category (empty = top level)').addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand((s) => s.setName('department').setDescription('Create a department').addStringOption((o) => o.setName('name').setDescription('e.g. Moderation').setRequired(true).setMaxLength(40)).addStringOption((o) => o.setName('emoji').setDescription('Optional emoji').setMaxLength(8)))
    .addSubcommand((s) => s.setName('position').setDescription('Create a position (level) in a department, or set its role for THIS server').addStringOption((o) => o.setName('department').setDescription('Department').setRequired(true).setAutocomplete(true)).addStringOption((o) => o.setName('name').setDescription('Position name, e.g. Trial Mod (lowest first!)').setRequired(true).setMaxLength(40)).addRoleOption((o) => o.setName('role').setDescription('Role in THIS server for this position')).addStringOption((o) => o.setName('nickname').setDescription('Short tag used in nicknames, e.g. T-Mod').setMaxLength(12)))
    .addSubcommand((s) => s.setName('invite').setDescription('Permanent staff-server invite link sent to accepted applicants').addStringOption((o) => o.setName('url').setDescription('https://discord.gg/… (empty = auto-create a 1-use invite each time)')))
    .addSubcommand((s) => s.setName('view').setDescription('Show the current configuration')),
  autocomplete: autocompletePosition,

  async execute(interaction) {
    const t = await getTeam(interaction);
    if (!t) return;
    const sub = interaction.options.getSubcommand();
    const inStaff = interaction.guildId === t.staffGuildId;
    const here = inStaff ? 'staff' : 'main';

    if (sub === 'view') {
      const { main, staff } = team.guilds(interaction.client, t);
      const ch = (id, g) => (id ? `<#${id}>` : '—');
      const role = (id) => (id ? `<@&${id}>` : '—');
      const e = card({ color: COLORS.blue, title: '⚙️ StaffHub configuration', fields: [
          { name: 'Servers', value: `Main: **${main?.name || '?'}**\nStaff: **${staff?.name || '?'}**` },
          { name: 'Channels (staff server)', value: CHANNEL_TYPES.map(([k, n]) => `${n.replace(/ \(.*\)/, '')}: ${ch(t.channels[k])}`).join('\n') },
          { name: 'Manager roles (staff server)', value: t.managerRoles.length ? t.managerRoles.map(role).join(' ') : '— (admins only)' },
          { name: 'Roles', value: `Staff: main ${role(t.roles.staffMain)} / staff ${role(t.roles.staffStaff)}\nLOA: main ${role(t.roles.loaMain)} / staff ${role(t.roles.loaStaff)}\nPending: ${role(t.roles.pendingStaff)} · Interview managers (main): ${role(t.roles.managerMain)}` },
          { name: 'Departments', value: t.departments.length ? t.departments.map((d) => `**${d.name}**: ${d.levels.map((l) => l.nick && l.nick !== l.name ? `${l.name} (${l.nick})` : l.name).join(' → ') || '_no positions_'}`).join('\n') : '— none (dashboard → Roster)' },
          { name: 'Other', value: `Nickname: \`${t.nicknameFormat}\`\nRequire application before verify: **${t.requireApplication ? 'yes' : 'no'}**\nApplications: **${t.applicationsOpen ? 'open' : 'closed'}** · ${t.questions.length} questions · cooldown ${t.applyCooldownDays}d · blacklist ${Object.keys(t.blacklist).length}\nStrikes: limit **${t.strikeLimit}** → ${t.strikeAction}${t.strikeExpiryDays ? ` · expire after ${t.strikeExpiryDays}d` : ''}\nWeekly report: ${t.report.enabled ? `day ${t.report.day} at ${t.report.hour}:00 UTC` : 'off'}\nInvite: ${t.inviteUrl || 'auto'}` },
        ] });
      return interaction.reply(msg(e, { ephemeral: true }));
    }

    if (sub === 'channel') {
      const type = interaction.options.getString('type');
      const chan = interaction.options.getChannel('channel');
      const wantMain = type === 'mainAnnouncements';
      if (chan && wantMain !== !inStaff) return fail(interaction, wantMain ? 'Run this in the **main** server to pick a main-server channel.' : 'Run this in the **staff** server to pick staff-server channels.');
      t.channels[type] = chan ? chan.id : null;
      if (type === 'roster') t.rosterMessageId = null;
      store.save();
      if (type === 'roster' && chan) await team.refreshRoster(interaction.client, t);
      return ok(interaction, `${CHANNEL_TYPES.find(([v]) => v === type)[1]} → ${chan ? `<#${chan.id}>` : 'cleared'}.`);
    }
    if (sub === 'manager') {
      if (!inStaff) return fail(interaction, 'Manager roles live in the **staff** server — run this there.');
      const r = interaction.options.getRole('role');
      const i = t.managerRoles.indexOf(r.id);
      if (i === -1) t.managerRoles.push(r.id); else t.managerRoles.splice(i, 1);
      store.save();
      return ok(interaction, `${r} ${i === -1 ? 'is now' : 'is no longer'} a manager role.`);
    }
    if (sub === 'role') {
      const type = interaction.options.getString('type');
      const r = interaction.options.getRole('role');
      if (type === 'pending' && !inStaff) return fail(interaction, 'The pending role is a **staff-server** role — run this there.');
      if (type === 'managermain' && inStaff) return fail(interaction, 'The interview-manager role is a **main-server** role — run this there.');
      const key = type === 'pending' ? 'pendingStaff' : type === 'managermain' ? 'managerMain' : `${type}${here === 'main' ? 'Main' : 'Staff'}`;
      t.roles[key] = r ? r.id : null;
      store.save();
      return ok(interaction, `${type} role for the **${here}** server → ${r ? `${r}` : 'cleared'}.`);
    }
    if (sub === 'interviews') {
      if (inStaff) return fail(interaction, 'Interview channels are created in the **main** server — run this there.');
      const cat = interaction.options.getChannel('category');
      t.interviewCategory = cat ? cat.id : null;
      store.save();
      return ok(interaction, `Interview channels will be created ${cat ? `under **${cat.name}**` : 'at the top level'}.`);
    }
    if (sub === 'department') {
      const name = interaction.options.getString('name').trim();
      if (t.departments.some((d) => d.name.toLowerCase() === name.toLowerCase())) return fail(interaction, 'A department with that name exists.');
      t.departments.push({ id: store.uid(), name, emoji: interaction.options.getString('emoji') || '', levels: [] });
      store.save();
      return ok(interaction, `Department **${name}** created. Add positions with \`/setup position\` (lowest rank first).`);
    }
    if (sub === 'position') {
      const d = t.departments.find((x) => x.id === interaction.options.getString('department')) || t.departments.find((x) => x.name.toLowerCase() === interaction.options.getString('department').toLowerCase());
      if (!d) return fail(interaction, 'Unknown department — create it with `/setup department` first.');
      const name = interaction.options.getString('name').trim();
      const r = interaction.options.getRole('role');
      let l = d.levels.find((x) => x.name.toLowerCase() === name.toLowerCase());
      const created = !l;
      if (!l) { l = { id: store.uid(), name, roleMain: null, roleStaff: null }; d.levels.push(l); }
      if (r) l[here === 'main' ? 'roleMain' : 'roleStaff'] = r.id;
      const nickTag = interaction.options.getString('nickname');
      if (nickTag) l.nick = nickTag.trim();
      store.save();
      return ok(interaction, `${created ? 'Created' : 'Updated'} position **${name}** in **${d.name}**${r ? ` — ${here}-server role ${r}` : ''}.${l.roleMain && l.roleStaff ? '' : ` Still missing: ${!l.roleMain ? 'main-server role' : ''}${!l.roleMain && !l.roleStaff ? ' and ' : ''}${!l.roleStaff ? 'staff-server role' : ''} (run \`/setup position\` with the same name in the other server, or use the dashboard).`}`);
    }
    if (sub === 'invite') {
      const url = interaction.options.getString('url');
      if (url && !/^https:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//.test(url)) return fail(interaction, 'That is not a Discord invite link.');
      t.inviteUrl = url || null;
      store.save();
      return ok(interaction, url ? `Accepted applicants will receive ${url}.` : 'Invite cleared — a 1-use invite will be created for each accepted applicant.');
    }
  },
};
