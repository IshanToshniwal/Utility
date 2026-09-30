// Verification requests: the ACCEPTED APPLICANT posts their proof (image) in the proof
// channel or with /proof. It lands in the verification channel where a manager picks the
// position from a dropdown (= approve) or presses Deny. Approval calls team.verify().
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('./store');
const team = require('./team');
const { COLORS, embed, ts } = require('./util');

const mention = (id) => `<@${id}>`;

function latestApp(t, userId) {
  return Object.values(t.applications).filter((a) => a.userId === userId).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
}
// Can this user submit proof? -> { ok, text }
function eligible(t, userId) {
  const m = t.members[userId];
  if (m && m.status !== 'resigned') return { ok: false, text: 'You are already a verified staff member.' };
  if (Object.values(t.verifications).some((v) => v.userId === userId && v.status === 'pending')) return { ok: false, text: 'Your proof was already sent to the managers — please wait for them to review it.' };
  if (t.requireApplication && latestApp(t, userId)?.status !== 'accepted') return { ok: false, text: 'You need an **accepted** application first. Apply with `/apply` in the main server.' };
  return { ok: true };
}

function components(t, id, disabled = false) {
  const options = [];
  for (const d of t.departments) for (const l of d.levels) options.push({ label: `${d.name} / ${l.name}`.slice(0, 100), value: l.id, description: l.nick && l.nick !== l.name ? `Nickname tag: ${l.nick}`.slice(0, 100) : undefined });
  const rows = [];
  if (options.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`vr:approve:${id}`).setPlaceholder(disabled ? 'Reviewed' : '✅ Approve as… (pick the position)').setDisabled(disabled).addOptions(options.slice(0, 25))));
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vr:deny:${id}`).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled)));
  return rows;
}
function vEmbed(t, v) {
  const color = v.status === 'pending' ? COLORS.blue : v.status === 'denied' ? COLORS.red : COLORS.green;
  const app = latestApp(t, v.userId);
  const e = embed(color, `🪪 Verification request #${v.id} — ${v.status}`, `${mention(v.userId)} (${v.tag}) sent their proof ${ts(v.at)}.${app ? `\n**Application:** #${app.id} (${app.status})` : ''}${v.note ? `\n**Note from them:** ${v.note}` : ''}`);
  if (v.proofUrl) e.setImage(v.proofUrl);
  if (v.status !== 'pending') e.addFields({ name: v.status === 'denied' ? 'Denied by' : 'Approved by', value: `${v.by ? mention(v.by) : 'dashboard'}${v.reason ? ` — ${v.reason}` : ''}${v.levelId ? ` → **${team.positionFull(t, { deptId: v.deptId, levelId: v.levelId })}**` : ''}` });
  if (app) for (const qa of app.answers.slice(0, 3)) e.addFields({ name: qa.q.slice(0, 256), value: (qa.a || '—').slice(0, 300) });
  return e;
}

async function submit(client, t, { userId, tag, proofUrl, note = null }) {
  const el = eligible(t, userId);
  if (!el.ok) return el;
  const v = { id: ++t.counters.verify, userId, tag, proofUrl, note, at: new Date().toISOString(), status: 'pending', by: null, reason: null, levelId: null, deptId: null, messageId: null, channelId: null };
  t.verifications[v.id] = v;
  store.activity(t, `🪪 Verification request #${v.id} from ${tag}`);
  const mgr = t.managerRoles.map((r) => `<@&${r}>`).join(' ');
  const msg = await team.post(client, t, 'verification', { content: mgr || null, embeds: [vEmbed(t, v)], components: components(t, v.id) });
  if (msg) { v.messageId = msg.id; v.channelId = msg.channelId; }
  store.save();
  return { ok: true, text: 'Your proof was sent to the managers. You will be verified soon — watch your DMs.', request: v };
}

async function refresh(client, t, v) {
  if (!v.messageId) return;
  const ch = await client.channels.fetch(v.channelId).catch(() => null);
  const msg = ch && (await ch.messages.fetch(v.messageId).catch(() => null));
  if (msg) await msg.edit({ content: null, embeds: [vEmbed(t, v)], components: components(t, v.id, true) }).catch(() => null);
}

async function approve(client, t, id, by, levelId) {
  const v = t.verifications[id];
  if (!v) return { ok: false, text: 'Request not found.' };
  if (v.status !== 'pending') return { ok: false, text: `Request #${v.id} was already ${v.status}.` };
  let pos = null;
  for (const d of t.departments) for (const l of d.levels) if (l.id === levelId) pos = { dept: d, level: l };
  if (!pos) return { ok: false, text: 'Unknown position.' };
  const { staff } = team.guilds(client, t);
  if (!(await team.fetchMember(staff, v.userId))) return { ok: false, text: `${v.tag} is not in the staff server (any more). Ask them to join, then approve again.` };
  const res = await team.verify(client, t, { userId: v.userId, deptId: pos.dept.id, levelId: pos.level.id, by, proofUrl: v.proofUrl, notes: v.note });
  if (!res.ok) return res;
  Object.assign(v, { status: 'approved', by: by?.id || null, levelId: pos.level.id, deptId: pos.dept.id, reviewedAt: new Date().toISOString() });
  store.save();
  await refresh(client, t, v);
  return res;
}
async function deny(client, t, id, by, reason = null) {
  const v = t.verifications[id];
  if (!v) return { ok: false, text: 'Request not found.' };
  if (v.status !== 'pending') return { ok: false, text: `Request #${v.id} was already ${v.status}.` };
  Object.assign(v, { status: 'denied', by: by?.id || null, reason, reviewedAt: new Date().toISOString() });
  store.activity(t, `❌ Verification #${v.id} (${v.tag}) denied by ${by?.tag || 'dashboard'}`);
  store.save();
  await refresh(client, t, v);
  await team.dm(client, v.userId, { embeds: [embed(COLORS.red, '❌ Your proof was not accepted', `${reason ? `**Reason:** ${reason}\n` : ''}You can send new proof in the proof channel of the staff server.`)] });
  await team.post(client, t, 'log', { embeds: [embed(COLORS.red, '❌ Verification denied', `#${v.id} ${mention(v.userId)} by ${by ? mention(by.id) : 'dashboard'}${reason ? ` — ${reason}` : ''}`)] });
  return { ok: true, text: `Denied verification request #${v.id} from ${v.tag}.` };
}

// Message posted in the proof channel (needs the Message Content intent to see attachments).
async function onProofMessage(client, message) {
  const t = store.teamFor(message.guildId);
  if (!t || !t.channels.proof || message.channelId !== t.channels.proof || message.author.bot) return;
  const img = message.attachments?.find?.((a) => a.contentType?.startsWith('image/')) || message.attachments?.first?.();
  const url = img?.url || (message.content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\S*/i) || [])[0] || null;
  const el = eligible(t, message.author.id);
  let reply;
  if (!el.ok) reply = `❌ ${el.text}`;
  else if (!url) reply = '❌ Please attach a screenshot/image as your proof (or paste an image link).';
  else {
    const res = await submit(client, t, { userId: message.author.id, tag: message.author.tag, proofUrl: url, note: message.content?.trim().slice(0, 300) || null });
    reply = `${res.ok ? '✅' : '❌'} ${res.text}`;
    if (res.ok) await message.react('✅').catch(() => null);
  }
  const r = await message.reply({ content: reply, allowedMentions: { repliedUser: true } }).catch(() => null);
  if (r && !reply.startsWith('✅')) setTimeout(() => r.delete().catch(() => null), 15_000);
}

function denyModal(id) {
  return new ModalBuilder().setCustomId(`vrdeny:${id}`).setTitle('Deny verification').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason sent to the applicant (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500))
  );
}

module.exports = { denyModal, submit, approve, deny, eligible, vEmbed, components, onProofMessage, latestApp };
