// Staff activity: per-day counters per staff member, leaderboard, weekly report, inactivity.
//   record(t, userId, kind)   kind: msgs | mod | interviews | apps | verifs
const store = require('./store');
const { day } = require('./util');

const KINDS = ['msgs', 'mod', 'interviews', 'apps', 'verifs'];
const LABEL = { msgs: 'messages', mod: 'mod actions', interviews: 'interviews', apps: 'applications', verifs: 'verifications' };
const KEEP_DAYS = 90;

function record(t, userId, kind, n = 1) {
  if (!KINDS.includes(kind)) return;
  const m = t.members[userId];
  if (!m || m.status === 'resigned') return;
  const d = day();
  const u = (t.stats[userId] ||= {});
  const row = (u[d] ||= { msgs: 0, mod: 0, interviews: 0, apps: 0, verifs: 0 });
  row[kind] += n;
  t.lastSeen[userId] = new Date().toISOString();
  store.save();
}

function prune(t) {
  const cutoff = day(new Date(Date.now() - KEEP_DAYS * 86400e3));
  for (const u of Object.values(t.stats)) for (const d of Object.keys(u)) if (d < cutoff) delete u[d];
}

// totals for one member over the last N days -> { msgs, mod, interviews, apps, verifs, total }
function totals(t, userId, days = 30) {
  const cutoff = day(new Date(Date.now() - days * 86400e3));
  const out = { msgs: 0, mod: 0, interviews: 0, apps: 0, verifs: 0, total: 0 };
  for (const [d, row] of Object.entries(t.stats[userId] || {})) {
    if (d < cutoff) continue;
    for (const k of KINDS) out[k] += row[k] || 0;
  }
  out.total = out.msgs + out.mod * 3 + out.interviews * 5 + out.apps * 2 + out.verifs * 3; // weighted score
  return out;
}
// per-day totals across the team (for the dashboard graph): [{ day, msgs, mod, ... }] oldest -> newest
function series(t, days = 30) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = day(new Date(Date.now() - i * 86400e3));
    const row = { day: d, msgs: 0, mod: 0, interviews: 0, apps: 0, verifs: 0 };
    for (const u of Object.values(t.stats)) for (const k of KINDS) row[k] += u[d]?.[k] || 0;
    out.push(row);
  }
  return out;
}
function leaderboard(t, days = 30) {
  return Object.values(t.members)
    .filter((m) => m.status !== 'resigned')
    .map((m) => ({ m, ...totals(t, m.userId, days) }))
    .sort((a, b) => b.total - a.total);
}
function inactive(t, days) {
  const cutoff = Date.now() - days * 86400e3;
  return Object.values(t.members).filter((m) => m.status === 'active' && new Date(t.lastSeen[m.userId] || m.joinedAt).getTime() < cutoff);
}

module.exports = { KINDS, LABEL, record, prune, totals, series, leaderboard, inactive };
