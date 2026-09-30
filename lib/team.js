// Core staff logic shared by commands, buttons and the dashboard.
// Everything that changes a staff member goes through here so roles and
// nicknames in BOTH servers always match the roster.
const { PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const store = require('./store');
const { COLORS, embed, formatDuration, ts } = require('./util');

// ------------------------------------------------------------------ lookups
function guilds(client, t) {
  return { main: client.guilds.cache.get(t.mainGuildId) || null, staff: client.guilds.cache.get(t.staffGuildId) || null };
}
async function fetchMember(guild, userId) {
  if (!guild) return null;
  return guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
}
async function isManager(client, t, userId) {
  const { main, staff } = guilds(client, t);
  const sm = await fetchMember(staff, userId);
  if (sm) {
    if (sm.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (t.managerRoles.some((r) => sm.roles.cache.has(r))) return true;
  }
  const mm = await fetchMember(main, userId);
  if (mm?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}
function dept(t, deptId) {
  return t.departments.find((d) => d.id === deptId) || null;
}
function level(t, deptId, levelId) {
  const d = dept(t, deptId);
  if (!d) return null;
  const i = d.levels.findIndex((l) => l.id === levelId);
  if (i === -1) return null;
  return { dept: d, level: d.levels[i], index: i };
}
function findPosition(t, query) {
  // "Department / Position", "Position", or a level id
  const q = String(query || '').trim().toLowerCase();
  for (const d of t.departments) for (const l of d.levels) if (l.id === q) return { dept: d, level: l };
  for (const d of t.departments) for (const l of d.levels) if (`${d.name} / ${l.name}`.toLowerCase() === q) return { dept: d, level: l };
  const hits = [];
  for (const d of t.departments) for (const l of d.levels) if (l.name.toLowerCase() === q) hits.push({ dept: d, level: l });
  return hits.length === 1 ? hits[0] : null;
}
function positionName(t, m) {
  const p = m && level(t, m.deptId, m.levelId);
  return p ? p.level.name : 'Staff';
}
function nickTag(t, m) {
  const p = m && level(t, m.deptId, m.levelId);
  return p ? (p.level.nick || p.level.name) : 'Staff';
}
function fill(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
}
function positionFull(t, m) {
  const p = m && level(t, m.deptId, m.levelId);
  return p ? `${p.level.name} (${p.dept.name})` : 'Staff';
}
function managedRoleIds(t, which) {
  const ids = new Set();
  for (const d of t.departments) for (const l of d.levels) if (l[which === 'main' ? 'roleMain' : 'roleStaff']) ids.add(l[which === 'main' ? 'roleMain' : 'roleStaff']);
  const base = which === 'main' ? t.roles.staffMain : t.roles.staffStaff;
  const loa = which === 'main' ? t.roles.loaMain : t.roles.loaStaff;
  if (base) ids.add(base);
  if (loa) ids.add(loa);
  if (which === 'staff' && t.roles.pendingStaff) ids.add(t.roles.pendingStaff);
  return ids;
}
function activeStaff(t) {
  return Object.values(t.members).filter((m) => m.status !== 'resigned');
}

// ------------------------------------------------------------------ nickname
function nickFor(t, m, baseName) {
  const name = (baseName || m.name || m.tag || 'Staff').slice(0, 20);
  const tag = nickTag(t, m);
  let nick = fill(t.nicknameFormat, { position: tag, name, department: dept(t, m.deptId)?.name || '' });
  if (nick.length > 32) nick = fill(t.nicknameFormat, { position: tag.slice(0, 10), name: name.slice(0, 12), department: '' }).slice(0, 32);
  return nick;
}
async function setNick(member, nick) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return false;
  if (member.nickname === nick) return true;
  try {
    await member.setNickname(nick, 'StaffHub roster sync');
    return true;
  } catch {
    return false;
  }
}
async function setRoles(member, wanted, managed, reason) {
  if (!member) return false;
  const me = member.guild.members.me;
  const top = me?.roles?.highest?.position ?? Infinity;
  const toAdd = [...wanted].filter((id) => !member.roles.cache.has(id));
  const toRemove = [...managed].filter((id) => member.roles.cache.has(id) && !wanted.has(id));
  const okRole = (id) => {
    const r = member.guild.roles.cache.get(id);
    return r && r.position < top;
  };
  let ok = true;
  for (const id of toAdd) {
    if (!okRole(id)) { ok = false; continue; }
    await member.roles.add(id, reason).catch(() => (ok = false));
  }
  for (const id of toRemove) {
    if (!okRole(id)) { ok = false; continue; }
    await member.roles.remove(id, reason).catch(() => (ok = false));
  }
  return ok;
}

// Make both servers match the roster for one person.
async function syncMember(client, t, userId, reason = 'StaffHub roster sync') {
  const m = t.members[userId];
  if (!m) return { main: null, staff: null };
  const { main, staff } = guilds(client, t);
  const out = {};
  for (const [which, guild] of [['main', main], ['staff', staff]]) {
    const member = await fetchMember(guild, userId);
    if (!member) { out[which] = null; continue; }
    const wanted = new Set();
    if (m.status !== 'resigned') {
      const p = level(t, m.deptId, m.levelId);
      const roleKey = which === 'main' ? 'roleMain' : 'roleStaff';
      if (p?.level[roleKey]) wanted.add(p.level[roleKey]);
      const base = which === 'main' ? t.roles.staffMain : t.roles.staffStaff;
      if (base) wanted.add(base);
      if (m.status === 'loa') {
        const loa = which === 'main' ? t.roles.loaMain : t.roles.loaStaff;
        if (loa) wanted.add(loa);
      }
    }
    const rolesOk = await setRoles(member, wanted, managedRoleIds(t, which), reason);
    const nickOk = m.status === 'resigned' ? await setNick(member, null) : await setNick(member, nickFor(t, m));
    out[which] = { rolesOk, nickOk, member };
  }
  return out;
}

// ------------------------------------------------------------------ posting
const FALLBACK = { applications: ['log'], proof: [], verification: ['applications', 'log'], announcements: ['log'], guide: [], roster: [], strikes: ['log'], breaks: ['log'], log: [], mainAnnouncements: [] };
function channelFor(t, key) {
  for (const k of [key, ...(FALLBACK[key] || [])]) if (t.channels[k]) return t.channels[k];
  return null;
}
async function post(client, t, key, payload) {
  const { main, staff } = guilds(client, t);
  const guild = key === 'mainAnnouncements' ? main : staff;
  const id = channelFor(t, key);
  if (!guild || !id) return null;
  const ch = guild.channels.cache.get(id) || (await guild.channels.fetch(id).catch(() => null));
  if (!ch?.isTextBased()) return null;
  return ch.send(payload).catch((e) => (console.error(`post to ${key} failed:`, e.message), null));
}
async function dm(client, userId, payload) {
  const u = await client.users.fetch(userId).catch(() => null);
  if (!u) return false;
  return u.send(payload).then(() => true).catch(() => false);
}
function history(t, m, type, text, by) {
  m.history.unshift({ at: new Date().toISOString(), type, text, by: by?.id || by || null, byTag: by?.tag || null });
  if (m.history.length > 200) m.history.length = 200;
}
const mention = (id) => `<@${id}>`;
const who = (by) => (by?.id ? `<@${by.id}>` : by ? `<@${by}>` : 'system');

// Staff-only channels a member can see in the staff server (hidden from @everyone).
function staffChannels(staffGuild, member) {
  if (!staffGuild || !member) return [];
  const everyone = staffGuild.roles.everyone;
  const out = [];
  for (const c of staffGuild.channels.cache.values()) {
    if (![ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice].includes(c.type)) continue;
    const mine = c.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel);
    if (!mine) continue;
    const pub = c.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel);
    out.push({ id: c.id, name: c.name, type: c.type, staffOnly: !pub, position: c.rawPosition ?? c.position ?? 0 });
  }
  out.sort((a, b) => a.position - b.position);
  const only = out.filter((c) => c.staffOnly);
  return only.length ? only : out;
}

// ------------------------------------------------------------------ actions
async function verify(client, t, { userId, deptId, levelId, by, proofUrl = null, notes = null }) {
  const p = level(t, deptId, levelId);
  if (!p) return { ok: false, text: 'That position does not exist. Create it on the dashboard (Roster page) first.' };
  const existing = t.members[userId];
  if (existing && existing.status !== 'resigned') return { ok: false, text: `${mention(userId)} is already on the roster as **${positionFull(t, existing)}**. Use /staff promote or /staff demote instead.` };
  const app = Object.values(t.applications).filter((a) => a.userId === userId).sort((a, b) => b.at.localeCompare(a.at))[0];
  if (t.requireApplication && app?.status !== 'accepted') return { ok: false, text: `${mention(userId)} has no **accepted** application. Accept their application first (or turn off "Require application" in Settings).` };

  const user = await client.users.fetch(userId).catch(() => null);
  if (!user) return { ok: false, text: 'User not found.' };
  const m = {
    userId, tag: user.tag, name: user.globalName || user.username,
    deptId, levelId, status: 'active', joinedAt: new Date().toISOString(),
    strikes: existing?.strikes || [], history: existing?.history || [], loa: null, resignedAt: null,
    verifiedBy: by?.id || null, proofUrl, notes, applicationId: app?.id || null,
  };
  t.members[userId] = m;
  history(t, m, 'verify', `Verified as ${positionFull(t, m)}${notes ? ` — ${notes}` : ''}`, by);
  if (app) app.status = 'verified';
  store.activity(t, `✅ ${user.tag} verified as ${positionFull(t, m)} by ${by?.tag || 'dashboard'}`);
  store.save();

  const sync = await syncMember(client, t, userId, `Verified by ${by?.tag || 'dashboard'}`);
  const { staff, main } = guilds(client, t);
  const chans = staffChannels(staff, sync.staff?.member);
  const chanList = chans.length ? chans.slice(0, 25).map((c) => `<#${c.id}>`).join(' ') + (chans.length > 25 ? ` +${chans.length - 25} more` : '') : '_none yet — check the position role permissions_';

  const vars = { user: mention(userId), name: m.name, position: p.level.name, department: p.dept.name, nickname: nickFor(t, m), channels: chanList, server: main?.name || 'the server', staffserver: staff?.name || 'the staff server' };
  const e = embed(COLORS.green, '🎉 New staff member')
    .setDescription(fill(t.messages.announcement, vars))
    .addFields(
      { name: 'Position', value: `**${p.level.name}**`, inline: true },
      { name: 'Department', value: p.dept.name, inline: true },
      { name: 'Verified by', value: who(by), inline: true },
      { name: 'Nickname', value: `\`${vars.nickname}\``, inline: true },
      { name: 'Staff channels', value: chanList },
    )
    .setThumbnail(user.displayAvatarURL({ size: 128 }));
  if (notes) e.addFields({ name: 'Notes', value: notes.slice(0, 1000) });
  if (proofUrl) e.setImage(proofUrl);
  await post(client, t, 'announcements', { content: mention(userId), embeds: [e] });
  await post(client, t, 'mainAnnouncements', { embeds: [embed(COLORS.green, '🎉 New staff member', `Welcome ${mention(userId)} as our new **${p.level.name}** (${p.dept.name})!`).setThumbnail(user.displayAvatarURL({ size: 128 }))] });
  await post(client, t, 'log', { embeds: [embed(COLORS.green, '✅ Verified', `${mention(userId)} → **${positionFull(t, m)}** by ${who(by)}${proofUrl ? `\n[Proof](${proofUrl})` : ''}`)] });
  await post(client, t, 'guide', { content: mention(userId), embeds: [embed(COLORS.blue, `📖 Welcome, ${m.name}!`, fill(t.messages.guide, vars).slice(0, 4000))] });
  await dm(client, userId, { embeds: [embed(COLORS.green, `You are now staff in ${vars.server}!`, fill(t.messages.verifyDm, vars).slice(0, 4000))] });
  await refreshRoster(client, t);

  const warn = [];
  if (sync.main === null) warn.push('they are not in the main server yet (roles + nickname will apply when they join)');
  if (sync.staff === null) warn.push('they are not in the staff server');
  if (sync.main && (!sync.main.rolesOk || !sync.main.nickOk)) warn.push('some roles/nickname could not be set in the main server (check my role position)');
  if (sync.staff && (!sync.staff.rolesOk || !sync.staff.nickOk)) warn.push('some roles/nickname could not be set in the staff server (check my role position)');
  return { ok: true, text: `Verified ${user.tag} as **${positionFull(t, m)}**.${warn.length ? ` ⚠️ Note: ${warn.join('; ')}.` : ''}`, member: m };
}

async function changePosition(client, t, { userId, by, toDeptId, toLevelId, direction, reason = null }) {
  const m = t.members[userId];
  if (!m || m.status === 'resigned') return { ok: false, text: `${mention(userId)} is not on the roster.` };
  const cur = level(t, m.deptId, m.levelId);
  let target;
  if (toLevelId) {
    target = level(t, toDeptId || m.deptId, toLevelId);
    if (!target) return { ok: false, text: 'Target position not found.' };
  } else {
    if (!cur) return { ok: false, text: 'Their current position no longer exists — set a position on the dashboard.' };
    const ni = cur.index + (direction === 'up' ? 1 : -1);
    if (ni < 0) return { ok: false, text: `**${cur.level.name}** is already the lowest position in ${cur.dept.name}.` };
    if (ni >= cur.dept.levels.length) return { ok: false, text: `**${cur.level.name}** is already the highest position in ${cur.dept.name}.` };
    target = { dept: cur.dept, level: cur.dept.levels[ni], index: ni };
  }
  const from = positionFull(t, m);
  const kind = !cur ? 'transfer' : target.dept.id !== cur.dept.id ? 'transfer' : target.index > cur.index ? 'promote' : target.index < cur.index ? 'demote' : 'same';
  if (kind === 'same') return { ok: false, text: 'They already hold that position.' };
  m.deptId = target.dept.id;
  m.levelId = target.level.id;
  const to = positionFull(t, m);
  const verb = kind === 'promote' ? 'Promoted' : kind === 'demote' ? 'Demoted' : 'Transferred';
  history(t, m, kind, `${verb}: ${from} → ${to}${reason ? ` — ${reason}` : ''}`, by);
  store.activity(t, `${kind === 'promote' ? '⬆️' : kind === 'demote' ? '⬇️' : '↔️'} ${m.tag} ${verb.toLowerCase()} ${from} → ${to} by ${by?.tag || 'dashboard'}`);
  store.save();
  await syncMember(client, t, userId, `${verb} by ${by?.tag || 'dashboard'}`);
  await refreshRoster(client, t);
  const color = kind === 'promote' ? COLORS.green : kind === 'demote' ? COLORS.orange : COLORS.blue;
  const emoji = kind === 'promote' ? '⬆️' : kind === 'demote' ? '⬇️' : '↔️';
  const e = embed(color, `${emoji} ${verb}`, `${mention(userId)} is now **${target.level.name}** in **${target.dept.name}**\n${from} → ${to}${reason ? `\n**Reason:** ${reason}` : ''}\nNickname: \`${nickFor(t, m)}\``).addFields({ name: 'By', value: who(by), inline: true });
  await post(client, t, kind === 'demote' ? 'log' : 'announcements', { content: kind === 'demote' ? null : mention(userId), embeds: [e] });
  if (kind !== 'demote') await post(client, t, 'log', { embeds: [e] });
  await dm(client, userId, { embeds: [embed(color, `${emoji} You were ${verb.toLowerCase()}`, `You are now **${target.level.name}** in **${target.dept.name}**.${reason ? `\n**Reason:** ${reason}` : ''}`)] });
  return { ok: true, text: `${verb} ${m.tag}: ${from} → **${to}**.`, kind };
}

async function strike(client, t, { userId, by, reason }) {
  const m = t.members[userId];
  if (!m || m.status === 'resigned') return { ok: false, text: `${mention(userId)} is not on the roster.` };
  const s = { id: ++t.counters.strike, reason, by: by?.id || null, byTag: by?.tag || null, at: new Date().toISOString() };
  m.strikes.push(s);
  const n = m.strikes.length;
  history(t, m, 'strike', `Strike #${s.id}: ${reason}`, by);
  store.activity(t, `⚠️ Strike #${s.id} for ${m.tag} (${n}/${t.strikeLimit}) by ${by?.tag || 'dashboard'}`);
  store.save();
  const e = embed(COLORS.yellow, `⚠️ Staff strike #${s.id}`, `${mention(userId)} (${positionFull(t, m)})\n**Reason:** ${reason}\n**Strikes:** ${n} / ${t.strikeLimit}`).addFields({ name: 'By', value: who(by), inline: true });
  await post(client, t, 'strikes', { embeds: [e] });
  await dm(client, userId, { embeds: [embed(COLORS.yellow, '⚠️ You received a staff strike', `**Reason:** ${reason}\nYou now have **${n} / ${t.strikeLimit}** strikes.`)] });
  let extra = '';
  if (n >= t.strikeLimit) {
    if (t.strikeAction === 'remove') {
      await resign(client, t, { userId, by, reason: `Reached ${n} strikes`, fired: true });
      extra = ' Strike limit reached → **removed from staff**.';
    } else if (t.strikeAction === 'demote') {
      const r = await changePosition(client, t, { userId, by, direction: 'down', reason: `Reached ${n} strikes` });
      extra = r.ok ? ' Strike limit reached → **demoted**.' : ` Strike limit reached (could not demote: ${r.text})`;
    } else {
      extra = ' Strike limit reached — managers alerted.';
    }
    const mgr = t.managerRoles.map((r) => `<@&${r}>`).join(' ');
    await post(client, t, 'strikes', { content: mgr || null, embeds: [embed(COLORS.red, '🚨 Strike limit reached', `${mention(userId)} now has **${n}** strikes (limit ${t.strikeLimit}). Action: **${t.strikeAction}**.`)] });
  }
  return { ok: true, text: `Strike #${s.id} added for ${m.tag} (${n}/${t.strikeLimit}).${extra}`, strike: s };
}
function unstrike(t, userId, strikeId, by, client = null) {
  const m = t.members[userId];
  if (!m) return { ok: false, text: 'Not on the roster.' };
  const i = m.strikes.findIndex((s) => s.id === Number(strikeId));
  if (i === -1) return { ok: false, text: `No strike #${strikeId} for that member.` };
  m.strikes.splice(i, 1);
  history(t, m, 'unstrike', `Strike #${strikeId} removed`, by);
  store.activity(t, `♻️ Strike #${strikeId} removed for ${m.tag} by ${by?.tag || 'dashboard'}`);
  store.save();
  if (client) post(client, t, 'strikes', { embeds: [embed(COLORS.green, '♻️ Strike removed', `Strike #${strikeId} removed from ${mention(userId)} by ${who(by)} (${m.strikes.length} left).`)] }).catch(() => null);
  return { ok: true, text: `Removed strike #${strikeId} from ${m.tag} (${m.strikes.length} left).` };
}

async function startLoa(client, t, { userId, by, durationMs, reason }) {
  const m = t.members[userId];
  if (!m || m.status === 'resigned') return { ok: false, text: `${mention(userId)} is not on the roster.` };
  if (m.status === 'loa') return { ok: false, text: `${mention(userId)} is already on a break until ${ts(m.loa.until)}.` };
  m.status = 'loa';
  m.loa = { until: new Date(Date.now() + durationMs).toISOString(), reason, by: by?.id || null, at: new Date().toISOString() };
  history(t, m, 'loa', `Break for ${formatDuration(durationMs)}: ${reason}`, by);
  store.activity(t, `🌴 ${m.tag} on break for ${formatDuration(durationMs)} (${by?.tag || 'dashboard'})`);
  store.save();
  await syncMember(client, t, userId, 'LOA started');
  await refreshRoster(client, t);
  const e = embed(COLORS.purple, '🌴 Staff on break', `${mention(userId)} (${positionFull(t, m)}) is on leave for **${formatDuration(durationMs)}** — back ${ts(m.loa.until)}.\n**Reason:** ${reason}`).addFields({ name: 'Approved by', value: who(by), inline: true });
  await post(client, t, 'breaks', { embeds: [e] });
  await dm(client, userId, { embeds: [embed(COLORS.purple, '🌴 Your break was approved', `You are on leave until ${ts(m.loa.until, 'F')}. Your LOA role was added in both servers and will be removed automatically when your break ends.`)] });
  return { ok: true, text: `${m.tag} is on break for **${formatDuration(durationMs)}** (until ${ts(m.loa.until, 'f')}).` };
}
async function endLoa(client, t, { userId, by, auto = false }) {
  const m = t.members[userId];
  if (!m || m.status !== 'loa') return { ok: false, text: `${mention(userId)} is not on a break.` };
  m.status = 'active';
  const prev = m.loa;
  m.loa = null;
  history(t, m, 'loa_end', auto ? 'Break ended (automatic)' : 'Break ended early', by);
  store.activity(t, `👋 ${m.tag} back from break${auto ? '' : ` (ended by ${by?.tag || 'dashboard'})`}`);
  store.save();
  await syncMember(client, t, userId, 'LOA ended');
  await refreshRoster(client, t);
  await post(client, t, 'breaks', { embeds: [embed(COLORS.green, '👋 Back from break', `${mention(userId)} is back on duty${auto ? '' : ` (ended early by ${who(by)})`}.${prev ? `\nBreak reason was: ${prev.reason}` : ''}`)] });
  await dm(client, userId, { embeds: [embed(COLORS.green, '👋 Welcome back!', 'Your break has ended and your LOA role was removed.')] });
  return { ok: true, text: `${m.tag}'s break has ended.` };
}

async function resign(client, t, { userId, by, reason = null, fired = false }) {
  const m = t.members[userId];
  if (!m || m.status === 'resigned') return { ok: false, text: `${mention(userId)} is not on the roster.` };
  const pos = positionFull(t, m);
  m.status = 'resigned';
  m.loa = null;
  m.resignedAt = new Date().toISOString();
  history(t, m, fired ? 'removed' : 'resign', `${fired ? 'Removed from staff' : 'Resigned'} (was ${pos})${reason ? ` — ${reason}` : ''}`, by);
  store.activity(t, `${fired ? '🚪' : '👋'} ${m.tag} ${fired ? 'removed' : 'resigned'} (was ${pos})`);
  store.save();
  await syncMember(client, t, userId, fired ? 'Removed from staff' : 'Resigned');
  await refreshRoster(client, t);
  const e = embed(fired ? COLORS.red : COLORS.grey, fired ? '🚪 Staff member removed' : '👋 Staff member resigned', `${mention(userId)} ${fired ? 'was removed from' : 'has left'} the team. Was **${pos}**.${reason ? `\n**Reason:** ${reason}` : ''}`);
  if (fired) e.addFields({ name: 'By', value: who(by), inline: true });
  await post(client, t, 'announcements', { embeds: [e] });
  await post(client, t, 'log', { embeds: [e] });
  if (fired) await dm(client, userId, { embeds: [embed(COLORS.red, 'You were removed from the staff team', reason ? `**Reason:** ${reason}` : 'Contact a manager if you have questions.')] });
  return { ok: true, text: fired ? `Removed ${m.tag} from staff.` : `${m.tag} resigned. Roster updated, roles and nickname removed in both servers.` };
}

// Runs every minute: end expired breaks.
async function tick(client) {
  const now = Date.now();
  for (const t of Object.values(store.data.teams)) {
    for (const m of Object.values(t.members)) {
      if (m.status === 'loa' && m.loa && new Date(m.loa.until).getTime() <= now) await endLoa(client, t, { userId: m.userId, auto: true }).catch((e) => console.error('endLoa failed:', e));
    }
  }
}

// ------------------------------------------------------------------ embeds
function rosterEmbeds(t, { staffGuild = null } = {}) {
  const out = [];
  const active = activeStaff(t);
  if (!t.departments.length) return [embed(COLORS.grey, '📋 Staff roster', 'No departments yet. Create them on the dashboard → **Roster**.')];
  for (const d of t.departments) {
    const lines = [];
    for (const l of [...d.levels].reverse()) {
      const ms = active.filter((m) => m.deptId === d.id && m.levelId === l.id);
      lines.push(`**${l.name}**${l.nick && l.nick !== l.name ? ` (${l.nick})` : ''} — ${ms.length}\n${ms.length ? ms.map((m) => `${m.status === 'loa' ? '🌴 ' : '• '}${mention(m.userId)}`).join('\n') : '_—_'}`);
    }
    const total = active.filter((m) => m.deptId === d.id).length;
    out.push(embed(COLORS.blue, `${d.emoji ? d.emoji + ' ' : ''}${d.name} (${total})`, lines.join('\n\n').slice(0, 4000)));
  }
  const orphans = active.filter((m) => !level(t, m.deptId, m.levelId));
  if (orphans.length) out.push(embed(COLORS.grey, 'Unassigned', orphans.map((m) => mention(m.userId)).join('\n')));
  out[0].setAuthor({ name: `Staff roster — ${active.length} staff, ${active.filter((m) => m.status === 'loa').length} on break` });
  if (staffGuild?.iconURL?.()) out[0].setThumbnail(staffGuild.iconURL({ size: 128 }));
  return out.slice(0, 10);
}
// Keep one live roster message in the roster channel.
async function refreshRoster(client, t) {
  if (!t.channels.roster) return false;
  const { staff } = guilds(client, t);
  const ch = staff && (staff.channels.cache.get(t.channels.roster) || (await staff.channels.fetch(t.channels.roster).catch(() => null)));
  if (!ch?.isTextBased()) return false;
  const embeds = rosterEmbeds(t, { staffGuild: staff });
  embeds[0].setFooter({ text: 'Live roster — updates automatically' });
  try {
    const old = t.rosterMessageId && (await ch.messages.fetch(t.rosterMessageId).catch(() => null));
    if (old) await old.edit({ content: null, embeds });
    else {
      const msg = await ch.send({ embeds });
      t.rosterMessageId = msg.id;
      store.save();
    }
    return true;
  } catch (err) {
    console.error('refreshRoster failed:', err.message);
    return false;
  }
}

function recordEmbed(t, userId, user = null) {
  const m = t.members[userId];
  if (!m) return embed(COLORS.grey, 'Staff record', `${mention(userId)} has no staff record.`);
  const status = m.status === 'active' ? '🟢 Active' : m.status === 'loa' ? `🌴 On break until ${ts(m.loa.until)}` : `⚫ Resigned ${m.resignedAt ? ts(m.resignedAt) : ''}`;
  const e = embed(m.status === 'resigned' ? COLORS.grey : COLORS.blue, `Staff record — ${m.tag}`)
    .addFields(
      { name: 'Position', value: m.status === 'resigned' ? `_was_ ${positionFull(t, m)}` : positionFull(t, m), inline: true },
      { name: 'Status', value: status, inline: true },
      { name: 'Joined staff', value: ts(m.joinedAt, 'D'), inline: true },
      { name: `Strikes (${m.strikes.length}/${t.strikeLimit})`, value: m.strikes.length ? m.strikes.slice(-5).map((s) => `**#${s.id}** ${ts(s.at)} — ${s.reason}${s.byTag ? ` _(by ${s.byTag})_` : ''}`).join('\n') : 'None 🎉' },
      { name: 'History', value: m.history.slice(0, 8).map((h) => `${ts(h.at)} ${h.text}`).join('\n').slice(0, 1024) || '—' },
    );
  if (user) e.setThumbnail(user.displayAvatarURL({ size: 128 }));
  if (m.notes) e.addFields({ name: 'Notes', value: m.notes.slice(0, 500) });
  return e;
}

module.exports = {
  guilds, fetchMember, isManager, dept, level, findPosition, positionName, nickTag, positionFull, activeStaff, managedRoleIds, fill,
  nickFor, syncMember, post, channelFor, dm, history, staffChannels, refreshRoster,
  verify, changePosition, strike, unstrike, startLoa, endLoa, resign, tick,
  rosterEmbeds, recordEmbed,
};
