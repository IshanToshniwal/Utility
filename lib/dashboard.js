// Admin dashboard: Login with Discord (OAuth2). Only Administrators of the main or
// staff server of a linked pair can open it. No extra dependencies.
const crypto = require('crypto');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('./store');
const team = require('./team');
const applications = require('./applications');
const breaks = require('./breaks');
const views = require('./views');
const { parseDuration, formatDuration } = require('./util');

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET not set — dashboard logins will reset on every restart.');
const sessions = new Map();
const SESSION_TTL = 7 * 86400e3;

function sign(v) { return `${v}.${crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url')}`; }
function unsign(s) {
  if (!s) return null;
  const i = s.lastIndexOf('.');
  if (i === -1) return null;
  const v = s.slice(0, i);
  const expected = sign(v);
  if (expected.length !== s.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  return v;
}
function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}
function baseUrl(req) { return process.env.BASE_URL?.replace(/\/$/, '') || `${req.headers['x-forwarded-proto'] || req.protocol || 'https'}://${req.headers.host}`; }
function getSession(req) {
  const sid = unsign(parseCookies(req).sid);
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_TTL) { sessions.delete(sid); return null; }
  return s;
}
const ADMIN = PermissionFlagsBits.Administrator;
const isAdmin = (g) => g.owner || Boolean(BigInt(g.permissions || 0) & ADMIN);
const q = (res, base, ok, err) => res.redirect(`${base}?${ok ? `ok=${encodeURIComponent(ok)}` : `err=${encodeURIComponent(err || 'Failed')}`}`);
const byUser = (by) => ({ id: by.id, tag: by.username });

function mount(app, client) {
  const express = require('express');
  app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false }));
  app.use((req, _res, next) => { req.session = getSession(req); next(); });

  // -------------------------------------------------------------- public
  app.get('/status', (req, res) => {
    const mem = process.memoryUsage();
    res.send(views.status({
      session: req.session, ready: client.isReady?.() ?? false, guilds: client.guilds.cache.size, uptime: process.uptime(), ping: client.ws?.ping ?? null, memoryMb: Math.round(mem.rss / 1048576),
      storage: store.hasPostgres?.() ? 'Postgres' : process.env.DATA_CHANNEL_ID ? 'Discord channel backup' : 'Local file only (not persistent on Render!)',
      errors: client.recentErrors || [], teams: Object.keys(store.data.teams).length, staff: Object.values(store.data.teams).reduce((n, t) => n + team.activeStaff(t).length, 0),
    }));
  });
  app.get('/', (req, res) => {
    if (req.session) return res.redirect('/dashboard');
    res.send(views.landing({ botName: client.user?.username || 'StaffHub', avatar: client.user?.displayAvatarURL?.({ size: 128 }) }));
  });

  // -------------------------------------------------------------- auth
  app.get('/auth/login', (req, res) => {
    if (!process.env.CLIENT_SECRET) return res.status(500).send(views.error('CLIENT_SECRET is not set on the server.'));
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `oauth_state=${sign(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600; Secure`);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.searchParams.set('client_id', process.env.CLIENT_ID);
    url.searchParams.set('redirect_uri', `${baseUrl(req)}/auth/callback`);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify guilds');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'none');
    res.redirect(url.toString());
  });
  app.get('/auth/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      if (error) return res.status(400).send(views.error(`Discord login was cancelled (${error}).`));
      const expected = unsign(parseCookies(req).oauth_state);
      if (!code || !state || state !== expected) return res.status(400).send(views.error('Invalid login state. Please try again.'));
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.CLIENT_ID, client_secret: process.env.CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: `${baseUrl(req)}/auth/callback` }),
      });
      if (!tokenRes.ok) return res.status(400).send(views.error(`Token exchange failed (${tokenRes.status}). Check CLIENT_SECRET and that the redirect URL is added in the Developer Portal.`));
      const token = await tokenRes.json();
      const h = { Authorization: `Bearer ${token.access_token}` };
      const [user, guilds] = await Promise.all([fetch('https://discord.com/api/users/@me', { headers: h }).then((r) => r.json()), fetch('https://discord.com/api/users/@me/guilds', { headers: h }).then((r) => r.json())]);
      if (!user?.id || !Array.isArray(guilds)) return res.status(400).send(views.error('Could not load your Discord profile.'));
      const sid = crypto.randomBytes(24).toString('hex');
      sessions.set(sid, {
        user: { id: user.id, username: user.global_name || user.username, avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null },
        adminGuilds: guilds.filter(isAdmin).map((g) => ({ id: g.id, name: g.name, icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null })),
        csrf: crypto.randomBytes(16).toString('hex'), createdAt: Date.now(),
      });
      res.setHeader('Set-Cookie', [`sid=${sign(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}; Secure`, 'oauth_state=; Path=/; Max-Age=0']);
      res.redirect('/dashboard');
    } catch (err) {
      console.error('OAuth callback failed:', err);
      res.status(500).send(views.error('Login failed. Check the server logs.'));
    }
  });
  app.get('/auth/logout', (req, res) => {
    const sid = unsign(parseCookies(req).sid);
    if (sid) sessions.delete(sid);
    res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0');
    res.redirect('/');
  });

  // -------------------------------------------------------------- guards + context
  const requireLogin = (req, res, next) => (req.session ? next() : res.redirect('/'));
  const requireTeam = (req, res, next) => {
    const t = store.team(req.params.teamId);
    if (!t) return res.status(404).send(views.error('That team does not exist (was it unlinked?).', req.session));
    if (!req.session.adminGuilds.some((g) => g.id === t.mainGuildId || g.id === t.staffGuildId)) return res.status(403).send(views.error('You must be an Administrator of the main or staff server.', req.session));
    const { main, staff } = team.guilds(client, t);
    req.t = t;
    req.main = main;
    req.staff = staff;
    req.team = { id: t.id, mainName: main?.name || 'main server', staffName: staff?.name || 'staff server', mainIcon: main?.iconURL?.({ size: 64 }) || null };
    req.base = `/dashboard/${t.id}`;
    next();
  };
  const csrf = (req, res, next) => (req.body?._csrf === req.session.csrf ? next() : res.status(403).send(views.error('Form expired — go back and try again.', req.session)));
  const ctx = (req, page, extra = {}) => ({ session: req.session, team: req.team, t: req.t, page, q: { ok: req.query.ok, err: req.query.err }, ...extra });
  const rolesOf = (g) => (g ? [...g.roles.cache.values()].filter((r) => r.id !== g.id && !r.managed).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name })) : []);
  const chansOf = (g) => (g ? [...g.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement).sort((a, b) => a.rawPosition - b.rawPosition).map((c) => ({ id: c.id, name: c.name })) : []);
  const enrich = (t, m) => {
    const p = team.level(t, m.deptId, m.levelId);
    const u = client.users.cache.get(m.userId);
    return { ...m, deptName: p?.dept.name || '—', posName: p?.level.name || '—', posFull: team.positionFull(t, m), avatar: u?.displayAvatarURL?.({ size: 64 }) || null };
  };
  const actor = (req) => byUser(req.session.user);

  // -------------------------------------------------------------- team list
  app.get('/dashboard', requireLogin, (req, res) => {
    const seen = new Set();
    const teams = [];
    for (const g of req.session.adminGuilds) {
      const t = store.teamFor(g.id);
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      const { main, staff } = team.guilds(client, t);
      teams.push({ id: t.id, mainName: main?.name || 'main server', staffName: staff?.name || 'staff server', mainIcon: main?.iconURL?.({ size: 64 }) || null, staffCount: team.activeStaff(t).length, pending: Object.values(t.applications).filter((a) => a.status === 'pending').length + Object.values(t.breakRequests).filter((r) => r.status === 'pending').length });
    }
    const unlinked = req.session.adminGuilds.filter((g) => !store.teamFor(g.id)).map((g) => ({ ...g, inBot: client.guilds.cache.has(g.id) }));
    const invite = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot%20applications.commands&permissions=402770945`;
    res.send(views.teams({ session: req.session, teams, unlinked, invite }));
  });

  // -------------------------------------------------------------- overview
  app.get('/dashboard/:teamId', requireLogin, requireTeam, (req, res) => {
    const t = req.t;
    const active = team.activeStaff(t);
    const month = Date.now() - 30 * 86400e3;
    const issues = [];
    if (!req.main) issues.push('The bot is not in the main server any more.');
    if (!req.staff) issues.push('The bot is not in the staff server any more.');
    if (!t.channels.applications) issues.push('No applications channel — <a href="' + req.base + '/settings">Settings</a>.');
    if (!t.channels.announcements && !t.channels.log) issues.push('No announcements or log channel — nothing will be posted.');
    if (!t.departments.some((d) => d.levels.length)) issues.push('No positions yet — <a href="' + req.base + '/roster">create departments and positions</a>.');
    if (!t.managerRoles.length) issues.push('No manager roles — only Administrators can verify/promote/strike.');
    for (const g of [req.main, req.staff]) if (g && g.members.me && !g.members.me.permissions.has(PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ManageNicknames)) issues.push(`I am missing Manage Roles / Manage Nicknames in <b>${views.esc(g.name)}</b>.`);
    res.send(views.overview(ctx(req, 'overview', {
      stats: { staff: active.length, loa: active.filter((m) => m.status === 'loa').length, pendingApps: Object.values(t.applications).filter((a) => a.status === 'pending').length, pendingBreaks: Object.values(t.breakRequests).filter((r) => r.status === 'pending').length, strikes30: Object.values(t.members).reduce((n, m) => n + m.strikes.filter((s) => new Date(s.at) > month).length, 0), departments: t.departments.length, setupIssues: issues },
      activity: t.activity,
      deptStats: t.departments.map((d) => ({ name: d.name, emoji: d.emoji, levels: d.levels.length, count: active.filter((m) => m.deptId === d.id).length })),
    })));
  });

  // -------------------------------------------------------------- roster
  app.get('/dashboard/:teamId/roster', requireLogin, requireTeam, (req, res) => {
    const counts = {};
    for (const m of team.activeStaff(req.t)) { counts[m.deptId] = (counts[m.deptId] || 0) + 1; counts[m.levelId] = (counts[m.levelId] || 0) + 1; }
    res.send(views.roster(ctx(req, 'roster', { mainRoles: rolesOf(req.main), staffRoles: rolesOf(req.staff), counts })));
  });
  app.post('/dashboard/:teamId/roster', requireLogin, requireTeam, csrf, async (req, res) => {
    const t = req.t, b = req.body, base = `${req.base}/roster`;
    const d = t.departments.find((x) => x.id === b.dept);
    const name = String(b.name || '').trim().slice(0, 40);
    try {
      if (b.action === 'dept.add') {
        if (!name) return q(res, base, null, 'Name required.');
        if (t.departments.some((x) => x.name.toLowerCase() === name.toLowerCase())) return q(res, base, null, 'That department exists.');
        t.departments.push({ id: store.uid(), name, emoji: String(b.emoji || '').trim().slice(0, 8), levels: [] });
        store.activity(t, `🗂️ Department "${name}" created`);
      } else if (!d) return q(res, base, null, 'Department not found.');
      else if (b.action === 'dept.edit') { d.name = name || d.name; d.emoji = String(b.emoji || '').trim().slice(0, 8); }
      else if (b.action === 'dept.delete') { t.departments.splice(t.departments.indexOf(d), 1); store.activity(t, `🗂️ Department "${d.name}" deleted`); }
      else if (b.action === 'dept.move') { const i = t.departments.indexOf(d), j = b.dir === 'up' ? i - 1 : i + 1; if (j >= 0 && j < t.departments.length) [t.departments[i], t.departments[j]] = [t.departments[j], t.departments[i]]; }
      else if (b.action === 'level.add') {
        if (!name) return q(res, base, null, 'Position name required.');
        d.levels.push({ id: store.uid(), name, roleMain: b.roleMain || null, roleStaff: b.roleStaff || null });
        store.activity(t, `🗂️ Position "${name}" added to ${d.name}`);
      } else if (b.action === 'level.edit') {
        const i = d.levels.findIndex((l) => l.id === b.level);
        if (i === -1) return q(res, base, null, 'Position not found.');
        if (b.del) { d.levels.splice(i, 1); store.activity(t, `🗂️ Position "${name}" removed from ${d.name}`); }
        else if (b.move) { const j = b.move === 'up' ? i + 1 : i - 1; if (j >= 0 && j < d.levels.length) [d.levels[i], d.levels[j]] = [d.levels[j], d.levels[i]]; }
        else { Object.assign(d.levels[i], { name: name || d.levels[i].name, roleMain: b.roleMain || null, roleStaff: b.roleStaff || null }); }
      }
      store.save();
      // roles may have changed -> re-sync affected staff in the background
      if (['level.edit', 'level.add', 'dept.delete'].includes(b.action)) for (const m of team.activeStaff(t)) team.syncMember(client, t, m.userId, 'Roster changed').catch(() => null);
      return q(res, base, 'Roster saved.');
    } catch (err) {
      console.error('roster POST failed:', err);
      return q(res, base, null, err.message);
    }
  });

  // -------------------------------------------------------------- staff
  app.get('/dashboard/:teamId/staff', requireLogin, requireTeam, (req, res) => {
    const filter = { q: String(req.query.q || '').trim().toLowerCase(), status: req.query.status || 'active' };
    let members = Object.values(req.t.members);
    if (filter.status === 'active') members = members.filter((m) => m.status !== 'resigned');
    else if (filter.status !== 'all') members = members.filter((m) => m.status === filter.status);
    if (filter.q) members = members.filter((m) => [m.tag, m.name, m.userId].some((x) => String(x || '').toLowerCase().includes(filter.q)));
    members = members.map((m) => enrich(req.t, m)).sort((a, b) => a.deptName.localeCompare(b.deptName) || a.posName.localeCompare(b.posName));
    res.send(views.staff(ctx(req, 'staff', { members, filter })));
  });
  app.post('/dashboard/:teamId/staff', requireLogin, requireTeam, csrf, async (req, res) => {
    const base = `${req.base}/staff`;
    if (req.body.action !== 'add') return q(res, base, null, 'Unknown action.');
    let pos = null;
    for (const d of req.t.departments) for (const l of d.levels) if (l.id === req.body.level) pos = { dept: d, level: l };
    if (!pos) return q(res, base, null, 'Pick a position.');
    const userId = String(req.body.userId || '').trim();
    if (!/^\d{15,22}$/.test(userId)) return q(res, base, null, 'Invalid user ID.');
    if (!(await team.fetchMember(req.staff, userId))) return q(res, base, null, 'That user is not in the staff server. They must join it first.');
    const saved = req.t.requireApplication;
    req.t.requireApplication = false; // manual add skips the application check
    const r = await team.verify(client, req.t, { userId, deptId: pos.dept.id, levelId: pos.level.id, by: actor(req), notes: 'Added from the dashboard' }).finally(() => (req.t.requireApplication = saved));
    return r.ok ? res.redirect(`${base}/${userId}?ok=${encodeURIComponent(r.text)}`) : q(res, base, null, r.text.replace(/<@!?\d+>/g, 'User'));
  });
  app.get('/dashboard/:teamId/staff/:userId', requireLogin, requireTeam, async (req, res) => {
    const m = req.t.members[req.params.userId];
    if (!m) return res.status(404).send(views.error('No staff record for that user.', req.session));
    const user = await client.users.fetch(m.userId).catch(() => null);
    const sync = { main: Boolean(await team.fetchMember(req.main, m.userId)), staff: Boolean(await team.fetchMember(req.staff, m.userId)) };
    res.send(views.member(ctx(req, 'staff', { m: enrich(req.t, m), user: user ? { avatar: user.displayAvatarURL({ size: 128 }) } : null, sync })));
  });
  app.post('/dashboard/:teamId/staff/:userId', requireLogin, requireTeam, csrf, async (req, res) => {
    const t = req.t, b = req.body, userId = req.params.userId, base = `${req.base}/staff/${userId}`, by = actor(req);
    const m = t.members[userId];
    if (!m) return q(res, base, null, 'No such staff member.');
    const pos = (id) => { for (const d of t.departments) for (const l of d.levels) if (l.id === id) return { deptId: d.id, levelId: l.id }; return null; };
    let r;
    try {
      switch (b.action) {
        case 'strike': r = await team.strike(client, t, { userId, by, reason: String(b.reason || '').trim().slice(0, 500) || 'No reason given' }); break;
        case 'unstrike': r = team.unstrike(t, userId, b.strike, by); break;
        case 'setpos': { const p = pos(b.level); r = p ? await team.changePosition(client, t, { userId, by, toDeptId: p.deptId, toLevelId: p.levelId, reason: b.reason || null }) : { ok: false, text: 'Unknown position.' }; break; }
        case 'promote': r = await team.changePosition(client, t, { userId, by, direction: 'up' }); break;
        case 'demote': r = await team.changePosition(client, t, { userId, by, direction: 'down' }); break;
        case 'sync': await team.syncMember(client, t, userId, 'Dashboard re-sync'); r = { ok: true, text: 'Roles and nickname re-applied in both servers.' }; break;
        case 'loa': { const ms = parseDuration(b.duration); r = ms && ms >= 60e3 ? await team.startLoa(client, t, { userId, by, durationMs: Math.min(ms, 90 * 86400e3), reason: String(b.reason || '').slice(0, 300) }) : { ok: false, text: 'Duration must look like 3d, 1w, 12h.' }; break; }
        case 'endloa': r = await team.endLoa(client, t, { userId, by }); break;
        case 'remove': r = await team.resign(client, t, { userId, by, reason: b.reason || null, fired: true }); break;
        case 'note': m.notes = String(b.notes || '').slice(0, 1000); store.save(); r = { ok: true, text: 'Notes saved.' }; break;
        case 'add': { const p = pos(b.level); if (!p) { r = { ok: false, text: 'Pick a position.' }; break; } const saved = t.requireApplication; t.requireApplication = false; r = await team.verify(client, t, { userId, deptId: p.deptId, levelId: p.levelId, by, notes: 'Re-added from the dashboard' }).finally(() => (t.requireApplication = saved)); break; }
        default: r = { ok: false, text: 'Unknown action.' };
      }
    } catch (err) {
      console.error('staff POST failed:', err);
      r = { ok: false, text: err.message };
    }
    const clean = (s) => s.replace(/<@!?(\d+)>/g, (_, id) => t.members[id]?.tag || 'user').replace(/\*\*/g, '');
    return q(res, base, r.ok ? clean(r.text) : null, r.ok ? null : clean(r.text));
  });

  // -------------------------------------------------------------- applications
  app.get('/dashboard/:teamId/applications', requireLogin, requireTeam, async (req, res) => {
    const all = Object.values(req.t.applications).sort((a, b) => b.at.localeCompare(a.at));
    const pending = [];
    for (const a of all.filter((x) => x.status === 'pending')) pending.push({ ...a, prior: all.filter((x) => x.userId === a.userId && x.id !== a.id).length, inStaff: Boolean(req.staff?.members.cache.has(a.userId)) });
    res.send(views.applications(ctx(req, 'applications', { pending, history: all.filter((x) => x.status !== 'pending') })));
  });
  app.post('/dashboard/:teamId/applications', requireLogin, requireTeam, csrf, async (req, res) => {
    const t = req.t, b = req.body, base = `${req.base}/applications`, by = actor(req);
    let r;
    try {
      if (b.action === 'accept') r = await applications.accept(client, t, b.app, by);
      else if (b.action === 'deny') r = await applications.deny(client, t, b.app, by, String(b.reason || '').trim().slice(0, 500) || null);
      else if (b.action === 'questions') {
        const qs = [];
        for (let i = 0; i < 5; i++) { const label = String(b[`q${i}`] || '').trim().slice(0, 45); if (label) qs.push({ label, long: Boolean(b[`long${i}`]), required: Boolean(b[`req${i}`]) }); }
        if (!qs.length) r = { ok: false, text: 'At least one question is needed.' };
        else { t.questions = qs; store.save(); r = { ok: true, text: `Saved ${qs.length} question(s).` }; }
      } else if (b.action === 'invite') {
        const url = String(b.inviteUrl || '').trim();
        if (url && !/^https:\/\/(www\.)?(discord\.gg|discord\.com\/invite)\//.test(url)) r = { ok: false, text: 'That is not a Discord invite link.' };
        else { t.inviteUrl = url || null; store.save(); r = { ok: true, text: 'Invite saved.' }; }
      } else r = { ok: false, text: 'Unknown action.' };
    } catch (err) {
      console.error('applications POST failed:', err);
      r = { ok: false, text: err.message };
    }
    return q(res, base, r.ok ? r.text.replace(/`/g, '') : null, r.ok ? null : r.text);
  });

  // -------------------------------------------------------------- breaks
  app.get('/dashboard/:teamId/breaks', requireLogin, requireTeam, (req, res) => {
    const t = req.t;
    const reqs = Object.values(t.breakRequests).sort((a, b) => b.at.localeCompare(a.at));
    res.send(views.breaks(ctx(req, 'breaks', {
      onBreak: team.activeStaff(t).filter((m) => m.status === 'loa').map((m) => enrich(t, m)).sort((a, b) => a.loa.until.localeCompare(b.loa.until)),
      requests: reqs.filter((r) => r.status === 'pending').map((r) => ({ ...r, duration: formatDuration(r.durationMs), m: enrich(t, t.members[r.userId] || { userId: r.userId, tag: '?', strikes: [], history: [] }) })),
      past: reqs.filter((r) => r.status !== 'pending').map((r) => ({ ...r, duration: formatDuration(r.durationMs), tag: t.members[r.userId]?.tag || r.userId })),
    })));
  });
  app.post('/dashboard/:teamId/breaks', requireLogin, requireTeam, csrf, async (req, res) => {
    const t = req.t, b = req.body, base = `${req.base}/breaks`, by = actor(req);
    let r;
    try {
      if (b.action === 'approve') r = await breaks.approve(client, t, b.req, by);
      else if (b.action === 'denyreq') r = await breaks.deny(client, t, b.req, by);
      else if (b.action === 'end') r = await team.endLoa(client, t, { userId: b.userId, by });
      else if (b.action === 'give') { const ms = parseDuration(b.duration); r = ms && ms >= 60e3 ? await team.startLoa(client, t, { userId: b.userId, by, durationMs: Math.min(ms, 90 * 86400e3), reason: String(b.reason || '').slice(0, 300) }) : { ok: false, text: 'Duration must look like 3d, 1w, 12h.' }; }
      else r = { ok: false, text: 'Unknown action.' };
    } catch (err) {
      console.error('breaks POST failed:', err);
      r = { ok: false, text: err.message };
    }
    const clean = (s) => s.replace(/<@!?(\d+)>/g, (_, id) => t.members[id]?.tag || 'user').replace(/<t:(\d+):?\w?>/g, (_, s) => new Date(s * 1000).toUTCString()).replace(/\*\*/g, '');
    return q(res, base, r.ok ? clean(r.text) : null, r.ok ? null : clean(r.text));
  });

  // -------------------------------------------------------------- settings
  app.get('/dashboard/:teamId/settings', requireLogin, requireTeam, (req, res) => {
    res.send(views.settings(ctx(req, 'settings', { staffChannels: chansOf(req.staff), mainChannels: chansOf(req.main), mainRoles: rolesOf(req.main), staffRoles: rolesOf(req.staff) })));
  });
  app.post('/dashboard/:teamId/settings', requireLogin, requireTeam, csrf, async (req, res) => {
    const t = req.t, b = req.body, base = `${req.base}/settings`;
    if (b.action === 'unlink') {
      store.deleteTeam(t.id);
      return res.redirect('/dashboard?ok=' + encodeURIComponent('Servers unlinked.'));
    }
    for (const k of ['applications', 'announcements', 'log', 'breaks', 'mainAnnouncements']) t.channels[k] = b[`ch_${k}`] || null;
    for (const k of ['staffMain', 'staffStaff', 'loaMain', 'loaStaff', 'pendingStaff']) t.roles[k] = b[`r_${k}`] || null;
    t.managerRoles = [].concat(b.managerRoles || []).filter(Boolean);
    const fmt = String(b.nicknameFormat || '').trim().slice(0, 32);
    if (fmt && fmt !== t.nicknameFormat) {
      t.nicknameFormat = fmt.includes('{name}') ? fmt : `${fmt} {name}`.slice(0, 32);
      for (const m of team.activeStaff(t)) team.syncMember(client, t, m.userId, 'Nickname format changed').catch(() => null);
    }
    t.requireApplication = Boolean(b.requireApplication);
    t.strikeLimit = Math.min(20, Math.max(1, Number(b.strikeLimit) || 3));
    t.strikeAction = ['alert', 'demote', 'remove'].includes(b.strikeAction) ? b.strikeAction : 'alert';
    store.save();
    return q(res, base, 'Settings saved.');
  });
}

module.exports = { mount };
