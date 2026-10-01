// Staff applications.
//   /apply (main server)  ->  the bot DMs the applicant and asks the questions one by one
//   -> application card in the applications channel with Accept / Interview / Deny
//   -> Accept DMs the staff-server invite; Interview opens a private channel in the main server.
const { ButtonStyle, AttachmentBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const store = require('./store');
const team = require('./team');
const stats = require('./stats');
const ui = require('./ui');
const { COLORS, card, msg, button, row } = ui;
const { ts } = require('./util');

const mention = (id) => `<@${id}>`;
const latest = (t, userId) => Object.values(t.applications).filter((a) => a.userId === userId).sort((a, b) => b.at.localeCompare(a.at))[0] || null;

// ------------------------------------------------------------------ eligibility
function canApply(t, userId) {
  if (!t.applicationsOpen) return { ok: false, text: t.closedMessage };
  if (t.blacklist[userId]) return { ok: false, text: 'You are not eligible to apply for staff.' };
  const m = t.members[userId];
  if (m && m.status !== 'resigned') return { ok: false, text: 'You are already a staff member. 🙂' };
  const last = latest(t, userId);
  if (last && (last.status === 'pending' || last.status === 'interview')) return { ok: false, text: `You already have an open application (#${last.id}). Please wait for the staff team to review it.` };
  if (last && last.status === 'denied' && t.applyCooldownDays) {
    const until = new Date(last.reviewedAt || last.at).getTime() + t.applyCooldownDays * 86400e3;
    if (until > Date.now()) return { ok: false, text: `Your last application was denied. You can apply again ${ts(until)}.` };
  }
  if (store.data.dmApps[userId]) return { ok: false, text: 'You already started an application — check your DMs with me. Reply **cancel** there to start over.' };
  if (!t.questions.length) return { ok: false, text: 'Applications are not set up yet (no questions).' };
  return { ok: true };
}

// ------------------------------------------------------------------ DM conversation
const questionCard = (t, s, main) => {
  const q = t.questions[s.step];
  return card({
    color: COLORS.blue, title: `Question ${s.step + 1} of ${t.questions.length}`, text: `**${q.label}**`,
    footer: `${q.required ? 'Required' : 'Optional — reply **skip** to leave it empty'} · **back** = previous question · **cancel** = stop${main ? ` · application for ${main}` : ''}`,
  });
};
async function start(interaction, t) {
  const el = canApply(t, interaction.user.id);
  if (!el.ok) return interaction.reply(ui.fail(el.text));
  const { main } = team.guilds(interaction.client, t);
  const s = { teamId: t.id, userId: interaction.user.id, step: -1, answers: [], startedAt: new Date().toISOString(), lastAt: new Date().toISOString() };
  const sent = await team.dm(interaction.client, interaction.user.id, msg(card({
    color: COLORS.teal, title: `📝 Staff application — ${main?.name || 'the server'}`,
    text: `Hi ${interaction.user}! I will ask you **${t.questions.length} questions**, one at a time. Answer each one by sending a message here — take your time, there is no character limit.\n\n**Reply \`start\` to begin.** You can reply \`back\` to change your previous answer and \`cancel\` at any time.`,
    thumbnail: main?.iconURL?.({ size: 128 }) || undefined,
  })));
  if (!sent) return interaction.reply(ui.fail('I could not DM you. Enable **Allow direct messages from server members** in your privacy settings for this server, then run `/apply` again.'));
  store.data.dmApps[interaction.user.id] = s;
  store.save();
  return interaction.reply(ui.msg(card({ color: COLORS.green, text: `✅ Check your DMs — I sent you the application. Reply **start** there to begin.` }), { ephemeral: true }));
}

async function onDm(client, message) {
  const s = store.data.dmApps[message.author.id];
  if (!s) return false;
  const t = store.team(s.teamId);
  if (!t) { delete store.data.dmApps[message.author.id]; return false; }
  const { main } = team.guilds(client, t);
  const text = (message.content || '').trim();
  const low = text.toLowerCase();
  const say = (c) => message.channel.send(msg(c));
  s.lastAt = new Date().toISOString();
  if (low === 'cancel') {
    delete store.data.dmApps[message.author.id];
    store.save();
    await say(card({ color: COLORS.grey, text: '❌ Application cancelled. Run `/apply` in the server whenever you want to start again.' }));
    return true;
  }
  if (s.step === -1) {
    if (low !== 'start') { await say(card({ color: COLORS.yellow, text: 'Reply **start** to begin your application, or **cancel** to stop.' })); return true; }
    s.step = 0;
    store.save();
    await say(questionCard(t, s, main?.name));
    return true;
  }
  if (low === 'back') {
    if (s.step > 0) s.step--;
    store.save();
    await say(questionCard(t, s, main?.name));
    return true;
  }
  const q = t.questions[s.step];
  const attachment = message.attachments?.first?.();
  let answer = text;
  if (attachment) answer = `${text ? text + '\n' : ''}${attachment.url}`;
  if (low === 'skip') answer = '';
  if (!answer && q.required) { await say(card({ color: COLORS.yellow, text: 'This question is required — please answer it (or reply **cancel**).' })); return true; }
  s.answers[s.step] = answer.slice(0, 1500);
  s.step++;
  if (s.step < t.questions.length) {
    store.save();
    await say(questionCard(t, s, main?.name));
    return true;
  }
  // finished
  delete store.data.dmApps[message.author.id];
  const a = await create(client, t, message.author, t.questions.map((qq, i) => ({ q: qq.label, a: s.answers[i] || '' })));
  await say(card({ color: COLORS.green, title: '✅ Application sent', text: `Thanks ${message.author}! Your application **#${a.id}** for **${main?.name || 'the server'}** was sent to the staff team. You will get a DM here when it is reviewed.` }));
  return true;
}

// ------------------------------------------------------------------ create + card
async function create(client, t, user, answers) {
  const a = {
    id: ++t.counters.app, userId: user.id, tag: user.tag, avatar: user.displayAvatarURL({ size: 128 }),
    answers, at: new Date().toISOString(), status: 'pending', by: null, reason: null, messageId: null, channelId: null,
  };
  t.applications[a.id] = a;
  store.activity(t, `📝 Application #${a.id} from ${a.tag}`);
  const sent = await team.post(client, t, 'applications', appPayload(t, a, { mention: true }));
  if (sent) { a.messageId = sent.id; a.channelId = sent.channelId; }
  store.save();
  return a;
}
function buttons(t, a) {
  const done = a.status !== 'pending' && a.status !== 'interview';
  return row(
    button(`app:accept:${a.id}`, 'Accept', ButtonStyle.Success, '✅', done),
    button(`app:interview:${a.id}`, a.status === 'interview' ? 'Interviewing' : 'Interview', ButtonStyle.Primary, '🎤', done || a.status === 'interview'),
    button(`app:deny:${a.id}`, 'Deny', ButtonStyle.Danger, '❌', done)
  );
}
function transcript(a) {
  return Buffer.from([`Staff application #${a.id}`, `Applicant: ${a.tag} (${a.userId})`, `Submitted: ${a.at}`, `Status: ${a.status}`, '', ...a.answers.map((qa, i) => `${i + 1}. ${qa.q}\n${qa.a || '(no answer)'}\n`)].join('\n'));
}
function appCard(t, a, { withButtons = true, prior = 0 } = {}) {
  const color = a.status === 'pending' ? COLORS.blue : a.status === 'interview' ? COLORS.purple : a.status === 'denied' ? COLORS.red : COLORS.green;
  const icon = { pending: '📝', interview: '🎤', accepted: '✅', verified: '✅', denied: '❌' }[a.status] || '📝';
  const fields = a.answers.map((qa, i) => ({ name: `${i + 1}. ${qa.q}`, value: (qa.a || '_no answer_').slice(0, 700) }));
  const long = a.answers.reduce((n, qa) => n + qa.q.length + (qa.a || '').length + 8, 0) > 3200;
  if (a.by) fields.push({ name: a.status === 'denied' ? 'Denied by' : a.status === 'interview' ? 'Interview by' : 'Accepted by', value: `${mention(a.by)}${a.reason ? ` — ${a.reason}` : ''}`, inline: true });
  return card({
    color, title: `${icon} Staff application #${a.id} — ${a.status}`, thumbnail: a.avatar || undefined,
    text: `**Applicant:** ${mention(a.userId)} (${a.tag})\n**Submitted:** ${ts(a.at)}${prior ? `\n**Earlier applications:** ${prior}` : ''}`,
    fields, rows: withButtons ? [buttons(t, a)] : [], files: long ? [`application-${a.id}.txt`] : [],
    footer: long ? 'Answers were shortened — the full application is attached as a file.' : undefined,
  });
}
function appPayload(t, a, { mention: ping = false } = {}) {
  const prior = Object.values(t.applications).filter((x) => x.userId === a.userId && x.id !== a.id).length;
  const long = a.answers.reduce((n, qa) => n + qa.q.length + (qa.a || '').length + 8, 0) > 3200;
  return msg(appCard(t, a, { prior }), { content: ping ? team.mgrPing(t) : null, files: long ? [new AttachmentBuilder(transcript(a), { name: `application-${a.id}.txt` })] : [] });
}
async function refreshMessage(client, t, a) {
  if (!a.messageId || !a.channelId) return;
  const ch = await client.channels.fetch(a.channelId).catch(() => null);
  const m = ch && (await ch.messages.fetch(a.messageId).catch(() => null));
  if (m) await m.edit({ ...appPayload(t, a), attachments: [] }).catch(() => null);
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

// ------------------------------------------------------------------ review
async function accept(client, t, appId, by) {
  const a = t.applications[appId];
  if (!a) return { ok: false, text: 'Application not found.' };
  if (a.status !== 'pending' && a.status !== 'interview') return { ok: false, text: `Application #${a.id} was already ${a.status}.` };
  if (t.blacklist[a.userId]) return { ok: false, text: `${a.tag} is blacklisted — remove them from the blacklist first.` };
  const wasInterview = a.status === 'interview';
  a.status = 'accepted';
  a.by = by?.id || null;
  a.reviewedAt = new Date().toISOString();
  store.activity(t, `✅ Application #${a.id} (${a.tag}) accepted by ${by?.tag || 'dashboard'}`);
  store.save();
  if (by?.id) stats.record(t, by.id, 'apps');
  const { main, staff } = team.guilds(client, t);
  const invite = await getInvite(client, t);
  const inStaff = await team.fetchMember(staff, a.userId);
  if (inStaff && t.roles.pendingStaff) await inStaff.roles.add(t.roles.pendingStaff, 'Application accepted').catch(() => null);
  const vars = { server: main?.name || 'the server', staffserver: staff?.name || 'the staff server', invite: inStaff ? '_(you are already in it)_' : invite || '_(a manager will send it to you)_', user: mention(a.userId), name: a.tag };
  const dmOk = await team.dm(client, a.userId, msg(card({ color: COLORS.green, title: '🎉 Application accepted', text: team.fill(t.messages.acceptDm, vars) })));
  await refreshMessage(client, t, a);
  if (wasInterview) await closeInterview(client, t, a.id, by, 'accepted').catch(() => null);
  await team.post(client, t, 'log', msg(card({ color: COLORS.green, title: '✅ Application accepted', text: `#${a.id} ${mention(a.userId)} by ${by ? mention(by.id) : 'dashboard'}${dmOk ? '' : '\n⚠️ Could not DM the applicant (DMs closed) — send them the invite manually.'}${invite ? `\nInvite: ${invite}` : ''}` })));
  return { ok: true, text: `Accepted application #${a.id} from ${a.tag}. ${dmOk ? 'Invite sent by DM.' : '⚠️ Their DMs are closed — send the invite manually.'} They should post their proof once they join the staff server.`, invite, dmOk };
}
async function deny(client, t, appId, by, reason = null) {
  const a = t.applications[appId];
  if (!a) return { ok: false, text: 'Application not found.' };
  if (a.status !== 'pending' && a.status !== 'interview') return { ok: false, text: `Application #${a.id} was already ${a.status}.` };
  const wasInterview = a.status === 'interview';
  a.status = 'denied';
  a.by = by?.id || null;
  a.reason = reason;
  a.reviewedAt = new Date().toISOString();
  store.activity(t, `❌ Application #${a.id} (${a.tag}) denied by ${by?.tag || 'dashboard'}`);
  store.save();
  if (by?.id) stats.record(t, by.id, 'apps');
  const { main } = team.guilds(client, t);
  const cd = t.applyCooldownDays ? `\nYou can apply again ${ts(Date.now() + t.applyCooldownDays * 86400e3, 'D')}.` : '';
  const dmOk = await team.dm(client, a.userId, msg(card({ color: COLORS.red, title: 'Application not accepted', text: team.fill(t.messages.denyDm, { server: main?.name || 'the server', reason: reason ? `**Reason:** ${reason}` : '', user: mention(a.userId), name: a.tag }) + cd })));
  await refreshMessage(client, t, a);
  if (wasInterview) await closeInterview(client, t, a.id, by, 'denied').catch(() => null);
  await team.post(client, t, 'log', msg(card({ color: COLORS.red, title: '❌ Application denied', text: `#${a.id} ${mention(a.userId)} by ${by ? mention(by.id) : 'dashboard'}${reason ? `\n**Reason:** ${reason}` : ''}${dmOk ? '' : '\n⚠️ Could not DM the applicant.'}` })));
  return { ok: true, text: `Denied application #${a.id} from ${a.tag}.${dmOk ? '' : ' (Could not DM them.)'}` };
}
function denyModal(appId) {
  return new ModalBuilder().setCustomId(`appdeny:${appId}`).setTitle('Deny application').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason sent to the applicant (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500))
  );
}

// ------------------------------------------------------------------ interviews (private channel in the MAIN server)
async function interview(client, t, appId, by) {
  const a = t.applications[appId];
  if (!a) return { ok: false, text: 'Application not found.' };
  if (a.status === 'interview') return { ok: false, text: `An interview is already open: <#${t.interviews[a.id]?.channelId}>` };
  if (a.status !== 'pending') return { ok: false, text: `Application #${a.id} was already ${a.status}.` };
  const { main } = team.guilds(client, t);
  if (!main) return { ok: false, text: 'I am not in the main server.' };
  const applicant = await team.fetchMember(main, a.userId);
  if (!applicant) return { ok: false, text: `${a.tag} is not in the main server any more.` };
  const overwrites = [
    { id: main.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: a.userId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] },
  ];
  if (by?.id && by.id !== a.userId) overwrites.push({ id: by.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  if (t.roles.managerMain) overwrites.push({ id: t.roles.managerMain, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  let ch;
  try {
    ch = await main.channels.create({ name: `interview-${a.tag.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || a.userId}`, type: ChannelType.GuildText, parent: t.interviewCategory || undefined, permissionOverwrites: overwrites, reason: `Interview for application #${a.id}` });
  } catch (err) {
    return { ok: false, text: `Could not create the interview channel: ${err.message}. Check Manage Channels and the interview category in Settings.` };
  }
  a.status = 'interview';
  a.by = by?.id || null;
  t.interviews[a.id] = { appId: a.id, userId: a.userId, channelId: ch.id, openedBy: by?.id || null, at: new Date().toISOString(), status: 'open' };
  store.activity(t, `🎤 Interview opened for application #${a.id} (${a.tag}) by ${by?.tag || 'dashboard'}`);
  store.save();
  await ch.send(msg(card({
    color: COLORS.purple, title: `🎤 Interview — ${a.tag}`, thumbnail: a.avatar || undefined,
    text: `Hi ${mention(a.userId)}! A manager would like to talk with you about your staff application. This channel is private — only you and the managers can see it.`,
    rows: [row(button(`app:accept:${a.id}`, 'Accept', ButtonStyle.Success, '✅'), button(`app:deny:${a.id}`, 'Deny', ButtonStyle.Danger, '❌'), button(`iv:close:${a.id}`, 'Close interview', ButtonStyle.Secondary, '🔒'))],
    footer: 'Buttons are for managers. Closing saves a transcript and deletes this channel.',
  }), { content: `${mention(a.userId)} ${by?.id ? mention(by.id) : ''}${t.roles.managerMain ? ` <@&${t.roles.managerMain}>` : ''}` }));
  await ch.send(msg(appCard(t, a, { withButtons: false }), { files: appPayload(t, a).files || [] }));
  await refreshMessage(client, t, a);
  await team.dm(client, a.userId, msg(card({ color: COLORS.purple, title: '🎤 Interview', text: `The staff team opened an interview channel for your application: <#${ch.id}>. Please check it in **${main.name}**.` })));
  return { ok: true, text: `Interview channel created: <#${ch.id}>`, channelId: ch.id };
}
async function closeInterview(client, t, appId, by, outcome = null) {
  const iv = t.interviews[appId];
  if (!iv || iv.status !== 'open') return { ok: false, text: 'No open interview for that application.' };
  const a = t.applications[appId];
  const { main } = team.guilds(client, t);
  const ch = main && (main.channels.cache.get(iv.channelId) || (await main.channels.fetch(iv.channelId).catch(() => null)));
  let lines = [];
  if (ch) {
    let before;
    for (let i = 0; i < 10; i++) {
      const batch = await ch.messages.fetch({ limit: 100, before }).catch(() => null);
      if (!batch?.size) break;
      lines.push(...[...batch.values()].map((m) => `[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag || '?'}: ${m.content || ''}${m.attachments?.size ? ' ' + [...m.attachments.values()].map((x) => x.url).join(' ') : ''}`));
      before = batch.last?.()?.id || [...batch.keys()].pop();
      if (batch.size < 100) break;
    }
    lines.reverse();
  }
  iv.status = 'closed';
  iv.closedBy = by?.id || null;
  iv.closedAt = new Date().toISOString();
  if (a && a.status === 'interview') a.status = 'pending';
  store.activity(t, `🔒 Interview for application #${appId} closed by ${by?.tag || 'dashboard'}`);
  store.save();
  if (by?.id) stats.record(t, by.id, 'interviews');
  const file = new AttachmentBuilder(Buffer.from(`Interview transcript — application #${appId} (${a?.tag || iv.userId})\nOpened ${iv.at} · closed ${iv.closedAt}${outcome ? ` · outcome: ${outcome}` : ''}\n\n${lines.join('\n') || '(no messages)'}`), { name: `interview-${appId}.txt` });
  await team.post(client, t, 'applications', msg(card({ color: COLORS.grey, title: `🔒 Interview closed — application #${appId}`, text: `${mention(iv.userId)} · closed by ${by ? mention(by.id) : 'dashboard'}${outcome ? ` · outcome: **${outcome}**` : ''}\n${lines.length} message(s) saved.`, files: [`interview-${appId}.txt`] }), { files: [file] }));
  if (ch) await ch.delete('Interview closed').catch(() => null);
  if (a) await refreshMessage(client, t, a);
  return { ok: true, text: `Interview closed, transcript saved (${lines.length} messages).` };
}

// ------------------------------------------------------------------ blacklist
function blacklistAdd(t, userId, by, reason) {
  t.blacklist[userId] = { reason: reason || null, by: by?.id || null, at: new Date().toISOString() };
  store.activity(t, `⛔ ${userId} blacklisted by ${by?.tag || 'dashboard'}`);
  store.save();
}
function blacklistRemove(t, userId, by) {
  if (!t.blacklist[userId]) return false;
  delete t.blacklist[userId];
  store.activity(t, `♻️ ${userId} removed from the blacklist by ${by?.tag || 'dashboard'}`);
  store.save();
  return true;
}

module.exports = { canApply, start, onDm, create, appCard, appPayload, buttons, accept, deny, denyModal, interview, closeInterview, getInvite, blacklistAdd, blacklistRemove, latest };
