// Counts moderation actions done by staff in the MAIN server (bans, kicks, timeouts, message
// deletes) — whatever bot or tool was used. Needs the View Audit Log permission.
const { Events, AuditLogEvent } = require('discord.js');
const store = require('../lib/store');
const stats = require('../lib/stats');

const MOD = new Set([AuditLogEvent.MemberKick, AuditLogEvent.MemberBanAdd, AuditLogEvent.MemberBanRemove, AuditLogEvent.MessageDelete, AuditLogEvent.MessageBulkDelete, AuditLogEvent.MemberUpdate]);

module.exports = {
  name: Events.GuildAuditLogEntryCreate,
  async execute(client, entry, guild) {
    const t = store.teamFor(guild.id);
    if (!t || guild.id !== t.mainGuildId) return;
    if (!MOD.has(entry.action)) return;
    // MemberUpdate only counts as moderation when it is a timeout
    if (entry.action === AuditLogEvent.MemberUpdate && !entry.changes?.some((c) => c.key === 'communication_disabled_until' && c.new)) return;
    const by = entry.executorId;
    if (!by || by === client.user.id || !t.members[by]) return;
    stats.record(t, by, 'mod');
  },
};
