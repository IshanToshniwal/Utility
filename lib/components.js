// Routes buttons and modal submits.
//   apply:<teamId>        modal submit  -> new application
//   app:accept|deny:<id>  button        -> review application (deny opens a reason modal)
//   appdeny:<id>          modal submit  -> deny with reason
//   brk:approve|deny:<id> button        -> break request
const { MessageFlags } = require('discord.js');
const store = require('./store');
const team = require('./team');
const applications = require('./applications');
const breaks = require('./breaks');
const verification = require('./verification');

async function requireManager(interaction, t) {
  if (await team.isManager(interaction.client, t, interaction.user.id)) return true;
  await interaction.reply({ content: '❌ Only staff managers can do that.', flags: MessageFlags.Ephemeral });
  return false;
}

async function handleButton(interaction) {
  const [kind, action, id] = interaction.customId.split(':');
  const t = store.teamFor(interaction.guildId);
  if (!t) return interaction.reply({ content: '❌ This server is not linked. Run `/link` first.', flags: MessageFlags.Ephemeral });

  if (kind === 'app') {
    if (!(await requireManager(interaction, t))) return true;
    if (action === 'deny') return interaction.showModal(applications.denyModal(id));
    await interaction.deferReply();
    const res = await applications.accept(interaction.client, t, id, interaction.user);
    return interaction.editReply({ content: `${res.ok ? '✅' : '❌'} ${res.text}` });
  }
  if (kind === 'vr') {
    if (!(await requireManager(interaction, t))) return true;
    if (action === 'deny') return interaction.showModal(verification.denyModal(id));
    return false;
  }
  if (kind === 'brk') {
    if (!(await requireManager(interaction, t))) return true;
    await interaction.deferReply();
    const res = action === 'approve' ? await breaks.approve(interaction.client, t, id, interaction.user) : await breaks.deny(interaction.client, t, id, interaction.user);
    return interaction.editReply({ content: `${res.ok ? '✅' : '❌'} ${res.text}` });
  }
  return false;
}

async function handleModal(interaction) {
  const [kind, id] = interaction.customId.split(':');
  if (kind === 'apply') {
    const t = store.team(id) || store.teamFor(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ This server is no longer linked.', flags: MessageFlags.Ephemeral });
    return applications.submit(interaction, t);
  }
  if (kind === 'vrdeny') {
    const t = store.teamFor(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ Not linked.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    const res = await verification.deny(interaction.client, t, id, interaction.user, interaction.fields.getTextInputValue('reason') || null);
    return interaction.editReply({ content: `${res.ok ? '✅' : '❌'} ${res.text}` });
  }
  if (kind === 'appdeny') {
    const t = store.teamFor(interaction.guildId);
    if (!t) return interaction.reply({ content: '❌ Not linked.', flags: MessageFlags.Ephemeral });
    await interaction.deferReply();
    const reason = interaction.fields.getTextInputValue('reason') || null;
    const res = await applications.deny(interaction.client, t, id, interaction.user, reason);
    return interaction.editReply({ content: `${res.ok ? '✅' : '❌'} ${res.text}` });
  }
  return false;
}

// vr:approve:<id> select menu -> approve with the chosen position
async function handleSelect(interaction) {
  const [kind, action, id] = interaction.customId.split(':');
  if (kind !== 'vr' || action !== 'approve') return false;
  const t = store.teamFor(interaction.guildId);
  if (!t) return interaction.reply({ content: '❌ Not linked.', flags: MessageFlags.Ephemeral });
  if (!(await requireManager(interaction, t))) return true;
  await interaction.deferReply();
  const res = await verification.approve(interaction.client, t, id, interaction.user, interaction.values[0]);
  return interaction.editReply({ content: `${res.ok ? '✅' : '❌'} ${res.text}` });
}

module.exports = { handleButton, handleModal, handleSelect };
