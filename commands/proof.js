// /proof image [note] — accepted applicants send their verification proof (alternative to posting in the proof channel).
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const verification = require('../lib/verification');
const { getTeam } = require('../lib/ctx');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('proof')
    .setDescription('Send your verification proof to the managers (accepted applicants)')
    .addAttachmentOption((o) => o.setName('image').setDescription('Screenshot / proof image').setRequired(true))
    .addStringOption((o) => o.setName('note').setDescription('Anything the managers should know').setMaxLength(300)),
  async execute(interaction) {
    const t = await getTeam(interaction);
    if (!t) return;
    if (interaction.guildId !== t.staffGuildId) return interaction.reply({ content: '❌ Send your proof in the **staff** server.', flags: MessageFlags.Ephemeral });
    const img = interaction.options.getAttachment('image');
    if (!img.contentType?.startsWith('image/')) return interaction.reply({ content: '❌ The proof must be an image.', flags: MessageFlags.Ephemeral });
    const res = await verification.submit(interaction.client, t, { userId: interaction.user.id, tag: interaction.user.tag, proofUrl: img.url, note: interaction.options.getString('note') });
    return interaction.reply({ content: `${res.ok ? '✅' : '❌'} ${res.text}`, flags: MessageFlags.Ephemeral });
  },
};
