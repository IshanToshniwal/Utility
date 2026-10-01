// Verification requests: the ACCEPTED APPLICANT posts their proof (image) in the proof
// channel or with /proof. It lands in the verification channel where a manager picks the
// position from a dropdown (= approve) or presses Deny. Approval calls team.verify().
const { ActionRowBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const store = require('./store');
const team = require('./team');
const { COLORS, card, msg, button, row } = require('./ui');
const { ts } = require('./util');

const mention = (id) => `<@${id}>`;
const latestApp = (t, userId) => Object.values(t.applications).filter((a) => a.userId === userId).sort((a, b) => b.at.localeCompare(a.at))[0] || null;

function eligible(t, userId) {
  const m = t.members[userId];
  if (m && m.status !== 'resigned') return { ok: false, text: 'You are already a verified staff member.' };
  if (t.blacklist[userId]) return { ok: false, text: 'You are not eligible to join the staff team.' };
  if (Object.values(t.verifications).some((v) => v.userId === userId && v.status === 'pending')) return { ok: false, text: 'Your proof was already sent to the managers — please wait for them to review it.' };
  if (t.requireApplication && latestApp(t, userId)?.status !== 'accepted') return { ok: false, text: 'You need an **accepted** application first. Apply with `/apply` in the main server.' };
  return { ok: true };
}
function rows(t, id, disabled = false) {
  const options = [];
  for (const d of t.departments) for (const l of d.levels) options.push({ label: `${d.name} / ${l.name}`.slice(0, 100), value: l.id, description: l.nick && l.nick !== l.name ? `Nickname tag: ${l.nick}`.slice(0, 100) : undefined });
  const out = [];
  if (options.length) out.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`vr:approve:${id}`).setPlaceholder(disabled ? 'Reviewed' : '✅ Approve as… (pick the position)').setDisabled(disabled).addOptions(options.slice(0, 25))));
  out.push(row(button(`vr:deny:${id}`, 'Deny', ButtonStyle.Danger, '❌', disabled)));
  return out;
}
function vCard(t, v) {
  const color = v.status === 'pending' ? COLORS.blue : v.status === 'denied' ? COLORS.red : COLORS.green;
  const app = latestApp(t, v.userId);
  const fields = [];
  if (v.note) fields.push({ name: 'Note from them', value: v.note });
  if (v.status !== 'pending') fields.push({ name: v.status === 'denied' ? 'Denied by' : 'Approved by', value: `${v.by ? mention(v.by) : 'dashboard'}${v.reason ? ` — ${v.reason}` : ''}${v.levelId ? ` → **${team.positionFull(t, { deptId: v.deptId, levelId: v.levelId })}**` : ''}` });
  if (app) for (const qa of app.answers.slice(0, 3)) fields.push({ name: qa.q, value: (qa.a || '—').slice(0, 300) });
  return card({ color, title: `🪪 Verification request #${v.id} — ${v.status}`, text: `${mention(v.userId)} (${v.tag}) sent their proof ${ts(v.at)}.${app ? `\n**Application:** #${app.id} (${app.status})` : ''}`, fields, image: v.proofUrl, rows: rows(t, v.id, v.status !== 'pending') });
}
async function submit(client, t, { userId, tag, proofUrl, note = null }) {
  const el = eligible(t, userId);
  if (!el.ok) return el;
  const v = { id: ++t.counters.verify, userId, tag, proofUrl, note, at: new Date().toISOString(), status: 'pending', by: null, reason: null, levelId: null, deptId: null, messageId: null, channelId: null };
  t.verifications[v.id] = v;
  store.activity(t, `🪪 Verification request #${v.id} from ${tag}`);
  const sent = await team.post(client, t, 'verification', msg(vCard(t, v), { content: team.mgrPing(t) }));
  if (sent) { v.messageId = sent.id; v.channelId = sent.channelId; }
  store.save();
  return { ok: true, text: 'Your proof was sent to the managers. You will be verified soon — watch your DMs.', request: v };
}
async function refresh(client, t, v) {
  if (!v.messageId) return;
  const ch = await client.channels.fetch(v.channelId).catch(() => null);
  const m = ch && (await ch.messages.fetch(v.messageId).catch(() => null));
  if (m) await m.edit(msg(vCard(t, v))).catch(() => null);
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
  await team.dm(client, v.userId, msg(card({ color: COLORS.red, title: '❌ Your proof was not accepted', text: `${reason ? `**Reason:** ${reason}\n` : ''}You can send new proof in the proof channel of the staff server.` })));
  await team.post(client, t, 'log', msg(card({ color: COLORS.red, title: '❌ Verification denied', text: `#${v.id} ${mention(v.userId)} by ${by ? mention(by.id) : 'dashboard'}${reason ? ` — ${reason}` : ''}` })));
  return { ok: true, text: `Denied verification request #${v.id} from ${v.tag}.` };
}
async function onProofMessage(client, message) {
  const t = store.teamFor(message.guildId);
  if (!t || !t.channels.proof || message.channelId !== t.channels.proof || message.author.bot) return false;
  const img = message.attachments?.find?.((a) => a.contentType?.startsWith('image/')) || message.attachments?.first?.();
  const url = img?.url || (message.content.match(/https?:\/\/\S+\.(png|jpe?g|gif|webp)\S*/i) || [])[0] || null;
  const el = eligible(t, message.author.id);
  let text;
  if (!el.ok) text = `❌ ${el.text}`;
  else if (!url) text = '❌ Please attach a screenshot/image as your proof (or paste an image link).';
  else {
    const res = await submit(client, t, { userId: message.author.id, tag: message.author.tag, proofUrl: url, note: message.content?.trim().slice(0, 300) || null });
    text = `${res.ok ? '✅' : '❌'} ${res.text}`;
    if (res.ok) await message.react('✅').catch(() => null);
  }
  const r = await message.reply(msg(card({ color: text.startsWith('✅') ? COLORS.green : COLORS.red, text }))).catch(() => null);
  if (r && !text.startsWith('✅')) setTimeout(() => r.delete().catch(() => null), 15_000);
  return true;
}
function denyModal(id) {
  return new ModalBuilder().setCustomId(`vrdeny:${id}`).setTitle('Deny verification').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Reason sent to the applicant (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500))
  );
}
module.exports = { denyModal, submit, approve, deny, eligible, vCard, onProofMessage, latestApp };
