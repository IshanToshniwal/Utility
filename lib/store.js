// JSON database with optional Postgres (DATABASE_URL) or backup to a private
// Discord channel (DATA_CHANNEL_ID). Render's free disk is wiped on deploy.
//
// Data model: a "team" = one main server + one staff server linked together.
//   data.teams[teamId]      -> team (teamId === staff guild id)
//   data.guildTeam[guildId] -> teamId  (for both guilds of the pair)
const fs = require('fs');
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

const DEFAULT_TEAM = (mainGuildId, staffGuildId) => ({
  id: staffGuildId,
  mainGuildId,
  staffGuildId,
  createdAt: new Date().toISOString(),
  channels: {
    // all in the STAFF guild unless noted; anything unset falls back to `log`
    applications: null, // /apply submissions with Accept/Deny
    proof: null, // accepted applicants post their proof here (or use /proof)
    verification: null, // proof requests land here with a position dropdown + Deny for managers
    announcements: null, // new staff / promotions / farewells
    guide: null, // new staff member is pinged here with the guide
    roster: null, // one live roster message, auto-updated
    strikes: null, // strike log
    breaks: null, // LOA requests + notices
    log: null, // general staff log (fallback for everything)
    mainAnnouncements: null, // MAIN guild (optional): public "welcome our new staff" post
  },
  rosterMessageId: null,
  messages: {
    guide: '👋 Welcome to the staff team, {user}!\n\nYou have been verified as **{position}** in **{department}**. Your nickname in both servers is now `{nickname}` — please keep it.\n\n**Your staff channels:** {channels}\n\n**Quick guide**\n• Read the staff rules and the pinned messages first\n• Need time off? Use `/break duration reason` — a manager approves it\n• See your own record with `/staff record`\n• Resigning? Use `/bye`\n\nIf anything is unclear, ask a manager. Glad to have you! 💙',
    acceptDm: '🎉 Your staff application for **{server}** was accepted!\n\n**Next steps**\n1. Join the staff server: {invite}\n2. Post your proof (a screenshot, as asked by the team) in the proof channel there, or use `/proof`\n3. A manager will verify you and you will get your role and channels automatically.',
    denyDm: 'Your staff application for **{server}** was not accepted.\n{reason}\nThank you for applying — you may apply again in the future.',
    verifyDm: 'You are now **{position}** in **{department}** of **{server}**! 🎉\nYour nickname is `{nickname}`. Your staff channels: {channels}',
    announcement: 'Please welcome {user} to the team as our new **{position}** ({department})! 🎉',
  },
  verifications: {}, // id -> { id, userId, tag, proofUrl, note, at, status: pending|approved|denied, by, levelId, messageId, channelId }
  managerRoles: [], // staff guild role IDs that may verify/promote/strike/loa (admins always can)
  roles: {
    staffMain: null, // base "Staff" role in main guild given to every verified member
    staffStaff: null, // base role in staff guild
    loaMain: null,
    loaStaff: null,
    pendingStaff: null, // staff guild role for accepted-but-not-verified people
  },
  inviteUrl: null, // staff-server invite sent on accept (auto-created if empty)
  nicknameFormat: '[{position} | {name}]',
  requireApplication: true, // /verify only works for accepted applicants
  strikeLimit: 3,
  strikeAction: 'alert', // alert | demote | remove
  questions: [
    { label: 'How old are you and what is your timezone?', long: false, required: true },
    { label: 'Do you have previous staff experience? Where?', long: true, required: true },
    { label: 'Why do you want to join the staff team?', long: true, required: true },
    { label: 'How many hours per week can you be active?', long: false, required: true },
    { label: 'Anything else we should know?', long: true, required: false },
  ],
  departments: [], // { id, name, emoji, levels: [ { id, name, nick, roleMain, roleStaff } ] }  nick = short tag used in nicknames  levels ordered lowest -> highest
  members: {}, // userId -> { userId, tag, name, deptId, levelId, status: active|loa|resigned, joinedAt, strikes: [], history: [], loa: {until, reason, by, at} | null, resignedAt }
  applications: {}, // id -> { id, userId, tag, answers: [{q,a}], at, status: pending|accepted|denied, by, reason, messageId, channelId }
  breakRequests: {}, // id -> { id, userId, durationMs, reason, at, status: pending|approved|denied, messageId }
  counters: { app: 0, strike: 0, breakReq: 0, verify: 0 },
  activity: [], // last 100 { at, text }
});

const data = { teams: {}, guildTeam: {} };
let client = null;
let saveTimer = null;

let pg = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pg = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
  } catch (err) {
    console.error('pg module not available, falling back to file/Discord backup:', err.message);
  }
}
async function pgInit() {
  if (!pg) return false;
  try {
    await pg.query('CREATE TABLE IF NOT EXISTS staffhub_store (id INT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT now())');
    const r = await pg.query('SELECT data FROM staffhub_store WHERE id = 1');
    if (r.rows[0]) {
      Object.assign(data, r.rows[0].data);
      console.log('Loaded database from Postgres.');
    }
    return true;
  } catch (err) {
    console.error('Postgres init failed:', err.message);
    pg = null;
    return false;
  }
}
async function pgSave() {
  if (!pg) return;
  try {
    await pg.query('INSERT INTO staffhub_store (id, data, updated_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()', [JSON.stringify(data)]);
  } catch (err) {
    console.error('Postgres save failed:', err.message);
  }
}

// ------------------------------------------------------------------ teams
function fill(team) {
  const def = DEFAULT_TEAM(team.mainGuildId, team.staffGuildId);
  for (const k of Object.keys(def)) if (team[k] === undefined) team[k] = def[k];
  for (const k of ['channels', 'roles', 'counters', 'messages']) for (const kk of Object.keys(def[k])) if (team[k][kk] === undefined) team[k][kk] = def[k][kk];
  return team;
}
function team(teamId) {
  const t = data.teams[teamId];
  return t ? fill(t) : null;
}
function teamFor(guildId) {
  const id = data.guildTeam[guildId];
  return id ? team(id) : null;
}
function createTeam(mainGuildId, staffGuildId) {
  const t = DEFAULT_TEAM(mainGuildId, staffGuildId);
  data.teams[t.id] = t;
  data.guildTeam[mainGuildId] = t.id;
  data.guildTeam[staffGuildId] = t.id;
  save();
  return t;
}
function deleteTeam(teamId) {
  const t = data.teams[teamId];
  if (!t) return;
  delete data.guildTeam[t.mainGuildId];
  delete data.guildTeam[t.staffGuildId];
  delete data.teams[teamId];
  save();
}
function activity(t, text) {
  t.activity.unshift({ at: new Date().toISOString(), text });
  if (t.activity.length > 100) t.activity.length = 100;
}
const uid = () => Math.random().toString(36).slice(2, 8);

// ------------------------------------------------------------------ persistence
function load() {
  try {
    if (fs.existsSync(DATA_FILE)) Object.assign(data, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
  } catch (err) {
    console.error('Could not read data.json, starting fresh:', err.message);
  }
}
function writeFile() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Could not write data.json:', err.message);
  }
}
async function backupToDiscord() {
  const channelId = process.env.DATA_CHANNEL_ID;
  if (!channelId || !client?.isReady()) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(data)), { name: 'data.json' });
    await channel.send({ content: `📦 Backup ${new Date().toISOString()}`, files: [file] });
    const msgs = await channel.messages.fetch({ limit: 20 });
    const mine = [...msgs.values()].filter((m) => m.author.id === client.user.id && m.attachments.size).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    for (const old of mine.slice(3)) await old.delete().catch(() => null);
  } catch (err) {
    console.error('Backup to Discord failed:', err.message);
  }
}
async function restoreFromDiscord() {
  const channelId = process.env.DATA_CHANNEL_ID;
  if (!channelId || !client?.isReady()) return;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const msgs = await channel.messages.fetch({ limit: 20 });
    const latest = [...msgs.values()].filter((m) => m.author.id === client.user.id && m.attachments.size).sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
    if (!latest) return;
    const res = await fetch(latest.attachments.first().url);
    Object.assign(data, await res.json());
    writeFile();
    console.log('Restored database from Discord backup.');
  } catch (err) {
    console.error('Restore from Discord failed:', err.message);
  }
}
function save() {
  writeFile();
  if (!process.env.DATA_CHANNEL_ID && !pg) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    pgSave();
    backupToDiscord();
  }, pg ? 3_000 : 20_000);
}
async function restore() {
  if (await pgInit()) return;
  await restoreFromDiscord();
}

load();

module.exports = {
  data, team, teamFor, createTeam, deleteTeam, activity, uid, save,
  attachClient: (c) => (client = c),
  restore,
  flush: async () => { await pgSave(); await backupToDiscord(); },
  hasPostgres: () => Boolean(pg),
};
