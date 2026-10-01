// /proof image [note] — accepted applicants send their verification proof (alternative to the proof channel).
const { SlashCommandBuilder } = require('discord.js');
const verification = require('../lib/verification');
const { getTeam } = require('../lib/ctx');
const ui = require('../lib/ui');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('proof')
    .setDescription('Send your verification proof to the managers (accepted applicants)')
    .addAttachmentOption((o) => o.setName('image').setDescription('Screenshot / proof image').setRequired(true))
    .addStringOption((o) => o.setName('note').setDescription('Anything the managers should know').setMaxLength(300)),
  async execute(interaction) {
    const t = await getTeam(interaction);
    if (!t) return;
    if (interaction.guildId !== t.staffGuildId) return interaction.reply(ui.fail('Send your proof in the **staff** server.'));
    const img = interaction.options.getAttachment('image');
    if (!img.contentType?.startsWith('image/')) return interaction.reply(ui.fail('The proof must be an image.'));
    const res = await verification.submit(interaction.client, t, { userId: interaction.user.id, tag: interaction.user.tag, proofUrl: img.url, note: interaction.options.getString('note') });
    return interaction.reply(res.ok ? ui.ok(res.text, { ephemeral: true }) : ui.fail(res.text));
  },
};
