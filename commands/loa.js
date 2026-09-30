// /loa give|end (managers), /break (staff request), /active breaks
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const team = require('../lib/team');
const breaks = require('../lib/breaks');
const { getTeam, requireManager } = require('../lib/ctx');
const { parseDuration, ok, fail } = require('../lib/util');

const MAX = 90 * 86400e3;
function dur(interaction, name = 'duration') {
  const ms = parseDuration(interaction.options.getString(name));
  if (!ms || ms < 60e3) return null;
  return Math.min(ms, MAX);
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('loa')
      .setDescription('Leave of absence (managers)')
      .addSubcommand((s) => s.setName('give').setDescription('Put a staff member on a break (gives the LOA role in both servers)').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true)).addStringOption((o) => o.setName('duration').setDescription('e.g. 3d, 1w, 12h').setRequired(true)).addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true).setMaxLength(300)))
      .addSubcommand((s) => s.setName('end').setDescription('End a break early').addUserOption((o) => o.setName('user').setDescription('Staff member').setRequired(true))),
    async execute(interaction) {
      const t = await getTeam(interaction);
      if (!t) return;
      if (!(await requireManager(interaction, t))) return;
      const user = interaction.options.getUser('user');
      await interaction.deferReply();
      if (interaction.options.getSubcommand() === 'end') {
        const res = await team.endLoa(interaction.client, t, { userId: user.id, by: interaction.user });
        return res.ok ? ok(interaction, res.text) : fail(interaction, res.text);
      }
      const ms = dur(interaction);
      if (!ms) return fail(interaction, 'Duration must look like `2d`, `1w`, `12h` (at least 1 minute, at most 90 days).');
      const res = await team.startLoa(interaction.client, t, { userId: user.id, by: interaction.user, durationMs: ms, reason: interaction.options.getString('reason') });
      return res.ok ? ok(interaction, res.text) : fail(interaction, res.text);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('break')
      .setDescription('Request time off (staff only) — a manager approves it')
      .addStringOption((o) => o.setName('duration').setDescription('e.g. 3d, 1w, 12h').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Why do you need a break?').setRequired(true).setMaxLength(300)),
    async execute(interaction) {
      const t = await getTeam(interaction);
      if (!t) return;
      const ms = dur(interaction);
      if (!ms) return fail(interaction, 'Duration must look like `2d`, `1w`, `12h` (at least 1 minute, at most 90 days).');
      const res = await breaks.request(interaction.client, t, { userId: interaction.user.id, durationMs: ms, reason: interaction.options.getString('reason') });
      return interaction.reply({ content: `${res.ok ? '✅' : '❌'} ${res.text}`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('active')
      .setDescription('Staff activity overview')
      .addSubcommand((s) => s.setName('breaks').setDescription('Show all staff currently on a break')),
    async execute(interaction) {
      const t = await getTeam(interaction);
      if (!t) return;
      return interaction.reply({ embeds: [breaks.activeEmbed(t)] });
    },
  },
];
