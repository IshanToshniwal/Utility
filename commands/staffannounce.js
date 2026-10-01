// /staffannounce message [department] [dm] — post to the announcements channel and DM every staff member.
const { SlashCommandBuilder } = require('discord.js');
const team = require('../lib/team');
const { getTeam, requireManager } = require('../lib/ctx');
const ui = require('../lib/ui');
const { COLORS, card, msg } = ui;

async function announce(client, t, { title, text, deptId = null, dm = true, by }) {
  const targets = team.activeStaff(t).filter((m) => !deptId || m.deptId === deptId);
  const d = deptId ? team.dept(t, deptId) : null;
  const c = card({ color: COLORS.teal, title: `📣 ${title || 'Staff announcement'}`, text, footer: `From ${by?.tag || 'the management'}${d ? ` · ${d.name} department` : ' · all staff'}` });
  const posted = await team.post(client, t, 'announcements', msg(c, { content: deptId ? targets.map((m) => `<@${m.userId}>`).join(' ').slice(0, 1900) || null : t.roles.staffStaff ? `<@&${t.roles.staffStaff}>` : null }));
  let sent = 0;
  if (dm) for (const m of targets) if (await team.dm(client, m.userId, msg(c))) sent++;
  return { ok: true, text: `Announcement ${posted ? 'posted' : 'NOT posted (no announcements/log channel)'}${dm ? ` and DMed to ${sent}/${targets.length} staff` : ''}.`, sent, targets: targets.length };
}

module.exports = {
  announce,
  data: new SlashCommandBuilder()
    .setName('staffannounce')
    .setDescription('Announce something to the staff team (posts + DMs)')
    .addStringOption((o) => o.setName('message').setDescription('The announcement').setRequired(true).setMaxLength(1800))
    .addStringOption((o) => o.setName('title').setDescription('Title').setMaxLength(80))
    .addStringOption((o) => o.setName('department').setDescription('Only this department').setAutocomplete(true))
    .addBooleanOption((o) => o.setName('dm').setDescription('Also DM everyone (default: yes)')),
  autocomplete: require('../lib/ctx').autocompletePosition,
  async execute(interaction) {
    const t = await getTeam(interaction);
    if (!t) return;
    if (!(await requireManager(interaction, t))) return;
    const deptId = interaction.options.getString('department');
    if (deptId && !team.dept(t, deptId)) return interaction.reply(ui.fail('Unknown department.'));
    await interaction.deferReply({ flags: 64 });
    const res = await announce(interaction.client, t, { title: interaction.options.getString('title'), text: interaction.options.getString('message'), deptId, dm: interaction.options.getBoolean('dm') ?? true, by: interaction.user });
    return interaction.editReply(ui.ok(res.text));
  },
};
