// Staff applications: /apply modal in the main server -> applications channel in the
// staff server with Accept / Deny buttons -> DM with the staff-server invite.
const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const store = require('./store');
const team = require('./team');
const { COLORS, embed, ts } = require('./util');

const mention = (id) => `<@${id}>`;

function buildModal(t) {
  const modal = new ModalBuilder().setCustomId(`apply:${t.id}`).setTitle('Staff application');
  t.questions.slice(0, 5).forEach((q, i) => {
    const input = new TextInputBuilder().setCustomId(`q${i}`).setLabel(q.label.slice(0, 45)).setStyle(q.long ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(Boolean(q.required)).setMaxLength(q.long ? 1000 : 200);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  });
  return modal;
}

function buttons(appId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app:accept:${appId}`).setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`app:deny:${appId}`).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

function appEmbed(t, a, user = null) {
  const color = a.status === 'pending' ? COLORS.blue : a.status === 'denied' ? COLORS.red : COLORS.green;
  const e = embed(color, `📝 Staff application #${a.id} — ${a.status}`, `**Applicant:** ${mention(a.userId)} (${a.tag})\n**Submitted:** ${ts(a.at)}`);
  for (const qa of a.answers) e.addFields({ name: qa.q.slice(0, 256), value: (qa.a || '_no answer_').slice(0, 1024) });
  if (a.by) e.addFields({ name: a.status === 'denied' ? 'Denied by' : 'Accepted by', value: `${mention(a.by)}${a.reason ? ` — ${a.reason}` : ''}` });
  if (user) e.setThumbnail(user.displayAvatarURL({ size: 128 }));
  else if (a.avatar) e.setThumbnail(a.avatar);
  return e;
}

async function open(interaction, t) {
  const pending = Object.values(t.applications).find((a) => a.userId === interaction.user.id && a.status === 'pending');
  if (pending) return interaction.reply({ content: `You already have a pending application (#${pending.id}). Please wait for the staff team to review it.`, flags: MessageFlags.Ephemeral });
  const m = t.members[interaction.user.id];
  if (m && m.status !== 'resigned') return interaction.reply({ content: 'You are already a staff member. 🙂', flags: MessageFlags.Ephemeral });
  if (!t.channels.applications && !t.channels.log) return interaction.reply({ content: 'Applications are not set up yet — an admin needs to pick an applications channel on the dashboard.', flags: MessageFlags.Ephemeral });
  return interaction.showModal(buildModal(t));
}

async function submit(interaction, t) {
  const answers = t.questions.slice(0, 5).map((q, i) => ({ q: q.label, a: interaction.fields.getTextInputValue(`q${i}`) || '' }));
  const a = {
    id: ++t.counters.app, userId: interaction.user.id, tag: interaction.user.tag, avatar: interaction.user.displayAvatarURL({ size: 128 }),
    answers, at: new Date().toISOString(), status: 'pending', by: null, reason: null, messageId: null, channelId: null,
  };
  t.applications[a.id] = a;
  store.activity(t, `📝 Application #${a.id} from ${a.tag}`);
  const mgr = t.managerRoles.map((r) => `<@&${r}>`).join(' ');
  const msg = await team.post(interaction.client, t, 'applications', { content: mgr || null, embeds: [appEmbed(t, a, interaction.user)], components: [buttons(a.id)] });
  if (msg) { a.messageId = msg.id; a.channelId = msg.channelId; }
  store.save();
  return interaction.reply({ embeds: [embed(COLORS.green, '✅ Application sent', `Thanks ${interaction.user}! Your application (#${a.id}) was sent to the staff team. You will get a DM when it is reviewed — make sure your DMs are open.`)], flags: MessageFlags.Ephemeral });
}

async function getInvite(client, t) {
  if (t.inviteUrl) return t.inviteUrl;
  const { staff } = team.guilds(client, t);
  if (!staff) return null;
  const ch = staff.channels.cache.get(t.channels.announcements) || staff.channels.cache.find((c) => c.type === 0 && c.permissionsFor(staff.members.me)?.has('CreateInstantInvite')) || staff.systemChannel || staff.rulesChannel;
  if (!ch) return null;
  const inv = await staff.invites.create(ch.id, { maxAge: 7 * 86400, maxUses: 1, unique: true, reason: 'StaffHub: accepted applicant' }).catch(() => null);
  return inv ? inv.url : null;
}

async function refreshMessage(client, t, a) {
  if (!a.messageId || !a.channelId) return;
  const ch = await client.channels.fetch(a.channelId).catch(() => null);
  const msg = ch && (await ch.messages.fetch(a.messageId).catch(() => null));
  if (msg) await msg.edit({ content: null, embeds: [appEmbed(t, a)], components: [buttons(a.id, true)] }).catch(() => null);
}

async function accept(client, t, appId, by) {
  const a = t.applications[appId];
  if (!a) return { ok: false, text: 'Application not found.' };
  if (a.status !== 'pending') return { ok: false, text: `Application #${a.id} was already ${a.status}.` };
  a.status = 'accepted';
  a.by = by?.id || null;
  a.reviewedAt = new Date().toISOString();
  store.activity(t, `✅ Application #${a.id} (${a.tag}) accepted by ${by?.tag || 'dashboard'}`);
  store.save();
  const { main, staff } = team.guilds(client, t);
  const invite = await getInvite(client, t);
  const inStaff = await team.fetchMember(staff, a.userId);
  if (inStaff && t.roles.pendingStaff) await inStaff.roles.add(t.roles.pendingStaff, 'Application accepted').catch(() => null);
  const dmOk = await team.dm(client, a.userId, {
    embeds: [embed(COLORS.green, `🎉 Your staff application for ${main?.name || 'the server'} was accepted!`,
      `${inStaff ? 'You are already in the staff server — a manager will verify you shortly.' : invite ? `**Next step:** join the staff server using this invite, then wait for a manager to verify you:\n${invite}` : 'A manager will contact you with the staff server invite.'}\n\nOnce verified you will get your position role and staff channels automatically.`)],
  });
  await refreshMessage(client, t, a);
  await team.post(client, t, 'log', { embeds: [embed(COLORS.green, '✅ Application accepted', `#${a.id} ${mention(a.userId)} by ${by ? mention(by.id) : 'dashboard'}${dmOk ? '' : '\n⚠️ Could not DM the applicant (DMs closed) — send them the invite manually.'}${invite ? `\nInvite: ${invite}` : ''}`)] });
  return { ok: true, text: `Accepted application #${a.id} from ${a.tag}. ${dmOk ? 'Invite sent by DM.' : '⚠️ Their DMs are closed — send the invite manually.'} Verify them with \`/verify\` once they join the staff server.`, invite, dmOk };
}

async function deny(client, t, appId, by, reason = null) {
  const a = t.applications[appId];
  if (!a) return { ok: false, text: 'Application not found.' };
  if (a.status !== 'pending') return { ok: false, text: `Application #${a.id} was already ${a.status}.` };
  a.status = 'denied';
  a.by = by?.id || null;
  a.reason = reason;
  a.reviewedAt = new Date().toISOString();
  store.activity(t, `❌ Application #${a.id} (${a.tag}) denied by ${by?.tag || 'dashboard'}`);
  store.save();
  const { main } = team.guilds(client, t);
  const dmOk = await team.dm(client, a.userId, { embeds: [embed(COLORS.red, `Your staff application for ${main?.name || 'the server'} was not accepted`, `${reason ? `**Reason:** ${reason}\n\n` : ''}Thank you for applying — you may apply again in the future.`)] });
  await refreshMessage(client, t, a);
  await team.post(client, t, 'log', { embeds: [embed(COLORS.red, '❌ Application denied', `#${a.id} ${mention(a.userId)} by ${by ? mention(by.id) : 'dashboard'}${reason ? `\n**Reason:** ${reason}` : ''}${dmOk ? '' : '\n⚠️ Could not DM the applicant.'}`)] });
  return { ok: true, text: `Denied application #${a.id} from ${a.tag}.${dmOk ? '' : ' (Could not DM them.)'}` };
}

function denyModal(appId) {
  return new ModalBuilder().setCustomId(`appdeny:${appId}`).setTitle('Deny application').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason sent to the applicant (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500))
  );
}

module.exports = { buildModal, buttons, appEmbed, open, submit, accept, deny, denyModal, getInvite };
