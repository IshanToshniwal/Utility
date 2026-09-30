// /setup — quick configuration from Discord. The dashboard can do all of this and more.
// Roles are per-server: run the command in the server whose role you are picking.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../lib/store');
const team = require('../lib/team');
const { getTeam, autocompletePosition, resolvePosition } = require('../lib/ctx');
const { COLORS, embed, ok, fail } = require('../lib/util');

const CHANNEL_TYPES = [
  ['applications', 'Applications (staff server)'], ['announcements', 'Staff announcements (staff server)'], ['log', 'Staff log (staff server)'], ['breaks', 'Breaks / LOA (staff server)'], ['mainAnnouncements', 'Public new-staff post (main server)'],
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure StaffHub (admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) => s.setName('channel').setDescription('Set a channel').addStringOption((o) => o.setName('type').setDescription('Which channel').setRequired(true).addChoices(...CHANNEL_TYPES.map(([v, n]) => ({ name: n, value: v })))).addChannelOption((o) => o.setName('channel').setDescription('Channel (leave empty to clear)')))
    .addSubcommand((s) => s.setName('manager').setDescription('Toggle a manager role (staff server) — managers can verify/promote/strike/LOA').addRoleOption((o) => o.setName('role').setDescription('Role in the staff server').setRequired(true)))
    .addSubcommand((s) => s.setName('role').setDescription('Set the Staff / LOA / Pending role for THIS server').addStringOption((o) => o.setName('type').setDescription('Which role').setRequired(true).addChoices({ name: 'Staff (given to every verified member)', value: 'staff' }, { name: 'LOA (given during breaks)', value: 'loa' }, { name: 'Pending (staff server: accepted, not yet verified)', value: 'pending' })).addRoleOption((o) => o.setName('role').setDescription('Role (leave empty to clear)')))
    .addSubcommand((s) => s.setName('department').setDescription('Create a department').addStringOption((o) => o.setName('name').setDescription('e.g. Moderation').setRequired(true).setMaxLength(40)).addStringOption((o) => o.setName('emoji').setDescription('Optional emoji').setMaxLength(8)))
    .addSubcommand((s) => s.setName('position').setDescription('Create a position (level) in a department, or set its role for THIS server').addStringOption((o) => o.setName('department').setDescription('Department').setRequired(true).setAutocomplete(true)).addStringOption((o) => o.setName('name').setDescription('Position name, e.g. Trial Mod (lowest first!)').setRequired(true).setMaxLength(40)).addRoleOption((o) => o.setName('role').setDescription('Role in THIS server for this position')))
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
      const e = embed(COLORS.blue, '⚙️ StaffHub configuration')
        .addFields(
          { name: 'Servers', value: `Main: **${main?.name || '?'}**\nStaff: **${staff?.name || '?'}**` },
          { name: 'Channels (staff server)', value: `Applications: ${ch(t.channels.applications)}\nAnnouncements: ${ch(t.channels.announcements)}\nLog: ${ch(t.channels.log)}\nBreaks: ${ch(t.channels.breaks)}\nMain-server post: ${ch(t.channels.mainAnnouncements)}` },
          { name: 'Manager roles (staff server)', value: t.managerRoles.length ? t.managerRoles.map(role).join(' ') : '— (admins only)' },
          { name: 'Roles', value: `Staff: main ${role(t.roles.staffMain)} / staff ${role(t.roles.staffStaff)}\nLOA: main ${role(t.roles.loaMain)} / staff ${role(t.roles.loaStaff)}\nPending: ${role(t.roles.pendingStaff)}` },
          { name: 'Departments', value: t.departments.length ? t.departments.map((d) => `**${d.name}**: ${d.levels.map((l) => l.name).join(' → ') || '_no positions_'}`).join('\n') : '— none (dashboard → Roster)' },
          { name: 'Other', value: `Nickname: \`${t.nicknameFormat}\`\nRequire application before verify: **${t.requireApplication ? 'yes' : 'no'}**\nStrike limit: **${t.strikeLimit}** → ${t.strikeAction}\nInvite: ${t.inviteUrl || 'auto'}` }
        );
      return interaction.reply({ embeds: [e], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'channel') {
      const type = interaction.options.getString('type');
      const chan = interaction.options.getChannel('channel');
      const wantMain = type === 'mainAnnouncements';
      if (chan && wantMain !== !inStaff) return fail(interaction, wantMain ? 'Run this in the **main** server to pick a main-server channel.' : 'Run this in the **staff** server to pick staff-server channels.');
      t.channels[type] = chan ? chan.id : null;
      store.save();
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
      const key = type === 'pending' ? 'pendingStaff' : `${type}${here === 'main' ? 'Main' : 'Staff'}`;
      t.roles[key] = r ? r.id : null;
      store.save();
      return ok(interaction, `${type} role for the **${here}** server → ${r ? `${r}` : 'cleared'}.`);
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
