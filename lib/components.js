// Routes buttons, select menus and modal submits.
//   app:accept|interview|deny:<id>   application review (deny opens a reason modal)
//   appdeny:<id>                     modal -> deny with reason
//   iv:close:<id>                    close an interview channel
//   vr:approve:<id> (select) / vr:deny:<id> / vrdeny:<id> (modal)
//   brk:approve|deny:<id>
const store = require('./store');
const team = require('./team');
const applications = require('./applications');
const breaks = require('./breaks');
const verification = require('./verification');
const ui = require('./ui');

async function requireManager(interaction, t) {
  if (await team.isManager(interaction.client, t, interaction.user.id)) return true;
  await interaction.reply(ui.fail('Only staff managers can do that.'));
  return false;
}
const done = (interaction, res) => interaction.editReply(res.ok ? ui.ok(res.text) : ui.fail(res.text, { ephemeral: false }));

async function handleButton(interaction) {
  const [kind, action, id] = interaction.customId.split(':');
  const t = store.teamFor(interaction.guildId);
  if (!t) return interaction.reply(ui.fail('This server is not linked. Run `/link` first.'));
  if (kind === 'app') {
    if (!(await requireManager(interaction, t))) return true;
    if (action === 'deny') return interaction.showModal(applications.denyModal(id));
    await interaction.deferReply();
    const res = action === 'interview' ? await applications.interview(interaction.client, t, id, interaction.user) : await applications.accept(interaction.client, t, id, interaction.user);
    return done(interaction, res);
  }
  if (kind === 'iv') {
    if (!(await requireManager(interaction, t))) return true;
    await interaction.deferReply();
    const res = await applications.closeInterview(interaction.client, t, id, interaction.user);
    return done(interaction, res).catch(() => null); // channel may already be gone
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
    return done(interaction, res);
  }
  return false;
}
async function handleModal(interaction) {
  const [kind, id] = interaction.customId.split(':');
  const t = store.teamFor(interaction.guildId);
  if (!t) return interaction.reply(ui.fail('Not linked.'));
  if (kind === 'vrdeny' || kind === 'appdeny') {
    await interaction.deferReply();
    const reason = interaction.fields.getTextInputValue('reason') || null;
    const res = kind === 'vrdeny' ? await verification.deny(interaction.client, t, id, interaction.user, reason) : await applications.deny(interaction.client, t, id, interaction.user, reason);
    return done(interaction, res);
  }
  return false;
}
async function handleSelect(interaction) {
  const [kind, action, id] = interaction.customId.split(':');
  if (kind !== 'vr' || action !== 'approve') return false;
  const t = store.teamFor(interaction.guildId);
  if (!t) return interaction.reply(ui.fail('Not linked.'));
  if (!(await requireManager(interaction, t))) return true;
  await interaction.deferReply();
  const res = await verification.approve(interaction.client, t, id, interaction.user, interaction.values[0]);
  return done(interaction, res);
}
module.exports = { handleButton, handleModal, handleSelect };
