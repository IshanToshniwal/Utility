// /verify user position [proof] [notes] — managers only, after the applicant joined the staff server.
const { SlashCommandBuilder } = require('discord.js');
const team = require('../lib/team');
const { getTeam, requireManager, resolvePosition, autocompletePosition } = require('../lib/ctx');
const { ok, fail } = require('../lib/util');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Manually verify someone (managers) — normally approve their proof in the verification channel')
    .addUserOption((o) => o.setName('user').setDescription('The new staff member').setRequired(true))
    .addStringOption((o) => o.setName('position').setDescription('Department / position').setRequired(true).setAutocomplete(true))
    .addAttachmentOption((o) => o.setName('proof').setDescription('Screenshot or proof (shown in the announcement)'))
    .addStringOption((o) => o.setName('notes').setDescription('Notes for the staff record').setMaxLength(500)),
  autocomplete: autocompletePosition,

  async execute(interaction) {
    const t = await getTeam(interaction);
    if (!t) return;
    if (!(await requireManager(interaction, t))) return;
    const user = interaction.options.getUser('user');
    if (user.bot) return fail(interaction, 'Bots cannot be staff.');
    const pos = resolvePosition(t, interaction.options.getString('position'));
    if (!pos) return fail(interaction, 'Unknown position. Pick one from the list (create them on the dashboard → Roster).');
    const proof = interaction.options.getAttachment('proof');
    if (proof && !proof.contentType?.startsWith('image/')) return fail(interaction, 'Proof must be an image.');
    const { staff } = team.guilds(interaction.client, t);
    const inStaff = await team.fetchMember(staff, user.id);
    if (!inStaff) return fail(interaction, `${user} has not joined the staff server yet. Send them the invite first.`);
    await interaction.deferReply();
    const res = await team.verify(interaction.client, t, { userId: user.id, deptId: pos.dept.id, levelId: pos.level.id, by: interaction.user, proofUrl: proof?.url || null, notes: interaction.options.getString('notes') });
    return res.ok ? ok(interaction, res.text) : fail(interaction, res.text);
  },
};
