// Break (LOA) requests from staff, approved by managers.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('./store');
const team = require('./team');
const { COLORS, embed, formatDuration, ts } = require('./util');

const mention = (id) => `<@${id}>`;

function buttons(id, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`brk:approve:${id}`).setLabel('Approve').setEmoji('✅').setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`brk:deny:${id}`).setLabel('Deny').setEmoji('❌').setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}
function reqEmbed(t, r) {
  const color = r.status === 'pending' ? COLORS.purple : r.status === 'denied' ? COLORS.red : COLORS.green;
  const e = embed(color, `🌴 Break request — ${r.status}`, `${mention(r.userId)} (${team.positionFull(t, t.members[r.userId])}) asks for **${formatDuration(r.durationMs)}** off.\n**Reason:** ${r.reason}\n**Requested:** ${ts(r.at)}`);
  if (r.by) e.addFields({ name: r.status === 'denied' ? 'Denied by' : 'Approved by', value: mention(r.by) });
  return e;
}

async function request(client, t, { userId, durationMs, reason }) {
  const m = t.members[userId];
  if (!m || m.status === 'resigned') return { ok: false, text: 'Only staff on the roster can request a break.' };
  if (m.status === 'loa') return { ok: false, text: `You are already on a break until ${ts(m.loa.until)}.` };
  if (Object.values(t.breakRequests).some((r) => r.userId === userId && r.status === 'pending')) return { ok: false, text: 'You already have a pending break request.' };
  const r = { id: ++t.counters.breakReq, userId, durationMs, reason, at: new Date().toISOString(), status: 'pending', by: null, messageId: null, channelId: null };
  t.breakRequests[r.id] = r;
  store.activity(t, `🌴 Break request #${r.id} from ${m.tag} (${formatDuration(durationMs)})`);
  const mgr = t.managerRoles.map((x) => `<@&${x}>`).join(' ');
  const msg = await team.post(client, t, 'breaks', { content: mgr || null, embeds: [reqEmbed(t, r)], components: [buttons(r.id)] });
  if (msg) { r.messageId = msg.id; r.channelId = msg.channelId; }
  store.save();
  return { ok: true, text: `Break request #${r.id} sent to the managers (${formatDuration(durationMs)}). You'll get a DM when it is reviewed.`, request: r };
}

async function refresh(client, t, r) {
  if (!r.messageId) return;
  const ch = await client.channels.fetch(r.channelId).catch(() => null);
  const msg = ch && (await ch.messages.fetch(r.messageId).catch(() => null));
  if (msg) await msg.edit({ content: null, embeds: [reqEmbed(t, r)], components: [buttons(r.id, true)] }).catch(() => null);
}

async function approve(client, t, id, by) {
  const r = t.breakRequests[id];
  if (!r) return { ok: false, text: 'Request not found.' };
  if (r.status !== 'pending') return { ok: false, text: `Request #${r.id} was already ${r.status}.` };
  const res = await team.startLoa(client, t, { userId: r.userId, by, durationMs: r.durationMs, reason: r.reason });
  if (!res.ok) return res;
  r.status = 'approved';
  r.by = by?.id || null;
  store.save();
  await refresh(client, t, r);
  return { ok: true, text: `Approved break #${r.id}: ${res.text}` };
}
async function deny(client, t, id, by) {
  const r = t.breakRequests[id];
  if (!r) return { ok: false, text: 'Request not found.' };
  if (r.status !== 'pending') return { ok: false, text: `Request #${r.id} was already ${r.status}.` };
  r.status = 'denied';
  r.by = by?.id || null;
  store.activity(t, `❌ Break request #${r.id} denied by ${by?.tag || 'dashboard'}`);
  store.save();
  await refresh(client, t, r);
  await team.dm(client, r.userId, { embeds: [embed(COLORS.red, '❌ Break request denied', `Your request for ${formatDuration(r.durationMs)} off was denied by ${by ? mention(by.id) : 'a manager'}. Talk to them if you need to.`)] });
  return { ok: true, text: `Denied break request #${r.id}.` };
}

function activeEmbed(t) {
  const onBreak = team.activeStaff(t).filter((m) => m.status === 'loa').sort((a, b) => a.loa.until.localeCompare(b.loa.until));
  const pending = Object.values(t.breakRequests).filter((r) => r.status === 'pending');
  const e = embed(COLORS.purple, `🌴 Active breaks (${onBreak.length})`, onBreak.length ? onBreak.map((m) => `• ${mention(m.userId)} — **${team.positionFull(t, m)}**\n  back ${ts(m.loa.until)} (${ts(m.loa.until, 'D')}) — ${m.loa.reason}`).join('\n') : 'Nobody is on a break right now. 🎉');
  if (pending.length) e.addFields({ name: `Pending requests (${pending.length})`, value: pending.map((r) => `#${r.id} ${mention(r.userId)} — ${formatDuration(r.durationMs)} — ${r.reason}`).join('\n').slice(0, 1024) });
  return e;
}

module.exports = { request, approve, deny, activeEmbed, buttons, reqEmbed };
